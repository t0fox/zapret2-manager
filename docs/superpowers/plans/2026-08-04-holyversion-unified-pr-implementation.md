# Holyversion Unified PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one unmerged pull request that brings the complete Zapret2 Manager LuCI application to practical visual and interaction parity with the rendered `holyversion.html`, connects every visible control to real backend behavior, and reaches exact-head router verdict `PASS`.

**Architecture:** Keep the existing single-root modular LuCI application: `app.js` coordinates navigation, shared draft/apply state, and page activation; focused `z2m-*` modules render pages and normalize backend data; `z2m-api.js` remains the only browser RPC boundary. Extend the existing `zapret2-manager` rpcd ucode object and sanctioned backend modules instead of creating a second runtime, writer, orchestration engine, or state store.

**Tech Stack:** OpenWrt LuCI JavaScript, rpcd ucode, POSIX shell, nftables/OpenWrt service lifecycle, Node.js `node:test`, the existing repository render harness, signed APK packaging for `aarch64_cortex-a53`, authenticated browser/router validation over SSH.

## Global Constraints

- Work only on remote branch `feat/holyversion-reference-parity`; keep remote branches exactly `main` and `feat/holyversion-reference-parity`.
- Base product commit is `a1b0f897f10fddc323eb232f3246647876a30141`; approved design commit is `5f8552fe22078ce94c372164e2268761a41a7337`.
- Use one draft PR from `feat/holyversion-reference-parity` to `main`; do not merge or mark ready before Task 17.
- `holyversion.html` is canonical for rendered information architecture, labels, dimensions, spacing, styling, states, and responsive behavior.
- Do not copy `holyversion.html` wholesale and do not create a second browser runtime or state manager.
- Introduce a visible backend-dependent block only in the same task that connects and tests its real backend contract.
- Never render demo values, fake success, simulated progress, raw `null`, raw `undefined`, `[object Object]`, `[object HTMLDivElement]`, or synthetic `—` fillers.
- No inert visible buttons or deferred backend actions.
- Preserve one root `L.view.extend()` in `app.js`; helper modules use `baseclass.extend(...)`.
- `z2m-store.js` owns browser state; `z2m-api.js` owns RPC declarations; backend owns validation, mutation, snapshots, lifecycle, verification, history, and rollback.
- No 60-second automatic rollback countdown. Manual rollback is visible only with backend-confirmed restorable evidence.
- Every behavior starts with a failing test. Do not remove, weaken, or skip existing tests to get green.
- No force-push, temporary branch, temporary workflow, patch dump, duplicate runtime, external UI asset, or unrelated refactor.
- No reboot, firewall stop/restart, nft flush, manual `nfqws2` kill, or `--allow-untrusted` unless the user separately approves that exact action.
- A PID alone is not health proof; mutations require reread and runtime verification.
- Final router verdict must be `PASS`; `PARTIAL` does not permit merge.

---

## Locked File Boundaries

### Existing frontend owners

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-lists.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`

### Focused frontend modules to create

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-domain-hub-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js`

### Backend owners and focused additions

- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` remains the only rpcd object registration point.
- `zapret2-manager/files/usr/libexec/zapret2-manager/status.uc`, `service.uc`, `apply.uc`, and `lists.uc` remain authoritative owners.
- Create `zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc` for read-only overview aggregation.
- Create `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-corpus.uc` for corpus validation used by the existing Orchestra methods.
- Create `zapret2-manager/files/usr/share/zapret2-manager/corpus/domains-61.json` as the versioned corpus.
- Create `zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub.uc` as an adapter over existing catalog/list/source owners, never as a writer replacement.
- Create `zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc` for bounded structured monitoring evidence.

---

### Task 1: Repair router-validation tooling

**Files:**
- Modify: `tools/session-check.sh`
- Modify: `tools/smoke.sh`
- Modify: `tools/deploy-verify.sh`
- Create: `tests/router-validation-tools.test.mjs`
- Modify: `docs/router-validation-a1b0f897.md`

**Interfaces:**
- Consumes router `root@192.168.1.1` and installed LuCI/backend packages.
- Produces syntax-valid scripts with canonical route/asset checks and unambiguous exit status.

- [x] **Step 1: Write the failing regression test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const session = fs.readFileSync('tools/session-check.sh', 'utf8');
const smoke = fs.readFileSync('tools/smoke.sh', 'utf8');
const deploy = fs.readFileSync('tools/deploy-verify.sh', 'utf8');

test('router validation uses current single-view assets', () => {
  assert.doesNotMatch(smoke, /overview\.js/);
  assert.match(deploy, /\/luci-static\/resources\/view\/zapret2-manager\/app\.js/);
  assert.doesNotMatch(deploy, /\/cgi-bin\/luci\/view\/zapret2-manager/);
  assert.match(smoke, /hostlist-exclude/);
  assert.match(smoke, /\/usr\/share\/rpcd\/ucode\/zapret2-manager/);
  assert.doesNotMatch(session, /echo .*SESSION_TOKEN/);
});
```

