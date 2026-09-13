import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
//   - package-static lua -> <base>/lua (upstream core Lua never downgraded)
//   - exact Mega Z2K lua seed closure -> package materialized on clean install
//   - other lifecycle Z2K lua -> blocked until Registry-backed activation
//   - lists      -> <base>/lists and <base>/ipset
//
// The script must accept root overrides for sandboxed testing while defaulting
// to canonical paths, and --verify prints a JSON verdict.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SYNC = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'strategy-runtime-assets-sync.sh');
const SRC = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'runtime-assets');
const PACKAGE_COMPOSITION = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'runtime-composition-package.json');
const MEGA_LUA_CLOSURE = ['z2k-modern-core.lua', 'z2k-state-persist.lua'];
const NON_MEGA_Z2K_LUA = [
  'z2k-alert.lua', 'z2k-fooling-ext.lua', 'z2k-quic-silence.lua', 'z2k-range-rand.lua',
];
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

function runSync(sb, args = [], source = SRC) {
  const result = spawnSync(SHELL, [bashPath(SYNC), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      Z2M_RUNTIME_ASSETS_SRC: bashPath(source),
      Z2M_RUNTIME_BASE: bashPath(sb.base),
      Z2M_MANAGER_STATE_ROOT: bashPath(sb.stateRoot),
      Z2M_MANAGER_ETC_ROOT: bashPath(sb.etcRoot),
      Z2M_PREFLIGHT_MANIFEST: bashPath(path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share', 'zapret2-manager', 'native-preflight.json')),
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
  for (const name of ['zapret-lib.lua', 'custom_diag.lua'])
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), true, `${name} missing`);
  for (const name of MEGA_LUA_CLOSURE)
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), true, `${name} missing from clean-install Mega closure`);
  for (const name of NON_MEGA_Z2K_LUA)
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), false, `${name} must remain Registry-backed`);
  const verdict = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.equal(verdict.lifecycleState, 'blocked-unknown-authority');
  assert.equal(verdict.blockedLifecycleAssets, NON_MEGA_Z2K_LUA.length);
  assert.equal(MEGA_LUA_CLOSURE.filter(name => !fs.existsSync(path.join(sb.base, 'lua', name))).length, 0,
    'MEGA_STATIC_RUNTIME_MISSING must be zero');
  assert.equal(fs.existsSync(path.join(sb.base, 'lists', 'discord.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.base, 'ipset', 'discord.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.base, 'lists', 'discovered-domains.txt')), true);
  assert.equal(fs.existsSync(path.join(sb.stateDir, 'state.tsv')), true);
});

test('package composition declares the exact Mega Lua closure and no extra Z2K seeds', () => {
  const composition = JSON.parse(fs.readFileSync(PACKAGE_COMPOSITION, 'utf8'));
  const strategy = composition.strategies.find(item => item.id === 'discord-stressozz-autocircular');
  assert.ok(strategy, 'Mega Strategy package entry missing');
  for (const name of MEGA_LUA_CLOSURE)
    assert.ok(strategy.dependencies.includes(`/runtime-assets/lua/${name}`), `${name} missing from Mega dependencies`);

  const seeds = composition.entries.filter(item => item.seedForLifecycle === 'z2k-core');
  assert.deepEqual(seeds.map(item => item.id), [
    'package:z2k-modern-core', 'package:z2k-state-persist',
  ]);
  assert.deepEqual(seeds.map(item => item.sourcePath), MEGA_LUA_CLOSURE.map(name => `files/lua/${name}`));
  for (const item of seeds) {
    assert.equal(item.owner, 'package');
    assert.equal(item.type, 'package-static');
    assert.equal(item.role, 'lua-init');
    assert.equal(item.kind, 'lua');
    assert.equal(item.runtimeTarget, `/runtime-assets/lua/${item.sourcePath.split('/').pop()}`);
    const bytes = fs.readFileSync(path.join(SRC, 'lua', item.sourcePath.split('/').pop()));
    assert.equal(item.byteSize, bytes.length);
    assert.equal(item.contentSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(item.provenance.sourceCommit, '54b6765f2ab3e0f7f13030c90c809f1dcacfcce2');
  }
});

test('materialization copies only the exact Mega Z2K closure, not every z2k Lua', () => {
  const sb = sandbox();
  const source = path.join(sb.dir, 'package-assets');
  fs.mkdirSync(path.join(source, 'lua'), { recursive: true });
  for (const name of [...MEGA_LUA_CLOSURE, ...NON_MEGA_Z2K_LUA])
    fs.copyFileSync(path.join(SRC, 'lua', name), path.join(source, 'lua', name));
  fs.writeFileSync(path.join(source, 'lua', 'z2k-unrelated.lua'), 'function z2k_unrelated() end\n');

  const result = runSync(sb, [], source);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of MEGA_LUA_CLOSURE)
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), true, `${name} missing`);
  for (const name of [...NON_MEGA_Z2K_LUA, 'z2k-unrelated.lua'])
    assert.equal(fs.existsSync(path.join(sb.base, 'lua', name)), false, `${name} was copied blindly`);
  const verdict = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.equal(verdict.blockedLifecycleAssets, NON_MEGA_Z2K_LUA.length + 1);
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

test('refreshes an existing Manager-owned Lua sidecar from the package baseline', () => {
  const sb = sandbox();
  const source = path.join(sb.dir, 'package-assets', 'lua');
  const target = path.join(sb.base, 'lua');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'z2m-hostkey-policy.lua'), '-- package NEW\n');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'z2m-hostkey-policy.lua'), '-- runtime OLD\n');

  const result = spawnSync(SHELL, [bashPath(SYNC)], {
    cwd: ROOT,
    env: {
      ...process.env,
      Z2M_RUNTIME_ASSETS_SRC: bashPath(path.join(sb.dir, 'package-assets')),
      Z2M_RUNTIME_BASE: bashPath(sb.base),
      Z2M_MANAGER_STATE_ROOT: bashPath(sb.stateRoot),
      Z2M_MANAGER_ETC_ROOT: bashPath(sb.etcRoot),
      Z2M_PREFLIGHT_MANIFEST: bashPath(path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share', 'zapret2-manager', 'native-preflight.json')),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
    },
    encoding: 'utf8', timeout: 240_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(target, 'z2m-hostkey-policy.lua'), 'utf8'), '-- package NEW\n');
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
  fs.writeFileSync(path.join(sb.base, 'lua', 'custom_diag.lua'), '-- tampered\n');
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
