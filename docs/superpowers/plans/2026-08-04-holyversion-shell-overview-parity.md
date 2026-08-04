# Holyversion Shell and Overview Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first independently usable `holyversion.html` parity slice: the shared visual shell, honest loading states, global simple/advanced presentation, and an Overview page that matches the reference structure while rendering only real backend evidence.

**Architecture:** Keep the existing single-root LuCI application and module lifecycle. Add one small pure `z2m-overview-model.js` module that translates current RPC envelopes into an honest view model, add reusable segmented-control and skeleton primitives to `z2m-shell.js`, then rebuild `z2m-overview.js` around the reference hero/advice layout without changing RPC names or mutation contracts. The existing stale-while-revalidate cache remains authoritative; this slice changes only its first-load presentation and refresh indicator.

**Tech Stack:** LuCI JavaScript (`L.view`, `baseclass`, `E()` DOM builder), local CSS, current `z2m-api.js` RPC facade, Node.js `node:test`, `tools/luci-module-smoke.mjs`, `tools/run-all-tests.sh`, GitHub Actions.

## Global Constraints

- `holyversion.html` is the canonical UI/UX reference for structure, spacing, labels, states, and responsive behavior.
- Every operational value must come from the existing backend responses; missing values render as `Нет данных`, `Не проверялось`, `Состояние неизвестно`, or `Backend не сообщил показатель`.
- Never hard-code prototype values such as `Flowseal ALT11`, `57/61`, `312 мс`, static timestamps, router addresses, or package versions.
- Keep exactly one root `L.view.extend()` in `app.js`; helper modules remain `baseclass.extend(...)`.
- Do not embed `holyversion.html` or copy its simulated JavaScript runtime into production.
- Do not change RPC names, positional `edit` transport, payloads, ACLs, ucode, shell backend, or router service behavior in this slice.
- Keep the current per-tab cache, in-flight request deduplication, activation-token protection, and old-module `unmount()` ordering.
- A process being alive may render `Служба запущена`; it may render `Обход работает` only when the backend supplies explicit positive health/connectivity evidence.
- A rollback control is enabled only when the backend supplies explicit rollback/snapshot availability; active strategy presence alone is insufficient.
- The 60-second automatic rollback UI must not be introduced.
- The global draft/apply redesign is outside this slice; preserve the current draft behavior until its dedicated vertical plan.
- Keep CSS and assets local; no `@import`, external URL, frontend framework, or new runtime dependency.
- Work only on `feat/holyversion-reference-parity`; do not create another feature branch and do not force-push.
- Full repository gate and exact-head GitHub Actions must finish with zero red tests before merge.
- Router acceptance remains `PARTIAL`; source and CI success do not prove installation or connectivity on the real router.

---

## File Structure

### Create

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
  - Pure normalization and formatting helpers for runtime health, applied strategy, latest completed run, corpus metrics, rollback availability, and actionable Overview advice.
- `tests/ui/holyversion-overview-model.test.mjs`
  - Behavioral tests for honest normalization and no fabricated success.
- `tests/ui/holyversion-shell-overview-parity.test.mjs`
  - Source and render contracts for the reference shell, Overview structure, real-data copy, and responsive classes.

### Modify

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
  - Conditional real version badge, skeleton first load, background-refresh state, and unchanged cache/lifecycle guarantees.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
  - Reusable segmented control and layout-preserving loading state.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
  - Reference-equivalent Overview composition using the pure model and existing RPC/actions.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
  - Reference visual tokens and shared shell/hero/skeleton styles.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
  - Overview-specific component and responsive rules.
- `tests/ui/render-harness.test.mjs`
  - Realistic Overview fixture and structural DOM assertions.
- `tests/ui/single-view-overview-strategy.test.mjs`
  - Updated Overview source contracts for the model and explicit health/rollback rules.
- `tests/ui/manager-cosmetic-redesign.test.mjs`
  - New reference-critical class assertions and local-asset checks.
- `tests/packaging.test.mjs`
  - Require the new shipped model and LuCI release.
- `luci-app-zapret2-manager/Makefile`
  - Bump only the LuCI package release from `r141` to `r142`.

---

### Task 1: Add RED contracts for honest Overview data

**Files:**
- Create: `tests/ui/holyversion-overview-model.test.mjs`
- Modify: `tests/ui/single-view-overview-strategy.test.mjs`

**Interfaces:**
- Consumes: `tools/luci-module-smoke.mjs::evaluateLuciModule(path)`.
- Produces test requirements for `z2m-overview-model.js` exports:
  - `normalize(data: object): OverviewViewModel`
  - `runtimeHealth(status: object): { label: string, detail: string, kind: string, verified: boolean }`
  - `latestCompletedRun(history: object): object|null`
  - `corpusMetrics(run: object|null): CorpusMetrics`
  - `rollbackInfo(preview: object, status: object): { available: boolean, snapshotId: string|null, label: string|null }`

- [ ] **Step 1: Create the failing pure-model test file**

Create `tests/ui/holyversion-overview-model.test.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-overview-model.js`);

test('missing evidence stays unavailable instead of becoming a fake success', () => {
  const view = model.normalize({});
  assert.equal(view.health.verified, false);
  assert.equal(view.health.kind, 'o');
  assert.equal(view.strategy.name, null);
  assert.equal(view.corpus.opened, null);
  assert.equal(view.corpus.total, null);
  assert.equal(view.corpus.medianLatencyMs, null);
  assert.deepEqual(view.corpus.failedDomains, []);
  assert.equal(view.rollback.available, false);
});

test('a running process without explicit connectivity is only running, not healthy', () => {
  const health = model.runtimeHealth({
    serviceState: 'running',
    runtime: { process: { found: true } }
  });
  assert.deepEqual(health, {
    label: 'Служба запущена',
    detail: 'Связность ещё не подтверждена backend',
    kind: 'o',
    verified: false
  });
});

test('explicit backend verification may produce a healthy bypass verdict', () => {
  const health = model.runtimeHealth({
    serviceState: 'running',
    runtime: { process: { found: true }, connectivity: { verified: true } }
  });
  assert.equal(health.label, 'Обход работает');
  assert.equal(health.kind, 'g');
  assert.equal(health.verified, true);
});

test('latest completed corpus run ignores active, stale and missing-run snapshots', () => {
  const completed = { runId: 'done-2', phase: 'completed', targetType: 'corpus', completedAt: '2026-08-04T09:00:00Z' };
  const selected = model.latestCompletedRun({ runs: [
    { runId: 'active', phase: 'testing', startedAt: '2026-08-04T10:00:00Z' },
    { runId: 'stale', phase: 'stale', completedAt: '2026-08-04T09:30:00Z' },
    completed,
    { runId: 'old', phase: 'completed', targetType: 'corpus', completedAt: '2026-08-03T09:00:00Z' }
  ] });
  assert.deepEqual(selected, completed);
});

