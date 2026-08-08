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
  const staleIdentity = fs.existsSync(socketPath) ? fs.lstatSync(socketPath) : null;
  server = spawn(binary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(() => {
    if (server.exitCode !== null || !fs.existsSync(socketPath)) return server.exitCode !== null;
    const current = fs.lstatSync(socketPath);
    return current.isSocket() && (!staleIdentity || current.dev != staleIdentity.dev ||
      current.ino != staleIdentity.ino);
  });
  assert.equal(server.exitCode, null, errors);
}

async function stop(operatorCleanup = true) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  if (operatorCleanup) removeSocketAsOperator();
}

function removeSocketAsOperator() {
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
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

function exchangeGuarded(payload = frame(), options = {}, guardMs = 2000) {
  return Promise.race([
    exchange(payload, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('exchange host guard expired')), guardMs)),
  ]);
}

async function waitStopped(pid) {
  await waitFor(() => {
    if (!fs.existsSync(`/proc/${pid}/status`)) return false;
    return /^State:\s+T/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
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

test('fails closed on a stale socket and leaves every pre-existing object untouched', async () => {
  await start();
  server.kill('SIGKILL');
  await new Promise(resolve => server.once('exit', resolve));
  const stale = fs.lstatSync(socketPath);
  const failedStale = spawn(daemon, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  let staleErrors = '';
  failedStale.stderr.on('data', chunk => { staleErrors += chunk; });
  await new Promise(resolve => setTimeout(resolve, 300));
  if (failedStale.exitCode === null) {
    failedStale.kill('SIGTERM');
    await new Promise(resolve => failedStale.once('exit', resolve));
  }
  assert.notEqual(failedStale.exitCode, 0);
  const after = fs.lstatSync(socketPath);
  assert.equal(after.dev, stale.dev);
  assert.equal(after.ino, stale.ino);
  assert.match(staleErrors, /pre-existing socket path/);
  fs.unlinkSync(socketPath);

  fs.writeFileSync(socketPath, 'sentinel', { mode: 0o600 });
  const failed = run(daemon, []);
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'sentinel');
  fs.unlinkSync(socketPath);
});

test('fails singleton startup on a live socket without modifying it', async () => {
  await start();
  const before = fs.lstatSync(socketPath);
  const second = run(daemon, []);
  assert.notEqual(second.status, 0);
  const after = fs.lstatSync(socketPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.match(second.stderr, /singleton|pre-existing socket path/);
  assert.equal(parseResponse(await exchange()).header.outcome, 'child_exited');
  await stop();
});

test('rejects a full-backlog socket without probing or modifying it', () => {
  const listener = path.join(root, 'full-backlog-listener');
  const ready = path.join(root, 'full-backlog-ready');
  compileHelper(listener, `#include <fcntl.h>\n#include <sys/socket.h>\n#include <sys/stat.h>\n#include <sys/un.h>\n#include <string.h>\n#include <unistd.h>\nint main(void){struct sockaddr_un a={.sun_family=AF_UNIX};int s=socket(AF_UNIX,SOCK_STREAM,0);if(s<0)return 1;strcpy(a.sun_path,"${socketPath}");if(bind(s,(struct sockaddr*)&a,sizeof(a))<0||chmod(a.sun_path,0600)<0||listen(s,1)<0)return 2;for(int i=0;i<64;i++){int c=socket(AF_UNIX,SOCK_STREAM|SOCK_NONBLOCK,0);if(c>=0)(void)connect(c,(struct sockaddr*)&a,sizeof(a));}int r=open("${ready}",O_WRONLY|O_CREAT|O_TRUNC,0600);if(r<0)return 3;close(r);sleep(3);return 0;}\n`);
  const crafted = spawn(listener);
  return waitFor(() => fs.existsSync(ready)).then(() => {
    const before = fs.lstatSync(socketPath);
    const started = performance.now();
    const failed = run(daemon, [], { timeout: 1000 });
    const elapsed = performance.now() - started;
    assert.notEqual(failed.status, 0);
    assert.equal(failed.signal, null, 'broker startup must not hit the host timeout');
    assert.ok(elapsed < 500, `pre-existing socket rejection took ${elapsed}ms`);
    const afterStat = fs.lstatSync(socketPath);
    assert.equal(afterStat.dev, before.dev);
    assert.equal(afterStat.ino, before.ino);
    crafted.kill('SIGKILL');
    return new Promise(resolve => crafted.once('exit', resolve));
  }).finally(removeSocketAsOperator);
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

test('shutdown never unlinks the socket inode created by this daemon', async () => {
  await start();
  const owned = fs.lstatSync(socketPath);
  await stop(false);
  const afterStat = fs.lstatSync(socketPath);
  assert.equal(afterStat.dev, owned.dev);
  assert.equal(afterStat.ino, owned.ino);
  removeSocketAsOperator();
});

test('shutdown never unlinks a replacement socket pathname', async () => {
  await start();
  const original = `${socketPath}.original`;
  fs.renameSync(socketPath, original);
  fs.writeFileSync(socketPath, 'replacement', { mode: 0o600 });
  await stop(false);
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'replacement');
  fs.unlinkSync(socketPath);
  fs.unlinkSync(original);
});

test('replacement between bind and socket recording is never unlinked', async () => {
  const binary = path.join(root, 'z2m-helperd-bind-record-race');
  compile(binary, helper, ['-DZ2M_TEST_STOP_AFTER_BIND']);
  server = spawn(binary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  await waitStopped(server.pid);
  const original = `${socketPath}.bind-original`;
  fs.renameSync(socketPath, original);
  fs.writeFileSync(socketPath, 'bind-record-replacement', { mode: 0o600 });
  server.kill('SIGCONT');
  await new Promise(resolve => server.once('exit', resolve));
  assert.notEqual(server.exitCode, 0);
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'bind-record-replacement');
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

test('deadline remains active after the leader exits while a descendant survives', async () => {
  const descendantHelper = path.join(root, 'descendant-timeout-helper');
  compileHelper(descendantHelper, '#include <signal.h>\n#include <stdio.h>\n#include <unistd.h>\nint main(void){pid_t p=fork();if(p<0)return 1;if(p==0){signal(SIGTERM,SIG_IGN);sleep(2);return 0;}printf("descendant=%ld\\n",(long)p);fflush(stdout);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-descendant-timeout');
  compile(binary, descendantHelper);
  await start(binary);
  const started = Date.now();
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'descendant:timeout', 100), {}, 1500));
  const descendant = Number(/descendant=(\d+)/.exec(response.body.toString())?.[1]);
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(response.header.childReaped, true);
  assert.ok(Date.now() - started < 800, `descendant timeout took ${Date.now() - started}ms`);
  assert.equal(fs.existsSync(`/proc/${descendant}`), false, `descendant ${descendant} survived timeout`);
  await stop();
});

test('shutdown escalates TERM-ignoring descendants after leader reap without hanging serial broker', async () => {
  const descendantHelper = path.join(root, 'descendant-shutdown-helper');
  compileHelper(descendantHelper, '#include <signal.h>\n#include <stdio.h>\n#include <unistd.h>\nint main(void){pid_t p=fork();if(p<0)return 1;if(p==0){signal(SIGTERM,SIG_IGN);sleep(2);return 0;}printf("descendant=%ld\\n",(long)p);fflush(stdout);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-descendant-shutdown');
  compile(binary, descendantHelper);
  await start(binary);
  const pending = exchangeGuarded(frame(Buffer.alloc(0), 'descendant:shutdown', 30000), { resetIsEof: true }, 1500);
  let descendant;
  await waitFor(() => {
    const children = fs.readFileSync(`/proc/${server.pid}/task/${server.pid}/children`, 'utf8').trim();
    descendant = Number(children.split(/\s+/)[0]);
    return Number.isInteger(descendant) && descendant > 0;
  });
  const started = Date.now();
  await stop();
  await pending;
  assert.ok(Date.now() - started < 800, `shutdown took ${Date.now() - started}ms`);
  assert.equal(fs.existsSync(`/proc/${descendant}`), false, `descendant ${descendant} survived shutdown`);
});

test('deadline kills and reaps an adopted descendant that escapes the leader process group', async () => {
  const adoptedHelper = path.join(root, 'adopted-timeout-helper');
  compileHelper(adoptedHelper, '#include <signal.h>\n#include <stdio.h>\n#include <unistd.h>\nint main(void){pid_t p=fork();if(p<0)return 1;if(p==0){if(setsid()<0)return 2;signal(SIGTERM,SIG_IGN);sleep(2);return 0;}printf("adopted=%ld\\n",(long)p);fflush(stdout);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-adopted-timeout');
  compile(binary, adoptedHelper);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'adopted:timeout', 100), {}, 1500));
  const adopted = Number(/adopted=(\d+)/.exec(response.body.toString())?.[1]);
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(response.header.childReaped, true);
  assert.equal(fs.existsSync(`/proc/${adopted}`), false, `adopted child ${adopted} survived timeout`);
  await stop();
});

test('EOF descriptors are removed from poll and silent-child poll count stays bounded', async () => {
  const silent = path.join(root, 'silent-helper');
  compileHelper(silent, '#include <unistd.h>\nint main(void){close(0);close(1);close(2);usleep(300000);return 0;}\n');
  const report = path.join(root, 'poll-count');
  const binary = path.join(root, 'z2m-helperd-poll-count');
  compile(binary, silent, [`-DZ2M_TEST_POLL_COUNT_PATH="${report}"`]);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'poll:bounded', 1000)));
  assert.equal(response.header.outcome, 'child_exited');
  const count = Number(fs.readFileSync(report, 'utf8'));
  assert.ok(count > 0 && count < 100, `poll count ${count} is not bounded`);
  await stop();
});

