import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const sourceDir = 'zapret2-manager/src/z2m-helperd';
const sourceNames = ['z2m-helperd.c', 'transport.c', 'supervise.c'];
const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'z2m-helperd-host-'));
const runtime = path.join(root, 'runtime');
const daemon = path.join(root, 'z2m-helperd');
const helper = path.join(root, 'helper');
const socketPath = path.join(runtime, 'z2m-helperd.sock');
let server;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function compile(output, helperPath, definitions = []) {
  const peerDefinition = definitions.some(value => value.startsWith('-DZ2M_TEST_PEER_UID='))
    ? [] : [`-DZ2M_TEST_PEER_UID=${process.getuid()}`];
  const result = run('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-DZ2M_TESTING', `-DZ2M_RUNTIME_PATH="${runtime}"`, `-DZ2M_HELPER_PATH="${helperPath}"`,
    `-DZ2M_TEST_RUNTIME_UID=${process.getuid()}`, `-DZ2M_TEST_RUNTIME_GID=${process.getgid()}`,
    ...peerDefinition, ...definitions,
    ...sourceNames.map(name => `${sourceDir}/${name}`), '-ljson-c', '-o', output]);
  assert.equal(result.status, 0, result.stderr);
}

function compileHelper(output, source) {
  const result = run('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-x', 'c', '-', '-o', output], { input: source });
  assert.equal(result.status, 0, result.stderr);
}

function frame(body = Buffer.alloc(0), requestId = 'host:1', timeoutMs = 1000) {
  const header = Buffer.from(JSON.stringify({ protocol: 'z2m-helper-transport-v1', requestId, timeoutMs }));
  const prelude = Buffer.alloc(20);
  prelude.write('Z2MHTV1\n'); prelude[8] = 1;
  prelude.writeUInt32BE(header.length, 12); prelude.writeUInt32BE(body.length, 16);
  return Buffer.concat([prelude, header, body]);
}

function rawFrame(header, body = Buffer.alloc(0)) {
  header = Buffer.from(header);
  const prelude = Buffer.alloc(20);
  prelude.write('Z2MHTV1\n'); prelude[8] = 1;
  prelude.writeUInt32BE(header.length, 12); prelude.writeUInt32BE(body.length, 16);
  return Buffer.concat([prelude, header, body]);
}

function parseResponse(data) {
  assert.equal(data.subarray(0, 8).toString(), 'Z2MHTV1\n');
  assert.equal(data[8], 2);
  const headerLength = data.readUInt32BE(12);
  const bodyLength = data.readUInt32BE(16);
  const header = JSON.parse(data.subarray(20, 20 + headerLength));
  const body = data.subarray(20 + headerLength);
  assert.equal(body.length, bodyLength);
  return { header, body };
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('condition did not become true');
}

async function start(binary = daemon) {
  server = spawn(binary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(() => fs.existsSync(socketPath) || server.exitCode !== null);
  assert.equal(server.exitCode, null, errors);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}

function exchange(payload = frame(), { resetIsEof = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const client = net.createConnection(socketPath);
    client.on('connect', () => client.end(payload));
    client.on('data', chunk => chunks.push(chunk));
    client.on('end', () => resolve(Buffer.concat(chunks)));
    client.on('error', error => {
      if (resetIsEof && ['EPIPE', 'ECONNRESET'].includes(error.code)) resolve(Buffer.concat(chunks));
      else reject(error);
    });
  });
}

before(() => {
  fs.mkdirSync(runtime, { mode: 0o700 });
  const helperBuilt = run('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-x', 'c', '-', '-o', helper], {
    input: '#include <stdio.h>\nint main(void){fputs("{\\\"ok\\\":true}\\n",stdout);return 0;}\n',
  });
  assert.equal(helperBuilt.status, 0, helperBuilt.stderr);
  compile(daemon, helper);
});

after(async () => {
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
});

