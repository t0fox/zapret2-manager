# P03 — Real Avatar Strategies Page Transplant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Z2M Strategies surface with the frozen Avatar Strategies list/card/editor interaction model while keeping canonical Z2M Strategy RPCs, state, Graphite shell, and Russian product presentation authoritative.

**Architecture:** `z2m-strategy-page.js` remains the route/lifecycle wrapper and `z2m-strategy.js` remains the canonical data/API adapter. The new donor-derived surface will live in a focused `z2m-avatar-strategies.js` module, reusing Z2M normalization and RPC boundaries but transplanting the donor page composition, ListUI card structure, editor modal, preview/validation, safe CRUD, selection, and cleanup patterns. Unsupported donor healthcheck/autocircular HTTP API features will not be copied; they will be documented as `BACKEND_NOT_READY` or intentional Z2M differences.

**Tech Stack:** LuCI JavaScript/baseclass, existing Z2M `Api`, `Shell`, `Strategy` adapter, donor `strategies.js`/`list_ui.js`/`confirm.js`/`nfqws2_lint.js`/`syntax.js`, Node `node:test`, direct SCP deployment, one authenticated in-app Browser session.

**Spec:** `C:\Users\Kirill\.codex\attachments\15e8c3d5-3213-4986-b10f-7627678c2c5f\pasted-text.txt`

## Global Constraints

- Work only in `G:\zapret2-manager\.codex-avatar-parity`; preserve the recorded dirty files exactly.
- Frozen donor is `avatarDD/zapret-gui` `origin/main` at `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`.
- Z2M canonical Strategy RPC/state remains the authority; no backend rebuild or new RPC.
- Keep the current Z2M Graphite theme, horizontal navigation, LuCI shell, and Russian normal UI.
- Preserve real nfqws2 profile boundaries and raw flags, including `--new`; do not flatten or reorder profiles.
- Do not copy donor `/api/*` calls, sidebar/router, global theme, or unsupported healthcheck/autocircular backend.
- Do not start P04; do not mutate runtime except an explicitly safe bounded Apply canary if proven reversible.

---

### Task 1: Freeze source manifest and write RED transplant contracts

**Files:**
- Create: `tests/ui/p03-strategies-transplant-contract.test.mjs`
- Create: `tests/ui/p03-strategies-model.test.mjs`
- Create: `tests/ui/p03-strategies-lifecycle-contract.test.mjs`
- Create: `docs/05-parity/avatar-strategies-transplant-audit.md`

**Interfaces:**
- Tests consume the donor SHA/source manifest and the planned `z2m-avatar-strategies.js`/`z2m-strategy.js` boundary.
- The audit records donor files, symbols, CSS, DOM, interactions, dependencies, and each required final classification.

- [ ] **Step 1: Record donor source facts.** Pin `web/js/pages/strategies.js`, `web/js/components/list_ui.js`, `web/js/components/confirm.js`, `web/js/components/toast.js`, `web/js/utils/nfqws2_lint.js`, `web/js/utils/syntax.js`, `web/js/utils/autocomplete.js`, and the Strategies CSS ranges from the frozen donor commit.
- [ ] **Step 2: Write failing source-contract tests.** Assert the new Strategies module is donor-derived, uses no donor `/api/` or `fetch`, preserves the donor card/editor/modal/list selectors, delegates to canonical `Api.strategies` methods, and is wired to `Обход DPI → Стратегии`.
- [ ] **Step 3: Write failing model tests.** Cover normalization of list/detail/status, selected versus applied/current identity, profile order and `--new` preservation, Russian state labels, safe unsupported-action mapping, and no raw enum/reason-code presentation.
- [ ] **Step 4: Run the three P03 tests.** Confirm they fail for missing donor-derived surface/contract before production implementation.
- [ ] **Step 5: Commit only the RED tests and audit scaffold.**

### Task 2: Transplant donor Strategies composition and list/card surface

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-strategies.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`
- Test: `tests/ui/p03-strategies-transplant-contract.test.mjs`, `tests/ui/p03-strategies-model.test.mjs`

**Interfaces:**
- `z2m-avatar-strategies.js` exports `render(ctx, data)`, `mount(ctx)`, `unmount()`, and safe surface helpers used by the page wrapper.
- It consumes normalized canonical Strategies data and `ctx.api.strategies`; it never calls donor HTTP endpoints.

- [ ] **Step 1: Add donor-derived module skeleton and failing selector assertions.** Use the donor `StrategiesPage` composition and IDs/classes for page header, active/current card, list host, bulk bar, strategy cards, preview modal, and editor modal; scope only necessary Z2M shell differences.
- [ ] **Step 2: Implement canonical data boundary.** Adapt `Strategy.load`, `normalizeStrategy`, `activeIdentity`, `strategyAvailability`, and profile normalization so canonical Z2M list/detail/status data populates donor-shaped cards without changing backend data.
- [ ] **Step 3: Implement the donor ListUI surface.** Transplant donor search, filters, grouping, empty state, count, selected card, active/applied visual treatment, profile badges, readable args preview, and action hierarchy using `z2m-avatar-strategies.js` plus existing shared primitives.
- [ ] **Step 4: Implement safe supported actions.** Map favorite, preview, validate, apply, duplicate, edit, delete, and create/update to `ctx.api.strategies.*`; classify unsupported donor healthcheck/autocircular/debug endpoints as excluded rather than rendering fake controls.
- [ ] **Step 5: Run P03 source/model tests.** Confirm the donor surface and canonical boundary tests pass while unrelated P01/P02 behavior remains untouched.
- [ ] **Step 6: Commit the list/card transplant.**

### Task 3: Transplant donor editor, dialogs, validation, preview, and CRUD guards

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-strategies.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js`
- Test: `tests/ui/p03-strategies-model.test.mjs`, `tests/ui/p03-strategies-lifecycle-contract.test.mjs`