- [x] **Step 2: Prove RED**

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
```

Expected: test failure plus the recorded `session-check.sh` syntax failure.

- [x] **Step 3: Implement the exact fixes**

```sh
STATIC_BASE="http://${ROUTER}/luci-static/resources/view/zapret2-manager"
ROUTE_BASE="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager"
```

Authenticated pages use `ROUTE_BASE`; assets use `STATIC_BASE`. `smoke.sh` checks `app.js` plus packaged modules, validates the no-extension rpcd plugin through actual rpcd registration and `status`, and compares normalized full list keys so `hostlist` cannot match `hostlist-exclude` by substring. Session tokens remain only in the mode-0600 jar and remote destroy call.

- [x] **Step 4: Prove GREEN**

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
tools/run-all-tests.sh
git diff --check
```

Source/CI result at `e9f1be6e0cf54ccc3ce6c4674bb97c5a6a7210f2`: `1146 green, 0 red`.

- [ ] **Step 5: Rerun non-destructive router checks**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

- [ ] **Step 6: Record router evidence and close Task 1**

```bash
git add docs/router-validation-a1b0f897.md
git commit -m "docs: record repaired router validation"
```

---

### Task 2: Build strict formatting, shell, and navigation parity

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`
- Create: `tests/ui/holyversion-format.test.mjs`
- Create: `tests/ui/holyversion-shell-navigation.test.mjs`

**Interfaces:**
- Produces `Format.present`, `Format.text`, `Format.integer`, `Format.bytes`, `Format.duration`, and `Format.timestamp`, each returning a formatted string or `null`.
- Produces `Shell.optional`, `Shell.primaryTabs`, `Shell.subTabs`, `Shell.switchControl`, and `Shell.statePanel`.

- [ ] **Step 1: Write RED formatter and DOM tests**

```js
test('formatters never leak missing or structured values', () => {
  assert.equal(Format.text(null), null);
  assert.equal(Format.text(undefined), null);
  assert.equal(Format.text({ ok: true }), null);
  assert.equal(Format.text(['a']), null);
  assert.equal(Format.duration(65), '1 мин 5 с');
});

assert.deepEqual(primaryLabels(root), [
  'Обзор', 'Стратегия', 'Сервисы и домены', 'DNS',
  'Telegram Proxy', 'Мониторинг', 'Обслуживание'
]);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-format.test.mjs tests/ui/holyversion-shell-navigation.test.mjs
```

- [ ] **Step 3: Implement strict formatters**

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

Other formatters never substitute display filler. `Shell.optional(factory, value)` returns `null` when the formatted value is `null`.

- [ ] **Step 4: Implement the Holyversion shell without a second runtime**

Preserve `activate()`, activation tokens, store ownership, modal/toast hosts, and one root view. Translate reference dimensions/tokens into CSS custom properties and reusable classes. Hidden/relocated legacy pages are not primary tabs.

- [ ] **Step 5: Prove GREEN and inspect on router**

```bash
node --test tests/ui/holyversion-format.test.mjs tests/ui/holyversion-shell-navigation.test.mjs tests/ui/single-view-manager.test.mjs
tools/run-all-tests.sh
```

Install the branch APK and verify shell, simple/advanced mode, navigation, modal, toast, and zero console errors.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json \
  tests/ui/holyversion-format.test.mjs tests/ui/holyversion-shell-navigation.test.mjs
git commit -m "feat: match holyversion application shell"
```

---

### Task 3: Add trusted Overview backend and complete Overview UI

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- Create: `tests/holyversion-overview-contract.test.mjs`
- Create: `tests/ui/holyversion-overview.test.mjs`

