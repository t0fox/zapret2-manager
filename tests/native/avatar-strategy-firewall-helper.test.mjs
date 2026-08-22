import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'zapret2-manager/src/z2m-scanner-firewall-helper.c');
const JSON_C_FLAGS = () => spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' })
  .stdout.trim().split(/\s+/);
const NONCE = 'a'.repeat(64);
const OWNED_TABLE = 'z2m_sc_01234567_89abcdef_0001_' + 'b'.repeat(32);

function request(operation, argumentsOverride = {}) {
  return `${JSON.stringify({ protocolVersion: 2, requestId: 'r1', operation,
    arguments: { tableName: OWNED_TABLE, operationId: 'session1:candidate1:7', nonce: NONCE,
      queue: 300, peerPid: 2, ...argumentsOverride } })}\n`;
}

function nativeToolchainAvailable() {
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  const pkg = spawnSync('pkg-config', ['--exists', 'json-c'], { encoding: 'utf8' });
  return cc.status === 0 && pkg.status === 0;
}

function buildHelper(bin, defines = []) {
  const built = spawnSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', ...defines, SOURCE, ...JSON_C_FLAGS(),
    '-o', bin,
  ], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
}

test('native Scanner firewall helper has no caller-controlled execution surface', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');
  // The helper speaks nfnetlink directly: fixed operations, fixed chain, fixed queue window.
  for (const fixed of ['NETLINK_NETFILTER', 'NFT_MSG_NEWTABLE', 'NFT_MSG_DELTABLE', 'NFT_MSG_GETTABLE',
    'NFT_TABLE_F_OWNER', '"z2m_scan_prerouting"', 'z2m-scanner-a1:', 'SCANNER_QUEUE_MIN 300U',
    'SCANNER_QUEUE_MAX 307U', '/proc/net/netfilter/nfnetlink_queue',
    '"ownership_create"', '"ownership_ready"', '"ownership_delete"', '"ownership_status"',
    '"ownership_nfqueue_prepare"', '"ownership_nfqueue_bind"', '"ownership_nfqueue_activate"']) assert.match(source, new RegExp(fixed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /getenv|system\s*\(|popen\s*\(|execvp\s*\(|nft\s+flush|\/usr\/sbin\/nft/);
  assert.match(source, /kernel_read_back/);
});

test('production Scanner firewall helper fails closed without nftables authority', () => {
  if (process.platform === 'win32') return;
  if (!nativeToolchainAvailable()) {
    assert.ok(true, 'native compiler or json-c unavailable; production helper execution limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-firewall-helper-prod-'));
  const bin = path.join(root, 'helper');
  try {
    buildHelper(bin);
    const ran = spawnSync(bin, [], { input: request('ownership_create'), encoding: 'utf8' });
    // Unprivileged callers either fail to open the netlink socket (EINTERNAL, exit 1)
    // or get the kernel EPERM acknowledgement (EOWNERSHIP, structured error, keeps serving).
    const out = JSON.parse((ran.stdout || '').trim().split(/\r?\n/)[0] || '{}');
    assert.equal(out.ok, false);
    assert.ok(['EINTERNAL', 'EOWNERSHIP'].includes(out.error?.code), out.error?.code);
    if (ran.status === 0) assert.equal(out.error.code, 'EOWNERSHIP');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native Scanner firewall helper only mutates its exact owned table identity', () => {
  if (process.platform === 'win32') return;
  if (!nativeToolchainAvailable()) {
    assert.ok(true, 'native compiler or json-c unavailable; helper execution limitation documented');
    return;
  }
  // delete_table refuses anything but the exact owned table/operation/nonce triple before
  // any netlink mutation; malformed requests never reach the transport.
  const source = fs.readFileSync(SOURCE, 'utf8');
  assert.match(source, /!state->table_created \|\| strcmp\(state->table_name, table_name\) != 0/);
  assert.match(source, /strcmp\(state->operation_id, operation_id\) != 0/);
  assert.match(source, /strcmp\(state->nonce, nonce\) != 0/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-firewall-helper-'));
  const bin = path.join(root, 'helper');
  try {
    buildHelper(bin, ['-DZ2M_SCANNER_HELPER_TEST']);
    const lines = [
      request('ownership_delete'), // no ownership established yet
      request('ownership_create', { tableName: 'evil_01234567_89abcdef_0001_' + 'b'.repeat(32) }), // foreign table identity
      request('ownership_create'), // valid request, but the test transport cannot reach nfnetlink
      request('ownership_status'), // after a fatal transport failure the helper stops serving
    ].join('');
    const ran = spawnSync(bin, [], { input: lines, encoding: 'utf8' });
    const responses = (ran.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.equal(responses.length, 3, JSON.stringify(responses));
    assert.equal(responses[0].ok, false);
    assert.equal(responses[0].error.code, 'EOWNERSHIP');
    assert.equal(responses[1].ok, false);
    assert.equal(responses[1].error.code, 'ESCHEMA');
    assert.equal(responses[2].ok, false);
    assert.equal(responses[2].error.code, 'EINTERNAL');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