test('fatal poll error terminates and reaps before transport failure response', async () => {
  const sleeper = path.join(root, 'poll-failure-sleeper');
  compileHelper(sleeper, '#include <unistd.h>\nint main(void){sleep(2);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-poll-failure');
  compile(binary, sleeper, ['-DZ2M_TEST_POLL_HARD_FAILURE']);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'poll:failure', 1000)));
  assert.equal(response.header.outcome, 'transport_failure');
  assert.equal(response.header.reason, 'supervision_failure');
  assert.ok(['not_started', 'started'].includes(response.header.startState),
    `unexpected start state ${response.header.startState}`);
  assert.equal(response.header.childReaped, true);
  await stop();
});

test('partial request stall expires and cannot wedge the next serial client', async () => {
  const binary = path.join(root, 'z2m-helperd-read-deadline');
  compile(binary, helper, ['-DZ2M_TEST_IO_TIMEOUT_MS=100']);
  await start(binary);
  const stalled = net.createConnection(socketPath);
  await new Promise((resolve, reject) => stalled.once('connect', resolve).once('error', reject));
  stalled.write(Buffer.from('Z2M'));
  const started = Date.now();
  const next = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'after:read-stall', 1000), {}, 1000));
  assert.equal(next.header.outcome, 'child_exited');
  assert.ok(Date.now() - started < 400, `next client waited ${Date.now() - started}ms`);
  stalled.destroy();
  await stop();
});