**Interfaces:**
- Adds read RPC `overview_get`.
- Exports `api.overview.get`.
- `OverviewModel.normalize(payload)` returns visibility-gated hero, health, applied, operation, corpus, recommendations, and rollback sections.

- [ ] **Step 1: Write RED backend and UI tests**

```js
assert.equal(rpcMethods.read.has('overview_get'), true);
assert.equal(renderText({ runtime: { service: { running: true } } }).includes('обход работает'), false);
assert.equal(renderText({ rollback: { available: false } }).includes('Вернуться'), false);
assert.equal(hasRawNullLikeText(root), false);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-overview-contract.test.mjs tests/ui/holyversion-overview.test.mjs
```

- [ ] **Step 3: Implement `overview_get`**

Return stored/read-only evidence only:

```json
{
  "ok": true,
  "runtime": { "service": {}, "nfqueue": {}, "dns": {}, "proxy": {} },
  "applied": { "strategy": null, "source": null, "revision": null, "appliedAt": null },
  "operation": null,
  "corpus": null,
  "recommendations": [],
  "rollback": { "available": false }
}
```

Do not run probes during this read call and do not infer bypass health from process liveness.

- [ ] **Step 4: Register RPC/API/ACL and implement the reference Overview**

Render only visibility-approved sections. Quick actions navigate to real page/subtab actions. Manual rollback requires backend snapshot identity, confirmation, sanctioned rollback, reread, and verification.

- [ ] **Step 5: Prove GREEN and run router acceptance**

```bash
node --test tests/holyversion-overview-contract.test.mjs tests/ui/holyversion-overview.test.mjs tests/ui/remastered-overview.test.mjs
tools/run-all-tests.sh
ssh root@192.168.1.1 "ubus call zapret2-manager overview_get '{}'"
```

Verify no config hash changes from read-only use and no literal `null` on screen.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/overview.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js \
  tests/holyversion-overview-contract.test.mjs tests/ui/holyversion-overview.test.mjs
git commit -m "feat: complete trusted holyversion overview"
```

---

### Task 4: Add versioned 61-domain corpus and full-run Orchestra contract

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-corpus.uc`
- Create: `zapret2-manager/files/usr/share/zapret2-manager/corpus/domains-61.json`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `tests/holyversion-strategy-contract.test.mjs`

**Interfaces:**
- Adds read RPC `orchestra_catalog`.
- Adds read RPC `orchestra_corpus_get` returning exactly 61 unique domains with stable `version` and `digest`.
- Extends existing `orchestra_run_start` to accept `mode:"full-corpus"`, `candidateIds`, `corpusVersion`, `attempts`, bounded timeouts, and `requestId`.

- [ ] **Step 1: Write RED contract tests**

```js
assert.equal(corpus.domains.length, 61);
assert.equal(new Set(corpus.domains).size, 61);
assert.equal(typeof corpus.version, 'string');
assert.match(corpus.digest, /^[a-f0-9]{64}$/);
assert.equal(fullRun.targets.length, 61);
assert.deepEqual(fullRun.candidateIds, applicableCandidateIds);
```

Also test single active operation, generation integer, digest drift rejection, bounded journal, deterministic ranking, cooperative stop, and infrastructure-vs-strategy failure codes.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-strategy-contract.test.mjs
```

- [ ] **Step 3: Implement corpus validation and extend the existing Orchestra methods**

Do not create another scheduler. Existing `orchestra_run_start`, status, history, stop, apply, and restore methods store corpus version/digest, candidate/domain/attempt cursor, bounded evidence, and restoration proof.

- [ ] **Step 4: Register API/ACL**

Export `api.orchestra.catalog` and `api.orchestra.corpus`; retain existing run methods.

- [ ] **Step 5: Prove GREEN**

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

### Task 5: Complete the Holyversion Strategy interface

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/holyversion-strategy.test.mjs`

**Interfaces:**
- Consumes Task 4 catalog/corpus/run APIs and existing preview/apply/restore APIs.
- Produces Strategy subtabs for strategies, selection/progress, diagnostics, journal/history, and settings.

- [ ] **Step 1: Write RED model and UI tests**

