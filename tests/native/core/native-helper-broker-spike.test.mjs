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
const socketPath = path.join(root, 'helper.sock');
const probe = path.resolve('tests/native/core/native-helper-broker-spike.uc');
const fixtureSource = path.resolve('tests/native/core/z2m-helperd-spike.c');
const targetPrefix = ucodeArgs.slice(0, -1);
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

async function startServer(mode, args = [], { asNonRoot = false } = {}) {
  const invocationRoot = asNonRoot ? nonRootRoot : root;
  const invocationSocket = path.join(invocationRoot, 'helper.sock');
  fs.rmSync(invocationSocket, { force: true });
  const command = asNonRoot ? 'runuser' : ucode;
  const prefix = asNonRoot ? ['-u', nonRootName, '--', 'env',
    `LD_LIBRARY_PATH=${process.env.LD_LIBRARY_PATH}`, 'PROOT_NO_SECCOMP=1', ucode] : [];
  server = spawn(command, [...prefix, ...targetPrefix, asNonRoot ? nonRootFixture : fixture,
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
    `-DTEST_ROOT=${root}`, fixtureSource, '-o', fixture]);
  assert.equal(built.status, 0, `${cc} failed:\n${built.stdout}${built.stderr}`);
  const userTmp = run('runuser', ['-u', nonRootName, '--', 'mktemp', '-d',
    `${process.env.TMPDIR ?? '/tmp'}/z2m-broker-nonroot-XXXXXX`]);
  assert.equal(userTmp.status, 0, `non-root test root creation failed:\n${userTmp.stderr}`);
  nonRootRoot = userTmp.stdout.trim();
  nonRootFixture = path.join(nonRootRoot, 'z2m-helperd-spike');
  const nonRootBuilt = run('runuser', ['-u', nonRootName, '--', 'env',
    `STAGING_DIR=${process.env.STAGING_DIR}`, cc, '-std=c11', '-Wall', '-Wextra', '-Werror',
    `-DTEST_ROOT=${nonRootRoot}`, fixtureSource, '-o', nonRootFixture]);
  assert.equal(nonRootBuilt.status, 0, `${cc} failed:\n${nonRootBuilt.stdout}${nonRootBuilt.stderr}`);
  process.stderr.write(`SOCKET_MODULE_SHA256=${sha256(modulePath)}\n`);
  process.stderr.write(`BROKER_FIXTURE_SHA256=${sha256(fixture)}\n`);
});

after(async () => {
  await stopServer();
  if (nonRootRoot) fs.rmSync(nonRootRoot, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('preserves binary and embedded-NUL bytes', async () => {
  await startServer('echo');
  const payload = Buffer.from([0, 10, 13, 255, 65, 0, 66]);
  const result = invoke('exchange', payload, { cap: payload.length });
  assert.equal(result.error, null);
  assert.deepEqual(result.response, payload);
  await stopServer();
});

test('handles partial writes and backpressure', async () => {
  await startServer('backpressure', [200]);
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x5a);
  const result = invoke('exchange', payload, { cap: payload.length, timeout: 5000 });
  assert.ok(result.shortWrites > 0, `expected a short send, got ${result.shortWrites}`);
  assert.ok(result.sendEagain > 0, `expected EAGAIN under backpressure, got ${result.sendEagain}`);
  assert.ok(result.recvCalls > 1, `expected fragmented receive, got ${result.recvCalls} recv call(s)`);
  assert.deepEqual(result.response, payload);
  await stopServer();
});

test('drains POLLIN with POLLHUP before reporting EOF', async () => {
  await startServer('partial');
  const result = invoke('exchange', Buffer.from('request'));
  assert.equal(result.sawInHup, true);
  assert.equal(result.eof, true);
  assert.deepEqual(result.response, Buffer.from('partial-response'));
  await stopServer();
});

test('uses one absolute deadline across repeated trickle wakeups', async () => {
  await startServer('trickle', [30]);
  const result = invoke('exchange', Buffer.from('request'), { timeout: 120 });
  assert.equal(result.error, 'timeout');
  assert.ok(result.recvCalls >= 3, `expected repeated readiness, got ${result.recvCalls} recv call(s)`);
  assert.ok(result.elapsedMs >= 100 && result.elapsedMs < 230, `elapsed ${result.elapsedMs}ms`);
  await stopServer();
});

test('distinguishes bare EOF from an explicitly framed empty body', async () => {
  await startServer('immediate-close');
  assert.equal(invoke('exchange').error, 'disconnect');
  await stopServer();
  await startServer('empty-frame');
  const empty = invoke('exchange');
  assert.equal(empty.error, null);
  assert.equal(empty.eof, true);
  assert.equal(empty.response.length, 0);
  await stopServer();
});

test('stops reading at response cap plus one byte', async () => {
  await startServer('generate', [8192]);
  const result = invoke('exchange', Buffer.from('request'), { cap: 4096 });
  assert.equal(result.error, 'response_limit');
  assert.equal(result.bytesRead, 4097);
  assert.equal(result.response.length, 4097);
  await stopServer();
});

test('reports root peer credentials and fixture PID', async () => {
  await startServer('peercred');
  const result = invoke('exchange');
  const report = result.response.toString().match(/^server_pid=(\d+) client_uid=(\d+) client_pid=(\d+)\n$/);
  assert.ok(report, `unexpected credential report: ${result.response.toString()}`);
  assert.equal(result.peer.uid, 0);
  assert.equal(result.peer.pid, Number(report[1]));
  assert.equal(Number(report[2]), 0);
  assert.ok(Number(report[3]) > 0);
  await stopServer();
});

test('fixture rejects a non-root peer', async () => {
  await startServer('reject-nonroot', [], { asNonRoot: true });
  const result = invoke('exchange', Buffer.from('request'), { asNonRoot: true });
  assert.equal(result.error, 'disconnect');
  await stopServer();
  assert.match(serverErrors, /REJECTED uid=1000 pid=\d+/);
});

test('does not grow descriptors over 100 connect-close cycles', async () => {
  await startServer('echo-many', [100]);
  const result = invoke('cycles', Buffer.from('x'), { repeats: 100 });
  assert.equal(result.fdAfter, result.fdBefore);
  assert.equal(result.completed, 100);
  await stopServer();
});