test('production broker has a closed fixed-purpose source surface', () => {
  for (const name of [...sourceNames, 'helperd.h'])
    assert.ok(fs.existsSync(`${sourceDir}/${name}`), `${name} must exist`);

  const source = [...sourceNames, 'helperd.h']
    .map(name => fs.readFileSync(`${sourceDir}/${name}`, 'utf8')).join('\n');
  for (const fixed of [
    '/usr/libexec/zapret2-manager/z2m-core-helper',
    '/tmp/zapret2-manager/runtime/z2m-helperd.sock',
    '/tmp/zapret2-manager/runtime/z2m-helperd.lock',
  ]) assert.ok(source.includes(fixed), `production source must contain fixed path ${fixed}`);

  assert.doesNotMatch(source, /\b(?:execvp|execlp|system|popen)\s*\(/,
    'broker must not resolve PATH or invoke a shell');
  assert.doesNotMatch(source, /\b(?:AF_INET6?|SOCK_DGRAM)\b/,
    'broker must expose only its AF_UNIX stream listener');
  assert.doesNotMatch(source, /getenv\s*\(|\/bin\/(?:ba)?sh|\bchdir\s*\(/,
    'caller environment, shell, and working directory are not capabilities');
  assert.doesNotMatch(source, /"(?:argv|env|executable|command|socketPath|workingDirectory|uid|gid|signal)"/,
    'wire fields must not expose generic process capabilities');
});

test('serves strict dynamic request framing and preserves helper bytes', async () => {
  await start();
  const response = parseResponse(await exchange(frame(Buffer.from('opaque'), 'state-write:1234:17', 1000)));
  assert.equal(response.header.requestId, 'state-write:1234:17');
  assert.equal(response.header.outcome, 'child_exited');
  assert.equal(response.header.childReaped, true);
  assert.equal(response.body.toString(), '{"ok":true}\n');
  await stop();
});

test('singleton lock excludes a second daemon without disturbing the live socket', async () => {
  await start();
  const before = fs.lstatSync(socketPath);
  const second = run(daemon, []);
  assert.notEqual(second.status, 0);
  const afterStat = fs.lstatSync(socketPath);
  assert.equal(afterStat.ino, before.ino);
  assert.equal(parseResponse(await exchange()).header.outcome, 'child_exited');
  await stop();
});

test('removes a safe stale socket but leaves unsafe stale objects untouched', async () => {
  await start();
  server.kill('SIGKILL');
  await new Promise(resolve => server.once('exit', resolve));
  assert.ok(fs.lstatSync(socketPath).isSocket());
  await start();
  assert.equal(parseResponse(await exchange()).header.outcome, 'child_exited');
  await stop();

  fs.writeFileSync(socketPath, 'sentinel', { mode: 0o600 });
  const failed = run(daemon, []);
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'sentinel');
  fs.unlinkSync(socketPath);
});

test('fails closed when peer UID does not match the fixed accepted UID', async () => {
  const rejecting = path.join(root, 'z2m-helperd-reject-peer');
  compile(rejecting, helper, [`-DZ2M_TEST_PEER_UID=${process.getuid() + 1}`]);
  await start(rejecting);
  assert.equal((await exchange(frame(), { resetIsEof: true })).length, 0);
  await stop();
});

test('classifies fixed helper exec failure from the status pipe', async () => {
  const missing = path.join(root, 'z2m-helperd-missing');
  compile(missing, `${helper}.missing`);
  await start(missing);
  const response = parseResponse(await exchange());
  assert.equal(response.header.outcome, 'spawn_failure');
  assert.equal(response.header.startState, 'not_started');
  assert.equal(response.header.stage, 'exec');
  assert.equal(response.header.childReaped, true);
  await stop();
});

test('classifies checked child setup failure from the status pipe', async () => {
  const broken = path.join(root, 'z2m-helperd-setup-failure');
  compile(broken, helper, ['-DZ2M_TEST_FAIL_STDIN_DUP2']);
  await start(broken);
  const response = parseResponse(await exchange());
  assert.equal(response.header.outcome, 'setup_failure');
  assert.equal(response.header.startState, 'not_started');
  assert.equal(response.header.stage, 'stdin_dup2');
  assert.equal(response.header.childReaped, true);
  await stop();
});

test('rejects malformed, duplicate, unknown, invalid identity, trailing, and oversized requests', async () => {
  await start();
  const valid = { protocol: 'z2m-helper-transport-v1', requestId: 'host:1', timeoutMs: 1000 };
  const cases = [
    rawFrame('{'),
    rawFrame('{"protocol":"z2m-helper-transport-v1","protocol":"z2m-helper-transport-v1","requestId":"host:1","timeoutMs":1000}'),
    rawFrame(JSON.stringify({ ...valid, command: '/bin/sh' })),
    rawFrame(JSON.stringify({ ...valid, requestId: '../bad' })),
    Buffer.concat([frame(), Buffer.from('x')]),
    (() => { const value = frame(); value.writeUInt32BE(4 * 1024 * 1024 + 1, 16); return value.subarray(0, 20); })(),
  ];
  for (const payload of cases)
    assert.equal((await exchange(payload, { resetIsEof: true })).length, 0);
  await stop();
});

test('rejects unsafe runtime and lock objects without repairing them', () => {
  fs.chmodSync(runtime, 0o755);
  let failed = run(daemon, []);
  assert.notEqual(failed.status, 0);
  assert.equal(fs.statSync(runtime).mode & 0o777, 0o755);
  fs.chmodSync(runtime, 0o700);

  const lockPath = path.join(runtime, 'z2m-helperd.lock');
  fs.rmSync(lockPath, { force: true });
  fs.symlinkSync(path.join(root, 'lock-target'), lockPath);
  failed = run(daemon, []);
  assert.notEqual(failed.status, 0);
  assert.ok(fs.lstatSync(lockPath).isSymbolicLink());
  fs.unlinkSync(lockPath);
});

test('disconnect before a complete frame does not spawn and daemon remains usable', async () => {
  await start();
  await new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    client.on('connect', () => client.end(Buffer.from('Z2M')));
    client.on('close', resolve);
    client.on('error', error => ['EPIPE', 'ECONNRESET'].includes(error.code) ? resolve() : reject(error));
  });
  assert.equal(parseResponse(await exchange()).header.outcome, 'child_exited');
  await stop();
});

