# System Components information architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed System Updates/Engine surface with a canonical Components page for the mandatory Engine and Z2K Core while preserving existing lifecycle owners and independent Backup/Settings/Resources/Telegram/WARP surfaces.

**Architecture:** Keep `Maintenance` as the compatibility module, but make `components` its canonical pane and normalize the existing Manager, Engine, and Resource Center payloads through a pure `z2m-components-model.js`. Engine actions continue to delegate to `EnginePanel`; Z2K mutations continue to delegate to Resource Center/Z2K component code. Add only a read-only Z2K check projection when the existing resource payload cannot explain integration-required states.

**Tech Stack:** LuCI JavaScript, existing `baseclass` view modules, ucode/rpcd, Node built-in `node:test`, static contract tests, existing CSS primitives.

**Spec:** `docs/superpowers/specs/2026-08-21-system-components-ia-design.md`

## Global Constraints

- `Система → Компоненты` contains only `Zapret2 Engine` and `Z2K Core` as mandatory component cards.
- Manager version is metadata and never a third component card.
- Avatar/resources, Telegram Proxy, WARP, and resource catalogs remain with their canonical owners.
- Do not create a second Engine installer, Z2K lifecycle, Asset Registry writer, or updater.
- Engine candidates are installable only after the existing compatibility gate succeeds; never offer vanilla upstream as a Z2M build.
- Z2K Core has no user-facing delete action; `rebase-required` and `review-required` block automatic update.
- Backups use preview → confirmation → restore → reread verification; unsupported fake scopes are forbidden.
- Preserve legacy reachability for `#/engine`, `#/updates`, and `#/maintenance` without duplicate module lifecycles.
- Preserve unrelated dirty changes in the primary checkout and do not deploy to the router in this host-only implementation slice.
- Browser confirmation is mandatory before completion; screenshots/accessibility snapshots and exercised flows are required evidence.

---

### Task 1: Add the pure Components read model

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- Test: `tests/ui/system-components-model.test.mjs`

**Interfaces:**
- Consumes: existing Engine status/release/gate envelopes, `resources_status`/`resources_check` payloads, and `versions` payloads.
- Produces: `normalizePage(input)`, `normalizeEngine(input)`, `normalizeZ2k(input)`, `aggregateHealth(components)`, and `managerMeta(versions)` exported through `baseclass.extend`.

- [ ] **Step 1: Write failing model tests.** Cover a ready Engine plus current Z2K (`2/2`, ready message), missing Engine (`1/2`, install action), broken Z2K (`1/2`, repair action), safe update without health failure, and integration-required without an automatic update action. Evaluate the module with the same VM/baseclass pattern used by existing pure UI model tests.
- [ ] **Step 2: Run the model test and verify RED.** Run `node --test tests/ui/system-components-model.test.mjs`. Expected: failure because the model file and exported functions do not exist.
- [ ] **Step 3: Implement the minimal pure model.** Keep the three axes separate: `health`, `updateState`, and `compatibility`. Map only user-facing state labels/actions in the model; retain bounded technical fields under `details`.
- [ ] **Step 4: Run the model test and verify GREEN.** Run `node --test tests/ui/system-components-model.test.mjs` and require all assertions to pass.
- [ ] **Step 5: Refactor only after green.** Remove duplicated state mapping helpers from the test fixture, keep input normalization defensive for missing/error envelopes, and rerun the same test.

### Task 2: Make Components the canonical System route

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Modify: `tests/ui/system-diagnostics-consolidation.test.mjs`
- Create: `tests/ui/system-components-navigation.test.mjs`

**Interfaces:**
- Consumes: `Navigation.GROUPS`, `ALIASES`, `LEGACY_PARAMS`, and the existing single `Maintenance` module registration.
- Produces: canonical route `components`, compatibility aliases for `engine`, `updates`, and `maintenance`, and `component=engine` deep-link parameters.

- [ ] **Step 1: Write failing navigation tests.** Assert that visible System items are exactly `components`, `backups`, and `settings`; `engine`/`updates` are absent from visible items; `#/engine` maps to `components` with `component=engine`; `#/updates` and `#/maintenance` map to `components`; and `app.js` still registers one System module.
- [ ] **Step 2: Run the navigation test and verify RED.** Run `node --test tests/ui/system-components-navigation.test.mjs`. Expected: failure because the current navigation exposes `updates` and `engine` and has no `components` route.
- [ ] **Step 3: Implement route changes.** Add `components` to the System group, remove visible `updates` and `engine`, map compatibility aliases to `components`, and preserve `backups`/`settings` as independent routes. Keep `MODULES.components`, `MODULES.backups`, and `MODULES.settings` mapped to the same System owner.
- [ ] **Step 4: Update existing consolidation assertions.** Change only assertions that describe the intentionally retired Updates/Engine tabs; keep diagnostics ownership and lazy-loading assertions intact.
- [ ] **Step 5: Run both navigation and consolidation tests.** Run `node --test tests/ui/system-components-navigation.test.mjs tests/ui/system-diagnostics-consolidation.test.mjs` and require the new route contract plus unchanged diagnostics coverage to pass.