test('corpus metrics use only explicit winner evidence', () => {
  const metrics = model.corpusMetrics({
    phase: 'completed',
    targetType: 'corpus',
    targetCount: 61,
    selectedWinner: {
      successCount: 57,
      medianLatencyMs: 312,
      failedDomains: ['gog.com', 'ok.ru']
    }
  });
  assert.deepEqual(metrics, {
    opened: 57,
    total: 61,
    medianLatencyMs: 312,
    failedDomains: ['gog.com', 'ok.ru'],
    percent: 93
  });
});

test('rollback is unavailable unless backend exposes an identifiable snapshot', () => {
  assert.equal(model.rollbackInfo({ strategyState: { active: { candidateId: 'x' } } }, {}).available, false);
  assert.deepEqual(model.rollbackInfo({
    strategyState: {
      rollback: { available: true, snapshotId: 'snap-12', label: 'rev12' }
    }
  }, {}), {
    available: true,
    snapshotId: 'snap-12',
    label: 'rev12'
  });
});
```

- [ ] **Step 2: Tighten the existing Overview source contract**

In `tests/ui/single-view-overview-strategy.test.mjs`, extend the Overview test with:

```js
assert.match(src, /z2m-overview-model as OverviewModel/);
assert.match(src, /OverviewModel\.normalize\(data\)/);
assert.match(src, /Простой/);
assert.match(src, /Расширенный/);
assert.match(src, /Как это работает/);
assert.match(src, /Отчёт проверки/);
assert.match(src, /Что стоит сделать/);
assert.match(src, /z2m-hero/);
assert.doesNotMatch(src, /Flowseal ALT11|57\s*\/\s*61|312\s*мс/);
assert.doesNotMatch(src, /rollback\(\)[\s\S]{0,250}!active/);
```

Keep all current lifecycle, real RPC, advanced-mode, and override assertions.

- [ ] **Step 3: Run the new focused tests and capture RED**

Run:

```sh
node --test \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
```

Expected result: RED because `z2m-overview-model.js` does not exist and `z2m-overview.js` does not yet consume it or render the reference hero/advice structure.

- [ ] **Step 4: Commit the RED tests**

```sh
git add \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
git commit -m "test: define honest holyversion overview contracts"
```

---

### Task 2: Implement the pure Overview data model

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
- Test: `tests/ui/holyversion-overview-model.test.mjs`

**Interfaces:**
- Consumes the existing settled envelopes produced by `z2m-overview.js::load()`:
  - `data.status.value`
  - `data.preview.value`
  - `data.history.value`
  - `data.orchestra.value`
  - `data.serviceDns.value`
- Produces:

```text
OverviewViewModel = {
  health: { label, detail, kind, verified },
  strategy: { id, name, description, source, appliedAt, argv, revision },
  corpus: { opened, total, medianLatencyMs, failedDomains, percent },
  lastRun: object|null,
  activeRun: object|null,
  serviceDnsCount: number|null,
  enabledRuleCount: number,
  rollback: { available, snapshotId, label },
  errors: Array<{ code, message }>,
  advice: Array<{ kind, title, detail, action }>
}
```

- [ ] **Step 1: Create the module and compatibility helpers**

Start the file with:

```js
'use strict';
'require baseclass';

var COMPLETED_PHASES = ['completed', 'applied'];
var ACTIVE_PHASES = ['queued', 'pending', 'running', 'testing', 'scanning', 'applying', 'verifying'];

function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function finite(value) {
  var number = Number(value);
  return isFinite(number) ? number : null;
}
function firstDefined(values) {
  for (var i = 0; i < values.length; i++)
    if (values[i] != null && values[i] !== '') return values[i];
  return null;
}
function timestamp(run) {
  var value = firstDefined([run.completedAt, run.finishedAt, run.updatedAt, run.startedAt]);
  var parsed = value ? Date.parse(value) : NaN;
  return isFinite(parsed) ? parsed : 0;
}
```

Do not use optional chaining, nullish coalescing, or browser-only APIs in this pure module.

- [ ] **Step 2: Implement explicit runtime health classification**

Add:

```js
function runtimeHealth(status) {
  status = object(status);
  var runtime = object(status.runtime);
  var process = object(runtime.process);
  var connectivity = object(runtime.connectivity);
  var explicit = object(status.health);
  var state = firstDefined([status.serviceState, status.state]);
  var verified = connectivity.verified === true ||
    explicit.status === 'healthy' || explicit.verified === true ||
    status.bypassVerified === true;

  if (state === 'stopped')
    return { label: 'Обход остановлен', detail: 'Служба zapret2 остановлена', kind: 'r', verified: false };
  if (verified)
    return { label: 'Обход работает', detail: 'Backend подтвердил runtime и связность', kind: 'g', verified: true };
  if (state === 'running' || process.found === true)
    return { label: 'Служба запущена', detail: 'Связность ещё не подтверждена backend', kind: 'o', verified: false };
  return { label: 'Состояние неизвестно', detail: 'Backend не сообщил достаточных runtime-данных', kind: 'o', verified: false };
}
```

The strings are deliberate product copy and must stay identical to the tests.

- [ ] **Step 3: Implement completed-run and corpus extraction**

Add:

```js
function latestCompletedRun(history) {
  var runs = asArray(object(history).runs).filter(function (run) {
    return COMPLETED_PHASES.indexOf(String(object(run).phase || '')) >= 0 &&
      object(run).targetType === 'corpus';
  });
  runs.sort(function (a, b) { return timestamp(b) - timestamp(a); });
  return runs[0] || null;
}

function activeRun(orchestra, history) {
  var direct = object(orchestra).run || object(orchestra).activeRun;
  if (direct && ACTIVE_PHASES.indexOf(String(direct.phase || '')) >= 0) return direct;
  var runs = asArray(object(history).runs);
  for (var i = 0; i < runs.length; i++)
    if (ACTIVE_PHASES.indexOf(String(object(runs[i]).phase || '')) >= 0) return runs[i];
  return null;
}