```js
assert.equal(view.primaryActions.length, 1);
assert.equal(view.basicText.includes(candidate.id), false);
assert.equal(view.basicText.includes('--lua-desync'), false);
assert.equal(view.progress.totalDomains, 61);
assert.equal(view.completedRun.complete, view.completedRun.testedDomains === 61);
```

Cover acknowledgement, progress, cooperative cancel, pending compact rows, failed candidate retention, terminal missing run, diagnostics, and winner apply.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-strategy.test.mjs
```

- [ ] **Step 3: Implement pure selectors**

```js
function normalizeRun(payload) {
  return {
    active: Boolean(payload && payload.active === true),
    phase: payload && payload.phase || null,
    totalDomains: Number(payload && payload.totalDomains || 0),
    testedDomains: Number(payload && payload.testedDomains || 0),
    candidates: Array.isArray(payload && payload.candidates) ? payload.candidates : [],
    journal: Array.isArray(payload && payload.journal) ? payload.journal : []
  };
}
```

- [ ] **Step 4: Implement reference UI and real actions**

Start uses `mode:"full-corpus"`; stop uses existing cooperative stop; selected winner enters the global semantic draft; apply uses sanctioned preview/apply/reread/verify; technical IDs/argv remain in advanced disclosure.

- [ ] **Step 5: Prove GREEN and run safe router scenarios**

```bash
node --test tests/ui/holyversion-strategy.test.mjs tests/ui/single-view-overview-strategy.test.mjs
tools/run-all-tests.sh
```

Run read-only catalog/corpus first. Run full-corpus mutation only in an approved safe window with saved baseline; verify cancel/restoration before winner apply.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-strategy.test.mjs
git commit -m "feat: complete holyversion strategy workflow"
```

---

### Task 6: Add the unified domain-hub backend contract

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/domain-hub.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `tests/holyversion-domain-hub-contract.test.mjs`

**Interfaces:**
- Adds read RPC `domain_hub_get`.
- Adds read RPC `domain_hub_preview(edit)`.
- Adds write RPC `domain_hub_apply(edit)`.
- `edit` is a JSON string containing `expectedRevision`, `requestId`, catalog operations, list operations, Autohostlist operations, and source operations.

- [ ] **Step 1: Write RED transaction tests**

```js
assert.equal(preview.mutated, false);
assert.equal(preview.precondition.revision, snapshot.revision);
assert.equal(preview.precondition.catalogDigest, snapshot.catalog.digest);
assert.equal(applyWithStaleRevision.ok, false);
assert.equal(applyResult.verified, true);
```

Cover exact include/exclude identity, domain normalization, Autohostlist promote/ignore/stale cleanup, source schedule/update, atomic snapshot, partial failure, and rollback proof.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-domain-hub-contract.test.mjs
```

- [ ] **Step 3: Implement the adapter over existing owners**

Return:

```json
{
  "ok": true,
  "revision": 12,
  "catalog": { "digest": "...", "packages": [], "categories": [] },
  "userDomains": { "include": [], "exclude": [] },
  "autohost": { "entries": [], "counts": {} },
  "sources": { "items": [], "schedule": null, "lastBuild": null }
}
```

Preview delegates to existing validators without mutation. Apply snapshots all affected owner state, calls only sanctioned owners/writers, rereads every scope, verifies exact result, and returns explicit rollback evidence.

- [ ] **Step 4: Register RPC/API/ACL**

Export `api.domainHub.get`, `preview`, and `apply`.

- [ ] **Step 5: Prove GREEN**

```bash
node --test tests/holyversion-domain-hub-contract.test.mjs tests/catalog-logic.test.mjs tests/lists.test.mjs
tools/run-all-tests.sh
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

### Task 7: Complete Services, domains, Lists, Autohostlist, and sources UI

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-domain-hub-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-lists.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/holyversion-domain-hub.test.mjs`

**Interfaces:**
- Consumes `api.domainHub.*`.
- Produces one visible `Сервисы и домены` primary section with subtabs `Каталог пакетов`, `Мои домены`, `Autohostlist`, and `Источники и сборка`.
- Produces a `domainHub` global draft adapter.

- [ ] **Step 1: Write RED selectors and interaction tests**

```js
assert.equal(categoryState(allEnabled), 'on');
assert.equal(categoryState(noneEnabled), 'off');
assert.equal(categoryState(partlyEnabled), 'mixed');
assert.equal(bulkAction(searchFilteredModel).affectedIds.length, fullCatalog.length);
assert.equal(changedCount(draft), semanticChanges.length);
```

Cover package/domain counts, filters, category overrides, ready-hosts mode, include/exclude conflicts, Autohostlist promote/ignore/cleanup, source update/schedule, and build history.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs
```

