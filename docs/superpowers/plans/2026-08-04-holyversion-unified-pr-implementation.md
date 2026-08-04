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

- [ ] **Step 1: Write the failing regression test**

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

- [ ] **Step 2: Prove RED**

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
```

Expected: test failure plus the recorded `session-check.sh` syntax failure.

- [ ] **Step 3: Implement the exact fixes**

```sh
STATIC_BASE="http://${ROUTER}/luci-static/resources/view/zapret2-manager"
ROUTE_BASE="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager"
```

Authenticated pages use `ROUTE_BASE`; assets use `STATIC_BASE`. `smoke.sh` checks `app.js` plus packaged modules, wrapper-compiles the no-extension rpcd plugin, and compares normalized full list keys so `hostlist` cannot match `hostlist-exclude` by substring. Session tokens remain only in the mode-0600 jar and remote destroy call.

- [ ] **Step 4: Prove GREEN**

```bash
node --test tests/router-validation-tools.test.mjs
sh -n tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh
tools/run-all-tests.sh
git diff --check
```

- [ ] **Step 5: Rerun non-destructive router checks**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

- [ ] **Step 6: Commit**

```bash
git add tools/session-check.sh tools/smoke.sh tools/deploy-verify.sh tests/router-validation-tools.test.mjs docs/router-validation-a1b0f897.md
git commit -m "fix: repair router validation tooling"
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
  "applied": { "strategy": null, "revision": null, "snapshot": null, "appliedAt": null },
  "operation": null,
  "lastCorpusRun": null,
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
assert.equal(start({ mode: 'full-corpus', candidateIds: ['missing'] }).ok, false);
assert.equal(runAfterCandidate.baselineRestored, true);
assert.equal(terminalRun.active, false);
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
assert.equal(view.basicText.includes(candidate.rawArgv), false);
assert.equal(view.basicText.includes(candidate.id), false);
assert.equal(view.journal.some(row => row.status === 'failed'), true);
assert.equal(view.activeRun && view.lastTerminalRun === view.activeRun, false);
```

Cover acknowledgement, progress, cooperative cancel, pending compact rows, failed candidate retention, terminal missing run, diagnostics, and winner apply.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-strategy.test.mjs
```

- [ ] **Step 3: Implement pure selectors**

```js
function normalizeRun(run) {
  return {
    active: !!run && run.terminal !== true && run.status !== 'missing',
    terminal: !!run && run.terminal === true,
    generation: Number.isInteger(run && run.generation) ? run.generation : null,
    progress: normalizeProgress(run),
    candidates: normalizeCandidates(run),
    journal: normalizeJournal(run)
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
- Exports `api.domainHub.get`, `api.domainHub.preview`, and `api.domainHub.apply`.

- [ ] **Step 1: Write RED contract tests**

```js
assert.equal(snapshot.catalog.services.length >= 0, true);
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
  "revision": 1,
  "catalog": { "digest": "sha256", "services": [], "categories": [] },
  "userDomains": { "include": [], "exclude": [] },
  "autohostlist": { "entries": [], "counts": {} },
  "sources": [],
  "build": null
}
```

`domain-hub.uc` calls existing catalog/list/source functions and sanctioned writers; it never edits production files directly when an owner function exists.

- [ ] **Step 4: Register RPC/API/ACL**

`domain_hub_get` and preview are read ACL; apply is write ACL.

- [ ] **Step 5: Prove GREEN and target read-only smoke**

```bash
node --test tests/holyversion-domain-hub-contract.test.mjs
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

### Task 7: Complete Services, domains, Lists, Autohostlist, and source UI

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-domain-hub-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-lists.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/holyversion-domain-hub.test.mjs`

**Interfaces:**
- Consumes Task 6 APIs.
- Produces one hub with catalog, my domains, Autohostlist, and sources/build subtabs and one `domainHub` draft adapter.

- [ ] **Step 1: Write RED UI tests**

```js
assert.equal(categoryState(categoryServices, enabled).state, 'mixed');
assert.equal(toggleAll(allServices, filteredEnabled, true).enabledCount, allServices.length);
assert.equal(searchResult.bulkTargetCount, allServices.length);
assert.equal(diff.rows.every(row => row.before !== row.after), true);
```

Cover KPI/filter consistency, individual override after category action, exact include/exclude edits, Autohostlist actions, source update/schedule/history, and conflict rows.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs
```

- [ ] **Step 3: Implement pure selectors**

```js
categoryState(services, enabledById)
toggleCategory(services, enabledById, categoryId)
toggleAll(services, enabledById, next)
applyDomainAction(snapshot, action)
semanticChanges(baseline, draft)
```