### Task 3: Expose Z2K check classification at its existing owner boundary

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Test: `tests/product/system-components-z2k-contract.test.mjs`

**Interfaces:**
- Consumes: `z2k_upstream_check()` and the existing `resource_center_status()` / `resource_center_check()` responses.
- Produces: a read-only `z2k` projection with `status`, `updates`, `rebases`, `reviews`, source, trust mode, and manifest identity. It does not add a mutation path.

- [ ] **Step 1: Write failing backend contract tests.** Assert that the resource status/check source contains a Z2K projection, that `rebase-required` carries adapted paths, that `review-required` carries watched paths, that `update-available` carries safe updates, and that update execution still delegates to `z2k_component_apply`/Asset Registry.
- [ ] **Step 2: Run the contract test and verify RED.** Run `node --test tests/product/system-components-z2k-contract.test.mjs`. Expected: failure because the current response exposes only generic `signedSources` evidence and not the classification lists.
- [ ] **Step 3: Implement the smallest projection.** Add a helper in `resource-update.uc` that converts the existing check result into the bounded `z2k` field. Keep initial status network-free and mark its source check as unknown until the explicit check RPC runs. Do not duplicate classification or fetch logic.
- [ ] **Step 4: Run the contract test and verify GREEN.** Run `node --test tests/product/system-components-z2k-contract.test.mjs`.
- [ ] **Step 5: Run existing Resource Center contracts.** Run `node --test tests/ui/resource-center-signed-z2k.test.mjs tests/ui/resources-update-center.test.mjs tests/product/resource-center-manifest.test.mjs tests/product/resource-center-transaction.test.mjs` and record any unrelated baseline failures separately.

### Task 4: Rebuild the System Components pane around the two cards

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js` only if an existing owner method needs a missing declaration
- Test: `tests/ui/system-components-page.test.mjs`

**Interfaces:**
- Consumes: Task 1 model, Task 3 Z2K projection, `EnginePanel.load/render/mount/unmount`, existing `maintenance.versions`, `engine.*`, and `resources.*` methods.
- Produces: Components page loading/refresh, compact Manager summary, Engine card with expandable management, Z2K Core card/details, check deduplication, and legacy deep-link expansion.

- [ ] **Step 1: Write failing page contract tests.** Assert page copy/structure for Manager metadata, `2 из 2 готовы`, exactly two component IDs, Engine `Управление`, Z2K `Подробнее`, no Avatar/Telegram/WARP/resource catalog card, no Z2K delete action, and no raw backend stack trace in normal state.
- [ ] **Step 2: Run the page contract test and verify RED.** Run `node --test tests/ui/system-components-page.test.mjs`. Expected: failure because the current `renderSystem()` is an installed-versions table plus Telegram Proxy handoff.
- [ ] **Step 3: Implement Components loading.** Add an active `components` pane path that loads only the required existing payloads, handles settled failures as component-specific unknown states, and preserves the existing EnginePanel data contract. The page `Проверить` action must serialize concurrent calls and refresh the same route.
- [ ] **Step 4: Implement the compact cards.** Render health first, then version/compatibility/counters, then context-appropriate action. Render EnginePanel only inside an Engine management disclosure; render Z2K details/provenance in a modal or disclosure and keep technical fields behind Advanced mode.
- [ ] **Step 5: Implement state-specific actions.** Missing Engine shows `Установить` and routes to Engine management; healthy Engine shows `Управление`; safe Z2K update shows changes/update; integration-required shows details only; broken Z2K shows only supported repair/recheck action.
- [ ] **Step 6: Implement real check behavior.** Call existing Engine status/gate and Resource Center check contracts, show pending state, disable duplicate invocation, preserve last known state on failure, and recompute aggregate health after completion.
- [ ] **Step 7: Run the page contract and focused UI suite.** Run `node --test tests/ui/system-components-page.test.mjs tests/ui/system-components-model.test.mjs tests/ui/system-components-navigation.test.mjs tests/ui/system-diagnostics-consolidation.test.mjs`.

### Task 5: Finish independent Backups and Settings UX

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js`
- Test: `tests/ui/system-backups-settings.test.mjs`

**Interfaces:**
- Consumes: existing `backup_list`, `backup_create`, `backup_restore_preview`, `backup_restore`, and `backup_delete` RPCs plus browser UI state.
- Produces: default full backup creation, advanced real-scope selection, preview-before-restore copy, and Settings containing only the working Advanced mode toggle.