- [ ] **Step 3: Implement the pure model**

No DOM nodes or RPC calls inside `z2m-domain-hub-model.js`. Return semantic draft operations with labels, before/after values, exact item IDs, revision, and catalog digest.

- [ ] **Step 4: Implement the unified reference UI**

Relocate/hide the former primary Lists tab according to the rendered reference. Keep compatibility navigation working. Every mutation stages one `domainHub` draft; preview/apply flow uses the Task 6 contract.

- [ ] **Step 5: Prove GREEN and router acceptance**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-services-lists-dns.test.mjs
tools/run-all-tests.sh
```

On router verify draft-only behavior, category tri-state, bulk action independence from search, semantic diff, cancel, one safe real apply, reread, hashes, nfqws2, nftables, and dnsmasq.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-domain-hub-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-lists.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-domain-hub.test.mjs
git commit -m "feat: complete holyversion services and domains hub"
```

---

### Task 8: Complete DNS contracts and interface

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js`
- Create: `tests/holyversion-dns-contract.test.mjs`
- Create: `tests/ui/holyversion-dns.test.mjs`

**Interfaces:**
- Retains existing `dns_get`, `dns_validate`, `dns_check`, `dns_apply`, provider, service-DNS, and rollback APIs.
- Adds read RPC `dns_history` only when current backend cannot provide persisted test/apply history.
- Produces a `dns` global draft adapter.

- [ ] **Step 1: Write RED backend and UI tests**

```js
assert.equal(defaultDraft.mode, 'system');
assert.equal(view.recommendationVisible, Boolean(realTestResult));
assert.equal(preview.mutated, false);
assert.equal(apply.verified, true);
assert.equal(staleRevision.ok, false);
```

Cover system/DoH/DoT/UDP, primary/fallback, provider validation and real latency, per-service ownership, advanced settings, history, rollback, and secret redaction.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
```

- [ ] **Step 3: Fill only the missing backend contract**

Reuse current DNS owners. Add `dns_history` only after the RED test proves no existing method can return bounded real history.

- [ ] **Step 4: Implement model, reference UI, and coordinator adapter**

No provider recommendation appears before a real test. Apply requires validation, expected revision, snapshot, sanctioned DNS writer/lifecycle, reread, verification, and rollback evidence.

- [ ] **Step 5: Prove GREEN and router acceptance**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs tests/dns-regressions.test.mjs tests/service-dns-contract.test.mjs
tools/run-all-tests.sh
```

Run provider read/test first, then one safe DNS draft/apply/rollback scenario with baseline hashes.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js \
  tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
git commit -m "feat: complete holyversion DNS workflow"
```

---

### Task 9: Complete Telegram Proxy truth model and interface

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Create: `tests/ui/holyversion-proxy.test.mjs`

**Interfaces:**
- Consumes existing proxy capability/status/config/validate/preview/apply/lifecycle/health/log/link APIs.
- Produces a `proxy` global draft adapter; secret/link values are never placed in store or model snapshots.

- [ ] **Step 1: Write RED truth-state and secret tests**

```js
assert.equal(classify({ process: 'running', listener: false, outbound: false }), 'degraded');
assert.equal(classify({ process: 'running', listener: true, outbound: true }), 'healthy');
assert.equal(JSON.stringify(storeSnapshot).includes('tg://'), false);
assert.equal(view.linkVisibleBeforeExplicitReveal, false);
```

Cover settings, activity/logs, rotate, lifecycle, quick install capability, listener and DC connectivity, active connections, and unavailable reasons.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-proxy.test.mjs
```

- [ ] **Step 3: Implement the pure truth model**

`z2m-proxy-model.js` accepts redacted backend state only and distinguishes `stopped`, `starting`, `healthy`, `degraded`, `unsupported`, and `error`.

- [ ] **Step 4: Implement reference UI and coordinator adapter**

Settings preview/apply uses the existing safe proxy contract. Start/stop/restart/rotate remain explicit confirmed operations. Link reveal is an uncached one-shot action.

- [ ] **Step 5: Prove GREEN and router read-only acceptance**

```bash
node --test tests/ui/holyversion-proxy.test.mjs tests/ui/single-view-proxy.test.mjs tests/proxy-secret-rotation.test.mjs
tools/run-all-tests.sh
```

Do not run TG proxy install/reboot/uninstall without separate approval. Verify no secret in DOM before reveal, console, store, or logs.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  tests/ui/holyversion-proxy.test.mjs
git commit -m "feat: complete holyversion Telegram Proxy"
```

