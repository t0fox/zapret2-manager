# Holyversion Shell and Overview Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first independently usable `holyversion.html` parity slice: the shared visual shell, honest loading states, global simple/advanced presentation, and an Overview page that matches the reference structure while rendering only real backend evidence.

**Architecture:** Keep the existing single-root LuCI application and module lifecycle. Add one focused `z2m-overview-model.js` module that translates current RPC envelopes into an honest view model, add reusable segmented-control and skeleton primitives to `z2m-shell.js`, then recompose `z2m-overview.js` around the reference hero/advice layout without changing RPC names or mutation contracts. The existing stale-while-revalidate cache remains authoritative; this slice changes only its first-load presentation and refresh indicator.

**Tech Stack:** LuCI JavaScript (`L.view`, `baseclass`, `E()`), local CSS, current `z2m-api.js` RPC facade, Node.js `node:test`, `tools/luci-module-smoke.mjs`, `tools/run-all-tests.sh`, GitHub Actions.

## Global Constraints

- `holyversion.html` is the canonical UI/UX reference for structure, spacing, labels, states, and responsive behavior.
- Every operational value comes from existing backend responses. Missing values render as `—`, `Не проверялось`, `Состояние неизвестно`, or an explicit backend-unavailable explanation.
- Never hard-code prototype values such as `Flowseal ALT11`, `57/61`, `312 мс`, static runtime timestamps, router addresses, or package versions in production source.
- Keep exactly one root `L.view.extend()` in `app.js`; helper modules remain `baseclass.extend(...)`.
- Do not embed `holyversion.html` or copy its simulated JavaScript runtime into production.
- Do not change RPC names, positional `edit` transport, payloads, ACLs, ucode, shell backend, or router service behavior in this slice.
- Keep the current per-tab cache, in-flight request deduplication, activation-token protection, and old-module `unmount()` ordering.
- A process being alive may render `Служба запущена`; it may render `Обход работает` only when the backend supplies explicit positive health/connectivity evidence.
- A rollback control appears only when the backend supplies explicit rollback availability and an identifiable snapshot.
- Do not add a 60-second automatic rollback countdown or browser-side confirmation timer.
- The global draft/apply redesign is outside this slice. Preserve its current behavior without adding a second apply engine.
- Keep CSS and assets local; no `@import`, external URL, frontend framework, or runtime dependency.
- Work only on `feat/holyversion-reference-parity`; do not create another feature branch and do not force-push.
- Full repository gate and exact-head GitHub Actions must finish with zero red tests before merge.
- Router acceptance remains `PARTIAL`; source and CI success do not prove real-router installation or connectivity.

---

## File Structure

### Create

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
  - Normalizes runtime health, applied strategy, latest completed corpus run, metrics, rollback availability, errors, and advice.
- `tests/ui/holyversion-overview-model.test.mjs`
  - Exercises honest normalization and prevents fabricated success.
- `tests/ui/holyversion-shell-overview-parity.test.mjs`
  - Locks shell, Overview, loading, copy, and responsive contracts.

### Modify

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
  - Conditional backend-reported version badge, skeleton first load, and non-destructive refresh state.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
  - Segmented control and layout-preserving loading state.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
  - Reference-equivalent Overview using the model and current APIs.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
  - Shared geometry, segmented control, skeleton, and refresh styles.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
  - Overview hero, advice, and responsive styles.
- `tests/ui/render-harness.test.mjs`
  - Healthy and unavailable Overview DOM assertions.
- `tests/ui/single-view-overview-strategy.test.mjs`
  - Source contracts for model use, reference structure, health, and rollback.
- `tests/ui/manager-cosmetic-redesign.test.mjs`
  - Reference-critical local CSS classes.
- `tests/packaging.test.mjs`
  - New shipped module and release assertion.
- `luci-app-zapret2-manager/Makefile`
  - LuCI release `r141` → `r142`.

---

### Task 1: Add RED contracts for honest Overview data

**Files:**
- Create: `tests/ui/holyversion-overview-model.test.mjs`
- Modify: `tests/ui/single-view-overview-strategy.test.mjs`

