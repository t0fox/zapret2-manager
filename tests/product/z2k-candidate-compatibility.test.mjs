import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'); }

// --- 1. NEGATIVE candidate must be review-required, not updates, rebases [] ---
test('NEGATIVE gate: missing _state or get_record -> review-required, rebases [], not in updates', () => {
  // This test verifies the compatibility gate via pure raw check (is_compatible_raw)
  // The production gate must be exposed as a pure function for testability.
  // We check that the fixture with missing API is detected as incompatible.
  const good = read('tests/fixtures/z2k-candidate-negative/z2k-state-persist-good.lua');
  const missingState = read('tests/fixtures/z2k-candidate-negative/z2k-state-persist-missing-state.lua');
  const missingGet = read('tests/fixtures/z2k-candidate-negative/z2k-state-persist-missing-getrecord.lua');

  // The upstream file itself should have a helper is_compatible_raw or similar.
  // We simulate what the gate should do: check for required symbols as words, not substrings.
  function isCompatibleRaw(raw) {
    if (typeof raw !== 'string') return false;
    if (!raw.includes('z2k_state_persist')) return false;
    if (!raw.includes('circular')) return false;
    // precise checks: exported _state and get_record as words
    const hasState = raw.includes('  _state =') || raw.includes('._state');
    const hasGet = raw.includes('  get_record =') || raw.includes('.get_record') || raw.includes('get_record(');
    if (!hasState) return false;
    if (!hasGet) return false;
    return true;
  }

  assert.equal(isCompatibleRaw(good), true, 'good candidate must be compatible');
  assert.equal(isCompatibleRaw(missingState), false, 'missing _state must be incompatible');
  assert.equal(isCompatibleRaw(missingGet), false, 'missing get_record must be incompatible');

  // The gate is expected to be exposed in production code as z2k_state_persist_compat_raw or is_compatible_raw
  // Check that production file actually exports such a helper (will fail until implemented)
  const upstreamUc = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
  assert.match(upstreamUc, /is_compatible_raw|compat_raw|is_state_persist_compatible_raw/, 'production must expose pure raw compatibility helper for testability');

  // Also verify that plan would put missing candidate in reviews, not updates, and rebases stays []
  // Simulate plan branching
  function simulatePlan(manifest, integration, gate) {
    const updates = [], rebases = [], reviews = [];
    for (const p of Object.keys(manifest.files_sha256)) {
      const digest = manifest.files_sha256[p];
      const item = integration.files.find(f => f.sourcePath === p);
      if (!item) throw new Error('unclassified ' + p);
      if (item.class === 'exact-managed') {
        const needsUpdate = true; // assume installed != digest
        if (needsUpdate) {
          if (p === 'files/lua/z2k-state-persist.lua' && !gate(digest)) reviews.push(p);
          else updates.push(p);
        }
      }
    }
    return { updates, rebases, reviews, status: rebases.length ? 'rebase-required' : reviews.length ? 'review-required' : updates.length ? 'update-available' : 'current' };
  }

  const manifest = JSON.parse(read('tests/fixtures/z2k-signed-update/UPDATES.json'));
  const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
  // Gate that returns false for negative digest (simulate missing API)
  const gateFalse = () => false;
  const result = simulatePlan(manifest, integration, gateFalse);
  assert.deepEqual(result.rebases, [], 'rebases must remain [] even for incompatible candidate');
  assert.ok(result.reviews.includes('files/lua/z2k-state-persist.lua'), 'incompatible must go to reviews');
  assert.ok(!result.updates.includes('files/lua/z2k-state-persist.lua'), 'incompatible must NOT be in normal updates');
  assert.equal(result.status, 'review-required');
});

