import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve('.');
const runner = path.join(projectRoot, 'tests', 'native', 'core', 'run-fs-helper-sanitizers.mjs');
const classifications = new Set([
  'PASS', 'SKIP_UNAVAILABLE', 'COMPILE_FAILED', 'TIMEOUT', 'SIGNALLED',
  'SANITIZER_FAILURE', 'ASSERTION_FAILURE'
]);
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const fixtures = `${wslRoot}/tests/native/core/fixtures`;
const cleanupModule = path.join(projectRoot, 'tests', 'native', 'core', 'sanitizer-process-cleanup.mjs');
const cleanupModuleUrl = pathToFileURL(cleanupModule).href;

function runScenario(scenario, extraArgs = []) {
  const run = spawnSync(process.execPath, [runner, '--scenario', scenario, ...extraArgs], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024
  });
  assert.equal(run.signal, null, run.stderr || run.stdout);
  assert.doesNotThrow(() => JSON.parse(run.stdout), run.stdout || run.stderr);
  const report = JSON.parse(run.stdout);
  assert.ok(classifications.has(report.classification), report.classification);
  assert.equal(typeof report.compiler.executable, 'string');
  assert.ok(Array.isArray(report.compiler.argv));
  for (const phase of [report.compile, report.run]) {
    assert.ok(Object.hasOwn(phase, 'exitCode'));
    assert.ok(Object.hasOwn(phase, 'signal'));
    assert.equal(typeof phase.stdout, 'string');
    assert.equal(typeof phase.stderr, 'string');
    assert.ok(Object.hasOwn(phase, 'error'));
  }
  assert.equal(typeof report.timeout.ms, 'number');
  assert.equal(typeof report.timeout.timedOut, 'boolean');
  assert.match(report.binaryPath, /^\/tmp\/[^/]+\/[^/]+$/);
  if (report.compile.exitCode === 0 && Object.hasOwn(report.probe, 'runtime') &&
      report.probe.runtime.exitCode === 0 && !report.timeout.timedOut)
    assert.equal(report.binaryPathVerified, true);
  assert.equal(typeof report.sanitizerEnvironment.ASAN_OPTIONS, 'string');
  assert.equal(typeof report.sanitizerEnvironment.UBSAN_OPTIONS, 'string');
  assert.ok(Buffer.byteLength(run.stdout) <= 512 * 1024, 'JSON report must remain bounded');
  return { ...run, report };
}

const capability = runScenario('normal');

function expectBehavior(run, classification) {
  if (capability.report.classification === 'PASS') {
    assert.equal(run.status, 1);
    assert.equal(run.report.classification, classification);
    return true;
  }
  assert.equal(capability.report.classification, 'SKIP_UNAVAILABLE');
  assert.ok(capability.report.skipEvidence);
  assert.equal(run.status, 0);
  assert.equal(run.report.classification, 'SKIP_UNAVAILABLE');
  assert.ok(run.report.skipEvidence);
  return false;
}

test('normal production helper run is PASS or capability-proven SKIP_UNAVAILABLE', () => {
  const run = capability;
  assert.ok(['PASS', 'SKIP_UNAVAILABLE'].includes(run.report.classification));
  assert.equal(run.status, 0, run.stderr || run.stdout);
  if (run.report.classification === 'PASS') {
    assert.equal(run.report.assertion?.response?.protocolVersion, 1);
    assert.equal(run.report.assertion?.response?.requestId, 'sanitizer-normal');
    assert.equal(run.report.assertion?.response?.ok, true);
    assert.equal(run.report.assertion?.response?.data?.type, 'regular');
  } else {
    assert.ok(run.report.skipEvidence);
    assert.match(run.report.skipEvidence.diagnostic, /sanitize|libasan|libubsan/i);
  }
});

test('unrelated probe compile failure is COMPILE_FAILED rather than skip', () => {
  const run = runScenario('normal', ['--probe-fixture', `${fixtures}/sanitizer-compile-failure.c`]);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'COMPILE_FAILED');
  assert.equal(run.report.skipEvidence, null);
});

test('missing probe fixture is COMPILE_FAILED rather than skip', () => {
  const run = runScenario('normal', ['--probe-fixture', `${fixtures}/missing-sanitizer-probe.c`]);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'COMPILE_FAILED');
  assert.match(run.report.compile.stderr, /No such file|not found/);
});

test('recognized unsupported sanitizer option is capability-proven SKIP_UNAVAILABLE', () => {
  const run = runScenario('normal', ['--compiler', `${fixtures}/unsupported-sanitizer-cc.sh`]);
  assert.equal(run.status, 0);
  assert.equal(run.report.classification, 'SKIP_UNAVAILABLE');
  assert.equal(run.report.skipEvidence?.phase, 'compile');
  assert.match(run.report.skipEvidence?.diagnostic, /unrecognized command-line option/);
});

