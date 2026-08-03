# Responsive LuCI Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the full-page loading flashes and unnecessary backend reloads demonstrated in the router video while preserving the single-view LuCI architecture and timer cleanup guarantees.

**Architecture:** `app.js` will own a small per-tab data cache and one in-flight load promise per tab. Previously visited tabs render from cached data immediately and refresh in the background; same-tab refreshes keep the current DOM visible until fresh data is ready. Strategy candidate selection becomes a local rerender rather than a backend reload, and draft cancellation replaces document reload with an in-app refresh.

**Tech Stack:** LuCI JavaScript (`L.view`, `baseclass`), browser DOM APIs, Node.js `node:test` source-contract tests, GitHub Actions single-view gate.

## Global Constraints

- Keep exactly one root `L.view.extend()` owner in `app.js`.
- Keep all helper modules as `baseclass.extend(...)` constructors.
- Do not add a frontend framework or external assets.
- Do not change RPC names, payload contracts, ACLs, backend files, or router service behavior in this PR.
- Preserve activation-token protection against late responses.
- Preserve module `unmount()` cleanup before replacing or abandoning a mounted view.
- A cached screen may be shown as stale, but a failed refresh must not erase the last successful data.
- Full repository gate and required GitHub checks must finish with zero red tests before merge.
- Work only on `docs/video-found-ui-correctness-design`; after merge, fast-forward this branch to the new `main` before the next stage.

---

### Task 1: Add regression contracts for non-destructive navigation

**Files:**
- Modify: `tests/ui/single-view-manager.test.mjs`
- Modify: `tests/orchestra-strategy-ui.test.mjs`

**Interfaces:**
- Consumes: current `app.js` activation flow and `z2m-strategy.js` candidate selection.
- Produces: source-level gates requiring `tabDataCache`, `tabLoadPromises`, guarded initial loader use, no document reload, and local strategy selection.

- [ ] **Step 1: Add failing app navigation assertions**

Add a test that reads `app.js` and asserts all of the following:

```js
assert.match(app, /var\s+tabDataCache\s*=\s*\{\}/);
assert.match(app, /var\s+tabLoadPromises\s*=\s*\{\}/);
assert.match(app, /function\s+loadTabData\s*\(/);
assert.match(app, /function\s+renderTabData\s*\(/);
assert.match(app, /if\s*\(!cachedData\s*&&\s*!keepCurrent\)/);
assert.match(app, /Показано последнее успешное состояние/);
assert.doesNotMatch(app, /window\.location\.reload\s*\(/);
```

Also assert that a same-tab navigation path returns without calling `activate()` again:

```js
assert.match(app, /if\s*\(activeModule\s*===\s*MODULES\[tab\]\s*&&\s*activeContext\)\s*return\s+Promise\.resolve\(\)/);
```

- [ ] **Step 2: Add failing strategy selection assertions**

Add a test that reads `z2m-strategy.js` and asserts:

```js
assert.match(strategy, /function\s+renderCandidateSelection\s*\(/);
assert.match(strategy, /select\(ctx,\s*id,\s*renderCandidateSelection\)/);
assert.doesNotMatch(strategy, /function\s+select[\s\S]{0,500}ctx\.refresh\(['"]strategy['"]\)/);
```

- [ ] **Step 3: Run the focused tests and record RED**

Run through the pull-request workflow or equivalent checkout:

```sh
node --test tests/ui/single-view-manager.test.mjs tests/orchestra-strategy-ui.test.mjs
```

Expected result: failures for missing cache/load helpers, `window.location.reload()`, and selection-driven `ctx.refresh('strategy')`.

- [ ] **Step 4: Commit the regression tests**

```sh
git add tests/ui/single-view-manager.test.mjs tests/orchestra-strategy-ui.test.mjs
git commit -m "test: capture video-found navigation regressions"
```

---

### Task 2: Preserve visible content during tab refreshes

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Test: `tests/ui/single-view-manager.test.mjs`