test('non-reading response client expires and cannot wedge the next serial client', async () => {
  const writer = path.join(root, 'nonreader-writer');
  compileHelper(writer, '#include <string.h>\n#include <unistd.h>\nint main(void){char b[65536];memset(b,\'x\',sizeof(b));for(int i=0;i<96;i++)if(write(1,b,sizeof(b))!=(ssize_t)sizeof(b))return 1;return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-write-deadline');
  compile(binary, writer, ['-DZ2M_TEST_IO_TIMEOUT_MS=100']);
  await start(binary);
  const stalled = net.createConnection(socketPath);
  await new Promise((resolve, reject) => stalled.once('connect', resolve).once('error', reject));
  stalled.end(frame(Buffer.alloc(0), 'response:stall', 1000));
  await new Promise(resolve => setTimeout(resolve, 50));
  const started = Date.now();
  const next = exchangeGuarded(frame(Buffer.alloc(0), 'after:write-stall', 1000), { resetIsEof: true }, 1000);
  await next;
  assert.ok(Date.now() - started < 400, `next client waited ${Date.now() - started}ms`);
  stalled.destroy();
  await stop();
});

test('lock pathname replacement after open cannot create dual singleton ownership', async () => {
  const binary = path.join(root, 'z2m-helperd-lock-race');
  compile(binary, helper, ['-DZ2M_TEST_STOP_AFTER_LOCK_OPEN']);
  server = spawn(binary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
  await waitStopped(server.pid);
  const lockPath = path.join(runtime, 'z2m-helperd.lock');
  const displaced = `${lockPath}.displaced`;
  fs.renameSync(lockPath, displaced);
  fs.writeFileSync(lockPath, '', { mode: 0o600 });
  server.kill('SIGCONT');
  await new Promise(resolve => server.once('exit', resolve));
  assert.notEqual(server.exitCode, 0, 'raced daemon must fail before lock ownership');
  fs.unlinkSync(displaced);
  await start();
  assert.equal(parseResponse(await exchange()).header.outcome, 'child_exited');
  await stop();
});

for (const [window, definition] of [
  ['between precheck and flock', '-DZ2M_TEST_STOP_BEFORE_LOCK_FLOCK'],
  ['between flock and postcheck', '-DZ2M_TEST_STOP_AFTER_LOCK_FLOCK'],
]) {
  test(`singleton rejects lock replacement ${window} while replacement lock is held`, async () => {
    const binary = path.join(root, `z2m-helperd-lock-${definition.includes('BEFORE') ? 'pre' : 'post'}-race`);
    compile(binary, helper, [definition]);
    server = spawn(binary, [], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitStopped(server.pid);
    const raced = server;
    const lockPath = path.join(runtime, 'z2m-helperd.lock');
    const displaced = `${lockPath}.displaced`;
    fs.renameSync(lockPath, displaced);
    fs.writeFileSync(lockPath, '', { mode: 0o600 });

    const contender = spawn(daemon, [], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitFor(() => fs.existsSync(socketPath) || contender.exitCode !== null);
    assert.equal(contender.exitCode, null, 'contender must hold the replacement lock');
    raced.kill('SIGCONT');
    await new Promise(resolve => raced.once('exit', resolve));
    assert.notEqual(raced.exitCode, 0, 'raced daemon must fail its post-flock identity gate');
    assert.equal(contender.exitCode, null, 'raced daemon must not disturb replacement lock owner');
    contender.kill('SIGTERM');
    await new Promise(resolve => contender.once('exit', resolve));
    removeSocketAsOperator();
    fs.unlinkSync(displaced);
    server = contender;
  });
}

test('repeated child discovery consumes a list larger than 4096 bytes and preserves identity', async () => {
  const childList = path.join(root, 'oversized-children');
  const enumeration = path.join(root, 'enumeration-bytes');
  const oversizedHelper = path.join(root, 'oversized-children-helper');
  compileHelper(oversizedHelper, `#include <fcntl.h>\n#include <stdio.h>\n#include <unistd.h>\nint main(void){int f=open("${childList}",O_WRONLY|O_CREAT|O_TRUNC,0600);if(f<0)return 1;for(int i=0;i<1200;i++)dprintf(f,"%ld ",(long)getpid());close(f);sleep(2);return 0;}\n`);
  const binary = path.join(root, 'z2m-helperd-oversized-children');
  compile(binary, oversizedHelper, [
    `-DZ2M_TEST_CHILDREN_PATH="${childList}"`,
    `-DZ2M_TEST_ENUMERATION_BYTES_PATH="${enumeration}"`,
  ]);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'children:oversized', 100), {}, 1500));
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(response.header.childReaped, true);
  assert.ok(Number(fs.readFileSync(enumeration, 'utf8')) > 4096,
    'enumeration must consume the complete oversized child list');
  await stop();
});

