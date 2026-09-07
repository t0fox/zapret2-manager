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
  fs.writeFileSync(fakeDetect, `#!/bin/sh\nkind="$1"\ntarget=""\nif [ "$kind" = probe ]; then target="$3"; fi\nif [ "$kind" = classify ] || [ "$kind" = quic ]; then target="$9"; fi\nif [ "$kind" = probe ] && [ "$target" = sleep.example.com ]; then (sleep 0.2; printf late > ${marker}) & wait; fi\nif [ "$kind" = probe ] && [ "$target" = overflow.example.com ]; then yes x | head -c 70000; exit 0; fi\nif [ "$target" = malformed.example.com ]; then printf 'not-json'; exit 0; fi\nif [ "$target" = truncated.example.com ]; then printf '{"fixture":true'; exit 0; fi\nif [ "$target" = array.example.com ]; then printf '[]'; exit 0; fi\ncase "$kind:$target" in\n  probe:invalid-probe.example.com|classify:invalid-classify.example.com|quic:invalid-quic.example.com) printf '{"fixture":true}\\n'; exit 0 ;;\nesac\ncase "$kind" in\n  probe) printf '%s\\n' '{"Domain":"example.com","DNSOK":true,"TCPOK":true,"TLSOK":true,"TLS12OK":true,"TLS13OK":true,"HTTPOK":true,"ResolvedIPs":["192.0.2.1"],"FailureCode":"","FailureReason":"","LatencyMS":12,"PathVerdict":"clear","PathReason":""}' ;;\n  classify) printf '%s\\n' '{"target":"example.com:443","verdict":"clear","reason":"fixture","repeats":3,"probes":3,"duration":"1s","trigger_len":0,"props":{},"composed":false,"raw_usable":true,"trace":[]}' ;;\n  quic) printf '%s\\n' '{"target":"example.com:443","addr":"192.0.2.1:443","verdict":"clear","reason":"fixture","repeats":1,"probes":1,"duration":"1s","props":{},"trace":[]}' ;;\n  voice) printf '%s\\n' '{"target":"voice","verdict":"clear","reason":"fixture","repeats":1,"probes":1,"duration":"1s","marked":false,"trace":[]}' ;;\n  tcp16) printf '%s\\n' 'tcp16 fixture output' ;;\n  *) printf '{"fixture":true}\\n' ;;\nesac\n`, { mode: 0o755 });
  compile();
});

test('constructs the exact fixed classify argv without client executable or raw command', () => {
  const response = invoke('z2k_detect_classify', { host: 'example.com', port: 443, hello: 'modern', repeats: 3, timeoutMs: 6000 });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.argv, [
    '/usr/libexec/zapret2-manager/z2k-detect', 'classify',
    '-hello', 'modern', '-repeats', '3', '-timeout', '6s', '-json', 'example.com:443',
  ]);
});

test('rejects shell and process-boundary fields, unknown flags, and unsafe values', () => {
  for (const args of [
    { domain: 'example.com', timeoutMs: 1000, executable: '/bin/sh' },
    { domain: 'example.com', timeoutMs: 1000, argv: [';id'] },
    { domain: 'example.com', timeoutMs: 1000, command: 'id' },
    { domain: 'example.com', timeoutMs: 1000, env: { PATH: '/tmp' } },
    { domain: 'example.com', timeoutMs: 1000, cwd: '/tmp' },
    { domain: 'example.com', timeoutMs: 1000, flags: ['--evil'] },
    { domain: 'example.com', timeoutMs: 120001 },
    { domain: 'bad host', timeoutMs: 1000 },
    { domain: '', timeoutMs: 1000 },
    { domain: ':', timeoutMs: 1000 },
    { domain: 'a:b:c', timeoutMs: 1000 },
    { domain: 'a..example.com', timeoutMs: 1000 },
    { domain: '-example.com', timeoutMs: 1000 },
    { domain: 'example-.com', timeoutMs: 1000 },
    { domain: '999.1.1.1', timeoutMs: 1000 },
    { domain: '1:2:3', timeoutMs: 1000 },
    { domain: ':1:2:3:4:5:6:7:8', timeoutMs: 1000 },
    { domain: '1:2:3:4:5:6:7:8:', timeoutMs: 1000 },
    { domain: 'example\u0000.com', timeoutMs: 1000 },
    { domain: 'example.com', timeoutMs: 0 },
    { domain: 'example.com\n-id', timeoutMs: 1000 },
  ]) {
    const response = invoke('z2k_detect_probe', args);
    assert.equal(response.ok, false, JSON.stringify(args));
    assert.equal(response.error.code, 'ESCHEMA', JSON.stringify(args));
  }
});