- [ ] **Step 4: Implement the exact reference hub and adapter**

All mutations enter the global draft. Preview calls `domain_hub_preview`; apply calls `domain_hub_apply`; clear only after reread verification. `z2m-lists.js` remains compatibility/fallback code and is not a duplicate primary tab.

- [ ] **Step 5: Prove GREEN and run router scenarios**

```bash
node --test tests/ui/holyversion-domain-hub.test.mjs tests/ui/services-parity.test.mjs tests/ui/services-model.test.mjs
tools/run-all-tests.sh
```

Verify draft-no-mutation, category mixed state, semantic diff, cancel, one safe apply, reload persistence, and runtime evidence.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-domain-hub-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-lists.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-domain-hub.test.mjs
git commit -m "feat: complete services and domains hub"
```

---

### Task 8: Complete DNS backend history, UI, and verified apply

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js`
- Create: `tests/holyversion-dns-contract.test.mjs`
- Create: `tests/ui/holyversion-dns.test.mjs`

**Interfaces:**
- Adds bounded read RPC `dns_history` and exports `api.dns.history`.
- Uses existing get/set/validate/apply/check/rollback/restore/provider/service-DNS methods.

- [ ] **Step 1: Write RED contract and UI tests**

```js
assert.equal(defaultMode, 'system');
assert.equal(recommendationBeforeRealCheck, null);
assert.equal(history.every(entry => !entry.secret && !entry.token), true);
assert.equal(staleRevisionApply.ok, false);
assert.equal(verifiedApply.rereadMatches, true);
```

Cover DoH/DoT/UDP, primary/fallback, real latency, per-service ownership, advanced fields, history, semantic preview, apply, conflict, and rollback.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
```

- [ ] **Step 3: Implement bounded redacted history and model**

History entries contain timestamp, mode/provider IDs, result, revision, and normalized redacted error. The model omits recommendations until a real check exists.

- [ ] **Step 4: Implement reference UI and adapter**

Apply requires validate, check where applicable, preview, expected revision, sanctioned apply, reread, and verification. Rollback is visible only with backend proof.

- [ ] **Step 5: Prove GREEN and run one safe reversible router mutation**

```bash
node --test tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs tests/service-dns-contract.test.mjs
tools/run-all-tests.sh
```

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js \
  tests/holyversion-dns-contract.test.mjs tests/ui/holyversion-dns.test.mjs
git commit -m "feat: complete holyversion dns workflow"
```

---

### Task 9: Complete Telegram Proxy with secret-safe health and controls

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/holyversion-proxy.test.mjs`

**Interfaces:**
- Consumes existing proxy capabilities/status/config/validate/preview/apply/start/stop/restart/autostart/rotate/logs/health/link APIs.
- Produces separate process, listener, connectivity, connections, config, activity, logs, and reveal states plus a proxy draft adapter.

- [ ] **Step 1: Write RED tests**

```js
assert.equal(normalize({ process: { running: true }, listener: { ok: false } }).health, 'degraded');
assert.equal(storeBeforeReveal.proxyLink, undefined);
assert.equal(domBeforeReveal.includes('tg://'), false);
assert.equal(logRows.length <= 200, true);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-proxy.test.mjs
```

- [ ] **Step 3: Implement model and reference layout**

Running process alone cannot yield healthy. Reveal calls `proxy_link_info` only after explicit confirmation and clears revealed values on unmount/navigation.

- [ ] **Step 4: Connect config draft and lifecycle verification**

Config uses validate/preview/apply/reread/verify. Start/stop/restart/autostart/rotate are explicit immediate operations with confirmation and post-action reread.

- [ ] **Step 5: Prove GREEN and run non-destructive router acceptance**

```bash
node --test tests/ui/holyversion-proxy.test.mjs tests/ui/single-view-proxy.test.mjs tests/t3-6-proxy-runtime.test.mjs
tools/run-all-tests.sh
```

Do not run uninstall or reboot drills. Verify no secret in DOM, store, console, or logs.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-proxy.test.mjs
git commit -m "feat: complete holyversion proxy interface"
```

---

### Task 10: Add structured Monitoring backend and complete Monitoring UI

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
- Adds read RPC `monitor_snapshot(edit)` and exports `api.monitor.snapshot`.
- UI polling controller exposes `start`, `pause`, `resume`, `setFilters`, and `destroy`.

- [ ] **Step 1: Write RED backend/lifecycle tests**

