import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'z2m-scanner-probe-'));
const helper = path.join(root, 'z2m-core-helper');
const fake = path.join(root, 'fake-ncat');
const source = 'zapret2-manager/src/z2m-core-helper';
const child = 'tests/native/core/scanner-probe-child.c';
const adapterDigest = '7cd367ef2aed1be2567505bf978b2d2b73f97ff149cc48d64826ed4f2b8c885e';
const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com', 'fail.example.com', 'sleep.example.com', 'stun.example.com'], probeUrl: 'https://example.com/probe', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' }, udp: { ports: '19302', l7: 'stun', payload: 'binding' } };
const profileDigest = createHash('sha256').update(JSON.stringify(profile)).digest('hex');

function compile(output, input, definitions = []) {
  const jsonC = spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' });
  assert.equal(jsonC.status, 0, jsonC.stderr);
  const result = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', '-I', source,
    `-DZ2M_NCAT_PATH="${fake}"`, ...definitions, ...input, ...jsonC.stdout.trim().split(/\s+/), '-o', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function request(request, extra = {}) {
  const defaults = request.transport === 'stun'
    ? { mode: 'quick', retries: 2, receiveLimitBytes: 1024, transactionId: '0102030405060708090a0b0c', portRange: String(request.port) }
    : { mode: 'quick', retries: 1, tls: { timeoutMs: 6000, readLimitBytes: 2048 }, portRange: String(request.port) };
  if (request.transport === 'tls+body') defaults.body = {
    timeoutMs: 8000, minimumBytes: 65536, readChunkBytes: 4096, markerScanBytes: 8192,
    readLimitBytes: 69633, range: 'bytes=0-69632',
    markers: [{ name: 'isp_page', needles: ['blocked', 'access denied', 'captcha'] }],
  };
  return JSON.stringify({ protocolVersion: 1, requestId: 'scanner:1', operation: 'scanner_probe', arguments: {
    authority: 'scanner-probe-adapter.v1', adapterDigest, targetProfileDigest: profileDigest, targetProfile: profile,
    request: { deadlineMs: Date.now() + 120000, ...defaults, ...request, ...(request.transport === 'tls+body' ? { body: { ...defaults.body, ...request.body } } : {}) }, ...extra,
  } }) + '\n';
}

function run(input, env = {}, expectedStatus = 0) {
  const result = spawnSync(helper, [], { input, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, expectedStatus, result.stderr);
  return JSON.parse(result.stdout);
}

before(() => {
  const fakeBuild = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', child, '-o', fake], { encoding: 'utf8' });
  assert.equal(fakeBuild.status, 0, fakeBuild.stderr);
  compile(helper, ['zapret2-manager/src/z2m-core-helper/main.c', 'zapret2-manager/src/z2m-core-helper/protocol.c', 'zapret2-manager/src/z2m-core-helper/canonical.c', 'zapret2-manager/src/z2m-core-helper/errors.c', 'zapret2-manager/src/z2m-core-helper/roots.c', 'zapret2-manager/src/z2m-core-helper/paths.c', 'zapret2-manager/src/z2m-core-helper/files.c', 'zapret2-manager/src/z2m-core-helper/base64.c', 'zapret2-manager/src/z2m-core-helper/mkdir.c', 'zapret2-manager/src/z2m-core-helper/sha256.c', 'zapret2-manager/src/z2m-core-helper/atomic.c', 'zapret2-manager/src/z2m-core-helper/scanner.c']);
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('fixed scanner binary receives argv without shell interpretation and uses descriptor UDP port', () => {
  const log = '/tmp/z2m-scanner-probe-argv.log'; fs.rmSync(log, { force: true });
  const result = run(request({ transport: 'stun', host: 'stun.example.com', port: 19302, addressFamily: 'ipv4', timeoutMs: 1000, retries: 2, receiveLimitBytes: 1024 }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(fs.readFileSync(log, 'utf8'), /-u\n-4\n-w\n1\nstun\.example\.com\n19302\n/);
});

test('native scanner binds every transport setting to the server-owned profile', () => {
  const target = {
    ...profile,
    tcp: { ports: '8443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '3478-3480', l7: 'stun', payload: 'binding' },
    probeUrl: 'https://example.com/probe/204',
  };
  const digest = createHash('sha256').update(JSON.stringify(target)).digest('hex');
  const accepted = run(request({ transport: 'stun', host: 'stun.example.com', port: 3478,
    portRange: '3478-3480', addressFamily: 'ipv4', timeoutMs: 1000, retries: 2,
    receiveLimitBytes: 1024, transactionId: '0102030405060708090a0b0c' },
    { targetProfile: target, targetProfileDigest: digest }));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const forged = run(request({ transport: 'stun', host: 'stun.example.com', port: 19302,
    portRange: '19302', addressFamily: 'ipv4', timeoutMs: 1000, retries: 2,
    receiveLimitBytes: 1024, transactionId: '0102030405060708090a0b0c' },
    { targetProfile: target, targetProfileDigest: digest }), {}, 2);
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'ESCHEMA');
});

test('forged URL/path and descriptor executable fields are rejected before spawn', () => {
  const forged = run(request({ transport: 'tls+body', host: 'example.com', addressFamily: 'ipv4', port: 443, timeoutMs: 1000, url: 'https://example.com/ok;touch', body: { range: 'bytes=0-69632', readLimitBytes: 69633 } }, { executable: '/bin/sh' }), {}, 2);
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'ESCHEMA');
});

test('target profile digest is verified at the native execution boundary', () => {
  const forged = run(request({ transport: 'stun', host: 'stun.example.com', port: 19302, addressFamily: 'ipv4', timeoutMs: 1000, retries: 2, receiveLimitBytes: 1024 }, { targetProfileDigest: 'a'.repeat(64) }), {}, 2);
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'ESCHEMA');
});

test('nonzero child status and partial output are returned independently', () => {
  const result = run(request({ transport: 'tls', host: 'fail.example.com', addressFamily: 'ipv4', port: 443, timeoutMs: 1000, addressFamilies: ['ipv4'] }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.exitCode, 7);
  assert.equal(result.data.byteLength, 7);
  assert.equal(result.data.complete, true);
  assert.equal(typeof result.data.startedAt, 'number');
  assert.equal(typeof result.data.finishedAt, 'number');
});

test('deadline kills and reaps the fixed child without grace beyond the request deadline', () => {
  const started = Date.now();
  const result = run(request({ transport: 'tls', host: 'sleep.example.com', addressFamily: 'ipv4', port: 443, timeoutMs: 100, addressFamilies: ['ipv4'] }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.data.signal > 0, true);
});
