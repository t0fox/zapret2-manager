# Single-View LuCI Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected legacy-wrapper frontend with one valid LuCI view that reproduces `luci-zapret2.html` as an eight-tab application while preserving every existing backend RPC contract.

**Architecture:** `app.js` is the only product module that exports `L.view.extend()`. Focused helper modules provide API declarations, state, shell widgets, and the eight internal tabs; old routes become hidden redirect views and all `*-legacy.js` runtime dependencies are removed after their handlers are migrated. The UI uses real backend data, central draft/pending state, hash navigation, and the exact visual system from `luci-zapret2.html`.

**Tech Stack:** OpenWrt LuCI JavaScript modules, `rpc.declare`, DOM through `E()`, CSS, Node.js built-in tests, OpenWrt APK packaging.

## Global Constraints

- Work only on `feat/strategy-first-integration`; do not create another branch or worktree.
- Authoritative design: `docs/superpowers/specs/2026-08-03-luci-single-view-manager-design.md`.
- Authoritative visual reference: user-provided `luci-zapret2.html`.
- Frontend baseline: `5cac06ce32529f54dc30153d35293e39c5c3a9eb`.
- Do not modify `zapret2-manager/files/usr/libexec/`, rpcd/ucode backend code, ACL, config formats, service manifests, catalog contents, or RPC payload formats.
- Do not invent successful data. Unknown values render as `—`, `не проверялось`, or an explicit warning.
- Strategy selection remains pending until explicit Apply; rollback/confirm remains available.
- Only `app.js` may export `L.view.extend()` as the product UI. Compatibility redirect modules may export minimal standalone redirect views, but may not import or return another view constructor.
- No runtime `*-legacy.js` imports. Delete migrated legacy files before packaging.
- No external fonts, icons, CSS, CDN, or network assets.
- Telegram QR output keeps a white quiet zone.
- Final LuCI package release: `PKG_RELEASE:=137`.
- Completion requires the full Node suite, JS syntax checks, menu JSON validation, backend diff guard, APK build/install, and browser acceptance on the test OpenWrt router.

---

## Locked Runtime Structure

Under `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/`:

```text
app.js                 # only product L.view.extend() and lifecycle
z2m-api.js             # existing RPC declarations and error normalization
z2m-store.js           # server/draft/pending/jobs/UI state
z2m-shell.js           # app header, tabs, modal, toast, apply bars
z2m-overview.js        # Обзор
z2m-strategy.js        # Стратегия / Orchestra
z2m-services.js        # Сервисы
z2m-lists.js           # Списки
z2m-dns.js             # DNS
z2m-proxy.js           # Telegram Proxy
z2m-qr.js              # existing QR encoder extracted from proxy code
z2m-monitor.js         # Мониторинг
z2m-maintenance.js     # Обслуживание
z2m-ui.css             # complete reference-aligned stylesheet
```

Every tab module exports exactly:

```js
{
  id: 'overview',
  title: _('Обзор'),
  subtitle: _('Состояние обхода блокировок на этом роутере'),
  load: function (ctx) { return Promise.resolve({}); },
  render: function (ctx) { return E('section', { 'class': 'z2m-view' }); },
  mount: function (ctx) {},
  unmount: function (ctx) {}
}
```

Shared context:

```js
{
  api: Api,
  store: Store,
  shell: Shell,
  root: HTMLElement,
  data: Object,
  navigate: function (tabId) {},
  refresh: function (tabId) {},
  setDraft: function (scope, value) {},
  clearDraft: function (scope) {}
}
```

---

### Task 1: LuCI Module Harness and Core Single-View Skeleton

**Files:**
- Create: `tools/luci-module-smoke.mjs`
- Create: `tests/ui/single-view-manager.test.mjs`
- Create: `.../app.js`
- Create: `.../z2m-api.js`
- Create: `.../z2m-store.js`
- Create: `.../z2m-shell.js`
- Modify: `tools/ui-rpc-contract.mjs`
- Test: `tests/fixtures/ui-rpc-contract.json`

