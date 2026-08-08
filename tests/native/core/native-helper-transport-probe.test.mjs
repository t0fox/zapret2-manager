import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ucode = process.env.UCODE_BIN;
const ucodeArgs = process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const libraryArgs = process.env.UCODE_MODULE_PATH ? ['-L', process.env.UCODE_MODULE_PATH] : [];
const cc = process.env.TARGET_CC ?? process.env.CC ?? 'cc';
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'z2m-transport-'));
const child = path.join(tmp, 'native-helper-probe-child');
const probe = path.resolve('tests/native/core/native-helper-transport-probe.uc');
let sequence = 0;

before(() => {
  assert.ok(ucode, 'UCODE_BIN must identify exact target ucode');
  const built = spawnSync(cc, [
    '-std=c11', '-Wall', '-Wextra', '-Werror',
    ...(process.env.TARGET_CFLAGS?.split(/\s+/).filter(Boolean) ?? []),
    path.resolve('tests/native/core/native-helper-probe-child.c'), '-o', child,
    ...(process.env.TARGET_LDFLAGS?.split(/\s+/).filter(Boolean) ?? []),
  ], { encoding: 'utf8' });
  assert.equal(built.status, 0, `${cc} failed:\n${built.stdout}${built.stderr}`);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function invoke(mode, request, { cap = 8 * 1024 * 1024, timeout = 2000, repeats = 1,
  executable = child, setupFail = false } = {}) {
  const id = sequence++;
  const requestPath = path.join(tmp, `request-${id}`);
  const responsePath = path.join(tmp, `response-${id}`);
  fs.writeFileSync(requestPath, request);
  const run = spawnSync(ucode, [...ucodeArgs, ...libraryArgs, probe, executable, mode, requestPath, responsePath,
    String(cap), String(timeout), String(repeats), setupFail ? '1' : '0'], {
    encoding: 'utf8', env: process.env, timeout: Math.max(10000, timeout * repeats + 5000),
  });
  assert.equal(run.signal, null, `probe host timeout: ${run.error ?? ''}`);
  assert.equal(run.status, 0, `probe failed:\n${run.stdout}${run.stderr}`);
  const result = JSON.parse(run.stdout.trim());
  result.response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath) : Buffer.alloc(0);
  return result;
}

function deterministic(size) {
  const data = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + 17) & 0xff;
  return data;
}

test('preserves exact newline and binary payload through EOF', () => {
  const payload = Buffer.from([0, 10, 13, 255, 65, 10, 0, 66]);
  const result = invoke('echo', payload);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutEof, true);
  assert.deepEqual(result.response, payload);
});

test('duplexes a 4 MiB request without deadlock', () => {
  const payload = deterministic(4 * 1024 * 1024);
  assert.deepEqual(invoke('echo', payload, { cap: payload.length }).response, payload);
});

test('accepts a 6 MiB generated response', () => {
  const size = 6 * 1024 * 1024;
  assert.deepEqual(invoke('generate', `${size}\n`, { cap: size }).response, deterministic(size));
});

test('stops observing a substantially oversized response at cap plus one byte', () => {
  const cap = 4096;
  const result = invoke('generate', `${cap + 1024 * 1024}\n`, { cap });
  assert.equal(result.error, 'response_limit');
  assert.equal(result.bytesRead, cap + 1);
  assert.equal(result.response.length, cap + 1);
});

test('reports exit zero, exit seven, and signal termination', () => {
  assert.equal(invoke('echo', '').exitCode, 0);
  assert.equal(invoke('exit7', 'consume me').exitCode, 7);
  const timeout = invoke('sleep', '', { timeout: 100 });
  assert.equal(timeout.error, 'timeout');
  assert.equal(timeout.signaled, true);
  assert.equal(timeout.reaped, true);
});

test('separates bounded stderr diagnostics from protocol stdout', () => {
  const result = invoke('stderr', '');
  assert.deepEqual(result.response, Buffer.from('protocol-ok\n'));
  assert.equal(result.stderr, 'probe diagnostic\n');
});

test('reports missing executable and setup failure without hanging', () => {
  assert.equal(invoke('echo', '', { executable: `${child}.missing` }).exitCode, 255);
  assert.equal(invoke('echo', '', { setupFail: true }).exitCode, 125);
});

test('does not grow descriptors across 100 calls', () => {
  const result = invoke('echo', 'x', { repeats: 100, timeout: 1000 });
  assert.equal(result.fdAfter, result.fdBefore);
  assert.deepEqual(result.response, Buffer.from('x'));
});
