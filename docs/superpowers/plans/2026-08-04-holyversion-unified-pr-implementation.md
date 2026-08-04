# Holyversion Unified PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one unmerged pull request that brings the complete Zapret2 Manager LuCI application to practical visual and interaction parity with the rendered `holyversion.html`, connects every visible control to real backend behavior, and reaches exact-head router verdict `PASS`.

**Architecture:** Keep the existing single-root modular LuCI application: `app.js` coordinates navigation, shared draft/apply state, and page activation; focused `z2m-*` modules render pages and normalize backend data; `z2m-api.js` is the only browser RPC boundary. Extend the existing `zapret2-manager` rpcd ucode object and sanctioned backend modules instead of creating a second runtime, writer, orchestration engine, or state store.

**Tech Stack:** OpenWrt LuCI JavaScript, rpcd ucode, POSIX shell, nftables/OpenWrt service lifecycle, Node.js `node:test` suites, existing repository render harness, signed APK packaging for `aarch64_cortex-a53`, authenticated browser/router validation over SSH.

## Global Constraints

- Work only on remote branch `feat/holyversion-reference-parity`; keep remote branches exactly `main` and `feat/holyversion-reference-parity`.
- Base product commit is `a1b0f897f10fddc323eb232f3246647876a30141`; design commit is `5f8552fe22078ce94c372164e2268761a41a7337`.
- Use one draft PR from `feat/holyversion-reference-parity` to `main`; do not merge or mark ready before the final task.
- `holyversion.html` is the canonical source for rendered information architecture, labels, dimensions, spacing, styling, states, and responsive behavior.
- Do not copy `holyversion.html` wholesale into production and do not create a second browser runtime or state manager.
- Introduce a visible backend-dependent block only in the same task that connects and tests its real backend contract.
- Never render demo values, fake success, simulated progress, raw `null`, raw `undefined`, `[object Object]`, `[object HTMLDivElement]`, or synthetic `—` fillers.
- No inert visible buttons or deferred backend actions.
- Preserve one root `L.view.extend()` in `app.js`; helper modules use `baseclass.extend(...)`.
- `z2m-store.js` owns browser state; `z2m-api.js` owns RPC declarations; backend owns validation, mutation, snapshots, lifecycle, verification, history, and rollback.
- No 60-second automatic rollback countdown. Manual rollback is shown only with backend-confirmed restorable evidence.
- Every behavior starts with a failing test. Do not remove, weaken, or skip existing tests to get green.
- No force-push, temporary branch, temporary workflow, patch dump, generated duplicate runtime, external UI asset, or unrelated refactor.
- No reboot, firewall stop/restart, nft flush, manual `nfqws2` kill, or `--allow-untrusted` unless the user separately approves that exact action.
- A process PID alone is not health proof; mutations require reread and runtime verification.
- Final router verdict must be `PASS`; `PARTIAL` does not permit merge.

---

## File Structure Map

### Existing frontend ownership

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js` — root navigation, activation lifecycle, global draft/apply coordinator.
- `.../z2m-api.js` — all rpcd declarations and domain-grouped API exports.
- `.../z2m-store.js` — applied, draft, coordinator, UI, pending-operation state.
- `.../z2m-shell.js` — reusable panels, buttons, switches, chips, tabs, modal, toast, loading, draft bar.
- `.../z2m-ui.css` and `.../z2m-components.css` — shared Holyversion visual tokens and responsive primitives.
- `.../z2m-overview.js`, `z2m-strategy-page.js`, `z2m-services.js`, `z2m-lists.js`, `z2m-dns.js`, `z2m-proxy.js`, `z2m-monitor.js`, `z2m-maintenance.js` — page controllers.

### Focused frontend files to create

- `.../z2m-format.js` — strict optional-value and human-format functions; never stringifies missing/structured values accidentally.
- `.../z2m-overview-model.js` — normalize overview RPC into visible sections and truth states.
- `.../z2m-strategy-model.js` — catalog, corpus, run, ranking, journal, diagnostics selectors.
- `.../z2m-domain-hub-model.js` — services, domains, lists, Autohostlist, source/build selectors and draft diffs.
- `.../z2m-dns-model.js` — DNS modes, providers, history, ownership, draft normalization.
- `.../z2m-proxy-model.js` — process/listener/connectivity/secret-safe state.
- `.../z2m-monitor-model.js` — structured monitoring rows and client pause/filter state.
- `.../z2m-maintenance-model.js` — packages, system state, backups, restore preview, diagnostics.

### Existing backend ownership

- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` — rpcd object registration and RPC adapters.
- `zapret2-manager/files/usr/libexec/zapret2-manager/status.uc` — runtime/system status collection.
- `.../service.uc` — service lifecycle and verification helpers.
- `.../apply.uc` and sanctioned apply modules — mutations, snapshots, reread, verification, rollback.
- `.../lists.uc` — list paths, list reads/writes, domain checks.
- Existing Orchestra, profiles, DNS, catalog, proxy, backup, diagnostics, and history modules remain authoritative; extend them rather than duplicating them.

### Focused backend files to create only where the existing owner cannot remain focused

- `zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc` — read-only backend-authoritative overview aggregation.
- `.../orchestra-corpus.uc` — versioned 61-domain corpus validation and selection helpers used by the existing Orchestra engine.
- `.../domain-hub.uc` — read/preview/apply adapters over catalog, lists, Autohostlist, and source/build owners; no independent writer.
- `.../monitor.uc` — bounded structured monitoring snapshot from existing runtime evidence.

