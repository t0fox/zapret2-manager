import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-detect-'));
const helper = path.join(root, 'z2m-core-helper');
const fakeDetect = path.join(root, 'z2k-detect');
const lateMarker = path.join(root, 'late-marker');
const source = 'zapret2-manager/src/z2m-core-helper';

function compile() {
  const jsonC = spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' });
  assert.equal(jsonC.status, 0, jsonC.stderr);
  const result = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-DZ2K_DETECT_PATH="' + fakeDetect.replaceAll('\\', '/') + '"', '-I', source,
    'zapret2-manager/src/z2m-core-helper/main.c',
    'zapret2-manager/src/z2m-core-helper/protocol.c',
    'zapret2-manager/src/z2m-core-helper/errors.c',
    'zapret2-manager/src/z2m-core-helper/paths.c',
    'zapret2-manager/src/z2m-core-helper/roots.c',
    'zapret2-manager/src/z2m-core-helper/scanner.c',
    'zapret2-manager/src/z2m-core-helper/canonical.c',
    'zapret2-manager/src/z2m-core-helper/files.c',
    'zapret2-manager/src/z2m-core-helper/base64.c',
    'zapret2-manager/src/z2m-core-helper/sha256.c',
    'zapret2-manager/src/z2m-core-helper/atomic.c',
    'zapret2-manager/src/z2m-core-helper/mkdir.c',
    ...jsonC.stdout.trim().split(/\s+/), '-o', helper], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function invoke(operation, args) {
  const request = JSON.stringify({ protocolVersion: 1, requestId: 'detect-test', operation, arguments: args });
  const result = spawnSync(helper, { input: request, encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

test.before(() => {
  fs.rmSync(lateMarker, { force: true });
  const marker = lateMarker.replaceAll('\\', '/');
  fs.writeFileSync(fakeDetect, `#!/bin/sh\nif [ "$1" = probe ] && [ "$2" = sleep.example.com:443 ]; then (sleep 0.2; printf late > ${marker}) & wait; fi\nif [ "$1" = probe ] && [ "$2" = overflow.example.com:443 ]; then yes x | head -c 70000; exit 0; fi\nif [ "$2" = malformed.example.com:443 ]; then printf 'not-json'; exit 0; fi\nif [ "$2" = truncated.example.com:443 ]; then printf '{"fixture":true'; exit 0; fi\nif [ "$2" = array.example.com:443 ]; then printf '[]'; exit 0; fi\ncase "$2" in\n  invalid-probe.example.com:443|invalid-classify.example.com:443|invalid-quic.example.com:443|invalid-voice.example.com:443|invalid-tcp16.example.com:443) printf '{"fixture":true}\\n'; exit 0 ;;\nesac\ncase "$1" in\n  probe) printf '%s\\n' '{"Domain":"example.com","DNSOK":true,"TCPOK":true,"TLSOK":true,"TLS12OK":true,"TLS13OK":true,"HTTPOK":true,"ResolvedIPs":["192.0.2.1"],"FailureCode":"","FailureReason":"","LatencyMS":12,"PathVerdict":"clear","PathReason":""}' ;;\n  classify) printf '%s\\n' '{"target":"example.com:443","verdict":"clear","reason":"fixture","repeats":3,"probes":3,"duration":"1s","trigger_len":0,"props":{},"composed":false,"raw_usable":true,"trace":[]}' ;;\n  quic) printf '%s\\n' '{"target":"example.com:443","addr":"192.0.2.1:443","verdict":"clear","reason":"fixture","repeats":1,"probes":1,"duration":"1s","props":{},"trace":[]}' ;;\n  voice) printf '%s\\n' '{"target":"example.com:443","verdict":"clear","reason":"fixture","repeats":1,"probes":1,"duration":"1s","marked":false,"trace":[]}' ;;\n  tcp16) printf '%s\\n' '{"Target":{"ID":"fixture","ASN":64500,"Provider":"fixture","IP":"192.0.2.1","Port":443,"SNI":"example.com"},"SNI":"example.com","Alive":true,"Detected":false,"DiedAtKB":0,"Err":"","RTT":1000}' ;;\n  *) printf '{"fixture":true}\\n' ;;\nesac\n`, { mode: 0o755 });
  compile();
});

test('constructs the exact fixed classify argv without client executable or raw command', () => {
  const response = invoke('z2k_detect_classify', { host: 'example.com', port: 443, hello: 'modern', repeats: 3, timeoutMs: 6000 });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.argv, [
    '/usr/libexec/zapret2-manager/z2k-detect', 'classify', 'example.com:443',
    '-hello', 'modern', '-repeats', '3', '-timeout', '6s', '-json',
  ]);
});

test('rejects shell and process-boundary fields, unknown flags, and unsafe values', () => {
  for (const args of [
    { host: 'example.com', port: 443, executable: '/bin/sh' },
    { host: 'example.com', port: 443, argv: [';id'] },
    { host: 'example.com', port: 443, command: 'id' },
    { host: 'example.com', port: 443, env: { PATH: '/tmp' } },
    { host: 'example.com', port: 443, cwd: '/tmp' },
    { host: 'example.com', port: 443, flags: ['--evil'] },
    { host: 'example.com', port: 443, timeoutMs: 120001 },
    { host: 'example.com', port: 443, repeats: 0 },
    { host: 'bad host', port: 443 },
    { host: '', port: 443 },
    { host: ':', port: 443 },
    { host: 'a:b:c', port: 443 },
    { host: 'a..example.com', port: 443 },
    { host: '-example.com', port: 443 },
    { host: 'example-.com', port: 443 },
    { host: '999.1.1.1', port: 443 },
    { host: '1:2:3', port: 443 },
    { host: ':1:2:3:4:5:6:7:8', port: 443 },
    { host: '1:2:3:4:5:6:7:8:', port: 443 },
    { host: 'example\u0000.com', port: 443 },
    { host: 'example.com', port: 0 },
    { host: 'example.com', port: 65536 },
    { host: 'example.com\n-id', port: 443 },
  ]) {
    const response = invoke('z2k_detect_probe', args);
    assert.equal(response.ok, false, JSON.stringify(args));
    assert.equal(response.error.code, 'ESCHEMA', JSON.stringify(args));
  }
});

test('accepts valid IPv6 and brackets it in the endpoint without changing the fixed argv', () => {
  const response = invoke('z2k_detect_probe', { host: '2001:db8::1', port: 443, repeats: 1, timeoutMs: 1000 });
  assert.equal(response.ok, true);
  assert.equal(response.data.argv[2], '[2001:db8::1]:443');
});

test('returns bounded process result fields and kills a timed-out process group', () => {
  const response = invoke('z2k_detect_probe', { host: 'sleep.example.com', port: 443, repeats: 1, timeoutMs: 25 });
  assert.equal(response.ok, true);
  assert.equal(response.data.timedOut, true);
  assert.equal(response.data.outputTruncated, false);
  assert.equal(typeof response.data.exitCode, 'number');
  assert.equal(typeof response.data.stdout, 'string');
  assert.equal(typeof response.data.stderr, 'string');
  assert.ok(response.data.stdout.length <= 65536);
  assert.ok(response.data.stderr.length <= 65536);
  spawnSync('sleep', ['0.35']);
  assert.equal(fs.existsSync(lateMarker), false, 'timed-out process-group descendant must not survive');
});

test('reports bounded-output truncation separately from wall-time timeout', () => {
  const response = invoke('z2k_detect_probe', { host: 'overflow.example.com', port: 443, repeats: 1, timeoutMs: 1000 });
  assert.equal(response.ok, true);
  assert.equal(response.data.timedOut, false);
  assert.equal(response.data.outputTruncated, true);
  assert.ok(response.data.stdout.length <= 65536);
});

test('rejects malformed, truncated, and non-object Detect JSON before returning success', () => {
  for (const host of ['malformed.example.com', 'truncated.example.com', 'array.example.com']) {
    const response = invoke('z2k_detect_probe', { host, port: 443, repeats: 1, timeoutMs: 1000 });
    assert.equal(response.ok, false, host);
    assert.equal(response.error.code, 'ESCHEMA', host);
  }
  const valid = invoke('z2k_detect_probe', { host: 'valid.example.com', port: 443, repeats: 1, timeoutMs: 1000 });
  assert.equal(valid.ok, true);
  assert.equal(JSON.parse(valid.data.stdout).Domain, 'example.com');
});

test('enforces operation-specific native Detect result schemas for every operation', () => {
  for (const kind of ['probe', 'classify', 'quic', 'voice', 'tcp16']) {
    const operation = `z2k_detect_${kind}`;
    const args = { host: `invalid-${kind}.example.com`, port: 443, repeats: kind === 'classify' ? 3 : 1, timeoutMs: 1000 };
    if (kind === 'classify') args.hello = 'modern';
    const invalid = invoke(operation, args);
    assert.equal(invalid.ok, false, operation);
    assert.equal(invalid.error.code, 'ESCHEMA', operation);
    const valid = invoke(operation, { ...args, host: 'valid.example.com' });
    assert.equal(valid.ok, true, operation);
    assert.equal(valid.data.outputTruncated, false, operation);
    assert.equal(valid.data.timedOut, false, operation);
    assert.equal(valid.data.argv[1], kind, operation);
  }
});

test('accepts a maximum-length hostname and rejects an overlong hostname at the native boundary', () => {
  const maxHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  const valid = invoke('z2k_detect_probe', { host: maxHost, port: 443, repeats: 1, timeoutMs: 1000 });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.argv[2], `${maxHost}:443`);
  const invalid = invoke('z2k_detect_probe', { host: `${maxHost}a`, port: 443, repeats: 1, timeoutMs: 1000 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ESCHEMA');
});
