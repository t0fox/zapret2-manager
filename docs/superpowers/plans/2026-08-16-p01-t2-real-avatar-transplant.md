# P01-T2 Real Avatar Transplant Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each slice ends with a focused test cycle and a focused commit.

**Goal:** Replace the remaining P01/shared Z2M custom approximations with source-derived Avatar component structure and behavior while retaining canonical Z2M RPC/state, Russian product copy, LuCI shell, horizontal navigation, and the frozen Graphite theme.

**Architecture:** Keep `z2m-overview.js` as the Z2M adapter/state owner, but move donor-derived Dashboard composition into a focused Avatar component module. The adapter supplies normalized cards, lifecycle controls, event rows, and the approved resource checker; the component owns donor DOM hierarchy, action affordance, and log/modal/toast presentation. Backend and router code remain unchanged.

**Tech Stack:** LuCI JavaScript view modules, LuCI `E()` DOM construction, existing Z2M RPC adapters, Node `node:test`, direct SCP development deployment, one authenticated Codex in-app Browser session.

**Spec:** User-provided P01-T2 task in `C:\Users\Kirill\.codex\attachments\44d0a62d-6d7a-4a50-839c-deaab8169f47\pasted-text.txt`.

## Global Constraints

- Donor authority is `avatarDD/zapret-gui@38ed85ce487c6b3dbdf703a5be197795f7c0cad1`; do not fetch a newer donor.
- Work only in `G:\zapret2-manager\.codex-avatar-parity`; preserve all pre-existing dirty files and do not touch P02.
- Keep the current Graphite theme, horizontal navigation, LuCI/OpenWrt shell, Russian product copy, canonical Z2M RPC/state, and approved `Проверить ресурс` extension.
- Do not change engine architecture, backend ownership, package/runtime footprint, or add donor Python/Bottle/API code.
- Use TDD for behavior changes: write a failing focused test, run RED, implement the smallest slice, run GREEN.
- Use one existing authenticated Browser session for final functional acceptance; no multi-resolution completion gate.
- Final runtime must remain `NFQWS2_ENABLE=0` and `runtimeSummary.status=stopped`.

---

### Task 1: Source re-audit and false-classification gate

**Files:**
- Modify: `docs/05-parity/avatar-transplant-audit.md`
- Create: `tests/ui/p01-t2-transplant-audit.test.mjs`
- Reference only: donor `G:\avatarDD\zapret-gui` at `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`

**Interfaces:**
- Consumes donor source blocks from `web/js/pages/dashboard.js`, `web/js/pages/logs.js`, `web/js/components/confirm.js`, `web/js/components/toast.js`, and `web/css/style.css`.
- Produces a source-evidence table with donor file/symbol/CSS, current Z2M file/structure, DOM/JS/CSS evidence, and a truthful classification for Dashboard composition, cards, Quick Actions, lifecycle result UI, log viewer, and dialogs.

- [ ] **Step 1: Record the evidence baseline**

Record `ACTIVE_WORKTREE`, `INITIAL_HEAD`, and the exact pre-existing dirty file list. In the audit, classify the current source rather than relying on the previous labels: Dashboard composition and Quick Actions are `CUSTOM_APPROXIMATION`; cards and log row rendering are `ADAPTED_BOUNDARY_ONLY`; dialogs are `CUSTOM_APPROXIMATION`; lifecycle result UI is `ADAPTED_BOUNDARY_ONLY` only where its donor toast/modal boundary is actually present.

- [ ] **Step 2: Write the failing audit gate**

Add assertions that the audit names the exact donor SHA, every six audited component rows, and does not claim `CUSTOM_APPROXIMATION_REMAINING: 0` before the transplant slices are complete.

- [ ] **Step 3: Run the audit gate RED**

Run `node --test tests/ui/p01-t2-transplant-audit.test.mjs`. Expected result: the new gate fails because the current audit still contains the previous false adapted classifications or lacks the current source-evidence fields.

- [ ] **Step 4: Update the audit with source evidence**

Use the actual ranges: donor Dashboard composition/cards/actions `dashboard.js:14-254,562-595`; donor log DOM/update `logs.js:452-521`; donor modal `confirm.js:21-83`; donor toast `toast.js:14-89`; donor CSS status cards `style.css:552-607`, logs `style.css:2945-3014`, modal `style.css:1312-1433`, toast `style.css:778-827`. Map them to the current Z2M functions and selectors with `YES/NO/PARTIAL` evidence, not visual similarity.