function corpusMetrics(run) {
  run = object(run);
  var winner = object(run.selectedWinner || object(run.canonical).winner);
  var total = finite(firstDefined([run.targetCount, run.totalTargets, asArray(run.targets).length || null]));
  var opened = finite(firstDefined([
    winner.successCount, winner.openedCount, winner.passedDomains,
    run.successCount, run.openedCount
  ]));
  var latency = finite(firstDefined([winner.medianLatencyMs, winner.latencyMs]));
  var failed = asArray(winner.failedDomains).length
    ? asArray(winner.failedDomains)
    : asArray(run.failedDomains);
  var percent = opened != null && total != null && total > 0
    ? Math.round(opened / total * 100)
    : null;
  return {
    opened: opened,
    total: total,
    medianLatencyMs: latency,
    failedDomains: failed.map(String),
    percent: percent
  };
}
```

Do not derive opened count as `total - failures`; absent success evidence remains `null`.

- [ ] **Step 4: Implement strategy and rollback normalization**

Add:

```js
function strategyInfo(preview) {
  preview = object(preview);
  var state = object(preview.strategyState);
  var active = object(state.active || preview.active);
  var id = firstDefined([active.candidateId, active.managerId, active.id]);
  return {
    id: id,
    name: firstDefined([active.name, active.displayName]),
    description: firstDefined([active.description, active.summary]),
    source: firstDefined([active.source, state.source, preview.source]),
    appliedAt: firstDefined([active.appliedAt, state.appliedAt]),
    argv: firstDefined([active.argv, active.options, active.opt]),
    revision: firstDefined([active.revision, state.revision, preview.revision])
  };
}

function rollbackInfo(preview, status) {
  var state = object(object(preview).strategyState);
  var candidate = object(state.rollback || object(preview).rollback || object(status).rollback);
  var snapshotId = firstDefined([candidate.snapshotId, candidate.id, candidate.revision]);
  var available = candidate.available === true && snapshotId != null;
  return {
    available: available,
    snapshotId: available ? String(snapshotId) : null,
    label: available ? firstDefined([candidate.label, candidate.name, candidate.revision]) : null
  };
}
```

- [ ] **Step 5: Implement recommendations and the top-level normalizer**

Add:

```js
function adviceFor(view) {
  var advice = [];
  if (!view.strategy.id)
    advice.push({ kind: 'o', title: 'Активная стратегия не определена', detail: 'Откройте раздел «Стратегия» и выполните реальную проверку.', action: 'strategy' });
  if (!view.lastRun)
    advice.push({ kind: 'o', title: 'Корпус из 61 домена ещё не проверялся', detail: 'Без завершённого corpus-run нельзя сравнить доступность и задержку.', action: 'strategy' });
  else if (view.corpus.failedDomains.length)
    advice.push({ kind: 'o', title: 'Есть домены, которые не открылись', detail: view.corpus.failedDomains.length + ' доменов требуют разбора.', action: 'report' });
  if (view.errors.length)
    advice.push({ kind: 'r', title: 'Часть данных недоступна', detail: view.errors.map(function (error) { return error.message; }).join(' · '), action: 'refresh' });
  if (!advice.length)
    advice.push({ kind: 'g', title: 'Критичных рекомендаций нет', detail: 'Последние доступные backend-данные не содержат явных проблем.', action: null });
  return advice;
}

function normalize(data) {
  data = object(data);
  var status = object(object(data.status).value);
  var preview = object(object(data.preview).value);
  var history = object(object(data.history).value);
  var orchestra = object(object(data.orchestra).value);
  var serviceDns = object(object(data.serviceDns).value);
  var lastRun = latestCompletedRun(history);
  var rules = asArray(object(preview.overrides).rules);
  var errors = [];
  Object.keys(data).forEach(function (key) {
    var error = object(data[key]).error;
    if (error) errors.push({ code: error.code || 'EUNAVAILABLE', message: error.message || String(error) });
  });
  var view = {
    health: runtimeHealth(status),
    strategy: strategyInfo(preview),
    corpus: corpusMetrics(lastRun),
    lastRun: lastRun,
    activeRun: activeRun(orchestra, history),
    serviceDnsCount: finite(firstDefined([serviceDns.activeCount, serviceDns.enabledCount])),
    enabledRuleCount: rules.filter(function (rule) { return object(rule).enabled !== false; }).length,
    rollback: rollbackInfo(preview, status),
    errors: errors,
    advice: []
  };
  view.advice = adviceFor(view);
  return view;
}

return baseclass.extend({
  normalize: normalize,
  runtimeHealth: runtimeHealth,
  latestCompletedRun: latestCompletedRun,
  corpusMetrics: corpusMetrics,
  rollbackInfo: rollbackInfo
});
```

- [ ] **Step 6: Run the model tests**

Run:

```sh
node --test tests/ui/holyversion-overview-model.test.mjs
```

Expected result: all model tests PASS.

- [ ] **Step 7: Commit the pure model**

```sh
git add \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js \
  tests/ui/holyversion-overview-model.test.mjs
git commit -m "feat: normalize honest overview evidence"
```

---

### Task 3: Add reference shell primitives and honest loading behavior

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Create: `tests/ui/holyversion-shell-overview-parity.test.mjs`
- Test: `tests/ui/video-navigation-regressions.test.mjs`

**Interfaces:**
- Produces from `z2m-shell.js`:
  - `segmented(items, activeId, onSelect, attrs): Element`
  - `renderLoadingState(label): Element`
- Produces in `app.js`:
  - `detectedVersion(initial): string|null`
  - `setContentBusy(busy: boolean): void`
- Consumes existing `tabDataCache`, `tabLoadPromises`, `activationToken`, `renderTabData()`, and `loadTabData()`.

- [ ] **Step 1: Create RED shell/app contracts**

Create `tests/ui/holyversion-shell-overview-parity.test.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

test('shell exports a segmented control and a layout-preserving loading state', () => {
  const shell = evaluateLuciModule(`${root}/z2m-shell.js`);
  assert.equal(typeof shell.segmented, 'function');
  assert.equal(typeof shell.renderLoadingState, 'function');
  assert.match(source('z2m-shell.js'), /z2m-seg/);
  assert.match(source('z2m-shell.js'), /z2m-skeleton/);
});