### Test files

- `tests/router-validation-tools.test.mjs`
- `tests/ui/holyversion-format.test.mjs`
- `tests/ui/holyversion-shell-navigation.test.mjs`
- `tests/holyversion-overview-contract.test.mjs`
- `tests/ui/holyversion-overview.test.mjs`
- `tests/holyversion-strategy-contract.test.mjs`
- `tests/ui/holyversion-strategy.test.mjs`
- `tests/holyversion-domain-hub-contract.test.mjs`
- `tests/ui/holyversion-domain-hub.test.mjs`
- `tests/holyversion-dns-contract.test.mjs`
- `tests/ui/holyversion-dns.test.mjs`
- `tests/ui/holyversion-proxy.test.mjs`
- `tests/holyversion-monitor-contract.test.mjs`
- `tests/ui/holyversion-monitor.test.mjs`
- `tests/ui/holyversion-maintenance.test.mjs`
- `tests/ui/holyversion-responsive.test.mjs`
- `tests/holyversion-package-contents.test.mjs`

---

### Task 1: Repair router-validation foundation

**Files:**
- Modify: `tools/session-check.sh`
- Modify: `tools/smoke.sh`
- Modify: `tools/deploy-verify.sh`
- Create: `tests/router-validation-tools.test.mjs`
- Modify: `docs/router-validation-a1b0f897.md` only after rerunning the fixed checks

**Interfaces:**
- Consumes: installed LuCI `r143`, backend/meta `r137`, router `root@192.168.1.1`.
- Produces: syntax-valid validation scripts whose exit status distinguishes transport failure, route/asset failure, compile failure, list-path ambiguity, and runtime failure.

- [ ] **Step 1: Write RED tests for the five recorded defects**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const session = fs.readFileSync('tools/session-check.sh', 'utf8');
const smoke = fs.readFileSync('tools/smoke.sh', 'utf8');
const deploy = fs.readFileSync('tools/deploy-verify.sh', 'utf8');

test('validation scripts parse and use canonical assets', () => {
  assert.doesNotMatch(smoke, /overview\.js/);
  assert.match(deploy, /\/luci-static\/resources\/view\/zapret2-manager\/app\.js/);
  assert.doesNotMatch(deploy, /\/cgi-bin\/luci\/view\/zapret2-manager/);
  assert.match(smoke, /hostlist-exclude/);
  assert.match(smoke, /\/usr\/share\/rpcd\/ucode\/zapret2-manager/);
  assert.doesNotMatch(session, /echo .*SESSION_TOKEN/);
});
```

- [ ] **Step 2: Run RED tests and shell parser**

Run:

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
```

Expected: at least one test failure and `session-check.sh` parser failure matching the router report.

- [ ] **Step 3: Apply minimal script fixes**

Implement these exact rules:

```sh
STATIC_BASE="http://${ROUTER}/luci-static/resources/view/zapret2-manager"
ROUTE_BASE="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager"
```

- authenticated page routes use `ROUTE_BASE`;
- assets use `STATIC_BASE`;
- `smoke.sh` checks `app.js` and every currently packaged required module, never legacy `overview.js`;
- rpcd no-extension plugin is syntax-checked using the repository's verified wrapper-import method;
- list-path assertions compare complete normalized keys/tokens, so `hostlist` never matches `hostlist-exclude` by substring;
- session token remains only in the mode-0600 cookie jar and remote destroy command.

- [ ] **Step 4: Run focused and full tests**

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
tools/run-all-tests.sh
git diff --check
```

Expected: zero failures.

- [ ] **Step 5: Rerun non-destructive router checks**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

Expected: canonical assets return 200; authenticated routes avoid 404/500; no reboot/TG drill occurs.

- [ ] **Step 6: Commit**

```bash
git add tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh tests/router-validation-tools.test.mjs docs/router-validation-a1b0f897.md
git commit -m "fix: repair router validation tooling"
```

---

### Task 2: Add strict display formatting and reference-state primitives

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js`
- Modify: `.../z2m-shell.js`
- Create: `tests/ui/holyversion-format.test.mjs`
- Modify: `tests/ui/render-harness.test.mjs`

**Interfaces:**
- Produces:
  - `Format.present(value) -> boolean`
  - `Format.text(value) -> string|null`
  - `Format.integer(value) -> string|null`
  - `Format.bytes(value) -> string|null`
  - `Format.duration(seconds) -> string|null`
  - `Format.timestamp(value) -> string|null`
  - `Shell.optional(factory, value) -> Node|null`
  - `Shell.statePanel({title, status, body, actions}) -> Node`

- [ ] **Step 1: Write RED tests for missing and structured values**

```js
test('formatters never expose null-like or object strings', () => {
  assert.equal(Format.text(null), null);
  assert.equal(Format.text(undefined), null);
  assert.equal(Format.text({ ok: true }), null);
  assert.equal(Format.text(['a', 'b']), null);
  assert.equal(Format.integer(12), '12');
  assert.equal(Format.duration(65), '1 мин 5 с');
});
```

Also render representative shell nodes and assert the DOM text contains none of:

```js
['null', 'undefined', '[object Object]', '[object HTMLDivElement]']
```

- [ ] **Step 2: Run RED test**

```bash
node --test tests/ui/holyversion-format.test.mjs
```

Expected: module-not-found or missing exported functions.

- [ ] **Step 3: Implement minimal strict formatters**

```js
function present(value) {
  return value !== null && value !== undefined &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}
function text(value) {
  if (!present(value)) return null;
  var result = String(value).trim();
  return result ? result : null;
}
```