**Interfaces:**
- Consumes exact declarations and `params` arrays from current Orchestra, profiles, lists, DNS, monitor, proxy, and maintenance views.
- Produces a valid root view, API facade, store, shell helpers, and a reusable LuCI module evaluator.

- [ ] **Step 1: Write failing module tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('app.js yields a valid LuCI view', () => {
  const exported = evaluateLuciModule(`${root}/app.js`);
  assert.equal(typeof exported, 'object');
  assert.equal(typeof exported.load, 'function');
  assert.equal(typeof exported.render, 'function');
});

test('core modules never return a legacy view', () => {
  for (const file of ['app.js', 'z2m-api.js', 'z2m-store.js', 'z2m-shell.js']) {
    const src = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(src, /require\s+view\.zapret2-manager\..*-legacy/);
    assert.doesNotMatch(src, /return\s+Legacy\w*/);
  }
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-manager.test.mjs
```

Expected: missing evaluator and app files.

- [ ] **Step 3: Implement `tools/luci-module-smoke.mjs`**

Parse LuCI string directives, inject stubs, remove directives, and evaluate the module body:

```js
export function evaluateLuciModule(file, overrides = {}) {
  const source = readFileSync(file, 'utf8');
  const reqs = [...source.matchAll(/'require\s+([^']+?)(?:\s+as\s+(\w+))?';/g)];
  const names = reqs.map((m) => m[2] || m[1].split('.').pop().replace(/-/g, '_'));
  const stripped = source.replace(/'require\s+[^']+';\s*/g, '');
  const L = overrides.L || {
    view: { extend: (value) => value },
    resource: (value) => value,
    url: (...parts) => '/' + parts.join('/')
  };
  const E = overrides.E || ((tag, attrs, children) => ({ tag, attrs: attrs || {}, children: children || [] }));
  const document = overrides.document || { getElementById: () => null, head: { appendChild() {} } };
  const window = overrides.window || { location: { hash: '', replace() {} }, addEventListener() {}, removeEventListener() {} };
  const values = names.map((name) => overrides[name] || {});
  return Function('L', 'E', 'document', 'window', ...names, stripped)(L, E, document, window, ...values);
}
```

Reject invalid aliases with a clear error.

- [ ] **Step 4: Move RPC declarations into `z2m-api.js` unchanged**

Move every current `rpc.declare({ object: 'zapret2-manager', method, params, reject })` declaration from the eight current/legacy views. Method strings, `params`, and JSON encoding must remain identical to the existing source and `tests/fixtures/ui-rpc-contract.json`.

Export grouped functions:

```js
return {
  normalizeError: normalizeError,
  service: serviceApi,
  strategy: strategyApi,
  orchestra: orchestraApi,
  profiles: profilesApi,
  services: servicesApi,
  lists: listsApi,
  dns: dnsApi,
  proxy: proxyApi,
  monitor: monitorApi,
  maintenance: maintenanceApi
};
```

- [ ] **Step 5: Update the RPC contract collector**

Make `collectUiContract()` read `z2m-api.js` when present and return sorted `{ method, params }` entries. Preserve fallback extraction from old views until Task 7. Assert equality with the frozen fixture.

- [ ] **Step 6: Implement store and shell interfaces**

`z2m-store.js` exports `create(initial)` with `get`, `update`, `setDraft`, `clearDraft`, `hasDraft`, and `subscribe`. State begins as:

```js
{
  server: {}, draft: {}, pending: {}, applied: {}, jobs: {},
  ui: { tab: 'overview', advanced: false, modal: null }
}
```

`z2m-shell.js` exports `injectCss`, `button`, `chip`, `panel`, `empty`, `showToast`, `openModal`, `closeModal`, and `renderApplyBar`.

- [ ] **Step 7: Implement a minimal valid `app.js`**

```js
return L.view.extend({
  load: function () {
    return Api.service.status().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },
  render: function (initial) {
    Shell.injectCss();
    return E('div', { 'class': 'z2m-app', 'id': 'z2m-app' }, [
      E('div', { 'class': 'z2m-app-placeholder' },
        initial && initial.error ? initial.error.message : _('Загрузка интерфейса…'))
    ]);
  },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
```

- [ ] **Step 8: Verify GREEN**

```bash
node --test tests/ui/single-view-manager.test.mjs tests/ui/manager-cosmetic-redesign.test.mjs
node --check tools/luci-module-smoke.mjs
for f in app.js z2m-api.js z2m-store.js z2m-shell.js; do
  node --check "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/$f" || exit 1
done
```

- [ ] **Step 9: Commit**

```bash
git add tools tests/ui/single-view-manager.test.mjs \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{app.js,z2m-api.js,z2m-store.js,z2m-shell.js}
git commit -m "refactor: establish single-view LuCI manager core"
```

---

### Task 2: Exact Reference Shell, Hash Routing, and Compatibility Menu

**Files:**
- Create: `.../z2m-ui.css`
- Modify: `.../app.js`, `.../z2m-shell.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Replace with redirect views: `orchestra-strategy.js`, `orchestra.js`, `strategies.js`, `lists.js`, `dns.js`, `service-dns.js`, `proxy.js`, `monitor.js`, `maintenance.js`
- Test: `tests/ui/single-view-manager.test.mjs`, `tests/packaging.test.mjs`

**Interfaces:** produces the exact app chrome, eight hash-routed tabs, standalone hidden redirects, and one visible LuCI menu entry.

- [ ] **Step 1: Add failing shell/menu assertions**

```js
const tabs = ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'];
for (const id of tabs) assert.match(app, new RegExp(`['"]${id}['"]`));
for (const token of ['#17181a','#1f2124','#25282c','#2c3035','#4b9fd5','#5cb98b','#e0a33b','#e2695a'])
  assert.match(css.toLowerCase(), new RegExp(token));
assert.match(css, /\.z2m-apptop/);
assert.match(css, /\.z2m-tabs/);
assert.match(css, /\.z2m-applybar/);
assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/app');
assert.equal(Object.values(menu).filter((entry) => entry.hidden !== true && entry.action).length, 1);
```

Each redirect must pass `evaluateLuciModule()` and contain `window.location.replace`, not `return Legacy`.

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-manager.test.mjs tests/packaging.test.mjs
```

- [ ] **Step 3: Implement self-contained `z2m-ui.css`**

Start with exact reference tokens scoped under `.z2m-app`:

```css
.z2m-app {
  --z2m-bg:#17181a; --z2m-panel:#1f2124; --z2m-panel2:#25282c; --z2m-raised:#2c3035;
  --z2m-border:#34383d; --z2m-border2:#3f444a;
  --z2m-tx:#e8eaed; --z2m-tx2:#a7aeb6; --z2m-tx3:#7d858e;
  --z2m-blue:#4b9fd5; --z2m-green:#5cb98b; --z2m-orange:#e0a33b;
  --z2m-red:#e2695a; --z2m-purple:#9a86d6;
  background:var(--z2m-bg); color:var(--z2m-tx); min-height:calc(100vh - 48px);
}
```

Port under `z2m-` names: app top, wrap, tabs, subtabs, page head, panel, row grids, buttons, CBI grid, chips, KPI strip, tables, service rows, switches, progress, console/diff, accordions, strategy rows, apply bar, modal, toasts, QR, filters, 900/560 px breakpoints, and reduced motion. Do not use `@import`.

- [ ] **Step 4: Implement hash routing**

```js
var TAB_IDS = ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'];
function tabFromHash() {
  var m = String(window.location.hash || '').match(/^#\/(overview|strategy|services|lists|dns|proxy|monitor|maintenance)$/);
  return m ? m[1] : 'overview';
}
function setHash(tab) {
  if (window.location.hash !== '#/' + tab) window.location.hash = '#/' + tab;
}
```

`render()` creates the reference app header, eight tab buttons, content host, modal/toast hosts, and apply/confirm bars. `hashchange` unmounts the old tab, loads/mounts the new one, updates active classes, and scrolls the manager area to top.

- [ ] **Step 5: Replace menu with one visible root and hidden aliases**

Root action: `zapret2-manager/app`. Preserve existing ACL arrays. Hidden aliases map old route names to their redirect files.

- [ ] **Step 6: Implement standalone redirect views**

```js
'use strict';
'require view';
return L.view.extend({
  load: function () {
    window.location.replace(L.url('admin/services/zapret2-manager/app') + '#/proxy');
    return Promise.resolve();
  },
  render: function () { return E('div', { 'class': 'z2m-redirect' }, _('Открываем Zapret 2 Manager…')); },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
```

Use the specification’s hash mapping for every route.

- [ ] **Step 7: Update packaging tests**

Assert one visible entry at `zapret2-manager/app`; hidden redirects and their JS files must exist.

- [ ] **Step 8: Verify GREEN and commit**

```bash
node --test tests/ui/single-view-manager.test.mjs tests/packaging.test.mjs
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
git add luci-app-zapret2-manager tests/ui/single-view-manager.test.mjs tests/packaging.test.mjs
git commit -m "feat: add reference-aligned single-view manager shell"
```

---

### Task 3: Overview and Strategy/Orchestra

**Files:**
- Create: `.../z2m-overview.js`, `.../z2m-strategy.js`
- Modify: `.../app.js`, `.../z2m-api.js`, `.../z2m-store.js`
- Test: `tests/ui/single-view-overview-strategy.test.mjs`

**Interfaces:** consumes service/status, strategy/profile, Orchestra run/history, overrides, and shared draft state; produces real-data Overview and Strategy tabs.

- [ ] **Step 1: Add failing tests**

Assert Overview has service state, KPI strip, active strategy, resource check, overrides, and no unavailable metric fallback using `|| 0`.

Assert Strategy has subtabs `list`, `chain`, `check`, `hist`; pending selection; explicit Apply; run start/status/history; and handling for `candidateCount === 0 || targetCount === 0`.

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-overview-strategy.test.mjs
```

- [ ] **Step 3: Implement Overview load/render**

Use `Promise.allSettled()` for status, profile preview, Orchestra status/history, and overrides. Rejected calls become `{ unavailable: true, error }`, not fake values. Render metrics with:

```js
function metric(value, suffix) {
  return value == null ? '—' : String(value) + (suffix || '');
}
```

Start/stop/restart invoke existing methods. “Все стратегии” calls `ctx.navigate('strategy')`.

- [ ] **Step 4: Implement resource check and overrides**

Use the existing targeted Orchestra payload unchanged. Creating an override updates `store.pending.overrides` and `store.draft.strategy`; it never auto-applies.

- [ ] **Step 5: Implement Strategy**

Migrate strategy list, preview/apply/rollback, run start/status/history, ratings, and profile-chain rendering. Selection updates pending state only. A completed run with zero targets/candidates renders:

```text
Автоподбор не получил целей. Проверьте corpus/manifest и runtime zapret2; пустой запуск не считается успешным.
```

- [ ] **Step 6: Implement polling lifecycle and apply bars**

One timer per active run; `unmount()` always clears it. Successful apply clears draft and opens the confirm bar using the backend deadline. Rollback and confirm-alive use existing RPCs.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test tests/ui/single-view-overview-strategy.test.mjs tests/orchestra-strategy-ui.test.mjs \
  tests/flowseal-combo.test.mjs tests/flowseal-combo-apply.test.mjs tests/flowseal-combo-integration.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js
git add luci-app-zapret2-manager tests/ui/single-view-overview-strategy.test.mjs
git commit -m "feat: rebuild overview and strategy tabs"
```

---

### Task 4: Services, Lists, and DNS

**Files:**
- Create: `.../z2m-services.js`, `.../z2m-lists.js`, `.../z2m-dns.js`
- Modify: `.../z2m-api.js`, `.../app.js`
- Test: `tests/ui/single-view-services-lists-dns.test.mjs`

**Interfaces:** consumes existing catalog/service DNS/profile/list/DNS RPC groups and shared draft state; produces the reference service catalog, lists UI, and five DNS subtabs.

- [ ] **Step 1: Add failing tests**

Services: KPI, search, filters, categories, switches, DNS assignment, hosts source, hostlist mapping.

Lists: domain check, include/exclude editors, counts, conflict blocking, advanced read-only lists.

DNS: exact panes `setup`, `check`, `access`, `adv`, `hist`, and live dnsmasq warning rendering.

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-services-lists-dns.test.mjs
```

- [ ] **Step 3: Implement Services**

Load real catalog and service DNS data. Search/filter stays local. Toggles and DNS choices update `draft.services` using original IDs and payload field names. Unsupported writes render disabled controls with the backend reason; never imitate saving.

- [ ] **Step 4: Implement Lists**

Migrate list get/check/validate/save/apply handlers and preserve conflict blocking. Disable Apply when validation reports conflicts. Never render edit controls for read-only engine lists.

- [ ] **Step 5: Implement DNS Setup and Check & Choose**

Migrate existing get/set/validate/preview/apply/check and provider benchmark methods with exact payloads. Benchmark cancellation stops polling without writing configuration.

- [ ] **Step 6: Implement DNS Service Access, Advanced, and History**

Migrate service mappings, raw dnsmasq rules, history, rollback, and restore-auto. Display backend warning text unchanged, including missing manager override registration.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test tests/ui/single-view-services-lists-dns.test.mjs tests/ui/single-view-manager.test.mjs
for f in z2m-services.js z2m-lists.js z2m-dns.js; do node --check "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/$f" || exit 1; done
git add luci-app-zapret2-manager tests/ui/single-view-services-lists-dns.test.mjs
git commit -m "feat: rebuild services lists and DNS tabs"
```

---

### Task 5: Telegram Proxy as a First-Class Tab

**Files:**
- Create: `.../z2m-proxy.js`, `.../z2m-qr.js`
- Modify: `.../z2m-api.js`, `.../app.js`
- Test: `tests/ui/single-view-proxy.test.mjs`

**Interfaces:** consumes every existing `proxy_*` RPC and the QR encoder; produces the complete reference Proxy tab without live-collection refresh bugs.

- [ ] **Step 1: Add failing tests**

Assert the facade retains:

```text
proxy_capabilities proxy_status proxy_config_get proxy_config_validate
proxy_config_preview proxy_config_apply proxy_start proxy_stop proxy_restart
proxy_autostart_set proxy_secret_rotate proxy_logs_tail proxy_health
proxy_link_info proxy_quick_install
```

Assert Open, Copy, QR, Rotate, start/stop/restart, Settings, Technical controls exist. Assert no runtime source contains `children.forEach`.

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-proxy.test.mjs
```

- [ ] **Step 3: Extract QR encoder unchanged**

Move the existing algorithm into `z2m-qr.js` and export:

```js
return {
  render: function (text, size) {
    // return a canvas/DOM node with white background and encoded text
  }
};
```

Do not alter encoding constants or matrix generation. Add a deterministic fixed-link matrix/module-count test.

- [ ] **Step 4: Implement proxy loading and main panel**

Use `Promise.allSettled()` for capabilities, status, config, link info, health. Render installed/running state, listener, masked secret, full link, active connections, and activity. Unknown fields render `—`.

- [ ] **Step 5: Implement actions**

Open uses the backend link. Copy uses Clipboard API plus textarea fallback. QR uses the shared modal and `Qr.render(fullLink, 220)`. Rotate requires confirmation, calls `proxy_secret_rotate`, reloads link info, and rerenders only Proxy.

- [ ] **Step 6: Implement Settings and Technical accordions**

Use existing config get/validate/preview/apply payloads for all reference fields. Start/stop/restart/quick install use existing RPCs. Self-test uses `proxy_health`; logs/diagnostics use existing calls.

Refresh with:

```js
ctx.root.replaceChildren(renderProxy(ctx));
```

Never move a live `HTMLCollection`.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test tests/ui/single-view-proxy.test.mjs tests/ui/single-view-manager.test.mjs
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-qr.js
git add luci-app-zapret2-manager tests/ui/single-view-proxy.test.mjs
git commit -m "feat: rebuild Telegram Proxy tab"
```

---

### Task 6: Monitoring and Maintenance Lifecycles

**Files:**
- Create: `.../z2m-monitor.js`, `.../z2m-maintenance.js`
- Modify: `.../z2m-api.js`, `.../app.js`
- Test: `tests/ui/single-view-monitor-maintenance.test.mjs`

**Interfaces:** consumes status/runtime/jobs/log/diagnostics and backup/restore RPCs; produces polling-safe Monitoring and working Backup Preview.

- [ ] **Step 1: Add failing tests**

Both modules expose `mount`/`unmount`. Monitor clears timers and capability-gates `events_tail`. Maintenance renders `id="z2m-backup-preview"` after preview state and never queries `.cbi-map`.

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-monitor-maintenance.test.mjs
```

- [ ] **Step 3: Implement Monitoring**

Implement Connections, Diagnostics, and Service Log using current methods. Poll only while active. Missing `events_tail` renders once:

```text
События недоступны: установленный backend не предоставляет events_tail.
```

Do not start a retry loop for that method.

- [ ] **Step 4: Implement diagnostics jobs**

Keep existing start/cancel/status payloads. On unmount clear frontend timers only; never cancel a backend job unless the user pressed Cancel.

- [ ] **Step 5: Implement Maintenance and Backup Preview**

Migrate service/system, diagnostics export, backup create/list/delete/preview/restore and confirmation. Preview sets component state and rerenders its content host:

```js
state.preview = { scope: scope, takenAt: takenAt, result: result };
ctx.root.replaceChildren(renderMaintenance(ctx, state));
```

Success must create `#z2m-backup-preview`; errors render a red panel in the same location.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --test tests/ui/single-view-monitor-maintenance.test.mjs tests/ui/single-view-manager.test.mjs
for f in z2m-monitor.js z2m-maintenance.js; do node --check "luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/$f" || exit 1; done
git add luci-app-zapret2-manager tests/ui/single-view-monitor-maintenance.test.mjs
git commit -m "feat: rebuild monitoring and maintenance tabs"
```

---

### Task 7: Remove Legacy Runtime, Package r137, and Accept on OpenWrt

**Files:**
- Delete: every `*-legacy.js` in the manager view directory.
- Delete: obsolete `z2m-ui-core.css`, `z2m-ui-v1.css`, `z2m-shell.css`, `z2m-orchestra.css` when no import remains.
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify/replace: `tests/ui/manager-cosmetic-redesign.test.mjs`, `tests/packaging.test.mjs`
- Test: full Node suite.

**Interfaces:** produces a clean packaged frontend, no wrapper code, `0.1.0-r137`, deployment evidence, and final browser acceptance.

- [ ] **Step 1: Add failing cleanup tests**

```js
for (const file of readdirSync(viewRoot))
  assert.equal(file.endsWith('-legacy.js'), false, `legacy runtime file shipped: ${file}`);
for (const file of ['z2m-ui-core.css','z2m-ui-v1.css','z2m-shell.css','z2m-orchestra.css'])
  assert.equal(existsSync(`${viewRoot}/${file}`), false, `obsolete CSS shipped: ${file}`);
assert.equal((readFileSync(`${viewRoot}/app.js`, 'utf8').match(/L\.view\.extend/g) || []).length, 1);
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/ui/single-view-manager.test.mjs
```

- [ ] **Step 3: Delete migrated legacy/CSS files**

Before deletion, compare all old RPC declarations with `z2m-api.js`; delete only after the frozen RPC contract passes.

- [ ] **Step 4: Set package release**

Change only:

```make
PKG_RELEASE:=137
```

Do not change backend package metadata.

- [ ] **Step 5: Run full verification**

```bash
node --test tests/**/*.test.mjs
find luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager -name '*.js' -print0 | xargs -0 -n1 node --check
node -e "JSON.parse(require('fs').readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json'))"
node -e "const fs=require('fs');const s=fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css','utf8');let n=0;for(const c of s){if(c==='{')n++;if(c==='}')n--;if(n<0)process.exit(1)}if(n!==0)process.exit(1)"
! grep -RInE 'https?://|@import' luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager
! grep -RInE 'return\s+Legacy|children\.forEach|require .*legacy' luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager
```

- [ ] **Step 6: Prove backend immutability**

```bash
changed="$(git diff --name-only 5cac06ce32529f54dc30153d35293e39c5c3a9eb..HEAD -- zapret2-manager/files/usr/libexec/)"
test -z "$changed" || { printf '%s\n' "$changed"; exit 1; }
```

- [ ] **Step 7: Build/install APK**

Build `luci-app-zapret2-manager-0.1.0-r137.apk`, install on `192.168.1.1`, then:

```sh
rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

Installed files must include `app.js`, all `z2m-*.js`, and only `z2m-ui.css`; no `*-legacy.js`.

- [ ] **Step 8: Browser acceptance**

Verify:

1. No `factory yielded invalid constructor` or other console exception.
2. One LuCI entry opens the app.
3. Eight internal tabs match the reference; Back/Forward restores hash state.
4. Overview uses real values or explicit unavailable markers.
5. Strategy selection stays draft until Apply; empty `0 targets` is an error.
6. Lists domain check works.
7. Five DNS subtabs open and the dnsmasq warning remains visible.
8. Proxy Stop → Start → Restart, full link, Copy, Open, QR and Rotate work without exceptions.
9. Monitor polling stops when leaving; unsupported events appear once.
10. Backup Create → Preview visibly renders `#z2m-backup-preview`; restore confirmation opens.
11. Desktop, 900 px, and 560 px layouts remain usable.

- [ ] **Step 9: Commit cleanup**

```bash
git add -A luci-app-zapret2-manager tests tools
git commit -m "feat: complete single-view LuCI manager rebuild"
```

- [ ] **Step 10: Record acceptance evidence**

Create `docs/superpowers/reports/2026-08-03-single-view-manager-acceptance.md` with final SHA, APK version, complete test outputs, backend diff guard, browser console result, PASS/FAIL per acceptance item, and screenshots for Overview, Strategy, DNS, Proxy, and Backup Preview.

```bash
git add docs/superpowers/reports/2026-08-03-single-view-manager-acceptance.md
git commit -m "docs: record single-view manager acceptance"
```

---

## Plan Self-Review Result

- **Spec coverage:** root view, eight tabs, exact visual reference, hash routing, RPC preservation, real-data policy, draft/apply/rollback, Proxy, polling cleanup, backup preview, compatibility routes, legacy removal, responsive behavior, packaging, and router verification each map to a task.
- **Placeholder scan:** no incomplete implementation steps or undefined public interfaces remain.
- **Interface consistency:** every tab uses the same context; only `app.js` is the product view; redirect views are standalone.
- **Scope:** one plan is retained because every tab depends on the same shell, API facade, store, draft lifecycle, and packaging transition.