**Interfaces:**
- Consumes: `evaluateLuciModule(path)` from `tools/luci-module-smoke.mjs`.
- Produces required exports:
  - `normalize(data)`
  - `runtimeHealth(status)`
  - `latestCompletedRun(history)`
  - `corpusMetrics(run)`
  - `rollbackInfo(preview, status)`

- [ ] **Step 1: Create the failing model tests**

Create `tests/ui/holyversion-overview-model.test.mjs`:

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

test('a running process without explicit connectivity is not healthy', () => {
  assert.deepEqual(model.runtimeHealth({
    serviceState: 'running', runtime: { process: { found: true } }
  }), {
    label: 'Служба запущена',
    detail: 'Связность ещё не подтверждена backend',
    kind: 'o', verified: false
  });
});

test('explicit backend verification may produce a healthy verdict', () => {
  const health = model.runtimeHealth({
    serviceState: 'running',
    runtime: { process: { found: true }, connectivity: { verified: true } }
  });
  assert.equal(health.label, 'Обход работает');
  assert.equal(health.kind, 'g');
  assert.equal(health.verified, true);
});

test('latest completed corpus run ignores active and stale snapshots', () => {
  const completed = {
    runId: 'done-2', phase: 'completed', targetType: 'corpus',
    completedAt: '2026-08-04T09:00:00Z'
  };
  assert.deepEqual(model.latestCompletedRun({ runs: [
    { runId: 'active', phase: 'testing', targetType: 'corpus', startedAt: '2026-08-04T10:00:00Z' },
    { runId: 'stale', phase: 'stale', targetType: 'corpus', completedAt: '2026-08-04T09:30:00Z' },
    completed,
    { runId: 'old', phase: 'completed', targetType: 'corpus', completedAt: '2026-08-03T09:00:00Z' }
  ] }), completed);
});

test('corpus metrics use only explicit winner evidence', () => {
  assert.deepEqual(model.corpusMetrics({
    phase: 'completed', targetType: 'corpus', targetCount: 61,
    selectedWinner: {
      successCount: 57, medianLatencyMs: 312,
      failedDomains: ['gog.com', 'ok.ru']
    }
  }), {
    opened: 57, total: 61, medianLatencyMs: 312,
    failedDomains: ['gog.com', 'ok.ru'], percent: 93
  });
});

test('rollback requires explicit availability and snapshot identity', () => {
  assert.equal(model.rollbackInfo({
    strategyState: { active: { candidateId: 'x' } }
  }, {}).available, false);
  assert.deepEqual(model.rollbackInfo({
    strategyState: {
      rollback: { available: true, snapshotId: 'snap-12', label: 'rev12' }
    }
  }, {}), {
    available: true, snapshotId: 'snap-12', label: 'rev12'
  });
});
```

- [ ] **Step 2: Extend the existing Overview source test**

Add to `tests/ui/single-view-overview-strategy.test.mjs`:

```js
assert.match(src, /z2m-overview-model as OverviewModel/);
assert.match(src, /OverviewModel\.normalize\(ctx\.data\s*\|\|\s*\{\}\)/);
for (const label of [
  'Простой', 'Расширенный', 'Как это работает',
  'Отчёт проверки', 'Что стоит сделать'
]) assert.match(src, new RegExp(label));
assert.match(src, /z2m-hero/);
assert.doesNotMatch(src, /Flowseal ALT11|57\s*\/\s*61|312\s*мс/);
assert.doesNotMatch(src, /rollback\(\)[\s\S]{0,250}!active/);
```

Keep all existing lifecycle, RPC, advanced-mode, and point-rule assertions.

- [ ] **Step 3: Run the focused tests and confirm RED**

```sh
node --test \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
```

Expected: failure because the model file and reference composition do not exist.

- [ ] **Step 4: Commit the RED tests**

```sh
git add tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
git commit -m "test: define honest holyversion overview contracts"
```

---

### Task 2: Implement the Overview data model

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
- Test: `tests/ui/holyversion-overview-model.test.mjs`

**Interfaces:**
- Consumes settled envelopes: `status`, `preview`, `history`, `orchestra`, `serviceDns`.
- Produces:

```text
{
  health: { label, detail, kind, verified },
  strategy: { id, name, description, source, appliedAt, argv, revision },
  corpus: { opened, total, medianLatencyMs, failedDomains, percent },
  lastRun, activeRun, serviceDnsCount, enabledRuleCount,
  rollback: { available, snapshotId, label },
  errors: [{ code, message }],
  advice: [{ kind, title, detail, action }]
}
```

- [ ] **Step 1: Add compatibility-safe helpers**

Create the module with:

```js
'use strict';
'require baseclass';