```js
assert.equal(snapshot.rows.length <= request.limit, true);
assert.equal(snapshot.rows.every(row => typeof row.decision === 'string'), true);
controller.pause();
assert.equal(requestCountAfterTick, requestCountBeforeTick);
controller.destroy();
assert.equal(activeTimers(), 0);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs
```

- [ ] **Step 3: Implement bounded structured evidence**

Return captured time, runtime evidence, bounded rows with host/decision/profile/rule/drops/errors, and cursor. Omit unsupported fields. Do not return raw packet payload, secret, unbounded log, or arbitrary argv in basic fields.

- [ ] **Step 4: Implement reference filters/table/cards and polling lifecycle**

Client pause stops polling only; resume triggers one immediate read. Mobile renders cards. Technical details remain collapsed in advanced mode.

- [ ] **Step 5: Prove GREEN and router read-only acceptance**

```bash
node --test tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs tests/ui/single-view-manager.test.mjs
tools/run-all-tests.sh
```

Verify monitoring does not change hashes or PIDs.

- [ ] **Step 6: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc \
  zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js \
  luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor.js \
  tests/holyversion-monitor-contract.test.mjs tests/ui/holyversion-monitor.test.mjs
git commit -m "feat: complete holyversion monitoring"
```

---

### Task 11: Complete Maintenance and verified backup/restore presentation

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- Create: `tests/ui/holyversion-maintenance.test.mjs`

**Interfaces:**
- Consumes existing versions, maintenance status, backup list/create/restore preview/restore/delete, events tail, and diagnostics export.
- Produces semantic package/system/backup/diagnostic sections with no raw JSON primary view.

- [ ] **Step 1: Write RED tests**

```js
assert.equal(model.uptime, '1 д 2 ч 3 мин');
assert.equal(model.memory.includes('[object'), false);
assert.equal(restoreButton.disabled, preview.blockers.length > 0);
assert.equal(successShownBeforeReread, false);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs
```

- [ ] **Step 3: Implement model and exact reference layout**

Use `Format.bytes`, `Format.duration`, and `Format.timestamp`. Restore preview lists exact scopes and blockers. Delete/restore require exact backup identity and confirmation.

- [ ] **Step 4: Require reread before success**

Restore success appears only after backend response plus maintenance/status reread. Logs are bounded and diagnostics export remains an explicit action.

- [ ] **Step 5: Prove GREEN and run router acceptance**

```bash
node --test tests/ui/holyversion-maintenance.test.mjs
tools/run-all-tests.sh
```

Create and preview a dedicated test backup. Actual restore is required during final acceptance in an approved safe window.

- [ ] **Step 6: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css \
  tests/ui/holyversion-maintenance.test.mjs
git commit -m "feat: complete holyversion maintenance"
```

---

### Task 12: Finish global semantic draft/apply for every mutable visible scope

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js`
- Modify: `tests/ui/global-draft-apply.test.mjs`
- Modify: `tests/ui/draft-model.test.mjs`

**Interfaces:**
- Every mutable adapter implements exactly:

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

- [ ] **Step 1: Write RED cross-scope tests**

```js
assert.equal(mutationsBeforeAllPreviewsComplete, 0);
assert.deepEqual(applyOrder, ['strategy', 'domainHub', 'dns', 'proxy']);
assert.equal(store.draft.failedScope !== undefined, true);
assert.equal(store.draft.verifiedScope, undefined);
assert.equal(document.body.textContent.includes('Автооткат через'), false);
```

Cover semantic grouping, revision conflict, deterministic order, partial failure retention, success clearing only after verification, secret redaction, and manual rollback proof.

- [ ] **Step 2: Prove RED**

```bash
node --test tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs
```

- [ ] **Step 3: Implement coordinator sequence**

Snapshot draft/revisions; validate all; preview all; abort before mutation on blockers; apply in tested order; reread/verify each; retain failures; refresh affected pages/Overview; show manual rollback only from returned proof.

- [ ] **Step 4: Prove GREEN and run a two-scope router scenario**

```bash
node --test tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs tests/ui/rpc-semantics.test.mjs
tools/run-all-tests.sh
```

Create two safe scopes, preview, cancel, recreate, apply, reload, and verify both scopes and runtime evidence.

- [ ] **Step 5: Commit**

```bash
git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy.js \
  tests/ui/global-draft-apply.test.mjs tests/ui/draft-model.test.mjs
