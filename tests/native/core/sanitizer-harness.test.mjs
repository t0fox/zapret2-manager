import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve('.');
const runner = path.join(projectRoot, 'tests', 'native', 'core', 'run-fs-helper-sanitizers.mjs');
const classifications = new Set([
  'PASS', 'SKIP_UNAVAILABLE', 'COMPILE_FAILED', 'TIMEOUT', 'SIGNALLED',
  'SANITIZER_FAILURE', 'ASSERTION_FAILURE'
]);

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
  }
  assert.equal(typeof report.timeout.ms, 'number');
  assert.equal(typeof report.timeout.timedOut, 'boolean');
  assert.match(report.binaryPath, /^\/tmp\/[^/]+\/[^/]+$/);
  assert.equal(typeof report.sanitizerEnvironment.ASAN_OPTIONS, 'string');
  assert.equal(typeof report.sanitizerEnvironment.UBSAN_OPTIONS, 'string');
  assert.ok(Buffer.byteLength(run.stdout) <= 512 * 1024, 'JSON report must remain bounded');
  return { ...run, report };
}

test('normal production helper run is PASS or capability-proven SKIP_UNAVAILABLE', () => {
  const run = runScenario('normal');
  assert.ok(['PASS', 'SKIP_UNAVAILABLE'].includes(run.report.classification));
  assert.equal(run.status, 0, run.stderr || run.stdout);
  if (run.report.classification === 'PASS') {
    assert.equal(run.report.assertion?.response?.ok, true);
    assert.equal(run.report.assertion?.response?.data?.type, 'regular');
  } else {
    const runtime = run.report.probe.runtime;
    assert.ok(run.report.probe.exitCode !== 0 || runtime?.exitCode !== 0 || runtime?.timedOut);
    assert.ok(run.report.probe.stderr || run.report.probe.stdout || runtime?.stderr || runtime?.stdout);
  }
});

test('intentional heap overflow is SANITIZER_FAILURE with diagnostics preserved', () => {
  const run = runScenario('heap-overflow');
  if (run.report.classification === 'SKIP_UNAVAILABLE') return assert.equal(run.status, 0);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'SANITIZER_FAILURE');
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
  if (run.report.classification === 'SKIP_UNAVAILABLE') return assert.equal(run.status, 0);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'TIMEOUT');
  assert.equal(run.report.timeout.timedOut, true);
});

test('self-termination is SIGNALLED and preserves the raw signal', () => {
  const run = runScenario('signal');
  if (run.report.classification === 'SKIP_UNAVAILABLE') return assert.equal(run.status, 0);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'SIGNALLED');
  assert.ok(run.report.run.signal || run.report.run.exitCode === 15 || run.report.run.exitCode >= 128);
});

test('silent abnormal exit is ASSERTION_FAILURE', () => {
  const run = runScenario('abnormal-exit');
  if (run.report.classification === 'SKIP_UNAVAILABLE') return assert.equal(run.status, 0);
  assert.equal(run.status, 1);
  assert.equal(run.report.classification, 'ASSERTION_FAILURE');
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
  if (first.report.classification !== 'SKIP_UNAVAILABLE') assert.equal(first.report.classification, 'ASSERTION_FAILURE');
  if (second.report.classification !== 'SKIP_UNAVAILABLE') assert.equal(second.report.classification, 'ASSERTION_FAILURE');
  assert.deepEqual(fs.readdirSync(projectRoot).sort(), before);
});