- [ ] **Step 1: Write failing backup/settings tests.** Assert default create payload is `scope: 'all'`/equivalent supported full scope, advanced options expose only `engineConfig`, `ourState`, `lists`, and `profiles`, preview displays integrity/version gate/diff before restore, and user-facing settings contain no developer-note/RPC-boundary text.
- [ ] **Step 2: Run the test and verify RED.** Run `node --test tests/ui/system-backups-settings.test.mjs`. Expected: failure because current copy says `Создать backup`, defaults to a visible scope selector, and renders the developer-facing contract panel.
- [ ] **Step 3: Implement the backup UX without changing backup ownership.** Make `Всё` the normal create action, move scope selection under Advanced disclosure, preserve preview identity/verification checks, and keep unsupported scopes out of the UI.
- [ ] **Step 4: Simplify Settings copy.** Keep the Advanced mode switch and remove only developer-facing implementation notes; do not invent a server settings RPC.
- [ ] **Step 5: Run the test and relevant backup contracts.** Run `node --test tests/ui/system-backups-settings.test.mjs tests/product/backup*.test.mjs` using the repository's actual matching files; if the glob is unsupported by the shell, enumerate the matching test files with `Get-ChildItem` and pass them explicitly.

### Task 6: Add compact responsive styling and update regression contracts

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `tests/ui/system-components-page.test.mjs`
- Modify: `tests/ui/system-diagnostics-consolidation.test.mjs` only for changed System expectations

**Interfaces:**
- Consumes: existing shell panels, buttons, chips, disclosure, and responsive primitives.
- Produces: stable Components card geometry, visible health/update distinction, compact details layout, and narrow-screen behavior.

- [ ] **Step 1: Add CSS assertions before styling.** Extend the page test with required selectors for the Components summary, component cards, state badges, details area, and narrow layout.
- [ ] **Step 2: Run the page test and verify the new CSS assertions fail.** Run `node --test tests/ui/system-components-page.test.mjs` and confirm the failure is missing selectors.
- [ ] **Step 3: Add the smallest CSS rules.** Reuse existing variables and primitives; add no global redesign. Ensure update-available is not styled as broken and integration-required has a distinct warning treatment.
- [ ] **Step 4: Run focused UI tests and `git diff --check`.** Require the page, model, navigation, consolidation, backup/settings, and Resource Center UI tests to pass with no whitespace errors.

### Task 7: Complete verification and delivery evidence

**Files:**
- Create: `.superpowers/sdd/2026-08-21-system-components-ia.md`
- Review: all files changed by Tasks 1–6

- [ ] **Step 1: Run exact focused tests.** Run the new model/navigation/page/backup/settings tests, the updated consolidation test, Resource Center signed-Z2K/resource tests, relevant backup/product tests, and relevant Engine compatibility tests.
- [ ] **Step 2: Run available broader host gates.** Run the repository's documented Node/UI/product suites that are applicable to this frontend/backend slice. Capture exact pass/fail counts; unrelated baseline reds remain explicitly unverified or baseline-failing.
- [ ] **Step 3: Run static contract checks.** Check no visible System navigation item remains for Updates/Engine, no Components markup mentions Avatar/Telegram Proxy/WARP/resource catalog, no Z2K delete action exists, and legacy routes resolve to Components.
- [ ] **Step 4: Run repository hygiene checks.** Run `node scripts/validate-knowledge.mjs`, `git diff --check`, and `git diff --find-renames`. Compare validator output to the pre-existing baseline errors recorded before implementation.
- [ ] **Step 5: Run mandatory browser confirmation.** Start the available LuCI preview or local static harness, invoke the browse skill, and capture desktop plus narrow viewport evidence for `Система → Компоненты`, `#/engine` deep-link expansion, `#/updates` redirect, Engine management, `Резервные копии`, and `Настройки`. Assert in the browser that Components contains only Engine/Z2K Core and does not contain Avatar, Telegram Proxy, WARP, or resource catalog content.
- [ ] **Step 6: Write the evidence report.** Record worktree/branch, commits, exact files, focused tests, broader tests, validator baseline, browser URL/viewport/screenshot paths, exercised flows, and explicit non-runs. Do not claim router deployment or package E2E because this slice does not authorize deployment.
- [ ] **Step 7: Commit only task files.** Stage the spec/plan if not already committed plus implementation/tests/report, verify `git diff --cached --name-only`, and commit with a scoped message.
- [ ] **Step 8: Verify final branch state.** Run `git status --short --branch`, `git log --oneline -3`, and prove the primary dirty checkout remains unchanged apart from the agent-created graphify artifact already identified during discovery.