for (const compiler of ['unrelated-asan-compile-cc.sh', 'unrelated-asan-library-cc.sh']) {
  test(`${compiler} generic asan wording remains COMPILE_FAILED`, () => {
    const run = runScenario('normal', ['--compiler', `${fixtures}/${compiler}`]);
    assert.equal(run.status, 1);
    assert.equal(run.report.classification, 'COMPILE_FAILED');
    assert.equal(run.report.skipEvidence, null);
  });
}

test('recognized missing sanitizer runtime is capability-proven SKIP_UNAVAILABLE', () => {
  const run = runScenario('normal', ['--compiler', `${fixtures}/unsupported-sanitizer-runtime-cc.sh`]);
  assert.equal(run.status, 0);
  assert.equal(run.report.classification, 'SKIP_UNAVAILABLE');
  assert.equal(run.report.skipEvidence?.phase, 'runtime');
  assert.match(run.report.skipEvidence?.diagnostic, /libasan/);
});

test('non-timeout host spawn failures retain structured error evidence', () => {
  const run = runScenario('normal', ['--wsl-executable', 'definitely-missing-wsl.exe']);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'COMPILE_FAILED');
  assert.equal(run.report.compile.timedOut, false);
  assert.equal(run.report.compile.error?.code, 'ENOENT');
  assert.match(run.report.compile.error?.message, /ENOENT/);
});

test('probe runtime crash is ASSERTION_FAILURE rather than skip', () => {
  const run = runScenario('normal', ['--probe-behavior', 'crash']);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'ASSERTION_FAILURE');
  assert.equal(run.report.skipEvidence, null);
});

test('probe runtime timeout is TIMEOUT rather than skip', () => {
  const run = runScenario('normal', ['--probe-behavior', 'timeout', '--timeout-ms', '100']);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'TIMEOUT');
  assert.equal(run.report.timeout.timedOut, true);
  assert.equal(run.report.cleanup.identityVerified, true, run.report.cleanup.evidence);
  assert.deepEqual(run.report.cleanup.membersAfter, []);
});

test('intentional heap overflow is SANITIZER_FAILURE with diagnostics preserved', () => {
  const run = runScenario('heap-overflow');
  if (!expectBehavior(run, 'SANITIZER_FAILURE')) return;
  assert.match(run.report.run.stderr, /AddressSanitizer|heap-buffer-overflow/);
});

test('invalid source is COMPILE_FAILED', () => {
  const run = runScenario('compile-failure');
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'COMPILE_FAILED');
  assert.notEqual(run.report.compile.exitCode, 0);
  assert.ok(run.report.compile.stderr);
});

test('hung fixture is TIMEOUT', () => {
  const run = runScenario('timeout', ['--timeout-ms', '100']);
  if (!expectBehavior(run, 'TIMEOUT')) return;
  assert.equal(run.report.timeout.timedOut, true);
  assert.equal(run.report.cleanup.terminated, true);
  assert.equal(run.report.cleanup.identityVerified, true, run.report.cleanup.evidence);
  assert.deepEqual(run.report.cleanup.membersAfter, []);
  assert.equal(run.report.cleanup.reaped, true);
  assert.equal(run.report.cleanup.processGone, true);
  assert.match(run.report.cleanup.pid, /^\d+$/);
});

test('explicit exit 130 is ASSERTION_FAILURE rather than SIGNALLED', () => {
  const run = runScenario('exit-130');
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'ASSERTION_FAILURE');
  assert.equal(run.report.run.exitCode, 130);
  assert.equal(run.report.run.signal, null);
});

test('AddressSanitizer word on stdout is not sanitizer evidence', () => {
  const run = runScenario('stdout-marker');
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'ASSERTION_FAILURE');
  assert.match(run.report.run.stdout, /AddressSanitizer/);
  assert.equal(run.report.run.stderr, '');
});

test('self-termination is SIGNALLED and preserves the raw signal', () => {
  const run = runScenario('signal');
  if (!expectBehavior(run, 'SIGNALLED')) return;
  assert.ok(run.report.run.signal || run.report.run.exitCode === 15 || run.report.run.exitCode >= 128);
});

test('silent abnormal exit is ASSERTION_FAILURE', () => {
  const run = runScenario('abnormal-exit');
  if (!expectBehavior(run, 'ASSERTION_FAILURE')) return;
  assert.equal(run.report.run.stderr, '');
  assert.notEqual(run.report.run.exitCode, 0);
});

test('missing compiler is COMPILE_FAILED rather than SKIP_UNAVAILABLE', () => {
  const run = runScenario('normal', ['--compiler', '/definitely/missing/z2m-cc']);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'COMPILE_FAILED');
  assert.equal(run.report.compiler.executable, '/definitely/missing/z2m-cc');
});

