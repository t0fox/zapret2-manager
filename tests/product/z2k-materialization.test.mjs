import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Z2K runtime asset materialization contract.
//
// Bundled package assets (/usr/share/zapret2-manager/runtime-assets) are NOT
// "Z2K ready" by themselves. The engine install transaction must materialize
// them into the live /opt/zapret2 roots and then VERIFY the installed copies
// against the package baseline digests:
//   - bin blobs  -> <base>/files/fake (+ <base>/bin compatibility link)
//   - lua        -> <base>/lua  (upstream core Lua never downgraded)
//   - lists      -> <base>/lists and <base>/ipset
//
// The script must accept root overrides for sandboxed testing while defaulting
// to canonical paths, and --verify prints a JSON verdict.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SYNC = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'strategy-runtime-assets-sync.sh');
const SRC = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'runtime-assets');
const SHELL = process.platform === 'win32'
  ? (process.env.Z2M_TEST_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
  : '/bin/sh';

function bashPath(value) {
  if (process.platform !== 'win32') return value;
  const normalized = value.replaceAll('\\', '/');
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-sync-'));
  // The engine installer owns creating the runtime base before sync runs;
  // emulate that so the script's shallow mkdir calls have their parent.
  const base = path.join(dir, 'opt', 'zapret2');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(dir, 'etc', 'zapret2-manager'), { recursive: true });
  return {
    dir,
    base,
    stateRoot: path.join(dir, 'etc', 'zapret2-manager', 'state'),
    stateDir: path.join(dir, 'etc', 'zapret2-manager', 'state', 'autocircular'),
    etcRoot: path.join(dir, 'etc', 'zapret2-manager')
  };
}

function runSync(sb, args = []) {
  const result = spawnSync(SHELL, [bashPath(SYNC), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      Z2M_RUNTIME_ASSETS_SRC: bashPath(SRC),
      Z2M_RUNTIME_BASE: bashPath(sb.base),
      Z2M_MANAGER_STATE_ROOT: bashPath(sb.stateRoot),
      Z2M_MANAGER_ETC_ROOT: bashPath(sb.etcRoot),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
    },
    encoding: 'utf8', timeout: 240_000
  });
  if (result.status !== 0 || result.error) {
    console.error('SYNC STDERR:', result.stderr);
    console.error('SYNC STDOUT:', result.stdout);
  }
  return result;
}

test('materializes blobs, lua, lists into the live engine roots', () => {
  const sb = sandbox();
  const result = runSync(sb);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fake = fs.readdirSync(path.join(SRC, 'bin'));
  for (const name of fake.slice(0, 5)) {
    assert.equal(fs.existsSync(path.join(sb.base, 'files', 'fake', name)), true, `blob ${name} missing`);
    assert.equal(fs.existsSync(path.join(sb.base, 'bin')), true, 'compatibility bin link missing');
  }
  for (const name of ['z2k-modern-core.lua', 'z2k-detectors.lua']) {
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), true, `${name} missing`);
  }
  assert.equal(fs.existsSync(path.join(sb.base, 'lists', 'discord.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.base, 'ipset', 'discord.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.stateDir, 'state.tsv')), true);
});

test('is idempotent and never downgrades existing upstream core Lua', () => {
  const sb = sandbox();
  assert.equal(runSync(sb).status, 0);
  // Simulate a custom upstream core file that MUST be preserved verbatim.
  const coreTarget = path.join(sb.base, 'lua', 'zapret-lib.lua');
  fs.writeFileSync(coreTarget, '-- upstream custom core\n');
  const second = runSync(sb);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readFileSync(coreTarget, 'utf8'), '-- upstream custom core\n',
    'upstream core Lua was overwritten');
});

test('--verify reports ok when installed copies match the baseline', () => {
  const sb = sandbox();
  assert.equal(runSync(sb).status, 0);
  const verify = runSync(sb, ['--verify']);
  assert.equal(verify.status, 0, verify.stdout || verify.stderr);
  const verdict = JSON.parse(verify.stdout.trim().split('\n').pop());
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.ok(verdict.files.length > 50, 'verify must cover the full baseline set');
});

test('--verify fails closed on a modified installed copy', () => {
  const sb = sandbox();
  assert.equal(runSync(sb).status, 0);
  fs.writeFileSync(path.join(sb.base, 'lua', 'z2k-modern-core.lua'), '-- tampered\n');
  const verify = runSync(sb, ['--verify']);
  assert.notEqual(verify.status, 0, 'tampered copy must not verify');
  const verdict = JSON.parse(verify.stdout.trim().split('\n').pop());
  assert.equal(verdict.ok, false);
  assert.ok(verdict.mismatched.length >= 1, JSON.stringify(verdict));
});

test('--verify fails closed on a missing mandatory asset', () => {
  const sb = sandbox();
  assert.equal(runSync(sb).status, 0);
  fs.rmSync(path.join(sb.base, 'files', 'fake', 'fake_tls_1.bin'));
  const verify = runSync(sb, ['--verify']);
  assert.notEqual(verify.status, 0);
  const verdict = JSON.parse(verify.stdout.trim().split('\n').pop());
  assert.equal(verdict.ok, false);
  assert.ok(verdict.missing.length >= 1, JSON.stringify(verdict));
});