test('post-reap cleanup never sends a negative process-group signal', async () => {
  const report = path.join(root, 'post-reap-group-signals');
  const descendantHelper = path.join(root, 'post-reap-group-helper');
  compileHelper(descendantHelper, '#include <signal.h>\n#include <unistd.h>\nint main(void){pid_t p=fork();if(p<0)return 1;if(p==0){signal(SIGTERM,SIG_IGN);sleep(2);return 0;}return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-post-reap-group');
  compile(binary, descendantHelper, [`-DZ2M_TEST_POST_REAP_GROUP_SIGNAL_PATH="${report}"`]);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'group:identity', 100), {}, 1500));
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(fs.readFileSync(report, 'utf8').trim(), '0');
  await stop();
});

test('cleanup repeatedly discovers and kills a descendant forked after TERM', async () => {
  const pidReport = path.join(root, 'late-descendant-pid');
  const helperPath = path.join(root, 'late-descendant-helper');
  compileHelper(helperPath, `#include <fcntl.h>\n#include <signal.h>\n#include <stdio.h>\n#include <unistd.h>\nstatic const char *p="${pidReport}";static void term(int s){(void)s;pid_t c=fork();if(c==0){signal(SIGTERM,SIG_IGN);sleep(2);_exit(0);}int f=open(p,O_WRONLY|O_CREAT|O_TRUNC,0600);if(f>=0){dprintf(f,"%ld\\n",(long)c);close(f);}}int main(void){signal(SIGTERM,term);sleep(2);return 0;}\n`);
  const binary = path.join(root, 'z2m-helperd-late-descendant');
  compile(binary, helperPath);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'children:late', 100), {}, 1500));
  const latePid = Number(fs.readFileSync(pidReport, 'utf8'));
  assert.equal(response.header.outcome, 'timeout');
  assert.equal(response.header.childReaped, true);
  assert.equal(fs.existsSync(`/proc/${latePid}`), false, `late descendant ${latePid} survived cleanup`);
  await stop();
});

