import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { launchGroup, awaitReadiness } from './sanitizer-launch-ownership.mjs';
import { cleanupOwnedGroup, cleanupProcessGroup } from './sanitizer-process-cleanup.mjs';

const projectRoot = path.resolve('.');
const runner = path.join(projectRoot, 'tests', 'native', 'core', 'run-fs-helper-sanitizers.mjs');
const classifications = new Set([
  'PASS', 'SKIP_UNAVAILABLE', 'COMPILE_FAILED', 'TIMEOUT', 'SIGNALLED',
  'SANITIZER_FAILURE', 'ASSERTION_FAILURE'
]);
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const fixtures = `${wslRoot}/tests/native/core/fixtures`;
const procScanner = `${fixtures}/sanitizer-proc-group-scan.sh`;

test('runner keeps ownership evidence outside ephemeral cleanup and uses no recursive removal', () => {
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /\/tmp\/z2m-cleanup-\$\{cleanupToken\}-probe\.pid/);
  assert.match(source, /\/tmp\/z2m-cleanup-\$\{cleanupToken\}-run\.pid/);
  assert.doesNotMatch(source, /\['\/bin\/rm',\s*'-rf'/);
  assert.match(source, /evidencePath/);
});

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
    encoding: 'utf8', input: options.input, timeout: options.timeout ?? 120000
  });
}

function procStat(pid, pgid, sid, startTime = '1000') {
  return `${pid} (fixture) S 1 ${pgid} ${sid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${startTime} 0\n`;
}

function writeWslFile(file, contents) {
  const written = wsl(['/usr/bin/tee', file], { input: contents });
  assert.equal(written.status, 0, written.stderr);
}

function runProcScanner(root, hook = 'none') {
  return wsl(['/bin/sh', procScanner, '700', '700', root, hook]);
}

test('proc scanner fails closed when a stat read fails for a present entry', () => {
  const root = `/tmp/z2m-proc-scan-${process.pid}-stat`;
  try {
    assert.equal(wsl(['/bin/mkdir', '-p', `${root}/701/stat`]).status, 0);
    const run = runProcScanner(root);
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, /stat-read-failed.*pid=701/);
    assert.ok(Buffer.byteLength(run.stderr) <= 4096);
  } finally {
    wsl(['/bin/rm', '-rf', root]);
  }
});

test('proc scanner fails closed when a matching member cmdline read fails', () => {
  const root = `/tmp/z2m-proc-scan-${process.pid}-cmdline`;
  try {
    assert.equal(wsl(['/bin/mkdir', '-p', `${root}/702/cmdline`]).status, 0);
    writeWslFile(`${root}/702/stat`, procStat(702, 700, 700));
    const run = runProcScanner(root);
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, /cmdline-read-failed.*pid=702/);
    assert.ok(Buffer.byteLength(run.stderr) <= 4096);
  } finally {
    wsl(['/bin/rm', '-rf', root]);
  }
});

test('proc scanner accepts an entry that vanishes after its stat read fails', () => {
  const root = `/tmp/z2m-proc-scan-${process.pid}-vanished`;
  try {
    assert.equal(wsl(['/bin/mkdir', '-p', `${root}/703/stat`]).status, 0);
    const run = runProcScanner(root, 'vanish-stat:703');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '');
  } finally {
    wsl(['/bin/rm', '-rf', root]);
  }
});

test('proc scanner rejects hook names with trailing characters', () => {
  const root = `/tmp/z2m-proc-scan-${process.pid}-invalid-hook`;
  try {
    assert.equal(wsl(['/bin/mkdir', '-p', root]).status, 0);
    const run = runProcScanner(root, 'vanish-stat:703suffix');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /invalid test hook/);
  } finally {
    wsl(['/bin/rm', '-rf', root]);
  }
});

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (wsl(['/bin/kill', '-0', pid]).status !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`leader did not exit: ${pid}`);
}

function groupSpec(mode) {
  const token = crypto.randomBytes(24).toString('hex');
  const pidFile = `/tmp/z2m-cleanup-${token}.pid`;
  const scenarioPath = `${fixtures}/sanitizer-process-group.sh`;
  return { readyMode: 'ready', pidFile, token, scenarioPath,
    command: ['wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/setsid', '--wait',
      '/bin/sh', `${fixtures}/sanitizer-process-wrapper.sh`, pidFile, token, scenarioPath,
      'ready', '/bin/sh', scenarioPath, mode] };
}

