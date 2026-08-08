import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const EXPECTED_UCODE_COMMIT = '85922056ef7abeace3cca3ab28bc1ac2d88e31b1';
const EXPECTED_UCODE_SHA256 = '647cb596577867470c16c6b58617b7ccd9b1bbe8f40c1fed6b29974df7b48833';
const EXPECTED_SOCKET_SHA256 = 'ccaff63617ed3136c6461dadbf3328cd3a0cba118fbc98578108024291541ca0';
const EXPECTED_SOURCE_SHA256 = '8c6f586f90e704827dc8736bf3726d15989a978c6a726a52d51e33f8019403b6';
const EXPECTED_VERSION_DATE = '1768603607';
const ucode = process.env.UCODE_BIN;
const ucodeArgs = process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const cc = process.env.TARGET_CC;
const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'z2m-broker-spike-'));
const fixture = path.join(root, 'z2m-helperd-spike');
const child = path.join(root, 'native-helper-broker-child');
const socketPath = path.join(root, 'helper.sock');
const probe = path.resolve('tests/native/core/native-helper-broker-spike.uc');
const fixtureSource = path.resolve('tests/native/core/z2m-helperd-spike.c');
const childSource = path.resolve('tests/native/core/native-helper-broker-child.c');
const targetPrefix = ucodeArgs.slice(0, -1);
const TRANSPORT = 'z2m-helper-transport-v1';
let server;
let serverErrors = '';
let nonRootRoot;
let nonRootFixture;
let nonRootName;
let libraryArgs;

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', env: process.env, ...options });
}

function compileSpawnFixture(name, definitions = []) {
  const output = path.join(root, name);
  const fixedChild = definitions.some(definition => definition.startsWith('-DFIXED_CHILD='))
    ? [] : [`-DFIXED_CHILD=${child}`];
  const built = run(cc, ['-std=c11', '-Wall', '-Wextra', '-Werror',
    `-DTEST_ROOT=${root}`, ...fixedChild, ...definitions, fixtureSource, '-o', output]);
  assert.equal(built.status, 0, `${cc} failed:\n${built.stdout}${built.stderr}`);
  return output;
}