Implement the remaining exports without fallback display text. `Shell.optional()` returns `null` when the formatter returns `null`; callers omit the element entirely.

- [ ] **Step 4: Run tests**

```bash
node --test tests/ui/holyversion-format.test.mjs tests/ui/render-harness.test.mjs
tools/run-all-tests.sh
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js \
  tests/ui/holyversion-format.test.mjs tests/ui/render-harness.test.mjs
git commit -m "feat: add strict holyversion display primitives"
```

---

### Task 3: Match shared shell, navigation, and responsive primitives

**Files:**
- Modify: `.../app.js`
- Modify: `.../z2m-shell.js`
- Modify: `.../z2m-ui.css`
- Modify: `.../z2m-components.css`
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Create: `tests/ui/holyversion-shell-navigation.test.mjs`

**Interfaces:**
- Consumes: `Format.*`, existing activation-token lifecycle, store simple/advanced mode.
- Produces:
  - `Shell.primaryTabs(items, activeId, onSelect)`
  - `Shell.subTabs(items, activeId, onSelect)`
  - `Shell.switchControl(options)` with `on|off|mixed`
  - final visible route map matching rendered Holyversion structure.

- [ ] **Step 1: Write RED DOM contracts**

Assert the root contains exactly one app header, one primary tablist, one active page, one modal host, one toast host, and one draft bar host. Assert tab labels/order equal the rendered reference and hidden/relocated legacy pages are not primary tabs.

```js
assert.deepEqual(primaryLabels(root), [
  'Обзор', 'Стратегия', 'Сервисы и домены', 'DNS',
  'Telegram Proxy', 'Мониторинг', 'Обслуживание'
]);
```

- [ ] **Step 2: Run RED test**

```bash
node --test tests/ui/holyversion-shell-navigation.test.mjs
```

- [ ] **Step 3: Implement shell markup and CSS tokens**

Translate exact reference values into CSS custom properties and reusable classes. Preserve the single `app.js` runtime; do not paste reference event handlers. Primary and subtab activation must call the existing `activate()`/module lifecycle.

- [ ] **Step 4: Add responsive assertions**

Assert no page adds a second root view, desktop tabs remain horizontally usable, and 390px layout uses one-column cards and wrapped actions without hiding the primary action.

- [ ] **Step 5: Run focused/full tests and browser shell check**

```bash
node --test tests/ui/holyversion-shell-navigation.test.mjs tests/ui/single-view-manager.test.mjs
tools/run-all-tests.sh
```

Install the current branch APK and verify header, tabs, simple/advanced toggle, modal, toast, navigation, and zero console errors on the router.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{app.js,z2m-shell.js,z2m-ui.css,z2m-components.css} \
  luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json \
  tests/ui/holyversion-shell-navigation.test.mjs
git commit -m "feat: match holyversion application shell"
```

---

### Task 4: Add backend-authoritative Overview contract

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `.../z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `tests/holyversion-overview-contract.test.mjs`

**Interfaces:**
- Produces RPC `overview_get` with response:

```json
{
  "ok": true,
  "runtime": { "service": {}, "nfqueue": {}, "dns": {}, "proxy": {} },
  "applied": { "strategy": null, "revision": null, "snapshot": null, "appliedAt": null },
  "operation": null,
  "lastCorpusRun": null,
  "recommendations": [],
  "rollback": { "available": false }
}
```

Missing sections are omitted or `null` in RPC data but never rendered directly.

- [ ] **Step 1: Write RED backend contract test**

Test that `overview_get` is registered read-only, has no mutation side effects, distinguishes process/runtime health from bypass/connectivity proof, and never invents corpus results.

- [ ] **Step 2: Run RED test**

```bash
node --test tests/holyversion-overview-contract.test.mjs
```

- [ ] **Step 3: Implement `overview.uc` aggregation**

Read existing status, Orchestra terminal history, applied profile state, package/runtime evidence, proxy health, and rollback metadata. Do not run network probes during `overview_get`; return only stored/available evidence.

- [ ] **Step 4: Register RPC and ACL**

```js
var overviewGet = rpc.declare({ object: 'zapret2-manager', method: 'overview_get', reject: true });
```

Export as `api.overview.get`.

- [ ] **Step 5: Run backend/full tests and target RPC smoke**

```bash
node --test tests/holyversion-overview-contract.test.mjs
tools/run-all-tests.sh
ssh root@192.168.1.1 "ubus call zapret2-manager overview_get '{}'"
```

Expected: normalized JSON, no config/runtime hash change.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  tests/holyversion-overview-contract.test.mjs
git commit -m "feat: expose trusted overview state"
```

---

### Task 5: Render complete Overview from real state

**Files:**
- Create: `.../z2m-overview-model.js`
- Modify: `.../z2m-overview.js`
- Modify: `.../z2m-components.css`
- Create: `tests/ui/holyversion-overview.test.mjs`

**Interfaces:**
- Consumes: `api.overview.get()` response from Task 4.
- Produces: `OverviewModel.normalize(payload)` returning `{hero, health, applied, corpus, operation, recommendations, rollback, visible}`.

- [ ] **Step 1: Write RED model/render tests**

Cover: no raw null, absent sections are not rendered, active operation is distinct from last terminal run, process-alive is not labeled bypass healthy, rollback action appears only when `rollback.available === true` and snapshot identity exists.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/ui/holyversion-overview.test.mjs
```