var COMPLETED_PHASES = ['completed', 'applied'];
var ACTIVE_PHASES = ['queued', 'pending', 'running', 'testing', 'scanning', 'applying', 'verifying'];

function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function finite(value) {
  if (value == null || value === '') return null;
  var number = Number(value);
  return isFinite(number) ? number : null;
}
function firstDefined(values) {
  for (var i = 0; i < values.length; i++)
    if (values[i] != null && values[i] !== '') return values[i];
  return null;
}
function timestamp(run) {
  run = object(run);
  var value = firstDefined([run.completedAt, run.finishedAt, run.updatedAt, run.startedAt]);
  var parsed = value ? Date.parse(value) : NaN;
  return isFinite(parsed) ? parsed : 0;
}
```

Do not use optional chaining or nullish coalescing.

- [ ] **Step 2: Implement runtime health**

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

- [ ] **Step 3: Implement completed and active run selection**

```js
function latestCompletedRun(history) {
  var runs = asArray(object(history).runs).filter(function (run) {
    run = object(run);
    return COMPLETED_PHASES.indexOf(String(run.phase || '')) >= 0 &&
      run.targetType === 'corpus';
  });
  runs.sort(function (a, b) { return timestamp(b) - timestamp(a); });
  return runs[0] || null;
}

function activeRun(orchestra, history) {
  var envelope = object(orchestra);
  var direct = envelope.run || envelope.activeRun || null;
  if (direct && ACTIVE_PHASES.indexOf(String(object(direct).phase || '')) >= 0)
    return direct;
  var runs = asArray(object(history).runs);
  for (var i = 0; i < runs.length; i++)
    if (ACTIVE_PHASES.indexOf(String(object(runs[i]).phase || '')) >= 0)
      return runs[i];
  return null;
}
```

- [ ] **Step 4: Implement explicit corpus metrics**

```js
function corpusMetrics(run) {
  run = object(run);
  var canonical = object(run.canonical);
  var winner = object(run.selectedWinner || canonical.winner);
  var targetLength = asArray(run.targets).length;
  var total = finite(firstDefined([
    run.targetCount, run.totalTargets, targetLength > 0 ? targetLength : null
  ]));
  var opened = finite(firstDefined([
    winner.successCount, winner.openedCount, winner.passedDomains,
    run.successCount, run.openedCount
  ]));
  var latency = finite(firstDefined([winner.medianLatencyMs, winner.latencyMs]));
  var failed = asArray(winner.failedDomains).length
    ? asArray(winner.failedDomains)
    : asArray(run.failedDomains);
  return {
    opened: opened,
    total: total,
    medianLatencyMs: latency,
    failedDomains: failed.map(String),
    percent: opened != null && total != null && total > 0
      ? Math.round(opened / total * 100) : null
  };
}
```

Do not calculate opened count as `total - failedDomains.length`.

- [ ] **Step 5: Implement strategy and rollback normalization**

```js
function strategyInfo(preview) {
  preview = object(preview);
  var state = object(preview.strategyState);
  var active = object(state.active || preview.active);
  return {
    id: firstDefined([active.candidateId, active.managerId, active.id]),
    name: firstDefined([active.name, active.displayName]),
    description: firstDefined([active.description, active.summary]),
    source: firstDefined([active.source, state.source, preview.source]),
    appliedAt: firstDefined([active.appliedAt, state.appliedAt]),
    argv: firstDefined([active.argv, active.options, active.opt]),
    revision: firstDefined([active.revision, state.revision, preview.revision])
  };
}

