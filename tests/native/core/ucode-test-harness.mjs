import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const SOCKET_PATH = '/tmp/zapret2-manager/runtime/z2m-helperd.sock';
export const MODULE = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

export function ucodeModulePattern(modulePath, libraryPath) {
  const moduleRoot = modulePath ?? (libraryPath ? path.join(libraryPath, 'ucode') : null);
  return moduleRoot && fs.existsSync(moduleRoot) ? path.join(moduleRoot, '*.so') : null;
}

export function requestFrameBody(frame) {
  assert.equal(frame.subarray(0, 8).toString(), 'Z2MHTV1\n');
  assert.equal(frame[8], 1);
  const headerLength = frame.readUInt32BE(12);
  const bodyLength = frame.readUInt32BE(16);
  assert.equal(frame.length, 20 + headerLength + bodyLength);
  return {
    header: JSON.parse(frame.subarray(20, 20 + headerLength)),
    body: JSON.parse(frame.subarray(20 + headerLength).toString()),
  };
}

export function responseFrame(header, stdout = '', stderr = '') {
  const rawHeader = Buffer.from(typeof header === 'string' ? header : JSON.stringify(header));
  const body = Buffer.concat([Buffer.from(stdout), Buffer.from(stderr)]);
  const prelude = Buffer.alloc(20);
  prelude.write('Z2MHTV1\n');
  prelude[8] = 2;
  prelude.writeUInt32BE(rawHeader.length, 12);
  prelude.writeUInt32BE(body.length, 16);
  return Buffer.concat([prelude, rawHeader, body]);
}

export function childExited(requestId, stdout, exitCode = 0, overrides = {}) {
  return responseFrame({
    protocol: 'z2m-helper-transport-v1', requestId, outcome: 'child_exited',
    startState: 'started', stdoutLength: Buffer.byteLength(stdout), stderrLength: 0,
    stdoutEof: true, stderrEof: true, stderrTruncated: false, stderrDrained: 0,
    childReaped: true, exitCode, signal: null, ...overrides,
  }, stdout);
}

export function brokerResult(requestId, outcome, overrides = {}) {
  const base = {
    protocol: 'z2m-helper-transport-v1', requestId, outcome,
    startState: 'started', stdoutLength: 0, stderrLength: 0,
    stdoutEof: true, stderrEof: true, stderrTruncated: false, stderrDrained: 0,
    childReaped: true,
  };
  return responseFrame({ ...base, ...overrides });
}

export async function withPeer(handler, callback) {
  fs.mkdirSync('/tmp/zapret2-manager/runtime', { recursive: true, mode: 0o700 });
  fs.rmSync(SOCKET_PATH, { force: true });
  const server = net.createServer(socket => {
    const chunks = [];
    socket.on('error', error => {
      if (!['EPIPE', 'ECONNRESET'].includes(error.code)) throw error;
    });
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', async () => {
      try { await handler(socket, Buffer.concat(chunks)); }
      catch (error) { socket.destroy(error); }
    });
  });
  await new Promise((resolve, reject) => server.listen(SOCKET_PATH, resolve).once('error', reject));
  fs.chmodSync(SOCKET_PATH, 0o600);
  try { return await callback(); }
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(SOCKET_PATH, { force: true });
  }
}

export async function withRawPeer(onConnection, callback) {
  fs.mkdirSync('/tmp/zapret2-manager/runtime', { recursive: true, mode: 0o700 });
  fs.rmSync(SOCKET_PATH, { force: true });
  const server = net.createServer(onConnection);
  await new Promise((resolve, reject) => server.listen(SOCKET_PATH, resolve).once('error', reject));
  fs.chmodSync(SOCKET_PATH, 0o600);
  try { return await callback(); }
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(SOCKET_PATH, { force: true });
  }
}

export function invoke(expression, timeout = 5000, extraEnv = {}) {
  const source = `import * as native from '${MODULE}'; print(sprintf('%J', ${expression}));`;
  let sourceRoot = null;
  let sourceArgs = ['-e', source];
  if (Buffer.byteLength(source) > 65536) {
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ucode-source-'));
    const sourcePath = path.join(sourceRoot, 'invoke.uc');
    fs.writeFileSync(sourcePath, source, { mode: 0o600 });
    sourceArgs = [sourcePath];
  }
  const child = spawn(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, ...sourceArgs], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '/opt/ucode/lib' },
  });
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const guard = setTimeout(() => {
      child.kill('SIGKILL'); reject(new Error(`ucode timed out after ${timeout}ms`));
    }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(guard); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(guard);
      if (sourceRoot) fs.rmSync(sourceRoot, { recursive: true, force: true });
      try {
        assert.equal(signal, null, `ucode terminated by ${signal}`);
        assert.equal(status, 0, stderr || stdout);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(error); }
    });
  });
}

export function buildSendFixture(output) {
  const built = spawnSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror',
    'tests/native/core/native-helper-send-fixture.c', '-o', output,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr || built.stdout);
}

export function buildShutdownShim(output) {
  const compiler = process.env.UCODE_ARGS_PIPE ? process.env.TARGET_CC : 'cc';
  assert.ok(compiler, 'TARGET_CC is required for exact-target shutdown injection');
  const built = spawnSync(compiler, [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC', '-ldl',
    'tests/native/core/native-helper-shutdown-shim.c', '-o', output,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr || built.stdout);
}

export function shutdownShimEnv(shim) {
  return process.env.UCODE_ARGS_PIPE
    ? { QEMU_SET_ENV: `LD_PRELOAD=${shim},Z2M_TEST_SHUTDOWN_FAIL=1` }
    : { LD_PRELOAD: shim, Z2M_TEST_SHUTDOWN_FAIL: '1' };
}

export function sendShimEnv(shim, mode) {
  return process.env.UCODE_ARGS_PIPE
    ? { QEMU_SET_ENV: `LD_PRELOAD=${shim},Z2M_TEST_SEND_MODE=${mode}` }
    : { LD_PRELOAD: shim, Z2M_TEST_SEND_MODE: mode };
}

export async function withSendFixture(binary, mode, callback) {
  fs.rmSync(SOCKET_PATH, { force: true });
  const child = spawn(binary, [mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(`send fixture not ready: ${stderr}`)), 3000);
    child.stdout.on('data', () => {
      if (stdout.includes('READY\n')) { clearTimeout(guard); resolve(); }
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (!stdout.includes('READY\n')) reject(new Error(`send fixture exited ${code}: ${stderr}`));
    });
  });
  await ready;
  try {
    const result = await callback();
    if (child.exitCode === null)
      await new Promise(resolve => child.once('exit', resolve));
    assert.equal(child.exitCode, 0, stderr);
    return { result, evidence: stdout.trim().split('\n').at(-1) };
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(SOCKET_PATH, { force: true });
  }
}