test('repeated runs leave no sanitizer artifacts in the worktree', () => {
  const before = fs.readdirSync(projectRoot).sort();
  const first = runScenario('abnormal-exit');
  const second = runScenario('abnormal-exit');
  expectBehavior(first, 'ASSERTION_FAILURE');
  expectBehavior(second, 'ASSERTION_FAILURE');
  assert.deepEqual(fs.readdirSync(projectRoot).sort(), before);
  const leftovers = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', 'find', '/tmp',
    '-maxdepth', '1', '-type', 'd', '-name', 'z2m-sanitizer-*', '-print'], { encoding: 'utf8' });
  assert.equal(leftovers.status, 0, leftovers.stderr);
  assert.equal(leftovers.stdout, '');
});

function wsl(args, options = {}) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', ...args], {
    encoding: 'utf8', input: options.input
  });
}

async function waitForPid(pidFile) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const read = wsl(['/bin/cat', pidFile]);
    try {
      const marker = JSON.parse(read.stdout);
      if (Number.isInteger(marker.pid)) return marker;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`PID marker not created: ${pidFile}`);
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (wsl(['/bin/kill', '-0', pid]).status !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`leader did not exit: ${pid}`);
}

async function startGroup(mode) {
  const token = crypto.randomBytes(24).toString('hex');
  const pidFile = `/tmp/z2m-cleanup-${token}.pid`;
  const scenarioPath = `${fixtures}/sanitizer-process-group.sh`;
  const child = spawn('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/setsid',
    '/bin/sh', `${fixtures}/sanitizer-process-wrapper.sh`, pidFile, token, scenarioPath,
    '/bin/sh', scenarioPath, mode], { stdio: 'ignore' });
  const marker = await waitForPid(pidFile);
  return { child, pid: String(marker.pid), marker, pidFile, token, scenarioPath };
}

function forceCleanup(group) {
  if (!group) return;
  wsl(['/bin/kill', '-KILL', `-${group.pid}`]);
  wsl(['/bin/rm', '-f', group.pidFile]);
  group.child.kill();
}

test('timeout cleanup verifies identity and removes every process-group member', async () => {
  const group = await startGroup('child');
  try {
    const { cleanupProcessGroup } = await import(`${cleanupModuleUrl}?child=${Date.now()}`);
    const cleanup = cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath);
    assert.equal(cleanup.identityVerified, true, cleanup.evidence);
    assert.ok(cleanup.membersBefore.length >= 2, cleanup.evidence);
    assert.deepEqual(cleanup.membersAfter, []);
    assert.equal(cleanup.processGone, true);
  } finally {
    forceCleanup(group);
  }
});

test('forged PID marker never signals an unrelated process group', async () => {
  const unrelated = await startGroup('unrelated');
  try {
    const { cleanupProcessGroup } = await import(`${cleanupModuleUrl}?forged=${Date.now()}`);
    const cleanup = cleanupProcessGroup(unrelated.pidFile, crypto.randomBytes(24).toString('hex'), unrelated.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.equal(wsl(['/bin/kill', '-0', unrelated.pid]).status, 0, 'unrelated process was signalled');
  } finally {
    forceCleanup(unrelated);
  }
});

test('leader exit with child survivor is detected without signalling an unverified group', async () => {
  const group = await startGroup('leader-exit');
  try {
    await waitForExit(group.pid);
    const { cleanupProcessGroup } = await import(`${cleanupModuleUrl}?survivor=${Date.now()}`);
    const cleanup = cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.ok(cleanup.membersAfter.length >= 1, cleanup.evidence);
    assert.equal(cleanup.processGone, false);
  } finally {
    forceCleanup(group);
  }
});

test('stale start time with matching token and cmdline never signals the group', async () => {
  const group = await startGroup('unrelated');
  try {
    const forged = { ...group.marker, startTime: String(BigInt(group.marker.startTime) + 1n) };
    const written = wsl(['/usr/bin/tee', group.pidFile], { input: JSON.stringify(forged) });
    assert.equal(written.status, 0, written.stderr);
    const { cleanupProcessGroup } = await import(`${cleanupModuleUrl}?stale=${Date.now()}`);
    const cleanup = cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.match(cleanup.evidence, /start-time-mismatch/);
    assert.equal(wsl(['/bin/kill', '-0', group.pid]).status, 0);
  } finally {
    forceCleanup(group);
  }
});

test('enumeration tool failure is cleanup failure and never means group gone', async () => {
  const group = await startGroup('child');
  try {
    const { cleanupProcessGroup } = await import(`${cleanupModuleUrl}?enumeration=${Date.now()}`);
    const cleanup = cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath, {
      procListCommand: '/definitely/missing/proc-list'
    });
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.equal(cleanup.processGone, false);
    assert.match(cleanup.evidence, /enumeration-failed/);
    assert.equal(wsl(['/bin/kill', '-0', group.pid]).status, 0);
  } finally {
    forceCleanup(group);
  }
});