- [ ] **Step 3: Implement model and reference layout**

Build the exact Holyversion hero, health cards, applied strategy, corpus summary, failures, quick actions, single-resource check, point rules, and recommendation blocks. A block is appended only when its normalized `visible` flag is true.

- [ ] **Step 4: Connect read-only and sanctioned actions**

Quick actions navigate to their real page/subtab; resource check uses existing real probe RPC; manual rollback invokes only the existing verified rollback path and requires a confirmation modal displaying real snapshot metadata.

- [ ] **Step 5: Run tests and router browser acceptance**

```bash
node --test tests/ui/holyversion-overview.test.mjs tests/ui/remastered-overview.test.mjs
tools/run-all-tests.sh
```

On router verify exact layout, absence of literal null, no fake cards, read-only hash stability, and no console errors.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-overview-model.js,z2m-overview.js,z2m-components.css} \
  tests/ui/holyversion-overview.test.mjs
git commit -m "feat: complete holyversion overview"
```

---

### Task 6: Define versioned 61-domain corpus and full-run Orchestra contract

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-corpus.uc`
- Create: `zapret2-manager/files/usr/share/zapret2-manager/corpus/domains-61.json`
- Modify: existing Orchestra backend owner modules
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `.../z2m-api.js`
- Modify: ACL JSON
- Create: `tests/holyversion-strategy-contract.test.mjs`

**Interfaces:**
- Produces:
  - `orchestra_catalog` -> applicable strategy metadata without raw argv in basic payload.
  - `orchestra_corpus_get` -> `{version, digest, domains[61]}`.
  - Extended `orchestra_run_start(edit)` accepting:

```json
{
  "mode": "full-corpus",
  "candidateIds": ["strategy-id"],
  "corpusVersion": "v1",
  "attempts": 1,
  "perAttemptTimeoutSec": 15,
  "totalTimeoutSec": 3600,
  "requestId": "uuid"
}
```

- Run status includes bounded aggregate and per-candidate/per-domain terminal evidence, generation, corpus digest, cancellation/restoration state, and no secrets.

- [ ] **Step 1: Write RED contract tests**

Assert exactly 61 unique normalized domains, stable version/digest, every applicable strategy is selectable, invalid candidate/corpus/revision is rejected, only one active run exists, deadlines are bounded, baseline restoration occurs after each candidate, and terminal runs are not active.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/holyversion-strategy-contract.test.mjs
```

- [ ] **Step 3: Implement corpus parser and extend existing Orchestra engine**

Do not create a second scheduler. The existing run owner stores corpus version/digest, candidate list, current candidate/domain/attempt, bounded journal, and restoration proof. Strategy failure and infrastructure failure use distinct codes.

- [ ] **Step 4: Register read/write RPC and ACL**

Add `orchestra_catalog` and `orchestra_corpus_get` to read ACL; keep start/stop/apply/restore in write ACL. Export through `api.orchestra.catalog`, `api.orchestra.corpus`, and the existing run methods.

- [ ] **Step 5: Run focused/full tests**

```bash
node --test tests/holyversion-strategy-contract.test.mjs tests/orchestra-strategy-ui.test.mjs tests/auto-strategy-package.test.mjs
tools/run-all-tests.sh
```

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-corpus.uc \
  zapret2-manager/files/usr/share/zapret2-manager/corpus/domains-61.json \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  tests/holyversion-strategy-contract.test.mjs
git commit -m "feat: add full corpus orchestra contract"
```

---

### Task 7: Complete Strategy UI and verified apply flow

**Files:**
- Create: `.../z2m-strategy-model.js`
- Modify: `.../z2m-strategy-page.js`
- Modify: `.../z2m-strategy.js`
- Modify: `.../z2m-runs.js`
- Modify: `.../z2m-components.css`
- Create: `tests/ui/holyversion-strategy.test.mjs`

**Interfaces:**
- Consumes: Task 6 catalog/corpus/run APIs plus existing preview/apply/restore APIs.
- Produces Strategy subtabs: strategies, selection/progress, diagnostics, journal/history, settings; one page-owned global draft adapter for selected winner/application.

- [ ] **Step 1: Write RED UI state-machine tests**

Cover catalog cards, applicability, one primary action, full-corpus acknowledgement, progress, cooperative cancel, pending candidates compactness, failed candidate journal retention, terminal missing run, basic-mode redaction, and verified winner application.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/ui/holyversion-strategy.test.mjs
```

- [ ] **Step 3: Implement model selectors**

```js
function normalizeRun(run) {
  return {
    active: run && run.terminal !== true && run.status !== 'missing',
    terminal: run && run.terminal === true,
    generation: Number.isInteger(run && run.generation) ? run.generation : null,
    progress: normalizeProgress(run),
    candidates: normalizeCandidates(run),
    journal: normalizeJournal(run)
  };
}
```

No model function stringifies arbitrary objects.

- [ ] **Step 4: Implement reference markup and real actions**

Render real cards and subtabs. Start uses `mode:"full-corpus"`; stop uses cooperative stop; apply first performs real preview, creates global draft semantic rows, then coordinator apply invokes the sanctioned Orchestra apply and reread verification. Technical IDs/argv live only in advanced disclosure.

- [ ] **Step 5: Run tests and safe router acceptance**

```bash
node --test tests/ui/holyversion-strategy.test.mjs tests/ui/single-view-overview-strategy.test.mjs
tools/run-all-tests.sh
```

On router run read-only catalog/corpus first. Execute full-corpus mutation only in the explicitly approved safe window with saved baseline and verify cancellation/restoration before testing winner apply.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-strategy-model.js,z2m-strategy-page.js,z2m-strategy.js,z2m-runs.js,z2m-components.css} \
  tests/ui/holyversion-strategy.test.mjs
git commit -m "feat: complete holyversion strategy workflow"
```

