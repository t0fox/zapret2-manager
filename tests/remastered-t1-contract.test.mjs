import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const run = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc', 'utf8');
const orchestra = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/orchestra.uc', 'utf8');
const status = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/status.uc', 'utf8');
const auto = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');
const rpcd = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const ui = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js', 'utf8');
const runs = JSON.parse(readFileSync('tests/fixtures/remastered-t1-runs.json', 'utf8'));
const runtime = JSON.parse(readFileSync('tests/fixtures/remastered-t1-runtime.json', 'utf8'));

test('redacted router fixtures cover canonical, legacy, corrupt, and false-negative shapes', () => {
  assert.deepEqual(runs.emptyList.runs, []);
  assert.equal(runs.oneRunCanonical.schemaVersion, 1);
  assert.equal(runs.routerParseFailedResponse.error, 'parse failed');
  assert.equal(runtime.routerFalseNegative.status, 'running');
  assert.equal(runtime.routerFalseNegative.nfqueue.ownerMatches, true);
});

test('run responses expose additive canonical list and detail contracts', () => {
  assert.match(run, /function canonical_run_summary\(/);
  assert.match(run, /schemaVersion:1/);
  assert.match(run, /warnings:/);
  assert.match(run, /function canonical_run_detail\(/);
  assert.match(run, /ranking:/);
  assert.match(run, /admissionReason/);
});

test('run history reports a corrupt artifact without making a valid list fail', () => {
  assert.match(run, /run-entry-corrupt/);
  assert.match(run, /unsupported-run-schema/);
  assert.match(run, /warnings:warnings/);
});

test('canonical runtime truth replaces the pidof-only Orchestra verdict', () => {
  assert.match(status, /runtimeSummary:/);
  assert.match(status, /runtime_summary\(/);
  assert.match(orchestra, /runtime_summary_cached\(/);
  assert.doesNotMatch(orchestra, /pidof nfqws2/);
  assert.match(auto, /runtime_summary_cached\(/);
});

test('Auto Strategy keeps boolean capabilities and adds server admission reasons', () => {
  assert.match(auto, /admissionReasons:/);
  assert.match(auto, /no-services-selected/);
  assert.match(auto, /cooldown-active/);
  assert.match(auto, /runtime-not-confirmed/);
});

test('Runs UI normalizes parse-failed envelopes without exposing raw output', () => {
  assert.match(ui, /normalizeRunResponse/);
  assert.match(ui, /invalid-run-response/);
  assert.match(ui, /Не удалось загрузить результаты запуска/);
  assert.doesNotMatch(ui, /journal parse failed/);
});

test('run-history adapter remains executable on the target BusyBox image', () => {
  assert.match(rpcd, /function orchestra_cmd\(sub, arg\)/);
  assert.doesNotMatch(rpcd, /timeout ' \+ ORCH_TIMEOUT_SEC/);
  assert.match(rpcd, /head -c ' \+ ORCH_MAX_OUTPUT/);
});
