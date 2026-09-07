import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-detect-'));
const helper = path.join(root, 'z2m-core-helper');
const fakeDetect = path.join(root, 'z2k-detect');
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
  fs.writeFileSync(fakeDetect, '#!/bin/sh\nif [ "$1" = probe ]; then sleep 3; fi\nprintf \'%s\\n\' "$@"\n', { mode: 0o755 });
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
    { host: 'example.com', port: 0 },
    { host: 'example.com\n-id', port: 443 },
  ]) {
    const response = invoke('z2k_detect_probe', args);
    assert.equal(response.ok, false, JSON.stringify(args));
    assert.equal(response.error.code, 'ESCHEMA', JSON.stringify(args));
  }
});

test('returns bounded process result fields and kills a timed-out process group', () => {
  const response = invoke('z2k_detect_probe', { host: 'example.com', port: 443, repeats: 1, timeoutMs: 100 });
  assert.equal(response.ok, true);
  assert.equal(response.data.timedOut, true);
  assert.equal(typeof response.data.exitCode, 'number');
  assert.equal(typeof response.data.stdout, 'string');
  assert.equal(typeof response.data.stderr, 'string');
  assert.ok(response.data.stdout.length <= 65536);
  assert.ok(response.data.stderr.length <= 65536);
});