async function readyGroup(mode) {
  const context = launchGroup(groupSpec(mode));
  const result = await awaitReadiness(context, { timeoutMs: 10000, cleanup: cleanupOwnedGroup });
  assert.equal(result.kind, 'ready', JSON.stringify(result));
  return context;
}

async function verifiedCleanup(context) {
  if (context.state === 'CLEANED') return;
  const cleanup = await cleanupOwnedGroup(context);
  assert.equal(cleanup.status, 'verified-gone', cleanup.evidence);
}

test('timeout cleanup verifies identity and removes every process-group member', async () => {
  const group = await readyGroup('child');
  try {
    const cleanup = await cleanupOwnedGroup(group);
    assert.equal(cleanup.identityVerified, true, cleanup.evidence);
    assert.ok(cleanup.membersBefore.length >= 2, cleanup.evidence);
    assert.deepEqual(cleanup.membersAfter, []);
    assert.equal(cleanup.groupGone, true);
  } finally {
    await verifiedCleanup(group);
  }
});

test('forged PID marker never signals an unrelated process group', async () => {
  const unrelated = await readyGroup('unrelated');
  try {
    const cleanup = await cleanupProcessGroup(unrelated.pidFile, crypto.randomBytes(24).toString('hex'), unrelated.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.equal(wsl(['/bin/kill', '-0', String(unrelated.marker.pid)]).status, 0, 'unrelated process was signalled');
  } finally {
    await verifiedCleanup(unrelated);
  }
});

test('leader exit with child survivor is detected without signalling an unverified group', async () => {
  const group = await readyGroup('leader-exit');
  try {
    await waitForExit(String(group.marker.pid));
    const cleanup = await cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.ok(cleanup.membersAfter.length >= 1, cleanup.evidence);
    assert.equal(cleanup.processGone, false);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await verifiedCleanup(group);
  }
});

test('stale start time with matching token and cmdline never signals the group', async () => {
  const group = await readyGroup('unrelated');
  try {
    const forged = { ...group.marker, startTime: String(BigInt(group.marker.startTime) + 1n) };
    const written = wsl(['/usr/bin/tee', group.pidFile], { input: JSON.stringify(forged) });
    assert.equal(written.status, 0, written.stderr);
    const cleanup = await cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath);
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.match(cleanup.evidence, /start-time-mismatch/);
    assert.equal(wsl(['/bin/kill', '-0', String(group.marker.pid)]).status, 0);
  } finally {
    writeWslFile(group.pidFile, `${JSON.stringify(group.marker)}\n`);
    await verifiedCleanup(group);
  }
});

test('enumeration tool failure is cleanup failure and never means group gone', async () => {
  const group = await readyGroup('child');
  try {
    const cleanup = await cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath, {
      procListCommand: '/definitely/missing/proc-list'
    });
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.equal(cleanup.processGone, false);
    assert.match(cleanup.evidence, /enumeration-failed/);
    assert.equal(wsl(['/bin/kill', '-0', String(group.marker.pid)]).status, 0);
  } finally {
    await verifiedCleanup(group);
  }
});

test('real scanner per-entry failure prevents cleanup signal and processGone', async () => {
  const group = await readyGroup('child');
  const root = `/tmp/z2m-proc-scan-${process.pid}-cleanup-error`;
  try {
    assert.equal(wsl(['/bin/mkdir', '-p', `${root}/704/stat`]).status, 0);
    const cleanup = await cleanupProcessGroup(group.pidFile, group.token, group.scenarioPath, {
      procListCommand: procScanner,
      procListArgs: [root, 'none']
    });
    assert.equal(cleanup.identityVerified, false);
    assert.equal(cleanup.signalSent, false);
    assert.equal(cleanup.processGone, false);
    assert.match(cleanup.evidence, /stat-read-failed.*pid=704/);
    assert.equal(wsl(['/bin/kill', '-0', String(group.marker.pid)]).status, 0);
  } finally {
    wsl(['/bin/rm', '-rf', root]);
    await verifiedCleanup(group);
  }
});
