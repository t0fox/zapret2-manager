import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

export const SOCKET_PATH = '/tmp/zapret2-manager/runtime/z2m-helperd.sock';
export const MODULE = './zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc';
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_MODULE_PATH ? ['-L', process.env.UCODE_MODULE_PATH] : [];

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

export async function withPeer(handler, callback) {
  fs.mkdirSync('/tmp/zapret2-manager/runtime', { recursive: true, mode: 0o700 });
  fs.rmSync(SOCKET_PATH, { force: true });
  const server = net.createServer(socket => {
    const chunks = [];
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

export function invoke(expression, timeout = 5000) {
  const source = `import * as native from '${MODULE}'; print(sprintf('%J', ${expression}));`;
  const child = spawn(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: process.cwd(),
    env: { ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '/opt/ucode/lib' },
  });
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const guard = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ucode timed out')); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(guard); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(guard);
      try {
        assert.equal(signal, null, `ucode terminated by ${signal}`);
        assert.equal(status, 0, stderr || stdout);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(error); }
    });
  });
}