---

### Task 8: Define unified Services/domains/Lists/Autohostlist backend contract

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub.uc`
- Modify: existing catalog/list/source backend owners
- Modify: rpcd plugin, `z2m-api.js`, ACL JSON
- Create: `tests/holyversion-domain-hub-contract.test.mjs`

**Interfaces:**
- Produces read RPC `domain_hub_get`:

```json
{
  "ok": true,
  "revision": 1,
  "catalog": { "digest": "sha256", "services": [], "categories": [] },
  "userDomains": { "include": [], "exclude": [] },
  "autohostlist": { "entries": [], "counts": {} },
  "sources": [],
  "build": null
}
```

- Produces `domain_hub_preview(edit)` and `domain_hub_apply(edit)` using exact revision/digest preconditions and sanctioned catalog/list/source writers.
- Preview returns semantic affected entries, blockers, restart plan, and snapshot identity; apply rereads and verifies every changed scope.

- [ ] **Step 1: Write RED contract tests**

Cover tri-state category derivation inputs, exact include/exclude identity, valid domain normalization, Autohostlist promote/ignore/stale cleanup, source schedule/update state, digest/revision conflicts, atomic snapshot, partial failure reporting, and rollback proof.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/holyversion-domain-hub-contract.test.mjs
```

- [ ] **Step 3: Implement adapter without a second writer**

`domain-hub.uc` calls existing catalog/list/source functions, builds one preview, orders mutations, and invokes their sanctioned writes. It never edits production files directly when an owner function exists.

- [ ] **Step 4: Register RPC/API/ACL**

Export as `api.domainHub.get`, `api.domainHub.preview`, `api.domainHub.apply`.

- [ ] **Step 5: Run tests and target read-only smoke**

```bash
node --test tests/holyversion-domain-hub-contract.test.mjs tests/service-dns-contract.test.mjs
tools/run-all-tests.sh
ssh root@192.168.1.1 "ubus call zapret2-manager domain_hub_get '{}'"
```

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  tests/holyversion-domain-hub-contract.test.mjs
git commit -m "feat: add unified domain hub backend"
```

---

### Task 9: Complete unified Services and domains interface

**Files:**
- Create: `.../z2m-domain-hub-model.js`
- Modify: `.../z2m-services.js`
- Modify: `.../z2m-lists.js` as compatibility/fallback only
- Modify: `.../app.js`
- Modify: CSS files
- Create: `tests/ui/holyversion-domain-hub.test.mjs`

**Interfaces:**
- Consumes: Task 8 domain hub API.
- Produces Holyversion hub subtabs: catalog, my domains, Autohostlist, sources/build; one `domainHub` draft scope and adapter.

- [ ] **Step 1: Write RED UI tests**

Assert real category `on|off|mixed`, global actions affect all services despite search, individual override after category action, KPI/filter consistency, semantic changed rows, domain include/exclude editing, Autohostlist promote/ignore/cleanup, source status/update/schedule/history, and exact conflict rows.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs
```

- [ ] **Step 3: Implement selectors and draft reducer**

Expose pure functions:

```js
categoryState(services, enabledById)
toggleCategory(services, enabledById, categoryId)
toggleAll(services, enabledById, next)
applyDomainAction(snapshot, action)
semanticChanges(baseline, draft)
```

- [ ] **Step 4: Implement exact reference hub and adapter**

All mutations enter the global draft. Preview calls `domain_hub_preview`; apply calls `domain_hub_apply`; successful scopes are cleared only after reread verification. Old Lists capability remains reachable through the hub, not as a duplicate primary runtime.

- [ ] **Step 5: Run tests and router scenarios**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs tests/ui/services-parity.test.mjs tests/ui/services-model.test.mjs
tools/run-all-tests.sh
```

Router scenarios cover draft-no-mutation, category mixed state, semantic diff, cancel, one safe service/domain apply, reload persistence, and runtime evidence.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-domain-hub-model.js,z2m-services.js,z2m-lists.js,app.js,z2m-ui.css,z2m-components.css} \
  tests/ui/holyversion-domain-hub.test.mjs
git commit -m "feat: complete services and domains hub"
```

---

### Task 10: Complete DNS interface, history, and verified apply

**Files:**
- Create: `.../z2m-dns-model.js`
- Modify: `.../z2m-dns.js`
- Modify: existing DNS backend owner and rpcd plugin only if `dns_history` is absent
- Modify: `z2m-api.js`, ACL JSON when adding `dns_history`
- Create: `tests/holyversion-dns-contract.test.mjs`
- Create: `tests/ui/holyversion-dns.test.mjs`

**Interfaces:**
- Produces optional read RPC `dns_history` returning bounded redacted entries.
- DNS adapter supports get/validate/check/preview/apply/reread/verify/rollback through existing APIs.

- [ ] **Step 1: Write RED backend/UI tests**