test('times out and reaps the fixed child before responding', async () => {
  const sleeper = path.join(root, 'sleeper');
  const sleeperBuilt = run('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-x', 'c', '-', '-o', sleeper], {
    input: '#include <unistd.h>\nint main(void){sleep(30);return 0;}\n',
  });
  assert.equal(sleeperBuilt.status, 0, sleeperBuilt.stderr);
  const timeoutDaemon = path.join(root, 'z2m-helperd-timeout');
  compile(timeoutDaemon, sleeper);
  await start(timeoutDaemon);
  const started = Date.now();
  const response = parseResponse(await exchange(frame(Buffer.alloc(0), 'timeout:1', 100)));
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(response.header.startState, 'started');
  assert.equal(response.header.childReaped, true);
  assert.ok(Date.now() - started < 1000);
  await stop();
});

test('duplexes a 4 MiB request into the fixed helper', async () => {
  const counter = path.join(root, 'counter');
  compileHelper(counter, '#include <stdio.h>\n#include <unistd.h>\nint main(void){char b[65536];size_t n=0;ssize_t r;while((r=read(0,b,sizeof(b)))>0)n+=(size_t)r;if(r<0)return 1;printf("%zu\\n",n);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-counter');
  compile(binary, counter);
  await start(binary);
  const response = parseResponse(await exchange(frame(Buffer.alloc(4 * 1024 * 1024), 'bounds:request', 5000)));
  assert.equal(response.header.outcome, 'child_exited');
  assert.equal(response.body.toString(), '4194304\n');
  await stop();
});