---

### Task 10: Add structured Monitoring backend and interface

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor.js`
- Create: `tests/holyversion-monitor-contract.test.mjs`
- Create: `tests/ui/holyversion-monitor.test.mjs`

**Interfaces:**
- Adds read RPC `monitor_snapshot(edit)` with bounded cursor/filter/limit.
- Exports `api.monitor.snapshot`.
- Client pause stops polling only; it does not mutate router state.

- [ ] **Step 1: Write RED bounded evidence tests**

```js
assert.ok(snapshot.rows.length <= 200);
assert.equal(snapshot.rows.every(row => typeof row.timestamp === 'number'), true);
assert.equal(snapshot.rows.every(row => !('secret' in row)), true);
assert.equal(pollCountWhilePaused, 0);
```

Rows carry host, decision, profile/rule attribution, queue, drops/errors, and bounded technical details.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs
```

- [ ] **Step 3: Implement read-only monitoring aggregation**

Use existing runtime/log evidence; do not create packet capture or unbounded storage. Reject invalid limit/cursor/filter input.

- [ ] **Step 4: Register RPC/API/ACL and implement the reference UI**

Basic mode shows human decisions. Raw argv/details appear only in advanced disclosure. Polling starts on mount and is cancelled on unmount or pause.

- [ ] **Step 5: Prove GREEN and router read-only acceptance**

```bash
node --test tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs tests/ui/single-view-monitor-maintenance.test.mjs
tools/run-all-tests.sh
```

Verify read-only usage changes no applied/runtime hashes.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor.js \
  tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs
git commit -m "feat: complete holyversion Monitoring"
```

---

### Task 11: Complete Maintenance interface and safe operations

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Create: `tests/ui/holyversion-maintenance.test.mjs`

**Interfaces:**
- Consumes existing versions, maintenance status, backup list/create/preview/restore/delete, event tail, and diagnostics export APIs.
- No new RPC unless RED tests prove a specific missing real field.

- [ ] **Step 1: Write RED model and UI tests**

```js
assert.equal(formatUptime(3661), '1 ч 1 мин');
assert.equal(renderRestorePreview(preview).includes('{"'), false);
assert.equal(dangerousAction.confirmedBeforeCall, true);
assert.equal(hasRawNullLikeText(root), false);
```

Cover package versions, memory, system/runtime, backup list, semantic preview, verified restore, diagnostics, logs, empty/error states, and dangerous confirmation.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs
```

- [ ] **Step 3: Implement the pure model and semantic preview**

No raw JSON as primary output. Omit missing fields instead of fillers.

- [ ] **Step 4: Implement reference UI and verified operations**

Backup restore requires preview identity/revision, confirmation, backend restore, reread, and explicit verification result. Delete and diagnostics export remain explicit actions.

- [ ] **Step 5: Prove GREEN and router acceptance**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs tests/ui/single-view-monitor-maintenance.test.mjs tests/maintenance.test.mjs tests/backup.test.mjs
tools/run-all-tests.sh
```

Run backup create/preview; run restore only with a safe disposable backup and user-approved test window.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
  tests/ui/holyversion-maintenance.test.mjs
git commit -m "feat: complete holyversion Maintenance"
```

---

### Task 12: Finish the global multi-scope draft/apply transaction

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- Create: `tests/ui/holyversion-global-apply.test.mjs`

**Interfaces:**
- Consumes adapters `strategy`, `domainHub`, `dns`, and `proxy`.
- Adapter interface remains `validateDraft`, `previewDraft`, `applyDraft`, `reloadAppliedState`, `verifyApplied`, `resetDraft`, and optional `rollbackResult`.

- [ ] **Step 1: Write RED coordinator tests**