function rollbackInfo(preview, status) {
  preview = object(preview);
  status = object(status);
  var state = object(preview.strategyState);
  var candidate = object(state.rollback || preview.rollback || status.rollback);
  var snapshotId = firstDefined([candidate.snapshotId, candidate.id, candidate.revision]);
  var available = candidate.available === true && snapshotId != null;
  return {
    available: available,
    snapshotId: available ? String(snapshotId) : null,
    label: available ? firstDefined([candidate.label, candidate.name, candidate.revision]) : null
  };
}
```

- [ ] **Step 6: Implement advice and the top-level normalizer**

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
    if (error) errors.push({
      code: error.code || 'EUNAVAILABLE',
      message: error.message || String(error)
    });
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

- [ ] **Step 7: Run the model tests**

```sh
node --test tests/ui/holyversion-overview-model.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js \
  tests/ui/holyversion-overview-model.test.mjs
git commit -m "feat: normalize honest overview evidence"
```

---

### Task 3: Add shell primitives and honest loading behavior

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Create: `tests/ui/holyversion-shell-overview-parity.test.mjs`
- Test: `tests/ui/video-navigation-regressions.test.mjs`

**Interfaces:**
- Produces:
  - `shell.segmented(items, activeId, onSelect, attrs)`
  - `shell.renderLoadingState(label)`
  - `app.js::detectedVersion(initial)`
  - `app.js::setContentBusy(busy)`

- [ ] **Step 1: Create the RED shell/app tests**

Create `tests/ui/holyversion-shell-overview-parity.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

