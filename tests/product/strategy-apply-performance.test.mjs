import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');
const CLI = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const APPLY = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const CANONICAL_PAGE = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');

function region(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(to > from, `missing ${end || 'end'}`);
  return source.slice(from, to);
}

function assertOrdered(source, patterns) {
  let cursor = -1;
  for (const pattern of patterns) {
    const match = source.slice(cursor + 1).match(pattern);
    assert.ok(match, `missing ordered pattern ${pattern}`);
    cursor += 1 + match.index;
  }
}

test('Strategy Apply compiles without native preflight and the locked writer owns exactly one authoritative preflight', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');
  const candidate = region(CLI, 'function strategy_apply_candidate', 'function bind_executable_candidate');
  const locked = region(APPLY, 'function profiles_apply_candidate_locked', 'export const profiles_apply_candidate');

  assert.match(apply, /trusted\.environment\.validate\s*=\s*false/);
  assert.match(apply, /trusted\.environment\.executionAdmission\s*=\s*false/);
  assert.doesNotMatch(candidate, /native_preflight\s*\(/);
  assert.equal((locked.match(/native_preflight_for_apply\s*\(/g) || []).length, 1);
});

test('Cached Preview is never Apply authority and Apply revalidates the final installed composition inside the lock', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');
  const locked = region(APPLY, 'function profiles_apply_candidate_locked', 'export const profiles_apply_candidate');

  assert.match(apply, /profiles_apply_candidate\(candidate\.candidate, candidate\.digest, projection\)/);
  assert.match(locked, /resolveInstalled\(\{\}\)/);
  assert.match(locked, /runtime.*snapshot|snapshot.*runtime/i);
  assert.match(locked, /native_preflight_for_apply\(candidate/);
  assert.doesNotMatch(region(CLI, 'function strategy_apply_candidate', 'function bind_executable_candidate'), /complete_validation/);
});

test('Apply uses condition-based bounded readiness for initial and rollback restarts', () => {
  const verify = region(APPLY, 'function transaction_verify', 'function transaction_restore');
  const transaction = region(APPLY, 'function apply_candidate_pipeline', 'function locked_candidate_call');

  assert.doesNotMatch(transaction, /run\('sleep 2'\)/);
  assert.match(verify, /deadline|deadlineSec|deadlineMs/);
  assert.match(verify, /sleep 0\.1|usleep 100000/);
  assert.match(transaction, /transaction_verify\(0,/);
  assert.match(transaction, /transaction_verify\(1,/);
});

test('Readiness polling exposes immediate, delayed, and timeout outcomes to the existing rollback verdict', () => {
  const verify = region(APPLY, 'function transaction_verify', 'function transaction_restore');
  const decision = region(APPLY, 'export const profiles_rollback_decision', 'function event_apply');

  assert.match(verify, /readiness|poll/i);
  assert.match(verify, /verify_status|result\.readiness/);
  assert.match(decision, /restartRc != 0 \|\| !verifyOk/);
  assert.match(decision, /rollbackRequired/);
});

test('Strategy Apply retains ESTALE, Z2K dependency closure, and runtime bundle digest admission', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');
  const locked = region(APPLY, 'function profiles_apply_candidate_locked', 'export const profiles_apply_candidate');

  assert.match(apply, /strategy_apply_projection\([\s\S]*installedSnapshot/);
  assert.match(locked, /resolveInstalled\(\{\}\)/);
  assert.match(locked, /ESTALE/);
  assert.match(apply, /dependencyClosure/);
  assert.match(apply, /runtimeBundleDigest/);
});

test('Canonical Strategy UI releases Apply busy and paints confirmed identity before refresh', () => {
  const mutate = region(CANONICAL_PAGE, 'function mutate(action, request, options)', 'function openConfirm');

  assert.match(mutate, /answer\.ok\s*===\s*false/);
  assert.match(mutate, /action === 'apply'/);
  assert.match(mutate, /applyAnswerIdentity\(answer\)/);
  assert.match(mutate, /state\.operationPending\s*=\s*null/);
  assert.match(mutate, /notify\('ok', Model\.actionCopy\('apply'\)\.success\)/);
  assert.match(mutate, /refreshData\(true\)/);
});

test('Strategy UI never paints Apply success from an error or uncertain response', () => {
  const mutate = region(CANONICAL_PAGE, 'function mutate(action, request, options)', 'function openConfirm');

  assert.match(mutate, /if \(!answer \|\| answer\.ok === false\) throw/);
  assert.match(mutate, /function \(error\)/);
  assert.match(mutate, /notify\('err', errorText\(state\.ctx, error\)\)/);
  assert.doesNotMatch(mutate, /answer\.uncertain.*success/i);
});

test('Canonical Strategies Apply paints backend identity before refresh and quarantines stale status', () => {
  const mutate = region(CANONICAL_PAGE, 'function mutate(action, request, options)', 'function openConfirm');
  const refresh = region(CANONICAL_PAGE, 'function refreshData(full)', 'function formatCatalogDuration');
  const guard = region(CANONICAL_PAGE, 'function retainConfirmedApplyIdentity', 'function buildRows');

  assert.match(mutate, /applyAnswerIdentity\(answer\)/);
  assert.match(mutate, /action === 'apply'[\s\S]*?refreshData\(true\)/);
  assert.match(refresh, /retainConfirmedApplyIdentity\(data\)/);
  assert.match(refresh, /retainConfirmedApplyIdentity\(\{ status: freshStatus \}\)/);
  assert.match(guard, /state\.applyIdentity/);
  assert.match(guard, /freshId[\s\S]*guard\.id/);
  assert.match(guard, /Object\.assign\(\{\}, data, \{ status: state\.data\.status \}\)/);
});

test('Locked Strategy projection validates the binding before the sole native preflight', () => {
  const locked = region(APPLY, 'function profiles_apply_candidate_locked', 'export const profiles_apply_candidate');

  assert.match(locked, /profiles_projection_boundary\(expectedHash\)/);
  assert.match(locked, /projection_valid\(projection, expectedHash\)/);
  assert.match(APPLY, /runtime_binding_valid\(value\.runtimeBinding\)/);
  assert.ok(locked.indexOf('projection_valid(projection, expectedHash)') < locked.indexOf('resolveInstalled({})'));
  assert.ok(locked.indexOf('resolveInstalled({})') < locked.indexOf('native_preflight_for_apply(candidate, runtimeSnapshot)'));
});

test('Strategy Apply reuses RPC runtime composition and leaves only a test/direct fallback resolve', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');

  assertOrdered(apply, [
    /let currentCatalog = catalog\(\)/,
    /let resolved = resolve_strategy\(/,
    /let trusted = server_context\(/,
    /let installedSnapshot = trusted\.runtimeComposition/,
    /strategy_apply_candidate\(/,
    /profiles_apply_candidate\(/
  ]);
  assert.equal((apply.match(/runtime_composition_for_apply\(/g) || []).length, 1);
});

test('Strategy Apply keeps projection validation loadable and releases the guard on transaction exceptions', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');
  const projection = region(APPLY, 'function runtime_binding_valid', 'function projection_valid');

  assert.ok(APPLY.indexOf('function runtime_binding_valid') < APPLY.indexOf('function projection_valid'));
  assert.match(projection, /observedRegistryRevision/);
  assert.match(apply, /try \{ applied = profiles_apply_candidate\([\s\S]*?\}\s*catch \(e\)/);
  assert.match(apply, /Strategy transaction failed before returning a bounded result/);
  assert.match(apply, /strategy_apply_finish\([\s\S]*begun\.operationNonce, projection\)/);
});

test('Runtime binding keeps large canonical composition IDs bounded with digests', () => {
  const digestHelper = region(CLI, 'function runtime_identity_digest', 'function safe_id');
  const binding = region(CLI, 'function runtime_snapshot_binding', 'function runtime_snapshot_error');
  const validator = region(APPLY, 'function runtime_binding_valid', 'function runtime_binding_matches');
  const matcher = region(APPLY, 'function runtime_binding_matches', 'function projection_valid');

  assert.match(binding, /snapshotIdSha256/);
  assert.match(binding, /compositionSnapshotIdSha256/);
  assert.match(binding, /membershipDigestSha256/);
  assert.match(digestHelper, /mktemp.*runtime-id|sha256sum.*runtime-id/);
  assert.match(validator, /snapshotIdSha256/);
  assert.match(matcher, /sha256_text_via_file/);
  assert.match(matcher, /membershipDigest/);
});

test('Readiness metadata remains bounded evidence for both success and rollback/error responses', () => {
  const verify = region(APPLY, 'function transaction_verify', 'function transaction_restore');
  const pipeline = region(APPLY, 'function apply_candidate_pipeline', 'function locked_candidate_call');

  assert.match(verify, /deadlineSec/);
  assert.match(verify, /timedOut: false/);
  assert.match(verify, /timedOut: true/);
  assert.match(pipeline, /rollbackVerify/);
  assert.match(pipeline, /uncertain/);
});

test('Locked transaction keeps Strategy identity calls in the authoritative UCode process', () => {
  const imports = APPLY.slice(0, APPLY.indexOf('const LASTGOOD_DIR'));
  const stateCall = region(APPLY, 'function strategy_state_call', 'function trim_ws');
  const pipeline = region(APPLY, 'function apply_candidate_pipeline', 'function locked_candidate_call');

  assert.match(imports, /import \* as strategy_state from ['"]\.\/strategy-state\.uc['"]/);
  assert.match(stateCall, /strategy_state\[name\]/);
  assert.match(stateCall, /same UCode process|private state lock/);
  assert.doesNotMatch(pipeline, /strategy_state_call\(['"]strategy_apply_revalidate['"][\s\S]*run\(/);
  assert.doesNotMatch(pipeline, /strategy_state_call\(['"]strategy_selection_apply['"][\s\S]*run\(/);
});

test('Apply exposes bounded per-stage timing evidence without making it an authority', () => {
  const apply = region(CLI, 'export const strategy_apply =', 'function strategy_reconcile_locked');
  const locked = region(APPLY, 'function profiles_apply_candidate_locked', 'export const profiles_apply_candidate');

  assert.match(CLI, /function monotonic_ms\(/);
  assert.match(APPLY, /function monotonic_ms\(/);
  assert.match(apply, /timing/);
  assert.match(locked, /timing/);
  assert.match(apply, /catalog|compile|transaction/i);
  assert.match(locked, /preflight|write|restart|postflight/i);
  assert.match(CLI, /MAX_TIMING|timing.*bounded|bounded.*timing/i);
});