test('accepts valid IPv6 and brackets it in the endpoint without changing the fixed argv', () => {
  const response = invoke('z2k_detect_probe', { domain: '2001:db8::1', timeoutMs: 1000 });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.argv.slice(2), ['-json', '2001:db8::1']);
});

test('returns bounded process result fields and kills a timed-out process group', () => {
  const response = invoke('z2k_detect_probe', { domain: 'sleep.example.com', timeoutMs: 25 });
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
  const response = invoke('z2k_detect_probe', { domain: 'overflow.example.com', timeoutMs: 1000 });
  assert.equal(response.ok, true);
  assert.equal(response.data.timedOut, false);
  assert.equal(response.data.outputTruncated, true);
  assert.ok(response.data.stdout.length <= 65536);
});

test('rejects malformed, truncated, and non-object Detect JSON before returning success', () => {
  for (const host of ['malformed.example.com', 'truncated.example.com', 'array.example.com']) {
    const response = invoke('z2k_detect_probe', { domain: host, timeoutMs: 1000 });
    assert.equal(response.ok, false, host);
    assert.equal(response.error.code, 'ESCHEMA', host);
  }
  const valid = invoke('z2k_detect_probe', { domain: 'valid.example.com', timeoutMs: 1000 });
  assert.equal(valid.ok, true);
  assert.equal(JSON.parse(valid.data.stdout).Domain, 'example.com');
});

test('enforces operation-specific native Detect result schemas for every operation', () => {
  for (const kind of ['probe', 'classify', 'quic', 'voice', 'tcp16']) {
    const operation = `z2k_detect_${kind}`;
    const args = kind === 'probe' ? { domain: `invalid-${kind}.example.com`, timeoutMs: 1000 } : kind === 'classify' ? { host: `invalid-${kind}.example.com`, port: 443, hello: 'modern', repeats: 3, timeoutMs: 1000 } : kind === 'quic' ? { domain: `invalid-${kind}.example.com`, port: 443, repeats: 1, timeoutMs: 1000 } : kind === 'voice' ? { repeats: 1, timeoutMs: 1000 } : { timeoutMs: 1000 };
    if (['probe', 'classify', 'quic'].includes(kind)) {
      const invalid = invoke(operation, args);
      assert.equal(invalid.ok, false, operation);
      assert.equal(invalid.error.code, 'ESCHEMA', operation);
    }
    const valid = invoke(operation, kind === 'probe' || kind === 'quic' ? { ...args, domain: 'valid.example.com' } : kind === 'classify' ? { ...args, host: 'valid.example.com' } : args);
    assert.equal(valid.ok, true, operation);
    assert.equal(valid.data.outputTruncated, false, operation);
    assert.equal(valid.data.timedOut, false, operation);
    assert.equal(valid.data.argv[1], kind, operation);
  }
});

test('accepts a maximum-length hostname and rejects an overlong hostname at the native boundary', () => {
  const maxHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  const valid = invoke('z2k_detect_probe', { domain: maxHost, timeoutMs: 1000 });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.argv[3], maxHost);
  const invalid = invoke('z2k_detect_probe', { domain: `${maxHost}a`, timeoutMs: 1000 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ESCHEMA');
});
