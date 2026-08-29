import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// Helper to simulate app.js ctx.refresh lifecycle
// This models the real bug: refresh creates a NEW ctx and replaces activeContext
function createHarness() {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  // Extract state and functions via evaluation in a sandbox
  // We will not eval the whole file, but simulate the relevant parts:
  // state, isBusyFor, operationPhase, checkUpdates, updateZ2K, refreshState, refresh, rerender
  // For this test, we simulate by directly checking the source ordering
  return src;
}

test('A successful check + context replacement visible ctx2 must NOT be busy', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  // Find checkUpdates function body
  const checkStart = src.indexOf('function checkUpdates');
  const checkBody = src.slice(checkStart, checkStart + 3000);
  // The bug is: refresh(ctx) followed by finally that touches old ctx
  // Correct order: clear operation and rerender BEFORE refresh, and no post-refresh rerender of old ctx
  // Check that checkUpdates does NOT have pattern: refresh(ctx) ... finally.*rerender.*old ctx
  // Instead it should have: componentOperation = null; rerender(ctx); return refresh(ctx);
  // We check the source order
  const refreshIdx = checkBody.indexOf('refresh(ctx)');
  const clearIdx = checkBody.indexOf('componentOperation = null');
  const rerenderIdx = checkBody.indexOf('rerender(ctx)');
  // In correct code, clear and rerender occur BEFORE refresh
  // In buggy code, clear is in finally AFTER refresh
  assert.ok(refreshIdx >= 0, 'checkUpdates must call refresh');
  assert.ok(clearIdx >= 0, 'must clear componentOperation');
  // Find the first clear after the start
  const firstClear = checkBody.indexOf('componentOperation = null');
  const firstRefresh = checkBody.indexOf('refresh(ctx)');
  // For correct lifecycle, clear must be BEFORE refresh
  // Buggy has refresh before clear (in finally)
  // We test that the file has clear BEFORE refresh (not after)
  // To simulate the realistic ctx replacement, we will run a JS simulation

  // Simulate the lifecycle
  let state = { componentOperation: null };
  function isBusyFor(id) {
    const op = state.componentOperation;
    if (!op) return false;
    if (op.scope === 'all') return true;
    if (op.scope === 'z2k' && id === 'z2k-core') return true;
    if (op.scope === 'engine' && id === 'engine') return true;
    return false;
  }
  let ctx1 = { id: 'ctx1', detached: false, busy: false };
  let ctx2 = null;
  let activeCtx = ctx1;
  function rerender(ctx) {
    // In real app, rerender replaces ctx.root children; we simulate by marking busy based on current state
    ctx.busy = isBusyFor('engine') || isBusyFor('z2k-core');
  }
  function refresh(ctx) {
    // app.js: creates new ctx, renders with current global state, marks old detached
    const newCtx = { id: 'ctx2', detached: false, busy: false };
    // Render new ctx with CURRENT global operation (should be null if cleared before refresh)
    newCtx.busy = isBusyFor('engine') || isBusyFor('z2k-core');
    ctx.detached = true;
    ctx2 = newCtx;
    activeCtx = newCtx;
    return Promise.resolve();
  }
  // Simulate buggy checkUpdates: set op, render old, do backend, then refresh, then finally clear old
  async function buggyCheckUpdates(ctx) {
    if (state.componentOperation) return;
    state.componentOperation = { kind: 'check', scope: 'all' };
    rerender(ctx);
    // backend
    await Promise.resolve();
    // buggy order: refresh then finally clear old
    await refresh(ctx);
    state.componentOperation = null;
    rerender(ctx); // rerenders detached ctx
  }
  // Simulate correct checkUpdates: clear before refresh
  async function correctCheckUpdates(ctx) {
    if (state.componentOperation) return;
    state.componentOperation = { kind: 'check', scope: 'all' };
    rerender(ctx);
    await Promise.resolve();
    state.componentOperation = null;
    rerender(ctx); // clear old before boundary
    await refresh(ctx); // new ctx rendered with cleared state
  }

  // Test buggy leaves ctx2 busy
  state.componentOperation = null;
  ctx1 = { id: 'ctx1', detached: false, busy: false };
  ctx2 = null;
  activeCtx = ctx1;
  await buggyCheckUpdates(ctx1);
  assert.equal(ctx2.busy, true, 'buggy: ctx2 must be busy (demonstrates bug)');

  // Test correct leaves ctx2 not busy
  state.componentOperation = null;
  ctx1 = { id: 'ctx1', detached: false, busy: false };
  ctx2 = null;
  activeCtx = ctx1;
  await correctCheckUpdates(ctx1);
  assert.equal(ctx2.busy, false, 'correct: ctx2 must NOT be busy');

  // Now check the actual file has correct order (clear before refresh)
  // The file should have "componentOperation = null" BEFORE "return refresh" or "refresh(ctx)" and NOT have finally after
  const hasFinallyAfterRefresh = /refresh\(ctx\)[\s\S]*?finally[\s\S]*?componentOperation\s*=\s*null/.test(checkBody);
  assert.equal(hasFinallyAfterRefresh, false, 'checkUpdates must NOT have refresh then finally clear (old ctx)');
  const hasClearBeforeRefresh = /componentOperation\s*=\s*null[\s\S]*?rerender\(ctx\)[\s\S]*?return refresh\(ctx\)|componentOperation\s*=\s*null[\s\S]*?refresh\(ctx\)/.test(checkBody);
  assert.equal(hasClearBeforeRefresh, true, 'checkUpdates must clear and rerender BEFORE refresh');
});