Cover safe system-DNS default, DoH/DoT/UDP, primary/fallback, real latency only after check, per-service ownership, advanced fields, revision conflict, semantic preview, verified apply, history, and rollback visibility.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
```

- [ ] **Step 3: Implement missing bounded history contract**

Only add `dns_history` when current backend has no equivalent. Entries contain timestamp, mode/provider IDs, result, revision, and redacted error; no secret URLs/tokens.

- [ ] **Step 4: Implement model/reference page and global adapter**

Provider recommendations remain absent until a real check result exists. Apply requires successful validate/check/preview, expected revision, sanctioned DNS apply, reread, and verification.

- [ ] **Step 5: Run tests and router DNS acceptance**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs tests/service-dns-contract.test.mjs
tools/run-all-tests.sh
```

Perform read-only checks, then one safe reversible mutation with baseline hashes and rollback proof.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-dns-model.js,z2m-dns.js,z2m-api.js} \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
git commit -m "feat: complete holyversion dns workflow"
```

---

### Task 11: Complete Telegram Proxy interface with secret-safe real health

**Files:**
- Create: `.../z2m-proxy-model.js`
- Modify: `.../z2m-proxy.js`
- Modify: `.../z2m-components.css`
- Create: `tests/ui/holyversion-proxy.test.mjs`

**Interfaces:**
- Consumes existing proxy capabilities/status/config/validate/preview/apply/start/stop/restart/autostart/rotate/logs/health/link APIs.
- Produces proxy truth state `{process, listener, connectivity, connections, config, activity, logs, reveal}` and global proxy draft adapter.

- [ ] **Step 1: Write RED tests**

Assert running process plus failed listener/connectivity renders degraded, not healthy; secret/link never loads or renders before explicit reveal; logs are bounded/redacted; config preview is semantic; lifecycle actions reread status.

- [ ] **Step 2: Run RED test**

```bash
node --test tests/ui/holyversion-proxy.test.mjs
```

- [ ] **Step 3: Implement model and reference page**

Use separate process, listener, outbound connectivity, and active-connection evidence. Basic/advanced settings follow the reference. Reveal action calls `proxy_link_info` only after confirmation and clears revealed data on unmount/navigation.

- [ ] **Step 4: Connect global draft/apply and lifecycle verification**

Config apply validates, previews, mutates, rereads config and health. Start/stop/restart/autostart/rotate are explicit immediate operations with confirmation where destructive and post-operation verification.

- [ ] **Step 5: Run tests and non-destructive router acceptance**

```bash
node --test tests/ui/holyversion-proxy.test.mjs tests/ui/single-view-proxy.test.mjs tests/t3-6-proxy-runtime.test.mjs
tools/run-all-tests.sh
```

Do not run uninstall/reboot drill. Verify no secret in DOM, console, store, or logs.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-proxy-model.js,z2m-proxy.js,z2m-components.css} \
  tests/ui/holyversion-proxy.test.mjs
git commit -m "feat: complete holyversion proxy interface"
```

---

### Task 12: Add structured Monitoring backend snapshot

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc`
- Modify: rpcd plugin, `z2m-api.js`, ACL JSON
- Create: `tests/holyversion-monitor-contract.test.mjs`

**Interfaces:**
- Produces read RPC `monitor_snapshot(edit)` with bounded filters and response:

```json
{
  "ok": true,
  "capturedAt": "timestamp",
  "runtime": {},
  "rows": [
    { "host": "example.org", "decision": "bypass", "profile": "id", "rule": "label", "drops": 0, "errors": [] }
  ],
  "cursor": null
}
```

No raw packet payload, secret, unbounded log, or arbitrary argv in basic fields.

- [ ] **Step 1: Write RED contract tests**

Cover bounded limit, stable cursor, host/filter validation, structured decisions, profile/rule attribution, drops/errors, advanced technical detail separation, and read-only side-effect absence.

- [ ] **Step 2: Run RED test**

```bash
node --test tests/holyversion-monitor-contract.test.mjs
```

- [ ] **Step 3: Implement snapshot from existing evidence**

Collect only evidence the router actually exposes. Unsupported fields are omitted. Client pause/resume remains a polling control, not a backend service mutation.

- [ ] **Step 4: Register API/ACL and run tests**

```bash
node --test tests/holyversion-monitor-contract.test.mjs
tools/run-all-tests.sh
```

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  tests/holyversion-monitor-contract.test.mjs
git commit -m "feat: expose structured monitoring evidence"
```

---

### Task 13: Complete Monitoring interface

**Files:**
- Create: `.../z2m-monitor-model.js`
- Modify: `.../z2m-monitor.js`
- Modify: CSS files
- Create: `tests/ui/holyversion-monitor.test.mjs`

**Interfaces:**
- Consumes: `api.monitor.snapshot(filters)`.
- Produces polling controller with `start()`, `pause()`, `resume()`, `setFilters()`, `destroy()` and no timer after unmount.

- [ ] **Step 1: Write RED lifecycle/render tests**

Assert reference filters/table/cards, pause prevents new polling, resume performs one immediate read, unmount clears timer, mobile uses cards, advanced details are collapsed, and no raw JSON is primary.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/ui/holyversion-monitor.test.mjs
```

- [ ] **Step 3: Implement model/controller/page**

Normalize only structured fields from Task 12. Render empty UI only when backend returns a real empty result; while no result exists render the real loading state.

- [ ] **Step 4: Run tests and router read-only acceptance**

```bash
node --test tests/ui/holyversion-monitor.test.mjs tests/ui/single-view-manager.test.mjs
tools/run-all-tests.sh
```

Verify hashes/PIDs remain unchanged during monitoring.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-monitor-model.js,z2m-monitor.js,z2m-ui.css,z2m-components.css} \
  tests/ui/holyversion-monitor.test.mjs
git commit -m "feat: complete holyversion monitoring"
```