**Interfaces:**
- Produces: `tabDataCache: Record<string, object>`, `tabLoadPromises: Record<string, Promise<object>>`, `loadTabData(tab, module)`, and `renderTabData(tab, module, data, token)`.
- Consumes: existing `MODULES`, `context()`, `activationToken`, `activeModule`, `activeContext`, and module `load/render/mount/unmount` methods.

- [ ] **Step 1: Add cache and in-flight registries**

Immediately after the current module-level lifecycle variables, add:

```js
var tabDataCache = {};
var tabLoadPromises = {};
```

- [ ] **Step 2: Add deduplicated loading**

Inside `render()`, add:

```js
function loadTabData(tab, module) {
  if (tabLoadPromises[tab]) return tabLoadPromises[tab];
  tabLoadPromises[tab] = Promise.resolve(module.load(context(tab, module))).then(function (data) {
    tabDataCache[tab] = data || {};
    return tabDataCache[tab];
  }).then(function (data) {
    delete tabLoadPromises[tab];
    return data;
  }, function (error) {
    delete tabLoadPromises[tab];
    throw error;
  });
  return tabLoadPromises[tab];
}
```

This guarantees one backend load per tab at a time and caches only successful responses.

- [ ] **Step 3: Add one render owner for loaded data**

Add `renderTabData(tab, module, data, token)` that:

1. returns when `token !== activationToken`;
2. calls the currently mounted module's `unmount(activeContext)` only when a context is actually mounted;
3. renders with `module.render(context(tab, module, data))`;
4. replaces `content` only after render succeeds;
5. assigns `activeModule`, `activeContext`, and invokes `module.mount(ctx)`.

The helper must never show the loading placeholder.

- [ ] **Step 4: Rewrite `activate(tab, force)` around stale-while-revalidate**

The flow must be:

```js
var module = MODULES[tab];
var sameTab = activeModule === module && !!activeContext;
var keepCurrent = sameTab && force === true;
var cachedData = tabDataCache[tab];
```

When switching away, unmount the previous module before rendering another tab. When `cachedData` exists and the current node is not already that tab, call `renderTabData()` immediately. Call the initial placeholder only under:

```js
if (!cachedData && !keepCurrent)
  content.replaceChildren(E('div', { 'class': 'z2m-app-placeholder' }, _('Загрузка данных…')));
```

Then call `loadTabData(tab, module)`. On success, replace the currently visible tab only if the activation token still matches. On failure:

- if cached/current content exists, keep it and call `Shell.showToast(_('Не удалось обновить данные. Показано последнее успешное состояние: ') + Api.normalizeError(error).message, 'warn')`;
- otherwise render the existing fatal `warnbar`.

- [ ] **Step 5: Prevent redundant same-tab navigation**

At the beginning of `navigateTo(tab)`, after normalizing the id, add:

```js
if (activeModule === MODULES[tab] && activeContext)
  return Promise.resolve();
```

Do not alter hash navigation for a different tab.

- [ ] **Step 6: Run focused tests**

```sh
node --test tests/ui/single-view-manager.test.mjs
```

Expected result: the new navigation regression test passes and all prior single-view contracts remain green.

- [ ] **Step 7: Commit the navigation implementation**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js tests/ui/single-view-manager.test.mjs
git commit -m "fix: preserve LuCI content during refresh"
```

---

### Task 3: Make strategy candidate selection local

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`
- Test: `tests/orchestra-strategy-ui.test.mjs`

**Interfaces:**
- Produces: `select(ctx, id, redraw)` and inner `renderCandidateSelection()`.
- Consumes: `list`, `preview`, `listHost`, `detailsHost`, `ctx.store`, and existing apply/rollback handlers.

- [ ] **Step 1: Change selection to a callback-based local mutation**

Replace the existing selector with:

```js
function select(ctx, id, redraw) {
  var snapshot = ctx.store.get();
  ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: id }) });
  setStrategyDraft(ctx, { candidateId: id });
  if (typeof redraw === 'function') redraw();
}
```

Do not call any RPC or `ctx.refresh()` from this function.

- [ ] **Step 2: Extract candidate list/details rendering**

Inside `render(ctx)`, create `renderCandidateSelection()` that:

1. recalculates `pendingStrategyId`, `selected`, and `activeItem` from current store/preview data;
2. clears `listHost` and `detailsHost`;
3. rebuilds candidate rows and details using the existing markup and handlers;
4. wires each row with `select(ctx, id, renderCandidateSelection)`;
5. keeps apply and rollback behavior unchanged.

Invoke `renderCandidateSelection()` once during the initial render.

- [ ] **Step 3: Run strategy UI tests**

```sh
node --test tests/orchestra-strategy-ui.test.mjs
```

Expected result: local-selection regression and all existing strategy UI contracts pass.

- [ ] **Step 4: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js tests/orchestra-strategy-ui.test.mjs
git commit -m "fix: update strategy selection without reload"
```

---

### Task 4: Cancel drafts without reloading the LuCI document

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Test: `tests/ui/single-view-manager.test.mjs`

**Interfaces:**
- Consumes: `store.clearAllDrafts()`, `clearConfirmation()`, `activate(tab, true)`, and `renderState()`.
- Produces: in-app cancellation that keeps the shell mounted.

- [ ] **Step 1: Replace document reload**

In the confirmation action inside `discardDrafts()`:

```js
Shell.closeModal();
store.clearAllDrafts();
var snapshot = store.get();
store.update({ pending: Object.assign({}, snapshot.pending, {
  pendingStrategyId: null,
  pendingOverride: null
}) });
renderState();
activate(store.get().ui.tab || 'overview', true);
```

Delete `window.location.reload()`.

- [ ] **Step 2: Run focused tests**

```sh
node --test tests/ui/single-view-manager.test.mjs tests/orchestra-strategy-ui.test.mjs
```

Expected result: zero failures.

- [ ] **Step 3: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js tests/ui/single-view-manager.test.mjs
git commit -m "fix: discard drafts inside the mounted app"
```

---

### Task 5: Package, full verification, PR, and automatic merge

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify only if existing release assertions require it: packaging test files that already pin the LuCI release.

**Interfaces:**
- Produces: LuCI package `0.1.0-r139` containing this stage.

- [ ] **Step 1: Bump only the LuCI package release**

Change:

```make
PKG_RELEASE:=138
```

to:

```make
PKG_RELEASE:=139
```

Update existing packaging assertions from r138 to r139. Do not bump the backend or meta-package unless their existing policy tests require it.

- [ ] **Step 2: Run full verification**

```sh
chmod +x tools/run-all-tests.sh
tools/run-all-tests.sh
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js
git diff --check
```

Expected result: every suite reports zero red tests; the green total may exceed 1036 because new regressions were added.

- [ ] **Step 3: Review the final diff**

Confirm that the diff contains only the design/plan documents, frontend source, focused tests, and LuCI release assertions. Confirm there are no secrets, router addresses, generated `etc/`, `usr/`, or `www/` trees.

- [ ] **Step 4: Open or update the PR from the single working branch**

Use title:

```text
fix: keep LuCI views responsive during refresh
```

Document the video symptoms, RED evidence, zero-red full gate, and that no RPC/backend contract changed.

- [ ] **Step 5: Wait for the exact head checks**

Require completed success for the single-view workflow, no unresolved review threads, no requested changes, and `mergeable=true`. If `main` moved, update the same branch without force-push and rerun all checks.

- [ ] **Step 6: Merge automatically**

Merge with a merge commit and `expected_head_sha` equal to the verified branch head. After merge, verify the PR state and merge commit, then move `docs/video-found-ui-correctness-design` forward to the new `main` without creating another branch.