- [ ] **Step 5: Run the audit gate GREEN and commit**

Run `node --test tests/ui/p01-t2-transplant-audit.test.mjs`, then commit only the audit and its gate as `docs(ui): re-audit P01 transplant source evidence`.

### Task 2: Real donor Dashboard composition and status-card transplant

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-dashboard.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Test: `tests/ui/p01-t2-transplant.test.mjs`

**Interfaces:**
- `z2m-avatar-dashboard.js` exports `render(options)` through `baseclass.extend`.
- `options` contains `E`, `heading`, `description`, five normalized card objects, a `quickActions` node, a `recentEvents` node, and optional Z2M extension nodes.
- `z2m-overview.js` remains responsible for `OverviewModel.normalize`, status/engine/system adapters, lifecycle state, and resource checker state.

- [ ] **Step 1: Add the failing donor-structure assertions**

Assert the new module contains the donor-derived `page-header`, `page-title`, `page-description`, `status-grid`, `status-card`, `status-card-header`, `status-card-label`, `status-card-value`, `status-card-detail`, `card`, `card-title`, `actions-row`, and `log-viewer` hierarchy, and that `z2m-overview.js` consumes the module instead of constructing those top-level containers itself.

- [ ] **Step 2: Run RED**

Run `node --test tests/ui/p01-t2-transplant.test.mjs`. Expected result: fail because the donor component module does not exist and the current overview still owns the custom composition.

- [ ] **Step 3: Port the donor composition**

Port the donor `DashboardPage.render` hierarchy into `z2m-avatar-dashboard.js` using `E()` rather than a new template engine. Keep the donor card order and hierarchy, replace donor API values with the five supplied Z2M card models, use `href` only for the approved zapret release card, and place the supplied lifecycle buttons/log viewer inside donor `card` containers. Keep the resource checker as an extension after the donor Dashboard blocks.

- [ ] **Step 4: Move the adapter boundary**

Replace the top-level `pageHead`, `renderStatusGrid`, `renderQuickActions`, and `renderEvents` composition in `z2m-overview.js` with one `AvatarDashboard.render(...)` call. Preserve all existing data normalization, lifecycle verification, event normalization, and Z2M-specific extension behavior.

- [ ] **Step 5: Port only component CSS into the frozen theme**

Add donor selector structure for `.card`, `.card-title`, `.actions-row`, and the existing status-card hierarchy under the Z2M view scope. Map donor surfaces to `--panel`, `--border`, `--tx`, `--tx2`, `--tx3`, `--blue`, `--green`, `--orange`, and `--red`; do not import donor global variables, sidebar, or theme.

- [ ] **Step 6: Run focused GREEN checks and commit**

Run `node --test tests/ui/p01-t2-transplant.test.mjs tests/ui/dashboard-parity-contract.test.mjs tests/ui/p01-5-runtime-navigation.test.mjs`. Commit as `feat(ui): transplant Avatar dashboard composition`.

### Task 3: Donor Quick Actions and result presentation

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-dashboard.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Test: `tests/ui/p01-t2-transplant.test.mjs`

**Interfaces:**
- Quick Actions receive existing Z2M mutation callbacks; the donor-derived component never calls `/api/start`, `/api/stop`, or `/api/restart`.
- Result presentation uses a normalized `{kind,title,message,technicalDetails}` adapter and the donor toast hierarchy; raw reason codes remain inside optional technical details.

- [ ] **Step 1: Add RED assertions**

Assert donor action SVG/button hierarchy, one pending lock for all three actions, no donor `/api/` calls, and a result presentation with icon/state, human title, human reason, and optional technical details.

- [ ] **Step 2: Run RED**

Run `node --test tests/ui/p01-t2-transplant.test.mjs`. Expected result: fail against the current custom `shell.button`/inline feedback implementation.

- [ ] **Step 3: Port the donor action flow**

Use donor `quickAction` structure and spinner affordance, but inject Z2M callbacks and keep the current bounded lifecycle verification. Preserve STOPPED/RUNNING disabled semantics and make the action result state explicit in the component tree.

- [ ] **Step 4: Port donor toast structure**

Adapt donor `Toast.show` to LuCI `E()` with `.toast`, `.toast-icon`, `.toast-text`, `role=status/alert`, max five entries, deduplication, click dismissal, and timeout cleanup. Keep Russian Z2M labels and the current theme tokens.