test('shell exports segmented and skeleton primitives', () => {
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
  assert.doesNotMatch(app, /['"]v0\.1\.0['"]/);
});

test('first load uses a skeleton and refresh remains non-destructive', () => {
  const app = source('app.js');
  assert.match(app, /Shell\.renderLoadingState\(TAB_LABELS\[tab\]\)/);
  assert.match(app, /setContentBusy\(true\)/);
  assert.match(app, /setContentBusy\(false\)/);
  assert.match(app, /z2m-refreshing/);
  assert.doesNotMatch(app, /z2m-app-placeholder[^\n]+Загрузка данных/);
});
```

- [ ] **Step 2: Run and confirm RED**

```sh
node --test tests/ui/holyversion-shell-overview-parity.test.mjs
```

Expected: missing exports, hard-coded version, and old placeholder fail.

- [ ] **Step 3: Add a self-updating segmented control**

Add after `chip()` in `z2m-shell.js`:

```js
function segmented(items, activeId, onSelect, attrs) {
  var host = E('div', Object.assign({ 'class': 'z2m-seg', role: 'group' }, attrs || {}));

  function select(id) {
    Array.from(host.querySelectorAll('button[data-segment]')).forEach(function (node) {
      var selected = node.getAttribute('data-segment') === id;
      node.classList.toggle('on', selected);
      node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  (items || []).forEach(function (item) {
    var selected = item.id === activeId;
    host.appendChild(button(item.label, selected ? 'on' : '', function () {
      select(item.id);
      if (typeof onSelect === 'function') onSelect(item.id);
    }, item.disabled === true, {
      'data-segment': item.id,
      'aria-pressed': selected ? 'true' : 'false'
    }));
  });
  return host;
}
```

- [ ] **Step 4: Add a layout-preserving skeleton**

Add:

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

Export:

```js
segmented: segmented,
renderLoadingState: renderLoadingState,
```

- [ ] **Step 5: Remove the fake header version**

Add near `statusState()` in `app.js`:

```js
function detectedVersion(initial) {
  var meta = initial && initial.meta || {};
  var value = meta.managerVersion || meta.packageVersion ||
    initial && initial.packageVersion;
  return value == null || value === '' ? null : String(value);
}
```

Before creating `appRoot`:

```js
var version = detectedVersion(initial);
var brand = [
  E('span', { 'class': 'mark', 'aria-hidden': 'true' }, 'z2'),
  E('span', { 'class': 'nm' }, [
    'zapret2', E('span', { 'class': 'mgr' }, '·manager')
  ])
];
if (version) brand.push(E('span', { 'class': 'ver' }, version));
```

Use `brand` as the children of `.z2m-brand` and delete literal `v0.1.0`.

- [ ] **Step 6: Add the busy state and skeleton to `activate()`**

After creating `content`:

```js
function setContentBusy(busy) {
  content.classList.toggle('z2m-refreshing', busy === true);
  content.setAttribute('aria-busy', busy === true ? 'true' : 'false');
}
```

In `activate(tab, force)`:

```js
if (!cachedData && !keepCurrent) {
  if (activeModule && activeContext && activeModule.unmount)
    activeModule.unmount(activeContext);
  activeModule = module;
  activeContext = null;
  content.replaceChildren(Shell.renderLoadingState(TAB_LABELS[tab]));
}

setContentBusy(true);
return loadTabData(tab, module).then(function (data) {
  if (token !== activationToken) return;
  renderTabData(tab, module, data, token, force);
  setContentBusy(false);
}).catch(function (error) {
  if (token !== activationToken) return;
  setContentBusy(false);
  var message = Api.normalizeError(error).message;
  if ((activeModule === module && activeContext) || cachedData) {
    Shell.showToast(_('Не удалось обновить данные. Показано последнее успешное состояние: ') + message, 'warn');
    return;
  }
  activeModule = module;
  activeContext = null;
  content.replaceChildren(E('div', { 'class': 'warnbar' }, message));
});
```

Preserve the immediate cached `renderTabData()` branch before this block and every activation-token/unmount guarantee.

- [ ] **Step 7: Run focused shell/navigation tests**

```sh
node --test \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/video-navigation-regressions.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js \
  tests/ui/holyversion-shell-overview-parity.test.mjs
git commit -m "feat: add holyversion shell loading states"
```

---

### Task 4: Recompose Overview to the reference structure

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- Test: `tests/ui/single-view-overview-strategy.test.mjs`
- Test: `tests/ui/holyversion-shell-overview-parity.test.mjs`

**Interfaces:**
- Consumes `OverviewModel.normalize(ctx.data || {})`, `shell.segmented()`, current API methods, current draft/store state, and current timer cleanup.
- Produces `.z2m-overview-head`, `.z2m-overview-status`, `.z2m-hero`, `.z2m-hero-left`, `.z2m-hero-right`, `.z2m-overview-failures`, and `.z2m-advice`.

- [ ] **Step 1: Import and use the model**

Add:

```js
'require view.zapret2-manager.z2m-overview-model as OverviewModel';
```

At the start of `render(ctx)`:

```js
var shell = ctx.shell;
var data = ctx.data || {};
var view = OverviewModel.normalize(ctx.data || {});
var status = data.status && data.status.value || {};
var preview = data.preview && data.preview.value || {};
var catalog = candidates(preview);
var rules = preview.overrides ? asArray(preview.overrides.rules) : [];
```

Use raw envelopes only for existing actions and choices. Summary presentation uses `view`.

- [ ] **Step 2: Replace the visible advanced checkbox with a segment**

```js
function setAdvanced(mode) {
  var current = ctx.store.get();
  ctx.store.update({
    ui: Object.assign({}, current.ui, { advanced: mode === 'advanced' })
  });
}

var modeControl = shell.segmented([
  { id: 'simple', label: _('Простой') },
  { id: 'advanced', label: _('Расширенный') }
], advanced ? 'advanced' : 'simple', setAdvanced, {
  id: 'z2m-overview-mode',
  'aria-label': _('Режим интерфейса')
});
```

Delete the old visible checkbox. Keep shared `store.ui.advanced` and root `.adv` behavior.

- [ ] **Step 3: Add help and display helpers**

```js
function valueOrDash(value) {
  return value == null || value === '' ? '—' : String(value);
}
function formatAppliedAt(value) {
  if (!value) return _('время применения неизвестно');
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function openHelp() {
  shell.openModal(_('Как это работает'), E('div', {}, [
    E('p', {}, _('Менеджер показывает отдельно применённую конфигурацию, черновик, активную проверку и последний завершённый результат.')),
    E('p', {}, _('Зелёный статус появляется только при положительном подтверждении backend. Если доказательств недостаточно, интерфейс показывает неизвестное или непроверенное состояние.')),
    E('p', {}, _('Расширенный режим раскрывает технические идентификаторы, argv и служебные сведения.'))
  ]));
}
```

- [ ] **Step 4: Add the exact report modal**

```js
function reportRow(label, value) {
  return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
    E('div', {}, [
      E('div', { 'class': 'nm' }, label),
      E('div', { 'class': 'co' }, valueOrDash(value))
    ])
  ]);
}

function openReport() {
  if (!view.lastRun) {
    shell.showToast(_('Завершённая corpus-проверка ещё не найдена.'), 'warn');
    return;
  }
  var failed = view.corpus.failedDomains.length
    ? E('div', { 'class': 'z2m-overview-failures' },
        view.corpus.failedDomains.map(function (domain) { return shell.chip(domain, 'r'); }))
    : E('div', { 'class': 'z2m-dim' }, _('Backend не зарегистрировал список неоткрывшихся доменов.'));
  shell.openModal(_('Отчёт проверки'), E('div', {}, [
    E('div', { 'class': 'z2m-change-list' }, [
      reportRow(_('Run ID'), view.lastRun.runId),
      reportRow(_('Состояние'), view.lastRun.phase),
      reportRow(_('Открывается'), view.corpus.opened != null && view.corpus.total != null
        ? view.corpus.opened + ' / ' + view.corpus.total : null),
      reportRow(_('Медианная задержка'), view.corpus.medianLatencyMs != null
        ? view.corpus.medianLatencyMs + ' мс' : null)
    ]),
    E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('Неоткрывшиеся домены')),
    failed
  ]));
}
```

- [ ] **Step 5: Build the reference page head**

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

- [ ] **Step 6: Build the hero left column**

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

- [ ] **Step 7: Build the hero right column**

```js
var openedText = view.corpus.opened == null || view.corpus.total == null
  ? '—' : view.corpus.opened + ' / ' + view.corpus.total;
var latencyText = view.corpus.medianLatencyMs == null
  ? '—' : view.corpus.medianLatencyMs + ' мс';
var progress = view.corpus.percent == null
  ? 0 : Math.max(0, Math.min(100, view.corpus.percent));
var failureNodes = view.corpus.failedDomains.length
  ? view.corpus.failedDomains.map(function (domain) { return shell.chip(domain, 'r'); })
  : [E('span', { 'class': 'z2m-dim' }, view.lastRun
      ? _('Неоткрывшиеся домены не зарегистрированы.')
      : _('Последняя corpus-проверка ещё не выполнялась.'))];

var heroRight = E('div', { 'class': 'z2m-hero-right' }, [
  E('div', { 'class': 'z2m-kpis z2m-overview-kpis' }, [
    E('div', { 'class': 'z2m-kpi z2m-acc' }, [
      E('div', { 'class': 'v' }, openedText),
      E('div', { 'class': 'l' }, _('доменов открываются'))
    ]),
    E('div', { 'class': 'z2m-kpi' }, [
      E('div', { 'class': 'v' }, latencyText),
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

- [ ] **Step 8: Build the honest status panel**

The current API exposes `service.start` and `service.stop`, but no `service.restart`. Use one real action:

```js
var statusPanel = E('section', { 'class': 'z2m-panel z2m-overview-status' }, [
  E('div', { 'class': 'hd' }, [
    E('span', { 'class': 'z2m-dot ' + view.health.kind }),
    E('h2', {}, view.health.label),
    E('span', { 'class': 'sub' }, view.health.detail),
    E('div', { 'class': 'sp' }, [
      shell.button(running ? _('Остановить') : _('Запустить'),
        running ? 'danger sm' : 'primary sm', serviceAction)
    ])
  ]),
  E('div', { 'class': 'bd z2m-hero' }, [heroLeft, heroRight])
]);
```

Do not synthesize restart by chaining stop/start.

- [ ] **Step 9: Keep current real resource and point-rule actions**

Preserve:

- `orchestra.runStart/runStatus` payload and polling;
- domain/URL validation before RPC;
- strategy catalog choices from backend;
- browser draft staging;
- current explicit point-rule apply until the unified apply slice replaces it;
- `unmount()` timer cleanup.

Do not copy single-resource results into corpus KPIs.

- [ ] **Step 10: Build the advice panel**

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
      handler ? E('div', { 'class': 'sp' },
        shell.button(_('Открыть'), 'sm', handler)) : null
    ]);
  })),
  _('по реальным данным последней проверки и runtime')
);
```

- [ ] **Step 11: Return the final composition**

```js
return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
  pageHead,
  warnings,
  statusPanel,
  E('div', { 'class': 'z2m-row3' }, [resourcePanel, rulesPanel]),
  advicePanel
]);
```

- [ ] **Step 12: Run focused tests**

```sh
node --test \
  tests/ui/holyversion-overview-model.test.mjs \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/single-view-overview-strategy.test.mjs
```

Expected: PASS.

- [ ] **Step 13: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js \
  tests/ui/single-view-overview-strategy.test.mjs \
  tests/ui/holyversion-shell-overview-parity.test.mjs
git commit -m "feat: match holyversion overview with real data"
```

---

### Task 5: Implement visual and responsive parity

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `tests/ui/manager-cosmetic-redesign.test.mjs`
- Modify: `tests/ui/holyversion-shell-overview-parity.test.mjs`

**Interfaces:**
- Consumes classes from Tasks 3–4.
- Produces desktop, tablet, mobile, refresh, skeleton, and reduced-motion states.

- [ ] **Step 1: Add RED CSS contracts**

Append to `tests/ui/holyversion-shell-overview-parity.test.mjs`:

```js
test('reference shell and Overview classes stay local and responsive', () => {
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
});
```

Add the same class names to the existing critical-class arrays in `tests/ui/manager-cosmetic-redesign.test.mjs`.

- [ ] **Step 2: Run and confirm RED**

```sh
node --test tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs
```

- [ ] **Step 3: Align shared geometry in `z2m-ui.css`**

Use:

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

Keep current approved color variables and generic rules needed by other pages.

- [ ] **Step 4: Add segment, skeleton, and refresh CSS**

```css
.z2m-seg{display:inline-flex;background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:2px;gap:2px}
.z2m-seg .z2m-btn{background:none;border:0;color:var(--tx3);font-size:12.5px;padding:5px 11px;min-height:0;border-radius:5px;box-shadow:none}
.z2m-seg .z2m-btn:hover{color:var(--tx);background:rgba(255,255,255,.03)}
.z2m-seg .z2m-btn.on{background:var(--raised);color:var(--tx);box-shadow:0 1px 2px rgba(0,0,0,.35)}
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

- [ ] **Step 5: Add Overview component CSS**

Append to `z2m-components.css`:

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
.z2m-overview-kpis .z2m-kpi .v{font-size:27px;letter-spacing:-.8px}
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
```

- [ ] **Step 6: Add tablet and mobile rules**

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

Retain existing overflow guards and table behavior.

- [ ] **Step 7: Run focused CSS tests**

```sh
node --test tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-shell-overview-parity.test.mjs \
  tests/ui/manager-cosmetic-redesign.test.mjs
git commit -m "style: align shell and overview with holyversion"
```

---

### Task 6: Exercise healthy and unavailable Overview rendering

**Files:**
- Modify: `tests/ui/render-harness.test.mjs`

**Interfaces:**
- Consumes the existing minimal DOM harness.
- Produces structural and no-fabrication render coverage.

- [ ] **Step 1: Replace the healthy Overview fixture**

Use:

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
        candidateId: 'real-candidate', name: 'Backend candidate',
        description: 'Returned by backend', source: 'manual',
        appliedAt: '2026-08-04T09:00:00Z', revision: 12
      },
      rollback: { available: true, snapshotId: 'snap-11', label: 'rev11' }
    },
    overrides: { rules: [] }
  } },
  history: { value: { runs: [{
    runId: 'corpus-1', phase: 'completed', targetType: 'corpus',
    targetCount: 61, completedAt: '2026-08-04T09:30:00Z',
    selectedWinner: {
      successCount: 57, medianLatencyMs: 312,
      failedDomains: ['gog.com']
    }
  }] } },
  orchestra: { value: {} },
  serviceDns: { value: { activeCount: 9 } }
}
```

These numbers are test fixtures and must not appear in production JavaScript.

- [ ] **Step 2: Add the healthy structure test**

```js
test('Overview follows the holyversion structure with backend fixture data', () => {
  const mod = evaluateLuciModule(`${root}/z2m-overview.js`, overrides, cache);
  const tree = mod.render(context(healthyData['z2m-overview.js']));
  for (const selector of [
    '.z2m-overview-head', '.z2m-overview-status', '.z2m-hero',
    '.z2m-hero-left', '.z2m-hero-right',
    '.z2m-overview-failures', '.z2m-advice'
  ]) assert.ok(tree.querySelector(selector), selector);
  assert.match(tree.textContent, /Backend candidate/);
  assert.match(tree.textContent, /57 \/ 61/);
  assert.match(tree.textContent, /312 мс/);
});
```

- [ ] **Step 3: Add the unavailable-state test**

```js
test('Overview unavailable state does not fabricate strategy or metrics', () => {
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

```sh
node --test tests/ui/render-harness.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add tests/ui/render-harness.test.mjs
git commit -m "test: render holyversion overview states"
```

---

### Task 7: Package, verify, open PR, and merge exact head

**Files:**
- Modify: `tests/packaging.test.mjs`
- Modify: `luci-app-zapret2-manager/Makefile`

**Interfaces:**
- Produces `luci-app-zapret2-manager 0.1.0-r142`.
- Backend and full meta-package remain `r137`.

- [ ] **Step 1: Update packaging tests first**

Add `z2m-overview-model.js` to the shipped runtime module list. Change:

```js
test('r142 package ships no legacy runtime and only the two authoritative local stylesheets', () => {
  const makefile = readFileSync(join(REPO, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /^PKG_RELEASE:=142$/m);
  // retain the existing CSS and legacy-runtime assertions verbatim
});
```

- [ ] **Step 2: Run packaging test and confirm RED**

```sh
node --test tests/packaging.test.mjs
```

Expected: release assertion fails while Makefile is still `141`.

- [ ] **Step 3: Bump only the LuCI release**

Change in `luci-app-zapret2-manager/Makefile`:

```make
PKG_RELEASE:=142
```

Do not modify backend/meta Makefiles.

- [ ] **Step 4: Run the focused suite**

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

Expected: zero failures.

- [ ] **Step 5: Run syntax and complete repository gates**

```sh
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
chmod +x tools/run-all-tests.sh
tools/run-all-tests.sh
git diff --check
```

Expected: all syntax checks exit `0`, runner prints `TOTAL one-line: <N> green, 0 red`, and diff check exits `0`.

- [ ] **Step 6: Run source safety checks**

```sh
! grep -RInE 'Flowseal ALT11|57[[:space:]]*/[[:space:]]*61|312 мс' \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/*.js
! grep -RInE '@import|https?://' \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/*.css
! find . -maxdepth 1 -type d \( -name etc -o -name usr -o -name www \) -print -quit | grep .
```

Expected: no output and successful exit status for every command.

- [ ] **Step 7: Commit release assertions**

```sh
git add tests/packaging.test.mjs luci-app-zapret2-manager/Makefile
git commit -m "chore: release holyversion overview parity"
```

- [ ] **Step 8: Review branch scope**

```sh
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --check
```

Only the approved spec/plan, first-slice frontend files, focused tests, packaging test, and LuCI Makefile may differ.

- [ ] **Step 9: Open the PR**

Title:

```text
feat: align shell and overview with holyversion
```

Body must state:

- canonical reference and first-slice scope;
- real-data-only rule;
- no backend, ACL, or RPC payload change;
- no auto-rollback timer;
- explicit health and rollback requirements;
- exact focused/full test counts;
- router verdict remains `PARTIAL`.

- [ ] **Step 10: Verify exact-head CI and review state**

Record the expected PR head SHA. Require:

- workflow conclusion `success` for that SHA;
- complete runner `0 red`;
- JavaScript syntax, menu/ACL JSON, CSS/local-assets gates green;
- no unresolved review threads or requested changes;
- `draft=false`, `mergeable=true`;
- current head equals the recorded SHA.

If `main` advances, update the same branch without force-push, rerun all gates, and record the new head.

- [ ] **Step 11: Merge and reuse the persistent branch**

Merge with a merge commit and the verified expected head SHA. Then:

```sh
git fetch origin
git checkout feat/holyversion-reference-parity
git merge --ff-only origin/main
git push origin feat/holyversion-reference-parity
git rev-parse origin/main
git rev-parse origin/feat/holyversion-reference-parity
git branch -r
```

Expected: both refs are identical and only `main` plus `feat/holyversion-reference-parity` exist.

- [ ] **Step 12: Record truthful evidence**

Report exact tested head, workflow run/job IDs, focused and full counts, LuCI `r142`, changed files, merge commit, unchanged backend contracts, and that real-router installation/connectivity was not performed.