---

### Task 14: Complete Maintenance interface and verified restore presentation

**Files:**
- Create: `.../z2m-maintenance-model.js`
- Modify: `.../z2m-maintenance.js`
- Modify: CSS files
- Create: `tests/ui/holyversion-maintenance.test.mjs`

**Interfaces:**
- Consumes existing versions, maintenance status, backup list/create/restore preview/restore/delete, events tail, diagnostics export.
- Produces semantic package/system/backup/diagnostic sections; no raw JSON primary output.

- [ ] **Step 1: Write RED tests**

Cover formatted uptime/memory, installed releases, backup rows, semantic restore preview, confirmation requiring exact backup identity, verified restore result, delete confirmation, bounded logs, and dangerous-action labels.

- [ ] **Step 2: Run RED test**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs
```

- [ ] **Step 3: Implement model and reference page**

Use `Format.bytes/duration/timestamp`. Restore preview must list exact changed/restored scopes and blockers; restore success requires backend response plus subsequent maintenance/status reread.

- [ ] **Step 4: Run tests and router acceptance**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs
tools/run-all-tests.sh
```

Run backup create/preview. Perform actual restore only with a dedicated safe backup and explicit test approval; otherwise final verdict cannot be PASS for that scenario.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{z2m-maintenance-model.js,z2m-maintenance.js,z2m-ui.css,z2m-components.css} \
  tests/ui/holyversion-maintenance.test.mjs
git commit -m "feat: complete holyversion maintenance"
```

---

### Task 15: Finish global draft/apply coverage for every mutable visible scope

**Files:**
- Modify: `.../app.js`
- Modify: `.../z2m-draft-model.js`
- Modify: `.../z2m-store.js`
- Modify: page modules/adapters from Tasks 7, 9, 10, 11, and 14
- Modify: `tests/ui/global-draft-apply.test.mjs`
- Modify: `tests/ui/draft-model.test.mjs`

**Interfaces:**
- Every mutable page adapter implements:

```js
{
  supported: true,
  validateDraft(scope, value, context),
  previewDraft(scope, value, context),
  applyDraft(scope, value, expectedRevision, context),
  reloadAppliedState(context),
  verifyApplied(value, context, read),
  resetDraft()
}
```

- Apply order is explicitly defined and tested: strategy/profile prerequisites, services/domain hub, DNS, proxy config, maintenance-safe settings. Unsupported/dangerous immediate operations never enter the global batch.

- [ ] **Step 1: Add RED cross-scope tests**

Test semantic grouping, preflight-all-before-mutation, revision conflict, deterministic order, partial failure retention, successful-scope clearing only after verification, secret redaction, manual rollback proof, and no automatic confirmation timer.

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs
```

- [ ] **Step 3: Complete coordinator and adapters**

Snapshot draft/revisions, validate all, preview all, stop before mutation on any blocker, apply in tested order, reread/verify each, retain failures, refresh affected pages/Overview, and show manual rollback only from returned proof.

- [ ] **Step 4: Run focused/full tests and multi-scope router scenario**

```bash
node --test tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs tests/ui/rpc-semantics.test.mjs
tools/run-all-tests.sh
```

On router create two safe scopes, preview, cancel, recreate, apply, reload, verify both scopes and runtime evidence.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/{app.js,z2m-draft-model.js,z2m-store.js,z2m-strategy-page.js,z2m-services.js,z2m-dns.js,z2m-proxy.js,z2m-maintenance.js} \
  tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs
git commit -m "feat: finish verified global apply coordination"
```

---

### Task 16: Perform exact visual/responsive parity audit and close UI gaps

**Files:**
- Create: `docs/holyversion-parity-matrix.md`
- Create: `tests/ui/holyversion-responsive.test.mjs`
- Modify: only frontend/CSS files named by a recorded matrix gap

**Interfaces:**
- Produces matrix row fields: reference location/state, production location/state, visual verdict, behavioral verdict, backend source, source test, router evidence, intentional deviation.

- [ ] **Step 1: Render/capture the reference and production at four widths**

Use:

```text
1920×1080
1366×768
1024×768
390×844
```

Cover every page, subtab, modal, empty/loading/error/success state that can be produced from real fixtures.

- [ ] **Step 2: Write RED responsive/parity assertions for every P0/P1 gap**

Examples:

```js
assert.equal(horizontalOverflow(root, 390), 0);
assert.equal(primaryActionVisible(root, 390), true);
assert.equal(rawNullLikeText(root), false);
assert.equal(duplicateRuntimeRoots(root), 0);
```

- [ ] **Step 3: Fix only recorded gaps**

No unrelated refactor. Each fix updates its matrix row and targeted test.

- [ ] **Step 4: Run complete UI/full gate**

```bash
node --test tests/ui/holyversion-*.test.mjs
tools/run-all-tests.sh
git diff --check
```

Expected: no unresolved P0/P1; any P2 is documented for explicit user approval.

- [ ] **Step 5: Commit**

```bash
git add docs/holyversion-parity-matrix.md tests/ui/holyversion-responsive.test.mjs \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager
git commit -m "fix: close holyversion parity gaps"
```

---

### Task 17: Package complete product and enforce package contents

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `zapret2-manager/Makefile` only when backend files changed
- Modify: `zapret2-manager-full/Makefile` only when dependency release must change
- Modify: `tools/build-apk-manual.sh`
- Create: `tests/holyversion-package-contents.test.mjs`
- Modify: existing packaging tests

**Interfaces:**
- Produces next unused releases; signed APK contain every created JS/CSS/ucode/JSON file and correct ACL/menu files.

- [ ] **Step 1: Write RED package manifest test**

Assert APK staging includes all focused modules and backend files from this plan, package metadata versions agree, and no legacy missing-asset expectation remains.

- [ ] **Step 2: Run RED packaging test**

```bash
node --test tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
```

- [ ] **Step 3: Bump releases once at final packaging boundary**

Read current releases from the branch and increment each changed package to the next unused integer. Do not reuse `r143`/`r137` for changed contents.

- [ ] **Step 4: Build and verify signed APK**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh
apk verify path/to/*.apk
sha256sum path/to/*.apk
```