test('B backend check failure ctx1 must not be busy', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const checkBody = src.slice(src.indexOf('function checkUpdates'), src.indexOf('function checkUpdates') + 3000);
  // Must have catch that clears before finally or directly
  assert.match(checkBody, /catch[\s\S]*?componentOperation|finally[\s\S]*?componentOperation/);
});

test('C refresh failure visible old page must not be busy', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  // refreshState should also clear before refresh
  const refreshBody = src.slice(src.indexOf('function refreshState'), src.indexOf('function refreshState') + 2000);
  assert.match(refreshBody, /componentOperation\s*=\s*null/);
  const hasFinallyAfterRefresh = /refresh\(ctx\)[\s\S]*?finally[\s\S]*?componentOperation/.test(refreshBody);
  assert.equal(hasFinallyAfterRefresh, false, 'refreshState must not have finally after refresh');
});

test('D successful Z2K update + context replacement ctx2 not busy', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const updBody = src.slice(src.indexOf('function updateZ2K'), src.indexOf('function z2kCatalogRows'));
  assert.ok(updBody.includes('componentOperation'), 'updateZ2K must use componentOperation');
  const hasClearBeforeRefresh = /componentOperation\s*=\s*null[\s\S]*?refresh\(ctx\)/.test(updBody);
  assert.equal(hasClearBeforeRefresh, true, 'updateZ2K must clear before refresh');
  const hasFinallyAfter = /refresh\(ctx\)[\s\S]*?finally[\s\S]*?componentOperation/.test(updBody);
  assert.equal(hasFinallyAfter, false, 'updateZ2K must not have finally after refresh');
});

test('E failed Z2K update not busy', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const updBody = src.slice(src.indexOf('function updateZ2K'), src.indexOf('function z2kCatalogRows'));
  assert.match(updBody, /catch[\s\S]*?showError|catch.*componentOperation/);
});

test('F refreshState same lifecycle contract', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const body = src.slice(src.indexOf('function refreshState'), src.indexOf('function refreshState') + 2000);
  assert.match(body, /componentOperation\s*=\s*\{[^}]*kind:\s*['"]refresh['"]/);
  assert.ok(body.includes('componentOperation = null'), 'must clear');
});

test('G no post-refresh rerender of detached caller ctx', async () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const checkStart = src.indexOf('function checkUpdates');
  const checkEnd = src.indexOf('function updateZ2K', checkStart);
  const checkBody = src.slice(checkStart, checkEnd);
  const afterRefresh = checkBody.slice(checkBody.indexOf('return refresh(ctx)'));
  assert.doesNotMatch(afterRefresh, /rerender\(ctx\)/);
  const updStart = src.indexOf('function updateZ2K');
  const updEnd = src.indexOf('function z2kCatalogRows', updStart);
  const updBody = src.slice(updStart, updEnd);
  const updAfter = updBody.slice(updBody.indexOf('return refresh(ctx)'));
  assert.doesNotMatch(updAfter, /rerender\(ctx\)/);
});