test('incomplete cleanup overrides timeout with supervision failure', async () => {
  const sleeper = path.join(root, 'cleanup-expiry-sleeper');
  compileHelper(sleeper, '#include <signal.h>\n#include <unistd.h>\nint main(void){signal(SIGTERM,SIG_IGN);sleep(2);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-cleanup-expiry');
  compile(binary, sleeper, ['-DZ2M_TEST_FORCE_CLEANUP_EXPIRED']);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'cleanup:expiry', 100), {}, 1500));
  assert.equal(response.header.outcome, 'transport_failure');
  assert.equal(response.header.reason, 'supervision_failure');
  assert.equal(response.header.childReaped, true);
  await stop();
});

test('discovery failure overrides simultaneous timeout after converged cleanup', async () => {
  const childrenDirectory = path.join(root, 'children-is-directory');
  fs.mkdirSync(childrenDirectory, { mode: 0o700 });
  const sleeper = path.join(root, 'discovery-failure-sleeper');
  compileHelper(sleeper, '#include <unistd.h>\nint main(void){sleep(2);return 0;}\n');
  const binary = path.join(root, 'z2m-helperd-discovery-failure');
  compile(binary, sleeper, [`-DZ2M_TEST_CHILDREN_PATH="${childrenDirectory}"`]);
  await start(binary);
  const response = parseResponse(await exchangeGuarded(frame(Buffer.alloc(0), 'discovery:failure', 100), {}, 1500));
  assert.equal(response.header.outcome, 'transport_failure');
  assert.equal(response.header.reason, 'supervision_failure');
  assert.equal(response.header.childReaped, true);
  await stop();
});

test('real process identity gates reject stale conflicts and signal only the matching child', () => {
  const auditSource = path.join(root, 'process-identity-audit.c');
  const auditBinary = path.join(root, 'process-identity-audit');
  fs.writeFileSync(auditSource, `#include <errno.h>\n#include <signal.h>\n#include <stdbool.h>\n#include <sys/wait.h>\n#include <unistd.h>\n#include "${path.resolve(sourceDir, 'helperd.h')}"\nbool z2m_stopping(void){return false;}\nstatic pid_t child(void){pid_t p=fork();if(p==0){for(;;)pause();}return p;}\nstatic int still_running(pid_t p){int s;return waitpid(p,&s,WNOHANG)==0;}\nstatic int fail(pid_t p,int code){kill(p,SIGKILL);while(waitpid(p,0,0)<0&&errno==EINTR){}return code;}\nint main(void){int s;pid_t p=child();if(p<0)return 1;unsigned long long actual=z2m_test_process_starttime(p);if(!actual)return fail(p,2);if(!z2m_test_identity_live(p,actual)||z2m_test_identity_live(p,actual+1))return fail(p,3);errno=0;if(z2m_test_track_conflict(p,actual+1,actual)!=-1||errno!=EEXIST)return fail(p,4);if(!still_running(p))return fail(p,5);z2m_test_signal_tracked(p,actual+1,SIGTERM);usleep(50000);if(!still_running(p))return fail(p,6);z2m_test_signal_tracked(p,actual,SIGTERM);if(waitpid(p,&s,0)!=p||!WIFSIGNALED(s)||WTERMSIG(s)!=SIGTERM)return 7;if(z2m_test_identity_live(p,actual))return 8;return 0;}\n`);
  const built = run('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-DZ2M_TESTING', `-DZ2M_RUNTIME_PATH="${runtime}"`, `-DZ2M_HELPER_PATH="${helper}"`,
    auditSource, `${sourceDir}/supervise.c`, '-o', auditBinary]);
  assert.equal(built.status, 0, built.stderr);
  const result = run(auditBinary, []);
  assert.equal(result.status, 0, result.stderr);
});