Inspect package file lists and record exact SHA-256 in the final router report.

- [ ] **Step 5: Run full gate and commit**

```bash
node --test tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
tools/run-all-tests.sh
git diff --check
git add luci-app-zapret2-manager/Makefile zapret2-manager/Makefile zapret2-manager-full/Makefile tools/build-apk-manual.sh tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
git commit -m "build: package complete holyversion interface"
```

---

### Task 18: Run comprehensive exact-head router acceptance

**Files:**
- Create: `docs/router-validation-<FINAL_SHORT_SHA>.md`
- Modify: `docs/holyversion-parity-matrix.md` with router evidence links/identifiers only

**Interfaces:**
- Consumes exact PR head, signed APK, fixed validation tooling, router `192.168.1.1`.
- Produces final verdict `PASS|PARTIAL|FAIL`; merge gate accepts only `PASS`.

- [ ] **Step 1: Freeze exact head and baseline**

```bash
git status --short
git rev-parse HEAD
git diff --check
ssh root@192.168.1.1 'uptime; apk list --installed | grep -E "zapret2-manager|luci-app-zapret2-manager"; pidof nfqws2; sha256sum /etc/zapret2-manager/state.json /etc/config/zapret2 /etc/config/dhcp /opt/zapret2/config 2>/dev/null'
```

Abort if the working tree is dirty or head changes during acceptance.

- [ ] **Step 2: Install exact signed packages and run automatic gates**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

Record package versions, APK hashes, authenticated routes, canonical assets, syntax/infra results.

- [ ] **Step 3: Execute every browser scenario**

For every page/subtab/modal at desktop and mobile record: route, screenshot, console errors, rejected promises, failed network requests, loading/empty/error/success states, read-only actions, and visible reference-parity row.

- [ ] **Step 4: Execute sanctioned mutation matrix**

Cover global draft cancel/apply/conflict/partial-failure/verification/manual rollback; full-corpus Strategy start/progress/cancel/restore/result/winner apply; Services/domain/Autohostlist/source mutation; DNS check/apply/rollback; proxy config/lifecycle without secret exposure; maintenance backup preview and approved restore.

- [ ] **Step 5: Recheck runtime and explain every change**

Verify nfqws2 identity/cmdline, NFQUEUE owner/counters, nftables table/rules, dnsmasq, rpcd, uhttpd, APPLIED/RUNTIME/config hashes, active operations, and package versions. Every changed hash must map to a sanctioned successful transaction.

- [ ] **Step 6: Write verdict report**

`PASS` requires every planned scenario and parity row complete. `PARTIAL` or `FAIL` creates a bounded fix task inside the same PR and returns to the relevant earlier task; do not merge.

- [ ] **Step 7: Commit PASS report**

```bash
git add docs/router-validation-<FINAL_SHORT_SHA>.md docs/holyversion-parity-matrix.md
git commit -m "docs: record full router acceptance"
```

Because the report commit changes the exact head, rerun source/CI checks and a final read-only router identity/package/asset verification against the report commit before readiness.

---

### Task 19: Whole-PR review, exact-head CI, and readiness gate

**Files:**
- Modify: only files required by verified review findings
- Modify: final router report with post-report-commit read-only evidence

**Interfaces:**
- Produces one review-clean draft PR ready for user-authorized transition to ready/merge.

- [ ] **Step 1: Run final verification suite**

```bash
sh -n tools/*.sh
node --test tests/**/*.test.mjs tests/*.test.mjs
tools/run-all-tests.sh
git diff --check
git status --short
```

- [ ] **Step 2: Request three bounded reviews**

Run spec-compliance review against the unified design, code-quality/safety review, and final parity/router-evidence review. Reviewers must inspect the complete PR diff but report findings by task/file with severity and evidence.

- [ ] **Step 3: Fix Critical and Important findings with TDD**

For each finding: reproduce with a failing test, implement the smallest fix, run focused/full tests, repeat affected router scenario, and commit with a scoped `fix:` message. Do not run a generic whole-branch fixer.

- [ ] **Step 4: Verify PR scope and branch invariant**

```bash
git branch -r
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected remote branches: only `origin/main` and `origin/feat/holyversion-reference-parity`; every changed file maps to this plan or an evidenced fix.

- [ ] **Step 5: Verify exact-head GitHub Actions**

Push the final head, wait for `Single-view UI gate / verify`, inspect job steps/logs, and record exact run/job IDs. Do not reuse a run from an older SHA.

- [ ] **Step 6: Present readiness evidence without merging**

Report:

```text
Exact head: <sha>
Full repository gate: 0 failed
CI exact-head: PASS
Parity P0/P1: 0
Router verdict: PASS
Remote branches: main + feat/holyversion-reference-parity
Unresolved review threads: 0
```

Mark the PR ready or merge only after explicit user instruction.