git commit -m "feat: finish verified global apply coordination"
```

---

### Task 13: Close visual and responsive parity gaps

**Files:**
- Create: `docs/holyversion-parity-matrix.md`
- Create: `tests/ui/holyversion-responsive.test.mjs`
- Modify: only frontend/CSS files named by a recorded matrix gap

**Interfaces:**
- Matrix fields: reference location/state, production location/state, visual verdict, behavioral verdict, backend source, test evidence, router evidence, intentional deviation.

- [ ] **Step 1: Capture reference and production at all required sizes**

```text
1920×1080
1366×768
1024×768
390×844
```

Cover every page, subtab, modal, and real loading/empty/error/success state.

- [ ] **Step 2: Write RED assertions for every P0/P1 gap**

```js
assert.equal(horizontalOverflow(root, 390), 0);
assert.equal(primaryActionVisible(root, 390), true);
assert.equal(rawNullLikeText(root), false);
assert.equal(duplicateRuntimeRoots(root), 0);
```

- [ ] **Step 3: Fix only recorded gaps and update matrix rows**

No unrelated refactor. Any P2 remains documented for explicit user approval.

- [ ] **Step 4: Prove GREEN**

```bash
node --test tests/ui/holyversion-*.test.mjs
tools/run-all-tests.sh
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add docs/holyversion-parity-matrix.md tests/ui/holyversion-responsive.test.mjs \
  luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager
git commit -m "fix: close holyversion parity gaps"
```

---

### Task 14: Package the complete product and verify contents

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`
- Modify: `zapret2-manager/Makefile`
- Modify: `zapret2-manager-full/Makefile`
- Modify: `tools/build-apk-manual.sh`
- Create: `tests/holyversion-package-contents.test.mjs`
- Modify: `tests/packaging.test.mjs`

**Interfaces:**
- Produces next unused releases and signed APK containing every new JS/CSS/ucode/JSON file.
- Exact SDK package directory: `/home/kirill/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64/bin/packages/aarch64_cortex-a53/zapret2-manager`.

- [ ] **Step 1: Write RED package-content tests**

```js
for (const required of requiredHolyversionFiles)
  assert.equal(stagedFiles.has(required), true, required);
assert.equal(packageMetadata.releaseReused, false);
```

- [ ] **Step 2: Prove RED**

```bash
node --test tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
```

- [ ] **Step 3: Compute and set next releases**

```bash
CURRENT_LUCI=$(sed -n 's/^PKG_RELEASE:=//p' luci-app-zapret2-manager/Makefile)
CURRENT_BACKEND=$(sed -n 's/^PKG_RELEASE:=//p' zapret2-manager/Makefile)
CURRENT_META=$(sed -n 's/^PKG_RELEASE:=//p' zapret2-manager-full/Makefile)
printf 'next luci=%s backend=%s meta=%s\n' "$((CURRENT_LUCI+1))" "$((CURRENT_BACKEND+1))" "$((CURRENT_META+1))"
```

Set each changed package to its computed next integer exactly once.