**Interfaces:**
- Editor consumes a deep copy of canonical strategy data and produces `strategyInput` requests with ordered profiles and unchanged raw args.
- Mutations use bounded busy state and refresh only after confirmed canonical response; modal confirmation names the exact strategy.

- [ ] **Step 1: Add failing editor/CRUD assertions.** Cover create, update, duplicate, delete confirmation, save pending, duplicate-submit prevention, preview, validation, and `--new`/profile ordering.
- [ ] **Step 2: Transplant donor editor DOM and interactions.** Preserve donor form hierarchy, profile rows, enabled state, add/remove controls, filter/hostlist insertion where canonical assets support it, raw monospace args, side diagnostics, modal Escape handling, and unsaved-edit protection.
- [ ] **Step 3: Map preview/validation to canonical RPCs.** Present backend output as readable technical content with Russian surrounding copy; hide raw reason/enums by default and keep actual nfqws2 flags unchanged.
- [ ] **Step 4: Implement CRUD guards.** Disable all mutation controls while pending, require confirmation for delete/apply, prevent deletion of built-ins, refresh canonical list/detail after success, and render Russian error/empty/loading states through existing shell/toast/modal primitives.
- [ ] **Step 5: Run model/lifecycle tests and verify GREEN.**
- [ ] **Step 6: Commit editor/CRUD behavior.**

### Task 4: Add scoped donor CSS and lifecycle/navigation regression coverage

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-ui.css`
- Modify: `tests/ui/p03-strategies-lifecycle-contract.test.mjs`
- Modify: `tests/ui/p03-strategies-transplant-contract.test.mjs`

**Interfaces:**
- CSS supplies donor Strategies selectors under the existing Z2M Graphite scope; lifecycle exposes one replaceable poller and complete listener/modal cleanup.

- [ ] **Step 1: Add failing CSS/lifecycle assertions.** Require donor selector families, active/selected semantics, editor/modal/list states, and zero duplicate listeners/pollers/stale DOM after unmount/re-entry.
- [ ] **Step 2: Port only donor Strategies CSS.** Scope `.strategy-card`, `.strategy-card.active/.selected`, profile badges, `.strat-editor-layout`, `.profile-editor-item`, `.strategy-args-preview`, `.strat-bulkbar`, preview/editor modal, empty/loading/error, and responsive rules to the Z2M Graphite variables.
- [ ] **Step 3: Implement cleanup.** Remove page listeners, stop polling, detach autocomplete and resize handlers, close temporary state, and ensure returning to Strategies initializes one page instance.
- [ ] **Step 4: Wire route and labels.** Ensure `Управление → Стратегии → Управление`, `Главная → Стратегии → Главная`, Back/Forward, hash/render agreement, and no stale Control/Dashboard DOM.
- [ ] **Step 5: Run P01/P02 regression tests because shared route/shell files changed.**
- [ ] **Step 6: Commit CSS/lifecycle/navigation closure.**

### Task 5: Deploy exact candidate and execute one Browser acceptance

**Files:**
- Create or modify: `scripts/deploy-strategies-parity-target.sh`
- Modify: `docs/05-parity/avatar-strategies-transplant-audit.md`

**Interfaces:**
- Deployment script accepts only the clean P03 candidate commit, stages a bounded `/tmp` backup, SCPs the exact changed closure, verifies SHA/owner/mode, and reloads only required LuCI resources.

- [ ] **Step 1: Add the deploy guard and verify the P03 diff.** No APK build, no reboot, no unrelated UCI/runtime mutation.
- [ ] **Step 2: Deploy by direct SCP from a clean detached candidate.** Verify target hashes and `root:root`/`0644`.
- [ ] **Step 3: Use the one existing authenticated Browser session.** Exercise Strategies visual composition, open/select/view, editor, validation, preview, safe temporary CRUD only if canonical response proves cleanup, dialogs, route away/back, Back/Forward, console/module/RPC checks, Russian/raw-enum gates, and listener/poller/stale-DOM counts.
- [ ] **Step 4: Run Apply only if a reversible known-safe baseline is proven; otherwise record `TARGET_APPLY_CANARY: NOT_RUN`.** Do not risk connectivity.
- [ ] **Step 5: Update the audit with exact classifications, pass counts, target evidence, preserved dirt, and `P04_STARTED=NO`.**
- [ ] **Step 6: Run final focused/regression/syntax/diff checks and commit only P03 files.**

## Self-review checklist

- Donor source is pinned and complete before implementation.
- Donor list/card/editor/modal/preview/validation interactions are transplanted where Z2M supports them.
- Donor-only healthcheck/autocircular functionality is not faked; it is documented as unsupported.
- Canonical Z2M Strategy data, revisions, validation, preview, Apply, and persistence remain authoritative.
- `--new` and ordered real nfqws2 profiles remain intact.
- CSS stays within Z2M Graphite theme and horizontal shell.
- P01/P02 remain closed except shared-route regression checks.
- No P04 work starts.
