import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PLANNER = join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');
const CATALOG = join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const WORKER = join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc');

test('production planner binds locally loaded authority once and keeps pure validation for callers', () => {
  const source = readFileSync(PLANNER, 'utf8');
  assert.match(source, /trustedServerAuthority/);
  assert.match(source, /scanner_plan_build_server\(validated\.value, loaded\.catalog, listed\.strategies, profile,[\s\S]*compilerAuthority, true, true/);
  assert.match(source, /if \(!trustedServerAuthority && !authority_valid/);
  assert.match(source, /if \(!trustedServerAuthority && !user_records_valid/);
  assert.match(source, /strategy_runtime_environment/,
    'production planning must bind the live runtime compiler environment');
  const strategyCli = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc'), 'utf8');
  assert.match(strategyCli, /resolveInstalled/,
    'live Strategy runtime composition must use the canonical installed resolver');
  assert.match(strategyCli, /composition_lua_inputs/,
    'live Strategy Lua init inputs must come from resolver-owned ordered closure');
  assert.match(strategyCli, /runtimeComposition/,
    'live Strategy compatibility must carry the canonical runtime composition');
  assert.match(source, /Scanner live runtime composition is unavailable/,
    'missing live runtime composition must remain a structured dependency error');
});

test('production Quick planning opens the compact index and materializes only selected catalog entries', () => {
  const planner = readFileSync(PLANNER, 'utf8');
  const catalog = readFileSync(CATALOG, 'utf8');
  assert.match(planner, /strategy_catalog_read_index/,
    'Quick planning must not force a full catalog parse');
  assert.match(planner, /strategy_catalog_materialize/,
    'selected candidates must be verified/materialized from the canonical source');
  assert.match(planner, /strategy_catalog_read_index\(getenv\('Z2M_SCANNER_SERVER_TEST'\)/,
    'test-only catalog overrides must remain behind the existing authority gate');
  assert.match(catalog, /export const strategy_catalog_materialize/,
    'catalog must expose a bounded materialization API');
  assert.match(planner, /let preserved = \{[\s\S]*compilerDigest: catalog\.compilerDigest[\s\S]*catalog = materialized\.catalog[\s\S]*for \(let key in preserved\) catalog\[key\] = preserved\[key\]/,
    'materialization must preserve the server-bound planner authority fields');
  assert.match(planner, /function catalog_lightweight_strategy/,
    'Quick selection must not normalize full catalog Strategies before shortlist');
  assert.match(planner, /let strategy = catalog_lightweight_strategy\(entry\)/,
    'Quick selection must use the compact index descriptor');
  assert.match(catalog, /fullPreset/,
    'compact index must carry the canonical full-preset selection bit');
  assert.match(catalog, /complexity/,
    'compact index must carry the canonical complexity selection tuple');
  assert.match(planner, /strategy\.fullPreset/,
    'Quick selection must reuse indexed full-preset metadata');
  assert.match(planner, /dependencyClosure\.available != true/,
    'planner must exclude candidates whose server-bound runtime dependency closure is unavailable');
  assert.match(planner, /timings/,
    'planner must publish monotonic phase timings');
  assert.match(planner, /\(!item\.available && \(!exists\(item, 'reason'\)/,
    'available dependency items may omit an unavailable-only reason');
});

test('production worker records monotonic state-write timing without changing the Scanner authority', () => {
  const worker = readFileSync(WORKER, 'utf8');
  assert.match(worker, /clock\(true\)/,
    'worker timings must use a monotonic clock');
  assert.match(worker, /stateWriteMs/,
    'checkpoint timing must identify the state-write phase');
  assert.match(worker, /state\.scanner_state_save\(record\)/,
    'timing must wrap the canonical Scanner state writer');
  assert.match(worker, /lifecycle\.checkpointFailure = saved\.error/,
    'checkpoint publication failures must preserve the structured native error');
  assert.match(worker, /no_scanner_table_created/,
    'activation failures before ownership creation must reconcile as a verified no-op after cleanup');
  assert.match(worker, /terminal_reconciliation\(record, transition, cleanup\)/,
    'terminal reconciliation must receive the cleanup evidence produced in the same finish path');
  assert.match(worker, /cleanupEvidence \|\| evidence\.sessionCleanup/,
    'terminal reconciliation must use explicit cleanup evidence before persisted recovery evidence');
  assert.match(worker, /try \{ cleanup = scanner_session_finish\(/,
    'terminal session finish exceptions must become durable structured recovery');
  assert.match(worker, /!staleOwnerRecovered && staleHeartbeat/,
    'resume may bypass stale heartbeat only after verified stale-owner recovery');
  assert.match(worker, /evidence: activated/,
    'activation failures must retain the nested structured application error');
  assert.match(worker, /function activation_cleanup\(value\)/,
    'activation failures must search nested adapter cleanup evidence before declaring recovery uncertain');
  const apply = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc'), 'utf8');
  assert.match(apply, /type\(parsed\.tokens\) != 'array'/,
    'compiled candidate token parsing must use the tokenizer contract');
  assert.doesNotMatch(apply, /parsed\.ok != true/,
    'candidate staging must not require a non-existent tokenizer ok flag');
  assert.ok(apply.indexOf('function scanner_secure_temp') < apply.indexOf('function scanner_stage_candidate'),
    'ucode helper declarations used by staging must be available before the staging function');
  assert.match(apply, /let moved = run\('mv -f/,
    'staging must use the module-local structured command runner');
  assert.doesNotMatch(apply, /let moved = command\(/,
    'staging must not call an undeclared command helper');
  const adapter = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh'), 'utf8');
  assert.match(adapter, /check.*meta/,
    'adapter tamper failures must identify the exact bounded identity invariant');
  assert.match(adapter, /argv_stream=.*awk/,
    'adapter must verify the canonical space-delimited compiled token stream, not staging newline bytes');
  assert.match(adapter, /runtime-composition-cli/,
    'temporary nfqws2 must load the resolver-owned Lua runtime as production nfqws2');
  assert.match(adapter, /fail EDEPENDENCY runtime/,
    'missing packaged runtime must remain a structured dependency failure');
  assert.match(adapter, /process_alive\(\).*print \$3.*!= Z/,
    'cleanup must classify an exact-starttime zombie as already stopped');
  const transient = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc'), 'utf8');
  assert.match(transient, /export const scanner_candidate_cleanup = function\(attempt\) \{\s*return candidate_cleanup\(attempt\);/,
    'production candidate cleanup must persist CLEANING/CLEANED journal evidence');
  assert.match(apply, /staging: staged/,
    'candidate staging failures must retain the exact bounded invariant');
});

test('transient restore uses the canonical atomic writer while Scanner lock is held', () => {
  const apply = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc'), 'utf8');
  const writer = readFileSync(join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc'), 'utf8');
  assert.match(apply, /let restored = restore_whole_file\(PATHS\.applied_conf, snapshot\.config\.bytes, true\);/,
    'Scanner restore must use the atomic writer under its already-held lock');
  assert.match(writer, /callerHoldsLock !== true/,
    'the writer must accept only the explicit already-held-lock mode');
  assert.match(writer, /if \(\(!locked\(\) && callerHoldsLock !== true\) \|\| path != CONFIG\)/,
    'the override must remain path-bound and fail closed without lock evidence');
});