- [ ] **Step 4: Build, verify signatures, list contents, and hash APK**

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh
APK_DIR=/home/kirill/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64/bin/packages/aarch64_cortex-a53/zapret2-manager
apk verify "$APK_DIR"/*.apk
sha256sum "$APK_DIR"/*.apk
```

- [ ] **Step 5: Prove GREEN and commit**

```bash
node --test tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
tools/run-all-tests.sh
git diff --check
git add luci-app-zapret2-manager/Makefile zapret2-manager/Makefile zapret2-manager-full/Makefile \
  tools/build-apk-manual.sh tests/holyversion-package-contents.test.mjs tests/packaging.test.mjs
git commit -m "build: package complete holyversion interface"
```

---

### Task 15: Run comprehensive exact-head router acceptance

**Files:**
- Create: `docs/router-validation-holyversion-final.md`
- Modify: `docs/holyversion-parity-matrix.md`

**Interfaces:**
- Consumes exact PR head, signed APK, fixed validation tooling, router `192.168.1.1`.
- Produces `PASS`, `PARTIAL`, or `FAIL`; only `PASS` advances.

- [ ] **Step 1: Freeze head and capture baseline**

```bash
test -z "$(git status --porcelain)"
git rev-parse HEAD | tee /tmp/holyversion-acceptance-head
ssh root@192.168.1.1 'uptime; apk list --installed | grep -E "zapret2-manager|luci-app-zapret2-manager"; pidof nfqws2; sha256sum /etc/zapret2-manager/state.json /etc/config/zapret2 /etc/config/dhcp /opt/zapret2/config 2>/dev/null'
```

Abort when the tree is dirty or the head changes.

- [ ] **Step 2: Install exact signed APK and run automatic gates**

```bash
ROUTER=192.168.1.1 tools/session-check.sh
DEPLOY_HOST=192.168.1.1 tools/smoke.sh
ROUTER=192.168.1.1 tools/deploy-verify.sh
```

- [ ] **Step 3: Execute all browser states**

For every page/subtab/modal at desktop and mobile record route, screenshot, console errors, rejected promises, failed requests, and loading/empty/error/success state. Link each result to its parity-matrix row.

- [ ] **Step 4: Execute the sanctioned mutation matrix**

Run global draft cancel/apply/conflict/partial-failure/verification/manual rollback; full-corpus Strategy start/progress/cancel/restore/result/winner apply; domain-hub mutation; DNS check/apply/rollback; proxy config/lifecycle without secret exposure; maintenance backup preview and approved restore.

- [ ] **Step 5: Recheck runtime and explain every change**

Verify nfqws2 identity/cmdline, NFQUEUE owner/counters, nftables, dnsmasq, rpcd, uhttpd, hashes, active operations, and package versions. Every changed hash maps to a sanctioned successful transaction.

- [ ] **Step 6: Write and commit the report**

```bash
git add docs/router-validation-holyversion-final.md docs/holyversion-parity-matrix.md
git commit -m "docs: record full router acceptance"
```

`PASS` requires every scenario and parity row complete. `PARTIAL` or `FAIL` returns to the relevant task inside the same PR.

- [ ] **Step 7: Revalidate the report commit**

```bash
test "$(git rev-parse HEAD)" != "$(cat /tmp/holyversion-acceptance-head)"
tools/run-all-tests.sh
ROUTER=192.168.1.1 tools/session-check.sh
```

Record the report-commit SHA and final read-only package/asset/runtime evidence in the report.

---

### Task 16: Complete whole-PR review and exact-head CI

**Files:**
- Modify: only files required by reproduced review findings
- Modify: `docs/router-validation-holyversion-final.md` with final CI/review evidence

**Interfaces:**
- Produces a review-clean draft PR at one exact head.

- [ ] **Step 1: Run final local verification**

```bash
sh -n tools/*.sh
node --test tests/*.test.mjs tests/ui/*.test.mjs
tools/run-all-tests.sh
git diff --check
test -z "$(git status --porcelain)"
```

- [ ] **Step 2: Request three bounded reviews**

Run spec-compliance review against the unified design, code-quality/safety review, and parity/router-evidence review. Findings must include severity, exact file, reproduction/evidence, and violated requirement.

- [ ] **Step 3: Fix Critical and Important findings through RED→GREEN**

For each finding add a failing test, implement the smallest fix, run focused/full tests, repeat the affected router scenario, and commit a scoped `fix:` commit. Do not run a generic whole-branch fixer.

- [ ] **Step 4: Verify branch and scope invariants**

```bash
git branch -r
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected remote refs are `origin/main` and `origin/feat/holyversion-reference-parity`; every file maps to this plan or an evidenced review fix.

- [ ] **Step 5: Push and verify exact-head GitHub Actions**

Wait for `Single-view UI gate / verify` for `git rev-parse HEAD`; inspect step summaries and logs; record exact run/job IDs in `docs/router-validation-holyversion-final.md`.

- [ ] **Step 6: Commit evidence-only update and rerun exact-head CI if the report changed**

```bash
git add docs/router-validation-holyversion-final.md
git commit -m "docs: record final review and ci evidence"
tools/run-all-tests.sh
```

Push the new report head and require a new green CI run for that SHA.

---

### Task 17: Present readiness evidence; do not merge without instruction

**Files:**
- No source changes.

**Interfaces:**
- Produces the final readiness report to the user and waits for explicit ready/merge instruction.

- [ ] **Step 1: Collect exact evidence without changing files**

```bash
HEAD_SHA=$(git rev-parse HEAD)
BRANCHES=$(git branch -r)
STATUS=$(git status --porcelain)
printf 'Exact head: %s\nRemote branches:\n%s\nWorking tree: %s\n' "$HEAD_SHA" "$BRANCHES" "${STATUS:-clean}"
```

- [ ] **Step 2: Verify all merge gates**

Required facts:

```text
Full repository gate: 0 failed
Exact-head CI: PASS
Parity P0/P1: 0
Router verdict: PASS
Remote branches: main + feat/holyversion-reference-parity
Unresolved review threads: 0
Working tree: clean
```

- [ ] **Step 3: Report readiness and stop**

Do not mark ready and do not merge until the user explicitly instructs it. After an authorized merge, verify merge commit, synchronize the persistent branch to `main`, and prove `0 ahead / 0 behind`.