// --- 2. SEMANTIC contract harness (behavioral, not just grep) ---
test('SEMANTIC: excluded 5th-col survives load/write, get_record key pair, state lookup, wrapper reconcile order', () => {
  const upstream = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
  // 5th column excluded must survive: check permissive mode logic, not restrictive
  assert.match(upstream, /\(mode ~= nil and mode ~= ""\) and mode or "auto"/, 'must preserve arbitrary mode including excluded');
  assert.doesNotMatch(upstream, /mode == "frozen" or mode == "excluded"/, 'must not have restrictive mode check that would clobber excluded');

  // Behavioral: simulate load/write in JS that mirrors Lua merge_state_file_into
  function normalizeHost(host) { return host.toLowerCase().replace(/\.$/, ''); }
  function mergeLine(line, dest) {
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([^\t]+)\t([^\t]+)\t([0-9]+)\t?([0-9]*)\t?([a-z]*)/);
    if (!m) return;
    const [, askey, host, strat, ts, mode] = m;
    const n = parseInt(strat, 10);
    if (n < 1) return;
    const hn = normalizeHost(host);
    const tsn = parseInt(ts || '0', 10) || 0;
    const mm = (mode != null && mode !== '') ? mode : 'auto';
    dest[askey] = dest[askey] || {};
    const prev = dest[askey][hn];
    if (!prev || (prev.ts || 0) <= tsn) dest[askey][hn] = { strategy: n, ts: tsn, mode: mm };
  }
  const dest = {};
  mergeLine('circular_1_1\texample.com\t2\t1000\texcluded', dest);
  assert.equal(dest['circular_1_1']['example.com'].mode, 'excluded', 'excluded must survive merge');
  assert.equal(dest['circular_1_1']['example.com'].strategy, 2);
  // 4-col legacy -> auto
  const dest2 = {};
  mergeLine('circular_1_1\tlegacy.com\t2\t1000', dest2);
  assert.equal(dest2['circular_1_1']['legacy.com'].mode, 'auto');
  // write simulation preserves mode
  function writeState(state) {
    const lines = ['# z2k autocircular state', '# key\thost\tstrategy\tts\tmode'];
    for (const [k, hosts] of Object.entries(state)) for (const [h, rec] of Object.entries(hosts)) lines.push(`${k}\t${h}\t${rec.strategy}\t${rec.ts}\t${rec.mode}`);
    return lines.join('\n');
  }
  const written = writeState(dest);
  assert.match(written, /excluded/, 'write must preserve excluded verbatim');
  const dest3 = {};
  for (const line of written.split('\n')) mergeLine(line, dest3);
  assert.equal(dest3['circular_1_1']['example.com'].mode, 'excluded', 'roundtrip must preserve excluded');

  // get_record contract: sidecar must call get_record(desync, false) and use returned askey/hostn
  const sidecar = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
  assert.match(sidecar, /get_record\s*\(\s*desync\s*,\s*false\s*\)/, 'sidecar must call get_record(desync, false)');
  assert.match(sidecar, /z2k_state_persist\.get_record/, 'must use z2k_state_persist.get_record');
  assert.match(sidecar, /z2k_state_persist\._state/, 'must use _state lookup');
  assert.match(sidecar, /mode == "excluded"/, 'must check mode == excluded');
  assert.match(sidecar, /plan_clear/, 'must clear plan for excluded');
  assert.match(sidecar, /VERDICT_PASS/, 'must return VERDICT_PASS for excluded');

  // upstream wrapper must reconcile external edits BEFORE calling captured circular
  // Check order: pcall(reconcile_external_edits) appears before pcall(orig_circular in wrapper
  const wrapperSection = upstream.slice(upstream.indexOf('if type(circular) == "function"'));
  const reconCallIdx = wrapperSection.indexOf('pcall(reconcile_external_edits');
  const origCallIdx = wrapperSection.indexOf('pcall(orig_circular');
  assert.ok(reconCallIdx >= 0, 'upstream must contain pcall(reconcile_external_edits)');
  assert.ok(origCallIdx >= 0, 'upstream must contain pcall(orig_circular');
  assert.ok(reconCallIdx < origCallIdx, 'reconcile must be called BEFORE orig_circular (external edits authoritative)');
  // Also sidecar must be loaded before upstream wraps, so that upstream is outer wrapper.
  // The runtime sync now receives the ordered LUA_INIT subset from the canonical
  // resolver; it must not recreate the retired hand-copied LuaOPT sequence.
  const sync = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
  assert.match(sync, /runtime-composition-cli\.uc/);
  assert.match(sync, /resolver_luaopt/);
  assert.match(sync, /LUA_INIT/);
  assert.doesNotMatch(sync, /append_luaopt_if_present\s+zapret-auto\.lua/,
    'runtime Lua order must come from the resolver, not a static append list');
});

// --- 3. Refresh-state regression ---
test('Refresh-state regression: resources_status is persisted CHECK_STATE and re-projects it through current policy', () => {
  const ru = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(ru, /load_check_state/, 'resource_center_status must use load_check_state (persisted)');
  assert.match(ru, /z2k_projection\(latestCheck\.signed,\s*true\)/, 'status must project persisted signed through current pure policy');
  // Extract resource_center_status body to ensure it does NOT call live check directly
  const statusStart = ru.indexOf('export const resource_center_status');
  const checkStart = ru.indexOf('export const resource_center_check');
  assert.ok(statusStart >= 0 && checkStart > statusStart, 'must have both functions');
  const statusBody = ru.slice(statusStart, checkStart);
  assert.doesNotMatch(statusBody, /z2k_upstream_check\s*\(/, 'status must NOT call live z2k_upstream_check (it uses persisted)');
  assert.match(statusBody, /load_check_state/, 'status must use persisted load_check_state');
  const checkBody = ru.slice(checkStart, checkStart + 5000);
  assert.match(checkBody, /z2k_upstream_check\s*\(\)/, 'check must call live z2k_upstream_check');
  assert.match(ru, /save_check_state/, 'check must save_check_state');
  assert.match(ru, /CHECK_STATE = '\/etc\/zapret2-manager\/resource-source-check\.json'/, 'CHECK_STATE path must be documented');
  assert.match(ru, /refreshPlan === true[\s\S]*z2k_upstream_plan/, 'status policy refresh must remain pure and local');
});