function spawnEvidence(mode, fixturePath = fixture) {
  const result = run(ucode, [...targetPrefix, fixturePath, 'spawn', mode], { timeout: 3000 });
  assert.equal(result.error, undefined, `target fixture exceeded host guard: ${result.error ?? ''}`);
  assert.equal(result.signal, null, `target fixture terminated by ${result.signal}`);
  assert.equal(result.status, 0, `target fixture failed:\n${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function invoke(mode, request = Buffer.alloc(0), { cap = 8 * 1024 * 1024,
  timeout = 2000, repeats = 1, asNonRoot = false } = {}) {
  const invocationRoot = asNonRoot ? nonRootRoot : root;
  const invocationSocket = path.join(invocationRoot, 'helper.sock');
  const requestPath = path.join(invocationRoot, `request-${mode}`);
  const responsePath = path.join(invocationRoot, `response-${mode}`);
  if (asNonRoot) {
    const written = run('runuser', ['-u', nonRootName, '--', 'tee', requestPath], {
      input: request, encoding: null,
    });
    assert.equal(written.status, 0, `non-root request creation failed: ${written.stderr}`);
  } else {
    fs.writeFileSync(requestPath, request);
  }
  const command = asNonRoot ? 'runuser' : ucode;
  const prefix = asNonRoot ? ['-u', nonRootName, '--', 'env',
    `LD_LIBRARY_PATH=${process.env.LD_LIBRARY_PATH}`, 'PROOT_NO_SECCOMP=1', ucode] : [];
  const result = run(command, [...prefix, ...ucodeArgs, ...libraryArgs, probe, mode, invocationSocket,
    requestPath, responsePath, String(cap), String(timeout), String(repeats)], {
    timeout: Math.max(10000, timeout * repeats + 5000),
  });
  assert.equal(result.signal, null, `ucode host timeout: ${result.error ?? ''}`);
  assert.equal(result.status, 0, `ucode failed:\n${result.stdout}${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim());
  parsed.response = fs.existsSync(responsePath) ? fs.readFileSync(responsePath) : Buffer.alloc(0);
  return parsed;
}

function expectChildExit(result, stdout, { exitCode = 0, stderr = Buffer.alloc(0),
  stderrTruncated = false } = {}) {
  assert.equal(result.error, null);
  assert.equal(result.header.protocol, TRANSPORT);
  assert.equal(result.header.requestId, 'probe:1');
  assert.equal(result.header.outcome, 'child_exited');
  assert.equal(result.header.startState, 'started');
  assert.equal(result.header.childReaped, true);
  assert.equal(result.header.exitCode, exitCode);
  assert.equal(result.header.signal, null);
  assert.equal(result.header.stdoutLength, stdout.length);
  assert.equal(result.header.stderrLength, stderr.length);
  assert.equal(result.header.stderrTruncated, stderrTruncated);
  assert.deepEqual(result.response.subarray(0, stdout.length), stdout);
  assert.deepEqual(result.response.subarray(stdout.length), stderr);
}

async function startServer(mode, args = [], { asNonRoot = false, fixturePath = fixture } = {}) {
  const invocationRoot = asNonRoot ? nonRootRoot : root;
  const invocationSocket = path.join(invocationRoot, 'helper.sock');
  fs.rmSync(invocationSocket, { force: true });
  const command = asNonRoot ? 'runuser' : ucode;
  const prefix = asNonRoot ? ['-u', nonRootName, '--', 'env',
    `LD_LIBRARY_PATH=${process.env.LD_LIBRARY_PATH}`, 'PROOT_NO_SECCOMP=1', ucode] : [];
  server = spawn(command, [...prefix, ...targetPrefix, asNonRoot ? nonRootFixture : fixturePath,
    mode, invocationSocket,
    ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
  let output = '';
  serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  for await (const chunk of server.stdout) {
    output += chunk;
    if (output.includes('READY\n')) return;
  }
  assert.fail(`fixture exited before READY (code=${server.exitCode}): ${output}${serverErrors}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}

before(() => {
  assert.equal(process.getuid?.(), 0, 'exact socket proof must run under real host UID 0');
  assert.ok(ucode, 'UCODE_BIN must identify exact target ucode');
  assert.ok(process.env.UCODE_ARGS, 'UCODE_ARGS must identify exact target PRoot/QEMU invocation');
  assert.ok(cc, 'TARGET_CC must identify the AArch64 target compiler');
  const targetRootIndex = ucodeArgs.indexOf('-R');
  assert.ok(targetRootIndex >= 0 && ucodeArgs[targetRootIndex + 1], 'UCODE_ARGS must contain target -R root');
  const targetRoot = ucodeArgs[targetRootIndex + 1];
  const targetUcode = path.join(targetRoot, 'usr/bin/ucode');
  const modulePath = process.env.TARGET_SOCKET_MODULE;
  assert.equal(modulePath, path.join(targetRoot, 'usr/lib/ucode/socket.so'),
    'TARGET_SOCKET_MODULE must be socket.so beneath the executed target root');
  assert.equal(sha256(targetUcode), EXPECTED_UCODE_SHA256, 'executed target ucode hash mismatch');
  assert.equal(sha256(modulePath), EXPECTED_SOCKET_SHA256, 'executed target socket module hash mismatch');
  const sdkRoot = targetRoot.slice(0, targetRoot.indexOf('/staging_dir/'));
  const packageMakefile = fs.readFileSync(path.join(sdkRoot, 'package/feeds/base/ucode/Makefile'), 'utf8');
  assert.match(packageMakefile,
    new RegExp(`^PKG_SOURCE_VERSION:=${EXPECTED_UCODE_COMMIT}$`, 'm'),
    'target SDK ucode source commit mismatch');
  assert.match(packageMakefile,
    new RegExp(`^PKG_MIRROR_HASH:=${EXPECTED_SOURCE_SHA256}$`, 'm'),
    'target SDK ucode source hash mismatch');
  assert.equal(sha256(path.join(sdkRoot, 'dl/ucode-2026.01.16~85922056.tar.zst')),
    EXPECTED_SOURCE_SHA256, 'downloaded ucode source artifact hash mismatch');
  const versionDate = path.join(sdkRoot,
    'build_dir/target-aarch64_cortex-a53_musl/ucode-2026.01.16~85922056/version.date');
  assert.equal(fs.readFileSync(versionDate, 'utf8').trim(), EXPECTED_VERSION_DATE,
    'target source version.date mismatch');

  const isolatedModules = path.join(root, 'modules');
  fs.mkdirSync(isolatedModules, { mode: 0o755 });
  for (const name of ['socket.so', 'fs.so'])
    fs.copyFileSync(path.join(targetRoot, `usr/lib/ucode/${name}`), path.join(isolatedModules, name));
  libraryArgs = ['-L', `${isolatedModules}/*.so`];

  const identity = run(ucode, [...ucodeArgs, ...libraryArgs, '-e',
    "import * as fs from 'fs'; import * as socket from 'socket'; printf('%J\\n', { constants: [socket.AF_UNIX, socket.SOCK_STREAM, socket.POLLIN, socket.POLLOUT, socket.POLLERR, socket.POLLHUP], maps: fs.readfile('/proc/self/maps') });"]);
  assert.equal(identity.status, 0, `socket module import failed:\n${identity.stdout}${identity.stderr}`);
  const targetIdentity = JSON.parse(identity.stdout.trim());
  assert.deepEqual(targetIdentity.constants.map(Number.isInteger),
    [true, true, true, true, true, true]);
  assert.match(targetIdentity.maps, new RegExp(`${isolatedModules.replaceAll('/', '\\/')}\\/socket\\.so`),
    'target process did not map isolated staged socket.so');

  const moduleFile = run('file', [modulePath]);
  assert.equal(moduleFile.status, 0, moduleFile.stderr);
  assert.match(moduleFile.stdout, /ELF 64-bit LSB shared object, ARM aarch64/);

  const account = run('getent', ['passwd', '1000']);
  assert.equal(account.status, 0, 'a real passwd account for required UID 1000 must exist');
  nonRootName = account.stdout.split(':')[0];
  assert.ok(nonRootName, 'unable to resolve account name for UID 1000');
  const accountUid = run('id', ['-u', nonRootName]);
  assert.equal(accountUid.status, 0, `unable to inspect UID 1000 account ${nonRootName}`);
  assert.equal(accountUid.stdout.trim(), '1000', `${nonRootName} must resolve to UID 1000`);

  const built = run(cc, ['-std=c11', '-Wall', '-Wextra', '-Werror',
    `-DTEST_ROOT=${root}`, `-DFIXED_CHILD=${child}`, fixtureSource, '-o', fixture]);
  assert.equal(built.status, 0, `${cc} failed:\n${built.stdout}${built.stderr}`);
  const childBuilt = run(cc, ['-std=c11', '-Wall', '-Wextra', '-Werror', childSource, '-o', child]);
  assert.equal(childBuilt.status, 0, `${cc} failed:\n${childBuilt.stdout}${childBuilt.stderr}`);
	process.stderr.write(`BROKER_CHILD_SHA256=${sha256(child)}\n`);
  const userTmp = run('runuser', ['-u', nonRootName, '--', 'mktemp', '-d',
    `${process.env.TMPDIR ?? '/tmp'}/z2m-broker-nonroot-XXXXXX`]);
  assert.equal(userTmp.status, 0, `non-root test root creation failed:\n${userTmp.stderr}`);
  nonRootRoot = userTmp.stdout.trim();
  nonRootFixture = path.join(nonRootRoot, 'z2m-helperd-spike');
  const nonRootBuilt = run('runuser', ['-u', nonRootName, '--', 'env',
    `STAGING_DIR=${process.env.STAGING_DIR}`, cc, '-std=c11', '-Wall', '-Wextra', '-Werror',
    `-DTEST_ROOT=${nonRootRoot}`, `-DFIXED_CHILD=${child}`, fixtureSource, '-o', nonRootFixture]);
  assert.equal(nonRootBuilt.status, 0, `${cc} failed:\n${nonRootBuilt.stdout}${nonRootBuilt.stderr}`);
  process.stderr.write(`SOCKET_MODULE_SHA256=${sha256(modulePath)}\n`);
  process.stderr.write(`BROKER_FIXTURE_SHA256=${sha256(fixture)}\n`);
});

after(async () => {
  await stopServer();
  if (nonRootRoot) fs.rmSync(nonRootRoot, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('uses the strict 20-byte transport-v1 prelude and preserves helper bytes', async () => {
  await startServer('broker-success');
  expectChildExit(invoke('exchange', Buffer.from('ignored')), Buffer.from('{"ok":true}\n'));
  await stopServer();
});

for (const [mode, error] of [
  ['request-short', 'request_rejected'], ['request-magic', 'request_rejected'],
  ['request-type', 'request_rejected'], ['request-flags', 'request_rejected'],
  ['request-reserved', 'request_rejected'], ['request-length', 'request_rejected'],
  ['request-trailing', 'request_rejected'], ['request-oversized', 'request_rejected'],
  ['request-duplicate', 'request_rejected'], ['request-unknown', 'request_rejected'],
  ['request-malformed', 'request_rejected'], ['request-id', 'request_rejected'],
]) {
  test(`rejects strict framing violation ${mode}`, async () => {
    await startServer('broker-success');
    assert.ok(invoke(mode, Buffer.from('x')).error, `${mode} must not produce a valid response`);
    await stopServer();
  });
}

test('preserves helper structured failure and malformed stdout as opaque bytes', async () => {
  await startServer('broker-exit7', [2]);
  expectChildExit(invoke('exchange'), Buffer.from('{"ok":false,"error":"probe"}\n'), { exitCode: 7 });
  await stopServer();
  await startServer('broker-malformed');
  expectChildExit(invoke('exchange'), Buffer.from('{not-json\n'));
  await stopServer();
});

test('classifies fixed-helper exec and injected setup failures in framed responses', async () => {
  const missing = compileSpawnFixture('z2m-helperd-broker-missing', [`-DFIXED_CHILD=${child}.missing`]);
  await startServer('broker-success', [], { fixturePath: missing });
  let result = invoke('exchange');
  assert.equal(result.header.outcome, 'spawn_failure');
  assert.equal(result.header.startState, 'not_started');
  assert.equal(result.header.stage, 'exec');
  await stopServer();
  const setup = compileSpawnFixture('z2m-helperd-broker-setup', ['-DINJECT_STDIN_DUP2_FAILURE=1']);
  await startServer('broker-success', [], { fixturePath: setup });
  result = invoke('exchange');
  assert.equal(result.header.outcome, 'setup_failure');
  assert.equal(result.header.stage, 'stdin_dup2');
  await stopServer();
});

test('duplexes a 4 MiB request and accepts a 6 MiB response', async () => {
  const request = Buffer.alloc(4 * 1024 * 1024, 0x5a);
  await startServer('broker-count-input');
  const counted = invoke('exchange', request, { timeout: 5000 });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(counted.error, null,
    `4 MiB request failed: ${JSON.stringify(counted)} server=${server?.exitCode}/${server?.signalCode} ${serverErrors}`);
  assert.equal(counted.header.exitCode, 0,
    `count child failed: header=${JSON.stringify(counted.header)} body=${counted.response.toString()}`);
  expectChildExit(counted, Buffer.from('4194304\n'));
  await stopServer();
  await startServer('broker-generate-6m');
  expectChildExit(invoke('exchange', Buffer.alloc(0), { cap: 6 * 1024 * 1024, timeout: 5000 }),
    Buffer.alloc(6 * 1024 * 1024, 0xa5));
  await stopServer();
});

test('turns helper stdout cap plus one into transport_failure', async () => {
  await startServer('broker-overflow');
  const result = invoke('exchange', Buffer.alloc(0), { cap: 6 * 1024 * 1024, timeout: 5000 });
  assert.equal(result.header.outcome, 'transport_failure');
  assert.equal(result.header.reason, 'stdout_limit');
  assert.equal(result.header.childReaped, true);
  await stopServer();
});

test('retains bounded stderr while draining excess', async () => {
  await startServer('broker-stderr');
  const result = invoke('exchange');
  expectChildExit(result, Buffer.from('protocol-ok\n'), {
    stderr: Buffer.alloc(4096, 0x65), stderrTruncated: true,
  });
  assert.equal(result.header.stderrDrained, 16384);
  await stopServer();
});

test('times out, signals, and reaps before framing the response', async () => {
  await startServer('broker-timeout');
  const result = invoke('exchange', Buffer.alloc(0), { timeout: 1000 });
  assert.equal(result.header.outcome, 'timeout');
  assert.equal(result.header.startState, 'started');
  assert.equal(result.header.childReaped, true);
  assert.equal(result.header.signal, 15);
  assert.ok(result.elapsedMs < 700, `elapsed ${result.elapsedMs}ms`);
  await stopServer();
});

for (const mode of ['disconnect-before-exec', 'disconnect-after-exec']) {
  test(`reaps the child after ${mode.replaceAll('-', ' ')}`, async () => {
    await startServer(`broker-${mode}`);
    const result = invoke(mode);
    assert.equal(result.error, null);
    await stopServer();
    assert.match(serverErrors, new RegExp(`${mode}=reaped`));
  });
}

test('rejects a truncated response frame', async () => {
  await startServer('response-truncated');
  assert.equal(invoke('exchange').error, 'response_truncated');
  await stopServer();
});

test('does not grow descriptors over 100 framed requests', async () => {
  await startServer('broker-success', [100]);
  const result = invoke('cycles', Buffer.from('x'), { repeats: 100 });
  assert.equal(result.fdAfter, result.fdBefore);
  assert.equal(result.completed, 100);
  await stopServer();
});

test('classifies a missing fixed child from a complete exec error record', () => {
  const missing = compileSpawnFixture('z2m-helperd-missing', [`-DFIXED_CHILD=${child}.missing`]);
  assert.deepEqual(spawnEvidence('success', missing), {
    outcome: 'spawn_failure', stage: 'exec', errno: 'ENOENT', state: 'not_started',
    evidence: 'status_record',
  });
});

test('retries interrupted status-record writes without reporting started', () => {
  const interrupted = compileSpawnFixture('z2m-helperd-status-eintr', [
    '-DINJECT_STATUS_WRITE_EINTR=1', `-DFIXED_CHILD=${child}.missing`,
  ]);
  assert.deepEqual(spawnEvidence('success', interrupted), {
    outcome: 'spawn_failure', stage: 'exec', errno: 'ENOENT', state: 'not_started',
    evidence: 'status_record', statusWriteAttempts: 2,
  });
});

test('completes partial status-record writes without reporting started', () => {
  const partial = compileSpawnFixture('z2m-helperd-status-partial', [
    '-DINJECT_STATUS_WRITE_PARTIAL=1', `-DFIXED_CHILD=${child}.missing`,
  ]);
  assert.deepEqual(spawnEvidence('success', partial), {
    outcome: 'spawn_failure', stage: 'exec', errno: 'ENOENT', state: 'not_started',
    evidence: 'status_record', statusWriteAttempts: 2,
  });
});

test('fails closed when the status record cannot be written', () => {
  const broken = compileSpawnFixture('z2m-helperd-status-hard-failure', [
    '-DINJECT_STATUS_WRITE_FAILURE=1', `-DFIXED_CHILD=${child}.missing`,
  ]);
  assert.deepEqual(spawnEvidence('success', broken), {
    outcome: 'protocol_failure', stage: null, errno: 'EIO', state: 'not_started',
    evidence: 'status_write_failure',
  });
});

test('rejects a complete status record with an unknown stage', () => {
  const unknown = compileSpawnFixture('z2m-helperd-status-unknown-stage', [
    '-DINJECT_UNKNOWN_STATUS_STAGE=1', `-DFIXED_CHILD=${child}.missing`,
  ]);
  assert.deepEqual(spawnEvidence('success', unknown), {
    outcome: 'protocol_failure', stage: null, errno: 'EPROTO', state: 'not_started',
    evidence: 'invalid_status_record',
  });
});

for (const [name, stage] of [
  ['INJECT_STDIN_DUP2_FAILURE', 'stdin_dup2'],
  ['INJECT_STDOUT_DUP2_FAILURE', 'stdout_dup2'],
  ['INJECT_STDERR_DUP2_FAILURE', 'stderr_dup2'],
]) {
  test(`classifies ${stage} setup failure from a complete status record`, () => {
    const injected = compileSpawnFixture(`z2m-helperd-${stage}`, [`-D${name}=1`]);
    assert.deepEqual(spawnEvidence('success', injected), {
      outcome: 'setup_failure', stage, errno: 'EBADF', state: 'not_started',
      evidence: 'status_record',
    });
  });
}

test('classifies successful exec only from close-on-exec EOF', () => {
  assert.deepEqual(spawnEvidence('success'), {
    outcome: 'started', stage: null, errno: null, state: 'started',
    evidence: 'status_pipe_eof', childExit: 0, stdout: '{"ok":true}\n',
  });
});

for (const code of [127, 255]) {
  test(`does not reinterpret child exit ${code} as spawn failure`, () => {
    const result = spawnEvidence(`exit-${code}`);
    assert.equal(result.outcome, 'started');
    assert.equal(result.state, 'started');
    assert.equal(result.evidence, 'status_pipe_eof');
    assert.equal(result.childExit, code);
  });
}

test('does not reinterpret missing child stdout as spawn failure', () => {
  assert.deepEqual(spawnEvidence('no-stdout'), {
    outcome: 'started', stage: null, errno: null, state: 'started',
    evidence: 'status_pipe_eof', childExit: 0, stdout: '',
  });
});

function assertGone(pid, label) {
  assert.ok(Number.isInteger(pid) && pid > 0, `invalid ${label} pid ${pid}`);
  assert.throws(() => process.kill(pid, 0), error => error?.code === 'ESRCH',
    `${label} ${pid} remains live`);
  assert.equal(fs.existsSync(`/proc/${pid}/stat`), false, `${label} ${pid} remains in /proc`);
}

test('terminates and reaps a cooperative 30-second child after one 100 ms deadline', () => {
  const result = spawnEvidence('timeout-cooperative');
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, false);
  assert.equal(result.reaped, true);
  assert.equal(result.waitSignal, 15);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 200, `TERM at ${result.termAtMs}ms`);
  assert.equal(result.killAtMs, null);
  assert.ok(result.elapsedMs >= 80 && result.elapsedMs < 500, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
});

test('kills and reaps a TERM-ignoring 30-second child after bounded grace', () => {
  const result = spawnEvidence('timeout-ignore-term');
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, true);
  assert.equal(result.reaped, true);
  assert.equal(result.waitSignal, 9);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 200, `TERM at ${result.termAtMs}ms`);
  assert.ok(result.killAtMs >= 180 && result.killAtMs < 350, `KILL at ${result.killAtMs}ms`);
  assert.ok(result.killAtMs - result.termAtMs >= 80,
    `grace ${result.killAtMs - result.termAtMs}ms`);
  assert.ok(result.elapsedMs >= 160 && result.elapsedMs < 600, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
});

test('terminates the dedicated process group including a forked descendant', () => {
  const result = spawnEvidence('timeout-descendant');
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.reaped, true);
  assert.equal(result.killSent, true);
  assert.equal(result.descendantReapedPid, result.descendantPid);
  assert.equal(result.adoptedChildrenExhausted, true);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 200, `TERM at ${result.termAtMs}ms`);
  assert.ok(result.killAtMs >= 180 && result.killAtMs < 350, `KILL at ${result.killAtMs}ms`);
  assert.ok(result.elapsedMs >= 180 && result.elapsedMs < 600, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
  assertGone(result.descendantPid, 'descendant');
});

test('repeated EINTR and pipe wakeups do not extend the absolute deadline', () => {
  const interrupted = compileSpawnFixture('z2m-helperd-supervision-eintr', [
    '-DINJECT_SUPERVISION_EINTR=1',
  ]);
  const result = spawnEvidence('timeout-wakeups', interrupted);
  assert.equal(result.outcome, 'timeout');
  assert.ok(result.pollEintr >= 3, `expected repeated EINTR, got ${result.pollEintr}`);
  assert.ok(result.interruptionDelayMs >= 75,
    `expected deterministic EINTR delay, got ${result.interruptionDelayMs}ms`);
  assert.ok(result.stdoutReads >= 3, `expected repeated wakeups, got ${result.stdoutReads}`);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 160, `TERM at ${result.termAtMs}ms`);
  assert.ok(result.elapsedMs >= 80 && result.elapsedMs < 500, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
});

test('stops retaining child stdout at cap plus one byte', () => {
  const result = spawnEvidence('stdout-overflow');
  assert.equal(result.outcome, 'stdout_limit');
  assert.equal(result.stdoutBytes, 4097);
  assert.equal(result.reaped, true);
  assertGone(result.pid, 'child');
});

test('retains 4096 stderr bytes while draining all excess', () => {
  const result = spawnEvidence('stderr-excess');
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.stderrBytes, 4096);
  assert.equal(result.stderrDrained, 16384);
  assert.equal(result.reaped, true);
  assertGone(result.pid, 'child');
});

test('continuous stderr flood cannot starve deadline or bounded escalation', () => {
  const result = spawnEvidence('timeout-stderr-flood');
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, true);
  assert.equal(result.waitSignal, 9);
  assert.equal(result.stderrBytes, 4096);
  assert.ok(result.stderrDrained > 4096, `drained ${result.stderrDrained}`);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 200, `TERM at ${result.termAtMs}ms`);
  assert.ok(result.killAtMs >= 180 && result.killAtMs < 350, `KILL at ${result.killAtMs}ms`);
  assert.ok(result.elapsedMs < 600, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
});

test('delayed setpgid cannot escape direct-child timeout signaling', () => {
  const delayed = compileSpawnFixture('z2m-helperd-delayed-setpgid', [
    '-DINJECT_DELAYED_SETPGID=1',
  ]);
  const result = spawnEvidence('timeout-cooperative', delayed);
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.groupReadyAtTerm, false);
  assert.equal(result.directTermSent, true);
  assert.equal(result.waitSignal, 15);
  assert.ok(result.termAtMs >= 80 && result.termAtMs < 200, `TERM at ${result.termAtMs}ms`);
  assert.ok(result.elapsedMs < 500, `elapsed ${result.elapsedMs}ms`);
  assertGone(result.pid, 'child');
});

test('group ESRCH after direct reap never falls back to reusable positive PID', () => {
  const raced = compileSpawnFixture('z2m-helperd-reaped-group-race', [
    '-DINJECT_GROUP_KILL_ESRCH_AFTER_REAP=1',
  ]);
  const result = spawnEvidence('timeout-reaped-group-race', raced);
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.reapedBeforeKill, true);
  assert.equal(result.groupKillNoTarget, true);
  assert.equal(result.directKillAttempted, false);
  assert.equal(result.directKillSent, false);
  assert.equal(result.directKillNoTarget, false);
  assert.equal(result.directKillAttemptedAfterReap, false);
  assert.equal(result.descendantReapedPid, result.descendantPid);
  assert.equal(result.adoptedChildrenExhausted, true);
  assertGone(result.pid, 'child');
  assertGone(result.descendantPid, 'descendant');
});

test('pumps child stdin, stdout, and stderr concurrently', () => {
  const result = spawnEvidence('pipe-pump');
  assert.equal(result.outcome, 'started');
  assert.equal(result.childExit, 0);
  assert.equal(result.stdinBytes, 65536);
  assert.equal(result.stdoutBytes, 4096);
  assert.equal(result.stderrDrained, 8192);
  assert.equal(result.stderrBytes, 4096);
  assert.equal(result.reaped, true);
  assertGone(result.pid, 'child');
});