test('app never presents a hard-coded package version as runtime truth', () => {
  const app = source('app.js');
  assert.match(app, /function\s+detectedVersion\s*\(/);
  assert.match(app, /managerVersion|packageVersion/);
  assert.doesNotMatch(app, /E\(['"]span['"],\s*\{\s*['"]class['"]:\s*['"]ver['"]\s*\},\s*['"]v0\.1\.0['"]\)/);
});

test('initial navigation uses a skeleton and cached refreshes remain non-destructive', () => {
  const app = source('app.js');
  assert.match(app, /Shell\.renderLoadingState\(TAB_LABELS\[tab\]\)/);
  assert.match(app, /setContentBusy\(true\)/);
  assert.match(app, /setContentBusy\(false\)/);
  assert.match(app, /z2m-refreshing/);
  assert.doesNotMatch(app, /z2m-app-placeholder[^\n]+Загрузка данных/);
});
```

- [ ] **Step 2: Run the shell test and capture RED**

Run:

```sh
node --test tests/ui/holyversion-shell-overview-parity.test.mjs
```

Expected result: RED for missing shell exports, hard-coded `v0.1.0`, and the old text-only placeholder.

- [ ] **Step 3: Add `segmented()` to `z2m-shell.js`**

Insert after `chip()`:

```js
function segmented(items, activeId, onSelect, attrs) {
  var host = E('div', Object.assign({ 'class': 'z2m-seg', role: 'group' }, attrs || {}));
  (items || []).forEach(function (item) {
    var selected = item.id === activeId;
    host.appendChild(button(item.label, selected ? 'on' : '', function () {
      if (typeof onSelect === 'function') onSelect(item.id);
    }, item.disabled === true, {
      'data-segment': item.id,
      'aria-pressed': selected ? 'true' : 'false'
    }));
  });
  return host;
}
```

The CSS will neutralize the normal `.z2m-btn` frame inside `.z2m-seg`.

- [ ] **Step 4: Add `renderLoadingState()` to `z2m-shell.js`**

Insert:

```js
function renderLoadingState(label) {
  return E('section', {
    'class': 'z2m-view on z2m-loading-view',
    'aria-live': 'polite'
  }, [
    E('div', { 'class': 'z2m-phead z2m-skeleton-head' }, [
      E('div', {}, [
        E('div', { 'class': 'z2m-skeleton line title' }),
        E('div', { 'class': 'z2m-skeleton line subtitle' })
      ]),
      E('span', { 'class': 'z2m-dim' }, _('Загрузка: ') + label)
    ]),
    E('div', { 'class': 'z2m-panel z2m-skeleton-panel' }, [
      E('div', { 'class': 'hd' }, E('div', { 'class': 'z2m-skeleton line heading' })),
      E('div', { 'class': 'bd z2m-skeleton-grid' }, [
        E('div', { 'class': 'z2m-skeleton block' }),
        E('div', { 'class': 'z2m-skeleton block' })
      ])
    ])
  ]);
}
```

Export both new functions in the final `baseclass.extend()` object:

```js
segmented: segmented,
renderLoadingState: renderLoadingState,
```

- [ ] **Step 5: Replace the hard-coded header version in `app.js`**

Add near `statusState()`:

```js
function detectedVersion(initial) {
  var meta = initial && initial.meta || {};
  var value = meta.managerVersion || meta.packageVersion || initial && initial.packageVersion;
  return value == null || value === '' ? null : String(value);
}
```

Build the brand children before `appRoot`:

```js
var version = detectedVersion(initial);
var brand = [
  E('span', { 'class': 'mark', 'aria-hidden': 'true' }, 'z2'),
  E('span', { 'class': 'nm' }, ['zapret2', E('span', { 'class': 'mgr' }, '·manager')])
];
if (version) brand.push(E('span', { 'class': 'ver' }, version));
```

Use `brand` inside `z2m-brand`. Delete the literal `v0.1.0` node. Do not fall back to the Makefile release in browser code.

- [ ] **Step 6: Add a non-destructive content busy state**

Inside `render()` after `content` is created, add:

```js
function setContentBusy(busy) {
  content.classList.toggle('z2m-refreshing', busy === true);
  content.setAttribute('aria-busy', busy === true ? 'true' : 'false');
}
```

In `activate(tab, force)`:

1. call `setContentBusy(true)` immediately before `loadTabData(tab, module)`;
2. replace the first-load placeholder with:

```js
if (!cachedData && !keepCurrent) {
  if (activeModule && activeContext && activeModule.unmount)
    activeModule.unmount(activeContext);
  activeModule = module;
  activeContext = null;
  content.replaceChildren(Shell.renderLoadingState(TAB_LABELS[tab]));
}
```

3. in both the success and failure handlers, call `setContentBusy(false)` only after verifying `token === activationToken`;
4. keep the existing cached content and warning toast on refresh failure;
5. do not remove `tabDataCache`, `tabLoadPromises`, or activation-token checks.

- [ ] **Step 7: Run the shell and navigation tests**

Run:

```sh
node --test \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/video-navigation-regressions.test.mjs
```

Expected result: both files PASS; cached navigation lifecycle assertions remain unchanged.

- [ ] **Step 8: Commit the shell/loading slice**

```sh
git add \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/video-navigation-regressions.test.mjs
git commit -m "feat: add holyversion shell loading states"
```

---

### Task 4: Recompose Overview to the reference structure

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- Test: `tests/ui/single-view-overview-strategy.test.mjs`
- Test: `tests/ui/holyversion-shell-overview-parity.test.mjs`

**Interfaces:**
- Consumes:
  - `OverviewModel.normalize(ctx.data)`
  - `shell.segmented(...)`
  - existing APIs `service.start/stop`, `orchestra.runStart/runStatus`, `strategy.apply/rollback`
  - existing store `ui.advanced`, strategy/override draft, and navigation methods.
- Produces a root containing:
  - `.z2m-overview-head`
  - `.z2m-overview-status`
  - `.z2m-hero`
  - `.z2m-hero-left`
  - `.z2m-hero-right`
  - `.z2m-overview-failures`
  - `.z2m-advice`

- [ ] **Step 1: Import and normalize through the model**

At the top of `z2m-overview.js`, add:

```js
'require view.zapret2-manager.z2m-overview-model as OverviewModel';
```

At the start of `render(ctx)`, replace local status/run metric derivation with:

```js
var view = OverviewModel.normalize(ctx.data || {});
var status = ctx.data.status && ctx.data.status.value || {};
var preview = ctx.data.preview && ctx.data.preview.value || {};
var rules = preview.overrides ? asArray(preview.overrides.rules) : [];
```

Keep raw `status`, `preview`, `catalog`, and `rules` only for existing actions and form choices. All displayed summary health, strategy, corpus, rollback, and advice values come from `view`.

- [ ] **Step 2: Replace the checkbox label with the reference segmented mode control**

Create:

```js
function setAdvanced(mode) {
  var current = ctx.store.get();
  ctx.store.update({ ui: Object.assign({}, current.ui, { advanced: mode === 'advanced' }) });
}
var modeControl = shell.segmented([
  { id: 'simple', label: _('Простой') },
  { id: 'advanced', label: _('Расширенный') }
], advanced ? 'advanced' : 'simple', setAdvanced, {
  id: 'z2m-overview-mode',
  'aria-label': _('Режим интерфейса')
});
```

Remove the visible checkbox. The hidden shared state remains `store.ui.advanced`; `app.js` continues toggling the root `.adv` class.

- [ ] **Step 3: Add the static help modal**

Add:

```js
function openHelp() {
  shell.openModal(_('Как это работает'), E('div', {}, [
    E('p', {}, _('Менеджер показывает отдельно применённую конфигурацию, черновик, активную проверку и последний завершённый результат.')),
    E('p', {}, _('Зелёный статус появляется только при положительном подтверждении backend. Если доказательств недостаточно, интерфейс показывает неизвестное или непроверенное состояние.')),
    E('p', {}, _('Расширенный режим раскрывает технические идентификаторы, argv и служебные сведения.'))
  ]));
}
```

This explanatory text is product documentation, not simulated runtime data.

- [ ] **Step 4: Add honest display helpers**

Inside the module, use:

```js
function valueOrDash(value) { return value == null || value === '' ? '—' : String(value); }
function metricValue(value, suffix) {
  if (value == null) return '—';
  return suffix ? [String(value), E('span', { 'class': 'z2m-dim z2m-metric-unit' }, suffix)] : String(value);
}
function formatAppliedAt(value) {
  if (!value) return _('время применения неизвестно');
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
```

Do not default any metric to zero.

- [ ] **Step 5: Build the status header and hero left column**

Replace `statusPanel` with a custom panel:

```js
var heroLeft = E('div', { 'class': 'z2m-hero-left' }, [
  E('div', { 'class': 'z2m-kick' }, _('активная стратегия')),
  E('h3', {}, view.strategy.name || _('Не определена')),
  E('div', { 'class': 'z2m-strategy-description' },
    view.strategy.description || _('Backend не сообщил описание активной стратегии.')),
  E('div', { 'class': 'z2m-dim z2m-strategy-meta' }, [
    _('источник: '), valueOrDash(view.strategy.source),
    ' · ', formatAppliedAt(view.strategy.appliedAt),
    ' · ', _('ревизия: '), valueOrDash(view.strategy.revision)
  ]),
  view.strategy.argv
    ? E('div', { 'class': 'z2m-mono z2m-dim z2m-adv-only z2m-overview-argv' }, view.strategy.argv)
    : null,
  E('div', { 'class': 'z2m-btnrow z2m-hero-actions' }, [
    shell.button(_('Подобрать лучшую стратегию'), 'primary', function () { ctx.navigate('strategy'); }),
    shell.button(_('Все стратегии'), '', function () { ctx.navigate('strategy'); }),
    view.rollback.available
      ? shell.button(_('Вернуться к предыдущей'), '', function () {
          ctx.api.strategy.rollback().then(reload).catch(showError);
        })
      : null
  ])
]);
```

Do not render a disabled rollback button when no snapshot exists; omit it entirely.

- [ ] **Step 6: Build the corpus hero right column**

Create:

```js
var openedText = view.corpus.opened == null || view.corpus.total == null
  ? '—'
  : view.corpus.opened + ' / ' + view.corpus.total;
var latencyText = view.corpus.medianLatencyMs == null ? '—' : view.corpus.medianLatencyMs;
var progress = view.corpus.percent == null ? 0 : Math.max(0, Math.min(100, view.corpus.percent));
var failureNodes = view.corpus.failedDomains.length
  ? view.corpus.failedDomains.map(function (domain) { return shell.chip(domain, 'r'); })
  : [E('span', { 'class': 'z2m-dim' }, view.lastRun ? _('Неоткрывшиеся домены не зарегистрированы.') : _('Последняя corpus-проверка ещё не выполнялась.'))];

var heroRight = E('div', { 'class': 'z2m-hero-right' }, [
  E('div', { 'class': 'z2m-kpis z2m-overview-kpis' }, [
    E('div', { 'class': 'z2m-kpi z2m-acc' }, [
      E('div', { 'class': 'v' }, openedText),
      E('div', { 'class': 'l' }, _('доменов открываются'))
    ]),
    E('div', { 'class': 'z2m-kpi' }, [
      E('div', { 'class': 'v' }, metricValue(latencyText === '—' ? null : latencyText, _(' мс'))),
      E('div', { 'class': 'l' }, _('медианная задержка'))
    ])
  ]),
  E('div', { 'class': 'z2m-bar z2m-overview-progress', 'aria-label': _('Результат последней проверки') },
    E('i', { 'class': view.corpus.percent == null ? 'o' : 'g', style: 'width:' + progress + '%' })),
  E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('не открылись при последней проверке')),
  E('div', { 'class': 'z2m-overview-failures' }, failureNodes),
  E('div', { 'class': 'z2m-btnrow z2m-report-actions' }, [
    shell.button(_('Отчёт проверки'), 'sm', openReport, !view.lastRun),
    shell.button(_('Диагностика'), 'sm', function () { ctx.navigate('monitor'); })
  ])
]);
```

`openReport()` must render only fields present in `view.lastRun` and `view.corpus`; it must not synthesize candidate rows or domain results.

- [ ] **Step 7: Build the status panel around the hero**

Create:

```js
var statusPanel = E('section', { 'class': 'z2m-panel z2m-overview-status' }, [
  E('div', { 'class': 'hd' }, [
    E('span', { 'class': 'z2m-dot ' + view.health.kind }),
    E('h2', {}, view.health.label),
    E('span', { 'class': 'sub' }, view.health.detail),
    E('div', { 'class': 'sp' }, [
      shell.button(running ? _('Перезапустить') : _('Запустить'), 'sm', running
        ? function () { ctx.api.service.restart().then(reload).catch(showError); }
        : serviceAction),
      running ? shell.button(_('Остановить'), 'danger sm', serviceAction) : null
    ])
  ]),
  E('div', { 'class': 'bd z2m-hero' }, [heroLeft, heroRight])
]);
```

If `service.restart` is not declared in `z2m-api.js`, keep the existing stop/start action instead of adding a new RPC. The implementation must inspect `z2m-api.js` before choosing; it must not invent a method.

- [ ] **Step 8: Add the reference page head**

Use:

```js
var pageHead = E('div', { 'class': 'z2m-phead z2m-overview-head' }, [
  E('div', {}, [
    E('h1', {}, _('Обзор')),
    E('p', {}, _('Состояние обхода блокировок на этом роутере'))
  ]),
  E('div', { 'class': 'sp' }, [
    modeControl,
    shell.button(_('Как это работает'), 'sm', openHelp)
  ])
]);
```

- [ ] **Step 9: Preserve resource checking and point-rule behavior**

Keep the current real RPC sequence for `orchestra.runStart/runStatus`, input validation, strategy catalog, draft staging, and timer cleanup.

Make only these presentation changes:

- resource panel subtitle stays `домен, URL или IP`;
- explanatory copy stays `Проверяет реальные стратегии и не меняет текущую конфигурацию.`;
- invalid input remains blocked before RPC;
- active polling is labelled separately from the last corpus run;
- no completed corpus KPI is updated from the one-resource run;
- point-rule technical IDs receive `.z2m-adv-only` where a human name is available.

Do not migrate the point-rule apply path in this task; the unified apply plan owns that behavior.

- [ ] **Step 10: Add the advice panel**

Map `view.advice` into:

```js
function adviceAction(item) {
  if (item.action === 'strategy') return function () { ctx.navigate('strategy'); };
  if (item.action === 'report') return openReport;
  if (item.action === 'refresh') return reload;
  return null;
}

var advicePanel = shell.panel(
  _('Что стоит сделать'),
  E('div', { 'class': 'z2m-advice' }, view.advice.map(function (item) {
    var handler = adviceAction(item);
    return E('div', { 'class': 'z2m-advice-row' }, [
      E('span', { 'class': 'z2m-dot ' + item.kind }),
      E('div', { 'class': 'z2m-advice-copy' }, [
        E('div', { 'class': 'tt' }, item.title),
        E('div', { 'class': 'dd' }, item.detail)
      ]),
      handler ? E('div', { 'class': 'sp' }, shell.button(_('Открыть'), 'sm', handler)) : null
    ]);
  })),
  _('по реальным данным последней проверки и runtime')
);
```

- [ ] **Step 11: Return the final reference-equivalent composition**

The final root children must be:

```js
return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
  pageHead,
  warnings,
  statusPanel,
  E('div', { 'class': 'z2m-row3' }, [resourcePanel, rulesPanel]),
  advicePanel
]);
```

Warnings remain based on real settled RPC errors.

- [ ] **Step 12: Run focused Overview tests**

Run:

```sh
node --test \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
```

Expected result: all tests PASS.

- [ ] **Step 13: Commit the Overview composition**

```sh
git add \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js \
  tests/ui/single-view-overview-strategy.test.mjs \
  tests/ui/holyversion-shell-overview-parity.test.mjs
git commit -m "feat: match holyversion overview with real data"
```

---

### Task 5: Implement visual and responsive parity for the first slice

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`
- Modify: `tests/ui/holyversion-shell-overview-parity.test.mjs`

**Interfaces:**
- Consumes the classes produced by Tasks 3–4.
- Produces reference-equivalent desktop, tablet, mobile, reduced-motion, and refresh states without external assets.

- [ ] **Step 1: Add RED CSS class contracts**

Extend `tests/ui/holyversion-shell-overview-parity.test.mjs`:

```js
const css = source('z2m-ui.css') + '\n' + source('z2m-components.css');
for (const cls of [
  '.z2m-seg', '.z2m-skeleton', '.z2m-refreshing', '.z2m-hero',
  '.z2m-hero-left', '.z2m-hero-right', '.z2m-overview-failures',
  '.z2m-advice', '.z2m-advice-row'
]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
assert.match(css, /@media\s*\(max-width:900px\)/);
assert.match(css, /@media\s*\(max-width:560px\)/);
assert.match(css, /prefers-reduced-motion/);
assert.doesNotMatch(css, /@import|https?:\/\//);
```

Extend `tests/ui/manager-cosmetic-redesign.test.mjs` to require the same critical shell/hero classes while retaining every existing local-asset assertion.

- [ ] **Step 2: Run the CSS contracts and capture RED**

Run:

```sh
node --test \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected result: RED for missing segment, skeleton, hero, advice, and refresh classes.

- [ ] **Step 3: Align shared geometry in `z2m-ui.css`**

Update existing values to the approved reference layer:

```css
.z2m-wrap{max-width:1180px;margin:0 auto;padding:16px 20px 130px}
.z2m-panel{background:#1e2023;border:1px solid var(--border);border-radius:8px;margin-bottom:14px}
.z2m-panel>.hd{padding:13px 18px}
.z2m-panel>.bd{padding:18px}
.z2m-btn{border-radius:6px}
.z2m-tabs{gap:4px;margin-bottom:20px}
.z2m-tabs button{padding:10px 14px;font-size:13.5px}
.z2m-phead h1{font-size:26px;letter-spacing:-.4px}
.z2m-bar{height:6px;border-radius:4px}
```

Do not change the approved color tokens or remove existing generic component rules used by other pages.

- [ ] **Step 4: Add the segmented-control rules**

Add:

```css
.z2m-seg{display:inline-flex;background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:2px;gap:2px}
.z2m-seg .z2m-btn{background:none;border:0;color:var(--tx3);font-size:12.5px;padding:5px 11px;min-height:0;border-radius:5px;box-shadow:none}
.z2m-seg .z2m-btn:hover{color:var(--tx);background:rgba(255,255,255,.03)}
.z2m-seg .z2m-btn.on{background:var(--raised);color:var(--tx);box-shadow:0 1px 2px rgba(0,0,0,.35)}
```

- [ ] **Step 5: Add skeleton and refresh rules**

Add:

```css
.z2m-content{position:relative;min-height:360px}
.z2m-content.z2m-refreshing:before{content:"";position:sticky;display:block;z-index:35;top:0;height:2px;margin-bottom:-2px;background:linear-gradient(90deg,transparent,var(--blue),transparent);background-size:220% 100%;animation:z2m-refresh-slide 1.15s linear infinite}
.z2m-loading-view{min-height:360px}
.z2m-skeleton{position:relative;overflow:hidden;background:#292c31;border-radius:5px}
.z2m-skeleton:after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.055),transparent);animation:z2m-skeleton-slide 1.35s ease-in-out infinite}
.z2m-skeleton.line{height:13px;width:190px;margin:6px 0}
.z2m-skeleton.line.title{height:28px;width:220px}
.z2m-skeleton.line.subtitle{width:330px;max-width:70vw}
.z2m-skeleton.line.heading{width:170px}
.z2m-skeleton-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}
.z2m-skeleton.block{height:210px}
@keyframes z2m-skeleton-slide{to{transform:translateX(100%)}}
@keyframes z2m-refresh-slide{to{background-position:-220% 0}}
@media (prefers-reduced-motion:reduce){
  .z2m-skeleton:after,.z2m-content.z2m-refreshing:before{animation:none}
}
```

The refresh marker is visual only; `aria-busy` in `app.js` provides semantics.

- [ ] **Step 6: Add Overview hero/advice rules in `z2m-components.css`**

Add:

```css
.z2m-overview-status>.bd{padding:0}
.z2m-hero{display:grid;grid-template-columns:1.32fr 1fr;padding:0!important}
.z2m-hero-left{padding:20px 20px 22px;min-width:0}
.z2m-hero-right{padding:20px;border-left:1px solid var(--border);background:#22252a;min-width:0}
.z2m-kick{display:flex;align-items:center;gap:8px;color:var(--tx3);font-size:12.5px;margin-bottom:10px}
.z2m-hero h3{margin:0;font-size:27px;font-weight:600;letter-spacing:-.6px;overflow-wrap:anywhere}
.z2m-strategy-description{color:var(--tx2);font-size:13.5px;margin-top:5px;max-width:52ch}
.z2m-strategy-meta{margin-top:10px;overflow-wrap:anywhere}
.z2m-overview-argv{margin-top:10px;overflow-wrap:anywhere}
.z2m-hero-actions{margin-top:16px}
.z2m-overview-kpis{grid-template-columns:1fr 1fr;gap:12px}
.z2m-overview-kpis .z2m-kpi{background:transparent;border:0;padding:0}
.z2m-overview-kpis .z2m-kpi .v{font-size:27px;letter-spacing:-.8px;display:flex;gap:5px;align-items:baseline;flex-wrap:wrap}
.z2m-overview-progress{margin-top:16px}
.z2m-failure-title{margin:14px 0 7px}
.z2m-overview-failures{display:flex;gap:6px;flex-wrap:wrap;min-height:22px}
.z2m-report-actions{margin-top:14px}
.z2m-advice-row{display:flex;gap:14px;align-items:flex-start;padding:13px 18px;border-bottom:1px solid #292c30}
.z2m-advice-row:last-child{border-bottom:0}
.z2m-advice-copy{min-width:0}
.z2m-advice-copy .tt{font-size:13.5px;font-weight:500}
.z2m-advice-copy .dd{color:var(--tx3);font-size:12px;margin-top:2px}
.z2m-advice-row .sp{margin-left:auto}
.z2m-metric-unit{font-size:13px}
```

- [ ] **Step 7: Add tablet and mobile behavior**

Add or extend:

```css
@media (max-width:900px){
  .z2m-hero{grid-template-columns:1fr}
  .z2m-hero-right{border-left:0;border-top:1px solid var(--border)}
  .z2m-skeleton-grid{grid-template-columns:1fr}
}
@media (max-width:560px){
  .z2m-overview-head .sp{width:100%;display:flex;align-items:stretch;flex-wrap:wrap}
  .z2m-overview-head .z2m-seg{width:100%}
  .z2m-overview-head .z2m-seg .z2m-btn{flex:1}
  .z2m-hero-left,.z2m-hero-right{padding:16px}
  .z2m-overview-kpis{grid-template-columns:1fr 1fr}
  .z2m-advice-row{flex-wrap:wrap}
  .z2m-advice-row .sp{width:100%;margin-left:22px}
}
```

Retain the existing mobile overflow guards and table behavior.

- [ ] **Step 8: Run focused CSS and render tests**

Run:

```sh
node --test \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs \
  tests/ui/render-harness.test.mjs
```

Expected result: all tests PASS.

- [ ] **Step 9: Commit the visual layer**

```sh
git add \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: align shell and overview with holyversion"
```

---

### Task 6: Exercise the rendered Overview tree

**Files:**
- Modify: `tests/ui/render-harness.test.mjs`
- Test: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`

**Interfaces:**
- Consumes the existing minimal DOM harness and `healthyData['z2m-overview.js']`.
- Produces behavioral coverage that the real render contains the hero, advice, mode control, and honest empty-state copy.

- [ ] **Step 1: Expand the healthy Overview fixture**

Replace the Overview fixture with:

```js
'z2m-overview.js': {
  status: { value: {
    serviceState: 'running',
    runtime: { process: { found: true }, connectivity: { verified: true } }
  } },
  preview: { value: {
    comboCatalog: { candidates: [{ candidateId: 'real-candidate', name: 'Backend candidate' }] },
    strategyState: {
      active: {
        candidateId: 'real-candidate',
        name: 'Backend candidate',
        description: 'Returned by backend',
        source: 'manual',
        appliedAt: '2026-08-04T09:00:00Z',
        revision: 12
      },
      rollback: { available: true, snapshotId: 'snap-11', label: 'rev11' }
    },
    overrides: { rules: [] }
  } },
  history: { value: { runs: [{
    runId: 'corpus-1', phase: 'completed', targetType: 'corpus', targetCount: 61,
    completedAt: '2026-08-04T09:30:00Z',
    selectedWinner: { successCount: 57, medianLatencyMs: 312, failedDomains: ['gog.com'] }
  }] } },
  orchestra: { value: {} },
  serviceDns: { value: { activeCount: 9 } }
}
```

These values are test fixtures only and must not be copied to production source.

- [ ] **Step 2: Add a dedicated Overview render test**

Add:

```js
test('Overview render follows the holyversion structure with backend fixture data', () => {
  const mod = evaluateLuciModule(`${root}/z2m-overview.js`, overrides, cache);
  const tree = mod.render(context(healthyData['z2m-overview.js']));
  assert.ok(tree.querySelector('.z2m-overview-head'));
  assert.ok(tree.querySelector('.z2m-overview-status'));
  assert.ok(tree.querySelector('.z2m-hero'));
  assert.ok(tree.querySelector('.z2m-hero-left'));
  assert.ok(tree.querySelector('.z2m-hero-right'));
  assert.ok(tree.querySelector('.z2m-overview-failures'));
  assert.ok(tree.querySelector('.z2m-advice'));
  assert.match(tree.textContent, /Backend candidate/);
  assert.match(tree.textContent, /57 \/ 61/);
  assert.match(tree.textContent, /312/);
});
```

- [ ] **Step 3: Add an honest unavailable-state render test**

Add:

```js
test('Overview unavailable render does not fabricate applied strategy or corpus metrics', () => {
  const mod = evaluateLuciModule(`${root}/z2m-overview.js`, overrides, cache);
  const unavailable = {
    status: { error: { code: 'EUNAVAILABLE', message: 'status unavailable' } },
    preview: { error: { code: 'EUNAVAILABLE', message: 'preview unavailable' } },
    history: { error: { code: 'EUNAVAILABLE', message: 'history unavailable' } },
    orchestra: { error: { code: 'EUNAVAILABLE', message: 'orchestra unavailable' } },
    serviceDns: { error: { code: 'EUNAVAILABLE', message: 'dns unavailable' } }
  };
  const tree = mod.render(context(unavailable));
  assert.match(tree.textContent, /Состояние неизвестно/);
  assert.match(tree.textContent, /Не определена/);
  assert.doesNotMatch(tree.textContent, /Flowseal ALT11|57 \/ 61|312 мс/);
});
```

- [ ] **Step 4: Run the render harness**

Run:

```sh
node --test tests/ui/render-harness.test.mjs
```

Expected result: all render-harness tests PASS for both healthy and unavailable envelopes.

- [ ] **Step 5: Commit render coverage**

```sh
git add tests/ui/render-harness.test.mjs
git commit -m "test: render holyversion overview states"
```

---

### Task 7: Package the first parity slice and run complete verification

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `tests/packaging.test.mjs`

**Interfaces:**
- Produces: `luci-app-zapret2-manager 0.1.0-r142`.
- Backend and meta-package stay at `r137` because this slice changes frontend files only.

- [ ] **Step 1: Require the new shipped module**

In `tests/packaging.test.mjs`, add `z2m-overview-model.js` to the `single-view runtime modules and local stylesheets exist` array.

- [ ] **Step 2: Update the LuCI release assertion first**

Change the packaging test name and assertion:

```js
test('r142 package ships no legacy runtime and only the two authoritative local stylesheets', () => {
  const makefile = readFileSync(join(REPO, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /^PKG_RELEASE:=142$/m);
  // retain every existing CSS and legacy-runtime assertion
});
```

- [ ] **Step 3: Run packaging test and capture RED**

Run:

```sh
node --test tests/packaging.test.mjs
```

Expected result: RED because `PKG_RELEASE` is still `141`.

- [ ] **Step 4: Bump only the LuCI package**

In `luci-app-zapret2-manager/Makefile`, change:

```make
PKG_RELEASE:=141
```

to:

```make
PKG_RELEASE:=142
```

Do not change `zapret2-manager/Makefile` or `zapret2-manager-full/Makefile`.

- [ ] **Step 5: Run the focused first-slice suite**

Run:

```sh
node --test \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs \
  tests/ui/video-navigation-regressions.test.mjs \
  tests/ui/render-harness.test.mjs \
  tests/packaging.test.mjs
```

Expected result: zero failures.

- [ ] **Step 6: Run JavaScript and repository gates**

Run:

```sh
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
chmod +x tools/run-all-tests.sh
tools/run-all-tests.sh
git diff --check
```

Expected result:

- every `node --check` exits `0`;
- complete runner prints `TOTAL one-line: <N> green, 0 red`;
- `git diff --check` exits `0`.

- [ ] **Step 7: Run source safety checks**

Run:

```sh
! grep -RInE 'Flowseal ALT11|57[[:space:]]*/[[:space:]]*61|312 мс' \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/*.js
! grep -RInE '@import|https?://' \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/*.css
! find . -maxdepth 1 -type d \( -name etc -o -name usr -o -name www \) -print -quit | grep .
```

Expected result: all three commands exit successfully and print no matches.

- [ ] **Step 8: Commit release and packaging assertions**

```sh
git add luci-app-zapret2-manager/Makefile tests/packaging.test.mjs
git commit -m "chore: release holyversion overview parity"
```

---

### Task 8: Review, open PR, verify exact head, and merge

**Files:**
- Review only; do not add implementation files unless a failing test identifies a concrete defect.

**Interfaces:**
- Produces the first merged vertical slice while preserving only `main` and `feat/holyversion-reference-parity`.

- [ ] **Step 1: Verify branch ancestry and diff scope**

Run:

```sh
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected changed paths are limited to:

```text
docs/superpowers/specs/2026-08-04-holyversion-reference-parity-design.md
docs/superpowers/plans/2026-08-04-holyversion-shell-overview-parity.md
luci-app-zapret2-manager/Makefile
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css
tests/packaging.test.mjs
tests/ui/holyversion-overview-model.test.mjs
tests/ui/holyversion-shell-overview-parity.test.mjs
tests/ui/manager-cosmetic-redesign.test.mjs
tests/ui/render-harness.test.mjs
tests/ui/single-view-overview-strategy.test.mjs
tests/ui/video-navigation-regressions.test.mjs
```

A test file may remain unchanged if its existing contracts already cover the requirement; no unrelated production file is allowed.

- [ ] **Step 2: Inspect for secret or router-specific material**

Run:

```sh
git diff origin/main...HEAD -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*' | \
  grep -Ein 'secret|token|password|tg://|t\.me/proxy|192\.168\.[0-9]+\.[0-9]+'
```

Expected result: no new literal secret, proxy URL, password, token, or real router address. Benign redaction/security code references must be reviewed manually rather than blindly accepted.

- [ ] **Step 3: Open the PR from the persistent branch**

Use title:

```text
feat: align shell and overview with holyversion
```

The body must state:

- `holyversion.html` is the canonical UI/UX reference;
- this PR delivers only the shell/Overview vertical slice;
- all operational values come from existing real RPC responses;
- no backend, ACL, or payload contract changed;
- no 60-second auto-rollback was added;
- a running process is no longer presented as verified bypass health without explicit backend evidence;
- focused and complete test counts from the exact head;
- router verdict remains `PARTIAL`.

- [ ] **Step 4: Verify exact-head GitHub Actions**

Record the expected PR head SHA before waiting. Require:

- workflow conclusion `success` for that exact SHA;
- complete repository gate with `0 red`;
- JavaScript syntax gate success;
- menu/ACL JSON success;
- CSS balance/local-assets success;
- no unresolved review threads;
- no requested changes;
- `draft=false`;
- `mergeable=true`;
- PR head still equals the recorded SHA.

If `main` advances, fast-forward or merge `main` into the same working branch without force-push, rerun the focused/full suite, and wait for a new exact-head run.

- [ ] **Step 5: Merge with the verified head**

Use a merge commit and the recorded `expected_head_sha`. Do not squash away the RED/test/implementation commit sequence unless repository policy requires squash.

- [ ] **Step 6: Reuse the persistent branch**

After merge:

```sh
git fetch origin
git checkout feat/holyversion-reference-parity
git merge --ff-only origin/main
git push origin feat/holyversion-reference-parity
```

Verify:

```sh
git rev-parse origin/main
git rev-parse origin/feat/holyversion-reference-parity
git branch -r
```

Expected result: the two SHAs are identical and the repository still has only `main` plus `feat/holyversion-reference-parity`.

- [ ] **Step 7: Record truthful completion evidence**

The completion report must include:

- exact tested head SHA;
- exact workflow run/job IDs;
- focused suite pass/fail count;
- complete repository green/red count;
- LuCI package release `r142`;
- changed-file list;
- merge commit SHA;
- confirmation that backend contracts were unchanged;
- confirmation that router installation/connectivity was not performed and verdict remains `PARTIAL`.
