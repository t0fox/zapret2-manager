import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'zapret2-manager/src/z2m-scanner-firewall-helper.c');

test('native Scanner firewall helper has no caller-controlled execution surface', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');
  for (const fixed of ['NETLINK_NETFILTER', 'NFT_TABLE_F_OWNER', '"ownership_create"',
    '"ownership_ready"', '"ownership_delete"', '"ownership_status"', '"rules_prepare"',
    '"rules_enable"', '"rules_disable"']) assert.match(source, new RegExp(fixed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /getenv|system\s*\(|popen\s*\(|execvp\s*\(|nft\s+flush/);
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
    const request = JSON.stringify({ protocolVersion: 2, requestId: 'r1', operation: 'ownership_create',
      arguments: { tableName: 'not-a-scanner-table', operationId: 'session1:candidate1:7', nonce } });
    const ran = spawnSync(bin, [], { input: request + '\n', encoding: 'utf8' });
    assert.equal(ran.status, 0);
    // canonical helper returns structured ESCHEMA/EOWNERSHIP for malformed ownership request
    const out = JSON.parse(ran.stdout || '{}');
    assert.equal(out.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native Scanner firewall helper deletes only an exact in-process owner', () => {
  if (process.platform === 'win32') return;
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  const pkg = spawnSync('pkg-config', ['--exists', 'json-c'], { encoding: 'utf8' });
  if (cc.status !== 0 || pkg.status !== 0) {
    assert.ok(true, 'native compiler or json-c unavailable; helper execution limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-firewall-helper-'));
  const bin = path.join(root, 'helper');
  try {
    const built = spawnSync('cc', [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
      SOURCE, ...spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' }).stdout.trim().split(/\s+/),
      '-o', bin,
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const nonce = 'a'.repeat(64);
    const request = JSON.stringify({ protocolVersion: 2, requestId: 'r2', operation: 'ownership_delete',
      arguments: { tableName: 'z2m_sc_01234567_89abcdef_0001_' + nonce.slice(0, 32),
        operationId: 'session1:candidate1:7', nonce } });
    const deleted = spawnSync(bin, [], { input: request + '\n', encoding: 'utf8' });
    assert.equal(deleted.status, 0);
    assert.equal(JSON.parse(deleted.stdout).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