```js
assert.deepEqual(callOrder, ['reload', 'validate', 'preview']);
assert.equal(mutationsBeforeAllPreflight, 0);
assert.deepEqual(result.clearedScopes, ['domainHub']);
assert.deepEqual(result.failedScopes, ['dns']);
assert.equal(store.draft.dns != null, true);
assert.equal(store.draft.domainHub, undefined);
```

Cover stale revision, unsupported scope, partial failure, semantic diff, secret redaction, manual rollback visibility, reread, and cache refresh.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-global-apply.test.mjs tests/ui/global-draft-apply.test.mjs
```

- [ ] **Step 3: Implement deterministic plan and blockers**

Preflight all scopes before the first mutation. Apply order is `strategy`, `domainHub`, `dns`, `proxy`. Clear only verified successes and retain exact failures.

- [ ] **Step 4: Complete semantic modal and manual rollback result**

Modal groups human changes by scope. Technical JSON is advanced/redacted only. No countdown exists. Rollback appears only for backend-proven restorable results.

- [ ] **Step 5: Prove GREEN and router transaction scenarios**

```bash
node --test tests/ui/holyversion-global-apply.test.mjs tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs
tools/run-all-tests.sh
```

Run one single-scope success, one preflight rejection, one revision conflict, and a safe multi-scope scenario. Do not manufacture production failures.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js \
  tests/ui/holyversion-global-apply.test.mjs
git commit -m "feat: complete global semantic apply transaction"
```

---

### Task 13: Close visual, responsive, accessibility, and null-output gaps

**Files:**
- Modify only parity-proven frontend files under `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/`
- Create: `tests/ui/holyversion-responsive.test.mjs`
- Create: `docs/holyversion-parity-matrix.md`

**Interfaces:**
- Consumes all completed pages.
- Produces a parity matrix row for every visible reference element with backend/test/router evidence.

- [ ] **Step 1: Create the exhaustive matrix from rendered `holyversion.html`**

Use columns:

```text
Reference state | Production state | Visual verdict | Behavior verdict |
Backend source | Test evidence | Router evidence | Intentional deviation
```

- [ ] **Step 2: Write RED responsive and global-output tests**

Assert widths `1920`, `1366`, `1024`, and `390`; no horizontal page overflow; visible primary action; one-column mobile cards; readable tables/cards; no raw null-like or object text; keyboard-visible focus; correct `aria-pressed`, `aria-selected`, and dialog semantics.

- [ ] **Step 3: Prove RED**

```bash
node --test tests/ui/holyversion-responsive.test.mjs
```

- [ ] **Step 4: Fix each matrix gap with bounded CSS/markup changes**

Do not alter backend behavior during this task. Every P0/P1 row must become PASS. Record any proposed P2 intentional deviation for explicit user approval.

- [ ] **Step 5: Prove GREEN and capture router screenshots**

```bash
node --test tests/ui/holyversion-responsive.test.mjs
tools/run-all-tests.sh
git diff --check
```

Capture all pages and relevant states at the four target dimensions with console errors and rejected promises equal to zero.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager \
  tests/ui/holyversion-responsive.test.mjs docs/holyversion-parity-matrix.md
git commit -m "fix: close final holyversion parity gaps"
```

---

### Task 14: Package the complete exact-head application

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `zapret2-manager/Makefile` when backend files changed
- Modify: `zapret2-manager-full/Makefile` when backend/meta dependency changed
- Create: `tests/holyversion-package-contents.test.mjs`

**Interfaces:**
- Consumes final source head.
- Produces unique next releases and signed `aarch64_cortex-a53` APK files containing every required runtime file.

- [ ] **Step 1: Write RED package content tests**

Assert all new frontend modules, backend modules, corpus, RPC/ACL/menu files, and CSS are installed; no test, reference HTML, legacy runtime, external asset, or secret fixture ships.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-package-contents.test.mjs
```

- [ ] **Step 3: Set the next unused releases**

Read releases at this task's starting head. Increment every changed package exactly once; never reuse an existing release.

- [ ] **Step 4: Prove package manifest GREEN**

```bash
node --test tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs tests/release-provenance.test.mjs
tools/run-all-tests.sh
```