- [ ] **Step 5: Run GREEN and commit**

Run the focused UI suite and commit as `feat(ui): transplant Avatar quick actions and results`.

### Task 4: Donor modal/dialog transplant

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Test: `tests/ui/p01-t2-transplant.test.mjs`

**Interfaces:**
- Existing `shell.openModal(title, body, footer)` and `shell.closeModal()` signatures remain stable for engine/maintenance callers.
- The rendered hierarchy becomes donor-derived `.modal-overlay > .modal-content > .modal-header/.modal-title/.modal-close + .modal-body + .modal-footer`, with Z2M `E()` and current button handlers.

- [ ] **Step 1: Add RED assertions**

Assert donor class hierarchy, focus on open, Escape dismissal, click-away dismissal, single key listener, cleanup, and restoration of the existing Z2M shell callback API.

- [ ] **Step 2: Run RED**

Run `node --test tests/ui/p01-t2-transplant.test.mjs`. Expected result: fail because current `z2m-modal/.mh/.mb/.mf` is a custom hierarchy.

- [ ] **Step 3: Implement the donor-derived modal boundary**

Change only the presentation boundary in `z2m-shell.js` and the reusable confirmation helper in `z2m-avatar-ui.js`; preserve Russian text, destructive button semantics, focus behavior, and Z2M operation callbacks.

- [ ] **Step 4: Port modal CSS selectors into Graphite**

Use donor overlay/content/header/body hierarchy and current theme variables, without importing donor global theme or strategy-editor behavior.

- [ ] **Step 5: Run GREEN and commit**

Run the focused UI suite and commit as `feat(ui): transplant Avatar modal boundary`.

### Task 5: Closure evidence, deployment, and one-session Browser acceptance

**Files:**
- Modify: `docs/05-parity/avatar-transplant-audit.md`
- Modify: `tests/ui/parity/dashboard.parity.json`
- Modify: `tests/ui/parity/validator.test.mjs` only if the completion contract changes
- Use: `scripts/deploy-dashboard-parity-target.sh`

**Interfaces:**
- Deployment candidate is a clean worktree/commit containing only the P01-T2 runtime closure; direct SCP manifest remains bounded to frontend/ACL assets.
- Browser acceptance uses the existing authenticated Codex in-app Browser tab once at normal desktop viewport.

- [ ] **Step 1: Run all focused tests and inspect the diff**

Run the P01-T2 transplant suite, dashboard contract suite, log UX suite, parity validator, and `git diff --check`; confirm no unrelated dirty file is staged.

- [ ] **Step 2: Build a clean deploy candidate**

Create a clean temporary worktree from the accepted P01 runtime base, apply only the committed P01-T2 frontend/doc-independent runtime commits, run the target deployment guard, and verify each deployed manifest SHA, owner, and mode.

- [ ] **Step 3: Browser acceptance in one existing authenticated session**

Hard-refresh the deployed page, inspect Dashboard structure/cards/Quick Actions/log viewer/modal, exercise one safe action/result path if required by changed interaction code, verify `Главная → Система → Главная`, Browser Back/Forward, URL/hash/rendered-page agreement, and inspect console/network/RPC/module failures.

- [ ] **Step 4: Recheck runtime final state**

Read-only target checks must show `NFQWS2_ENABLE=0`, no nfqws2 process, and `runtimeSummary.status=stopped`; run the lifecycle canary only if the changed UI interaction path materially changes lifecycle behavior.

- [ ] **Step 5: Record truth and commit**

Update donor provenance, final classifications, `CUSTOM_APPROXIMATION_REMAINING=0`, browser result, target SHA evidence, dirty-state preservation, `P02_STARTED=NO`, and final status. Commit docs/evidence separately from runtime code.

## Self-review checklist

- Donor source evidence is recorded before implementation claims.
- Every previously false `ADAPTED_BOUNDARY_ONLY` row is corrected before it is reclassified.
- No donor backend/API/sidebar/theme is copied.
- Each behavior change has a RED test observed before implementation and a GREEN focused suite afterward.
- The final audit has no usable-donor `CUSTOM_APPROXIMATION` rows.
- One authenticated Browser session proves real behavior; responsive sweeps are not used as the completion gate.
- P02 remains unstarted and unrelated dirty changes remain untouched.
