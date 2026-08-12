import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'zapret2-manager/src/z2m-scanner-firewall-helper.c');

test('native Scanner firewall helper has no caller-controlled execution surface', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');
  for (const fixed of ['"/usr/sbin/nft"', '"zapret2"', '"z2m_scanner"', '"300"',
    '"compare_delete"', '"delete"', '"chain"', '"inet"']) assert.match(source, new RegExp(fixed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /getenv|system\s*\(|popen\s*\(|execvp\s*\(|nft\s+flush/);
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /flock\(lock, LOCK_EX\)/);
});

test('production Scanner firewall helper fails closed before any nft or filesystem mutation', () => {
  if (process.platform === 'win32') return;
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  const pkg = spawnSync('pkg-config', ['--exists', 'json-c'], { encoding: 'utf8' });
  if (cc.status !== 0 || pkg.status !== 0) {
    assert.ok(true, 'native compiler or json-c unavailable; production helper execution limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-firewall-helper-prod-'));
  const bin = path.join(root, 'helper');
  try {
    const built = spawnSync('cc', [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', SOURCE,
      ...spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' }).stdout.trim().split(/\s+/),
      '-o', bin,
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const nonce = 'b'.repeat(64);
    const request = JSON.stringify({ candidate: 'candidate1', expectedChainDigest: 'c'.repeat(64), generation: 7,
      marker: `z2m-scanner:session1:candidate1:7:${nonce}`, nonce, operation: 'compare_delete',
      ownershipToken: `scanner-firewall-v1:session1:candidate1:7:${nonce}`, session: 'session1' });
    const ran = spawnSync(bin, [], { input: request, encoding: 'utf8' });
    assert.notEqual(ran.status, 0);
    assert.deepEqual(JSON.parse(ran.stdout), {
      ok: false, code: 'EUNSUPPORTED', evidence: 'atomic-compare-delete-unavailable',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native Scanner firewall helper compare-deletes only an exact owned chain', () => {
  if (process.platform === 'win32') return;
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  const pkg = spawnSync('pkg-config', ['--exists', 'json-c'], { encoding: 'utf8' });
  if (cc.status !== 0 || pkg.status !== 0) {
    assert.ok(true, 'native compiler or json-c unavailable; helper execution limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-firewall-helper-'));
  const bin = path.join(root, 'helper');
  const nft = path.join(root, 'nft');
  const runtime = path.join(root, 'runtime');
  const log = path.join(root, 'nft.log');
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.mkdirSync(path.join(runtime, 'scanner'), { mode: 0o700 });
  try {
    const built = spawnSync('cc', [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
      '-DZ2M_SCANNER_HELPER_TEST', `-DZ2M_SCANNER_NFT_PATH="${nft}"`,
      `-DZ2M_SCANNER_ROOT_PATH="${runtime}"`,
      `-DZ2M_SCANNER_LOCK_PATH="${path.join(runtime, 'scanner', 'firewall.lock')}"`,
      `-DZ2M_SCANNER_EVIDENCE_PATH="${path.join(runtime, 'scanner', 'evidence')}"`,
      SOURCE, ...spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' }).stdout.trim().split(/\s+/),
      '-o', bin,
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    fs.writeFileSync(nft, `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  "list chain inet zapret2 z2m_scanner") cat "${path.join(runtime, 'chain')}" 2>/dev/null || exit 1 ;;
  "delete chain inet zapret2 z2m_scanner") rm -f "${path.join(runtime, 'chain')}" ;;
  *) exit 1 ;;
esac
`);
    fs.chmodSync(nft, 0o755);
    const nonce = 'a'.repeat(64);
    const session = 'session1';
    const candidate = 'candidate1';
    const marker = `z2m-scanner:${session}:${candidate}:7:${nonce}`;
    const token = `scanner-firewall-v1:${session}:${candidate}:7:${nonce}`;
    const chain = `chain inet zapret2 z2m_scanner {\n queue num 300 comment ${marker}\n}`;
    const digest = crypto.createHash('sha256').update(chain).digest('hex');
    const request = JSON.stringify({ candidate, expectedChainDigest: digest, generation: 7, marker,
      nonce, operation: 'compare_delete', ownershipToken: token, session });
    fs.writeFileSync(path.join(runtime, 'chain'), chain);
    const deleted = spawnSync(bin, [], { input: request, encoding: 'utf8' });
    assert.equal(deleted.status, 0, `${deleted.stdout}\n${deleted.stderr}`);
    assert.equal(JSON.parse(deleted.stdout).ok, true);
    assert.equal(fs.existsSync(path.join(runtime, 'chain')), false);
    assert.match(fs.readFileSync(log, 'utf8'), /list chain inet zapret2 z2m_scanner/);
    assert.match(fs.readFileSync(log, 'utf8'), /delete chain inet zapret2 z2m_scanner/);

    fs.writeFileSync(path.join(runtime, 'chain'), chain + 'foreign mutation\n');
    const mismatch = spawnSync(bin, [], { input: request, encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.equal(JSON.parse(mismatch.stdout).ok, false);
    assert.equal(fs.existsSync(path.join(runtime, 'chain')), true,
      'digest mismatch must retain the chain');
    assert.match(fs.readFileSync(path.join(runtime, 'scanner', 'evidence'), 'utf8'), /state=ownership-mismatch/);

    const unknown = spawnSync(bin, [], { input: request.replace('"operation":"compare_delete"', '"operation":"other"'), encoding: 'utf8' });
    assert.notEqual(unknown.status, 0);
    assert.equal(JSON.parse(unknown.stdout).ok, false);
    assert.equal(fs.existsSync(path.join(runtime, 'chain')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