- [ ] **Step 5: Build and verify signed APK**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh
APK_DIR=/mnt/g/zapret2-manager/dist/apk
apk verify "$APK_DIR"/*.apk
sha256sum "$APK_DIR"/*.apk
```

Record exact names, versions, architectures, and SHA-256.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/Makefile zapret2-manager/Makefile zapret2-manager-full/Makefile \
  tests/holyversion-package-contents.test.mjs
git commit -m "build: package complete holyversion parity"
```

---

### Task 15: Run comprehensive exact-head router acceptance

**Files:**
- Create: `docs/router-validation-final.md`
- Modify: `docs/holyversion-parity-matrix.md`

**Interfaces:**
- Consumes exact PR head, signed APK, fixed validation tooling, and router `192.168.1.1`.
- Produces `PASS|PARTIAL|FAIL`; only `PASS` permits readiness.

- [ ] **Step 1: Record immutable baseline**

Record exact commit, package SHA-256, router/OpenWrt model/version/architecture, uptime, package versions, config/runtime hashes, nfqws2 PID/starttime/cmdline, NFQUEUE owner/counters, nftables, dnsmasq/rpcd/uhttpd, active operations, and backups.

- [ ] **Step 2: Install signed packages without `--allow-untrusted`**

Install only changed releases and reload rpcd at most once when newly registered RPC methods require it. Do not restart uhttpd, firewall, or router.

- [ ] **Step 3: Run fixed automated checks**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

- [ ] **Step 4: Execute every browser/router scenario**

Cover every page/subtab/modal/state, all read-only actions, global draft/diff/cancel/apply, revision conflict, safe partial failure evidence, manual rollback, domain hub, DNS, Strategy full corpus/cancel/restore/winner apply, Proxy truth/secret handling, Monitoring, Maintenance, and all four viewport sizes.

- [ ] **Step 5: Record final evidence and verdict**

Every read-only operation must preserve hashes/runtime. Every sanctioned mutation must have explained before/after evidence, reread, verification, and rollback proof where advertised.

- [ ] **Step 6: Commit the PASS report**

```bash
git add docs/router-validation-final.md docs/holyversion-parity-matrix.md
git commit -m "docs: record full router acceptance"
```

Because the report changes the head, rerun source/CI plus final read-only package/asset/runtime identity verification against the report commit.

---

### Task 16: Whole-PR review and exact-head verification

**Files:**
- Modify only files required by concrete review findings.

**Interfaces:**
- Consumes PR #26 exact head.
- Produces zero unresolved Critical/Important findings, zero unresolved review threads, and exact-head green CI.

- [ ] **Step 1: Request spec-compliance review**

Reviewer maps every unified-spec requirement to source, tests, parity matrix, and router evidence.

- [ ] **Step 2: Request code-quality and safety review**

Reviewer checks duplicate runtimes/writers, fake data, inert controls, unverified success, unsafe lifecycle, unbounded data, secret leakage, scope drift, and release/package correctness.

- [ ] **Step 3: Resolve findings through RED→GREEN loops**

Each code finding begins with a reproducing test. Rerun focused, full, CI, and affected router scenarios after fixes.

- [ ] **Step 4: Verify PR state**

```bash
git fetch --prune origin
git rev-parse HEAD
git diff --check origin/main...HEAD
tools/run-all-tests.sh
git branch -r
```

Require exact head unchanged throughout review and only the two authorized remote branches.

- [ ] **Step 5: Mark PR ready only after all gates are green**

Do not merge in this task.

---

### Task 17: Merge only with explicit authorization

**Files:** none unless final evidence correction is required.

**Interfaces:**
- Consumes explicit user authorization, expected head SHA, ready PR, green exact-head CI, clean reviews, and exact-head router `PASS`.
- Produces one merge commit in `main`, then synchronized persistent branch.

- [ ] **Step 1: Re-read immutable merge evidence**

Confirm expected head SHA, approvals, no request-changes, no unresolved threads, CI success, router PASS at that SHA, releases, APK hashes, and parity matrix.

- [ ] **Step 2: Ask for explicit merge authorization quoting the expected head SHA**

No authorization from an earlier head is reusable.

- [ ] **Step 3: Merge with merge commit and expected-head guard**

Do not squash or rebase unless the user changes the approved merge method.

- [ ] **Step 4: Synchronize persistent branch**

Fast-forward `feat/holyversion-reference-parity` to merged `main`; verify `0 ahead / 0 behind` and exactly two remote branches.

- [ ] **Step 5: Report final completion**

Only now may the Holyversion parity program be called complete.