test('accepts 6 MiB stdout and rejects cap plus one after reap', async () => {
  for (const [extra, outcome] of [[0, 'child_exited'], [1, 'transport_failure']]) {
    const writer = path.join(root, `writer-${extra}`);
    compileHelper(writer, `#include <string.h>\n#include <unistd.h>\nint main(void){char b[65536];memset(b,'o',sizeof(b));size_t n=${6 * 1024 * 1024 + extra}U;while(n){size_t c=n<sizeof(b)?n:sizeof(b);ssize_t w=write(1,b,c);if(w<=0)return 1;n-=(size_t)w;}return 0;}\n`);
    const binary = path.join(root, `z2m-helperd-writer-${extra}`);
    compile(binary, writer);
    await start(binary);
    const response = parseResponse(await exchange(frame(Buffer.alloc(0), `bounds:response:${extra}`, 5000)));
    assert.equal(response.header.outcome, outcome);
    assert.equal(response.header.childReaped, true);
    if (extra == 0) assert.equal(response.body.length, 6 * 1024 * 1024);
    else assert.equal(response.header.reason, 'stdout_limit');
    await stop();
  }
});

test('retains 4096 stderr bytes while draining excess', async () => {
  const noisy = path.join(root, 'noisy');
  compileHelper(noisy, '#include <string.h>\n#include <unistd.h>\nint main(void){char b[16384];memset(b,\'e\',sizeof(b));if(write(2,b,sizeof(b))!=(ssize_t)sizeof(b))return 1;return write(1,"ok\\n",3)!=3;}\n');
  const binary = path.join(root, 'z2m-helperd-noisy');
  compile(binary, noisy);
  await start(binary);
  const response = parseResponse(await exchange(frame(Buffer.alloc(0), 'bounds:stderr', 1000)));
  assert.equal(response.header.outcome, 'child_exited');
  assert.equal(response.header.stderrLength, 4096);
  assert.equal(response.header.stderrDrained, 16384);
  assert.equal(response.header.stderrTruncated, true);
  assert.equal(response.body.length, 4099);
  await stop();
});

test('daemon shutdown terminates and reaps an active helper', async () => {
  const sleeper = path.join(root, 'shutdown-sleeper');
  compileHelper(sleeper, '#include <unistd.h>\nint main(void){sleep(30);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-shutdown');
  compile(binary, sleeper);
  await start(binary);
  const pending = exchange(frame(Buffer.alloc(0), 'shutdown:1', 30000), { resetIsEof: true });
  let childPid;
  await waitFor(() => {
    const children = fs.readFileSync(`/proc/${server.pid}/task/${server.pid}/children`, 'utf8').trim();
    childPid = Number(children.split(/\s+/)[0]);
    return Number.isInteger(childPid) && childPid > 0;
  });
  await stop();
  await pending;
  assert.equal(fs.existsSync(`/proc/${childPid}`), false, `helper ${childPid} survived daemon shutdown`);
});

test('cleanup removes only the socket inode created by this daemon', async () => {
  await start();
  const original = `${socketPath}.original`;
  fs.renameSync(socketPath, original);
  fs.writeFileSync(socketPath, 'replacement', { mode: 0o600 });
  await stop();
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'replacement');
  fs.unlinkSync(socketPath);
  fs.unlinkSync(original);
});

test('handles serial requests without descriptor growth', async () => {
  await start();
  const before = fs.readdirSync(`/proc/${server.pid}/fd`).length;
  for (let i = 0; i < 100; i++)
    assert.equal(parseResponse(await exchange(frame(Buffer.alloc(0), `cycle:${i}`, 1000))).header.outcome,
      'child_exited');
  const afterCount = fs.readdirSync(`/proc/${server.pid}/fd`).length;
  assert.equal(afterCount, before);
  await stop();
});
