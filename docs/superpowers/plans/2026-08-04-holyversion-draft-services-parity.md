# Holyversion Draft and Services Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-local draft/apply presentation with one backend-authoritative semantic draft coordinator and deliver a real-data Services page matching the approved `holyversion.html` structure, including catalogue-wide tri-state category controls.

**Architecture:** Keep `app.js` as the only `L.view.extend()` root and keep LuCI helper modules as `baseclass.extend(...)`. Add small pure model modules for draft normalization/diff and Services selectors. `app.js` owns scope registration, preflight/apply ordering, partial-result retention, and modal orchestration; each page owns only its adapter and local editing state. `z2m-services.js` owns catalogue-mode presentation and delegates all mutation to the global coordinator through the Services adapter. Existing RPC method names and positional `edit` transport remain unchanged.

**Tech Stack:** LuCI JavaScript, `baseclass`, `E()`, existing `z2m-api.js` facade, Node.js `node:test`, `tools/luci-module-smoke.mjs`, shell repository gate, GitHub Actions via `gh`.

## Global Constraints

- `holyversion.html` is the only UI/UX reference; its demonstration values and browser simulation are not production data.
- Every operational value comes from an existing backend/RPC response or renders as unavailable.
- LuCI remains frontend-only for this slice: `luci-app-zapret2-manager` release `r142` -> `r143`; backend and full meta-package remain `r137`.
- Do not add a backend RPC, ACL entry, backend release change, second apply engine, legacy wrapper, external asset, fake catalogue entry, countdown, timer, or automatic rollback UI.
- Keep exactly one root `L.view.extend()` in `app.js`, helper modules as `baseclass.extend(...)`, single-view lifecycle, activation token, stale-while-revalidate cache, unmount ordering, positional `edit` transport, existing RPC names, ACL contracts, proxy secret protections, terminal missing-run behavior, Strategy candidate preflight, and Service DNS ownership.
- Scope names are `strategy`, `services`, `dns`, `lists`, `proxy`, `service-dns`, `maintenance`, and any other scope only when an adapter exists; unknown scopes are visible and blocked, never silently skipped.
- The apply button is enabled only when all draft scopes have an adapter, local validation passes, backend preflight/preview passes, revisions are current, and no conflict/blocker exists.
- Raw JSON is hidden in the semantic diff; any advanced technical details redact keys matching `secret`, `token`, or `password` and never render proxy link secrets.
- No user-owned list entry may be removed by Services catalogue application; backend ownership remains authoritative.
- Bulk Services actions operate on the complete active-mode backend catalogue, not filtered rows.
- Do not create branches other than the existing `main` and `feat/holyversion-reference-parity`; do not force-push.
- Router acceptance remains `PARTIAL` and must be stated in the PR.

## File Map

### Create

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js` - pure scope normalization, semantic diff, redaction, applicability and apply-result bookkeeping.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services-model.js` - pure catalogue selectors, draft delta calculation, category tri-state and KPI/filter derivation.
- `tests/ui/draft-model.test.mjs` - RED/GREEN contracts for semantic scopes, blockers, secrets and partial apply.
- `tests/ui/services-model.test.mjs` - RED/GREEN contracts for selectors, categories, bulk actions and draft deltas.
- `tests/ui/global-draft-apply.test.mjs` - source and harness contracts for the coordinator and modal.
- `tests/ui/services-parity.test.mjs` - source/render contracts for the two Services modes and controls.

### Modify

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js` - register adapters, remove confirmation/countdown flow, run coordinator, update the global bar and semantic diff modal, retain successful scopes only after reread/verification.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js` - render exactly `Отменить все`, `Показать различия`, and primary `Применить`; expose disabled reason, semantic modal footer, and manual rollback presentation only for backend-confirmed snapshots.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js` - preserve immutable scope drafts and add pending coordinator state/results without replacing applied data with draft data.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js` - only expose existing methods needed by adapters; no RPC names or transport changes.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js` - remove local preview/apply engine, consume the Services model, render all real backend categories, modes, master switches, counts, changed rows and global draft alias.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css` - Services parity geometry, category controls, mode tabs, changed rows and responsive states.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css` - global bar and semantic modal disabled/error states; no confirmation/countdown styles.
- `luci-app-zapret2-manager/Makefile` - LuCI `PKG_RELEASE:=143`.
- `tests/ui/single-view-manager.test.mjs` - exact global action and no legacy primary-workflow assertions.
- `tests/ui/single-view-services-lists-dns.test.mjs` - Services adapter/model/mode contracts.
- `tests/ui/video-drafts-service-dns-regressions.test.mjs` - no page-local Services apply and no confirmation/countdown regression.
- `tests/ui/render-harness.test.mjs` - real backend catalogue fixtures, two modes, synchronized KPI/filter and post-apply state.
- `tests/packaging.test.mjs` - shipped modules, r143, unchanged backend/meta r137, no legacy runtime.

### Backend boundary

No backend files are changed. `catalog_list`, `catalog_status`, `catalog_preview`, and `catalog_apply` already provide real catalogue metadata, category/service records, revision/hash preconditions, snapshot, sanctioned write, reread and membership verification. The coordinator must use these contracts and must report unsupported scopes rather than inventing a cross-scope backend transaction. If an implementer proves an existing contract cannot meet a stated safety gate, stop that task before adding backend code and record the concrete missing contract in the SDD ledger.

---

## Task 1: Define pure draft and Services RED contracts

**Files:**
- Create: `tests/ui/draft-model.test.mjs`
- Create: `tests/ui/services-model.test.mjs`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-draft-model.js`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services-model.js`

**Interfaces:**
- `DraftModel.normalizeScope(scope, value)` returns `{scope, changes, applicable, blocker, revision, advanced}`.
- `DraftModel.semanticDiff(draft, applied)` returns ordered scope groups with `{label, rows, applicable, blocker}`.
- `DraftModel.redact(value)` returns a display-safe clone/string with secret values masked.
- `DraftModel.applyAvailability(scopes)` returns `{enabled, reason, blockers}`.
- `DraftModel.recordApplyResult(draft, result)` returns `{draft, clearedScopes, failedScopes, errors}` and never clears failed scopes.
- `ServicesModel.catalog(catalog, status)` returns normalized real services/categories/mode metadata without adding entries.
- `ServicesModel.selectors(services, baseline, draft, query, filter, category)` returns one shared `{visible, counts, kpis}` object.
- `ServicesModel.categoryState(services, enabled)` returns `off|on|mixed` plus enabled/total counts.
- `ServicesModel.toggleCategory(services, enabled, category)` applies mixed -> on and on -> off to every service in the category.
- `ServicesModel.toggleAll(services, enabled, on)` changes every service in the active catalogue, ignoring search visibility.
- `ServicesModel.changes(services, baseline, enabled)` returns only changed service IDs with before/after values.

- [ ] Write failing tests for empty draft, unsupported scope, unavailable strategy, revision conflict, semantic grouping, default non-raw diff, secret redaction, partial apply retention, applied/draft counts, off/on/mixed, individual override, all/none and search-independent bulk actions.
- [ ] Run `node --test tests/ui/draft-model.test.mjs tests/ui/services-model.test.mjs`; confirm expected RED failures caused by missing exports.
- [ ] Implement the two pure modules with no DOM, RPC, random values or hardcoded catalogue entries.
- [ ] Rerun the two focused tests and then `node --check` for both modules.
- [ ] Commit: `test: define draft and services selector contracts` for tests, then `feat: add draft and services pure models` for implementation.

## Task 2: Implement global semantic draft coordinator

**Files:**
- Modify: `app.js`, `z2m-shell.js`, `z2m-store.js`, `z2m-api.js`
- Modify: `tests/ui/global-draft-apply.test.mjs`, `tests/ui/single-view-manager.test.mjs`, `tests/ui/video-drafts-service-dns-regressions.test.mjs`, `tests/ui/render-harness.test.mjs`
- Modify: `z2m-ui.css`

**Interfaces:**
- `app.js` adapter registry entries expose `validateDraft(scope, value, context)`, `previewDraft(scope, value, context)`, `applyDraft(scope, value, expectedRevision, context)`, `reloadAppliedState(context)`, and `resetDraft()` or an equivalent object with the same responsibilities.
- Coordinator exposes internal `preflightDraft(snapshot, context)`, `applyDrafts(snapshot, context)`, `handleApplyResult(result)`, and `openSemanticDiff()` behavior through the root view event handlers.
- `Shell.renderApplyBar(store, availability)` emits IDs `z2m-discard-drafts`, `z2m-preview-drafts`, `z2m-apply-drafts`, and a visible disabled reason when needed.
- `Shell.renderConfirmBar` is removed from the primary workflow. Manual rollback is a result action only when `{available:true, snapshotId|revision}` comes from backend.

- [ ] Extend tests first: assert exactly the three global actions, no `Показать на странице`/`Перейти к изменениям`, primary Apply, no `rollback_ttl`/deadline/interval/countdown, disabled reason, semantic modal apply, full preflight before mutation, successful scope clear, failed scope retention and exact errors.
- [ ] Run focused tests to confirm RED against current bar/countdown implementation.
- [ ] Implement coordinator with ordered snapshot -> revision reads -> local validation -> backend previews/preflight -> full blocker rejection -> adapter apply -> adapter reread -> verification -> per-scope clear. Use `Promise` sequencing; never trust RPC exit/resolve alone.
- [ ] Ensure a blocker prevents every mutation call, stale revision remains in draft, and unsupported scopes are visible as blocked.
- [ ] Ensure `Отменить все` resets page module drafts and browser state only; it never invokes a backend mutation.
- [ ] Implement semantic diff default view with human labels/values and collapsible redacted advanced details only.
- [ ] Remove browser confirmation timer and `confirm_alive`/automatic rollback presentation from this primary workflow while retaining backend manual rollback action when explicitly available.
- [ ] Run focused tests, `node --check app.js z2m-shell.js z2m-store.js z2m-api.js`, and render harness.
- [ ] Commit: `feat: unify semantic draft apply workflow`.

## Task 3: Adapt existing supported scopes without duplicating apply logic

**Files:**
- Modify: `z2m-strategy-page.js`, `z2m-strategy.js`, `z2m-lists.js`, `z2m-dns.js`, `z2m-proxy.js`, `z2m-services.js` as needed for adapter exports only
- Modify: `app.js`, `z2m-draft-model.js`
- Modify: `tests/ui/global-draft-apply.test.mjs`, `tests/ui/video-drafts-service-dns-regressions.test.mjs`, `tests/ui/render-harness.test.mjs`

**Interfaces:**
- Each supported adapter carries the existing page state and backend preconditions in semantic draft data; it does not directly apply from a page button.
- Services adapter uses `catalogPreview({enabled})`, then `catalogApply({enabled, revision: ledgerRevision, fileSha256})`, followed by `catalogStatus()` and `catalogList()` reread.
- DNS adapter uses existing `dns.validate`, `dns.set({entries, revision})`, and `dns.apply({mode:'apply'})`, followed by `dns.get()` reread. It must not claim success from `dns.set` alone.
- Strategy adapter uses existing candidate preflight and `profiles.apply({mode:'preview'|'apply'})` only for an applicable candidate; it must preserve candidate blocker evidence.
- Lists and proxy remain blocked by the global button unless their current backend contract and adapter provide a safe preview/apply/revision/reread path. The block reason is shown in the semantic diff, not silently skipped.

- [ ] Add RED integration tests for adapter contract shape, no mutation on preflight blocker, no strategy apply when `applicable:false`, and unsupported scope reason.
- [ ] Run them RED against page-local apply paths.
- [ ] Move only the coordinator-facing adapter methods into modules; remove or convert page-local Apply buttons to aliases that call the same coordinator.
- [ ] Verify proxy secrets and links never enter draft, semantic diff, store, toast or advanced details.
- [ ] Run all focused global/draft tests and source checks.
- [ ] Commit: `feat: route supported pages through global apply coordinator`.

## Task 4: Build the real-data Services page parity

**Files:**
- Modify: `z2m-services.js`, `z2m-services-model.js`, `z2m-components.css`, `z2m-ui.css`
- Modify: `tests/ui/services-model.test.mjs`, `tests/ui/services-parity.test.mjs`, `tests/ui/single-view-services-lists-dns.test.mjs`, `tests/ui/render-harness.test.mjs`

**Interfaces:**
- `z2m-services.js` loads only real `catalogList`, `catalogStatus`, health/preflight/source metadata already exposed by the facade; missing responses render unavailable.
- Active modes are exactly `services` (`Собрать по сервисам`) and `hosts` (`Готовый hosts`). Hosts source rows contain backend-provided ID, label, metadata, revision/date and validation status; no fake source is rendered.
- Category master switches have `aria-checked`/state for off/on/mixed. Mixed click/keyboard action is deterministic: mixed -> on; on -> off; off -> on.
- Global `Включить все` and `Выключить все` call `ServicesModel.toggleAll` over the full active catalogue and show the exact copy `Массовые действия применяются ко всему каталогу, включая скрытые поиском сервисы`.
- KPI, filters and visible rows use the same draft-aware selector. Changed rows show `изменено`, `будет включено`, or `будет выключено`; applied values remain visually distinct.

- [ ] Add RED render/source tests for two modes, backend categories/fallback names, master switches, `N из M включено`, search/filter/KPI agreement, global controls, changed rows, source metadata and no fake entries.
- [ ] Run Services-focused tests and render harness to confirm RED against current one-mode/local-action page.
- [ ] Implement the reference composition with real backend values, responsive layout and mode-safe draft retention. Switching modes must prompt/retain rather than destroy the other mode draft.
- [ ] Wire individual, category and global changes to `ctx.setDraft('services', {changes, mode, enabled, baseline, precondition})`; clear only when no actual delta exists.
- [ ] Make any page-level preview/apply button an alias that opens the global semantic diff/coordinator, never an independent mutation path.
- [ ] Run focused Services tests, `node --check z2m-services.js z2m-services-model.js`, and render harness.
- [ ] Commit: `feat: match holyversion services controls`.

## Task 5: Verify successful and failed Services apply behavior

**Files:**
- Modify: `tests/ui/global-draft-apply.test.mjs`, `tests/ui/services-parity.test.mjs`, `tests/ui/render-harness.test.mjs`, `tests/ui/single-view-services-lists-dns.test.mjs`
- Modify implementation files only where a failing regression test proves a gap.

**Interfaces:**
- Successful catalog apply must call `catalogStatus/catalogList` reread, derive new baseline from applied state, set changed count to zero and remove `services` from `store.draft`.
- Failed catalog apply must leave the prior applied baseline unchanged, retain `services` draft and show the normalized backend error; partial coordinator results clear only verified successful scopes.
- Stale revision/hash, invalid source, digest mismatch and backend verification failure are blockers or explicit errors before reporting success.

- [ ] Write RED tests with deterministic fake API functions that record mutation order and return preflight, success, conflict and failure responses.
- [ ] Run RED and verify each failure reflects missing behavior rather than a test/setup error.
- [ ] Implement the smallest state/result fixes in the reviewed task owner, preserving backend-authoritative baseline.
- [ ] Run focused tests and the complete UI focused set: `node --test tests/ui/draft-model.test.mjs tests/ui/services-model.test.mjs tests/ui/global-draft-apply.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-manager.test.mjs tests/ui/single-view-services-lists-dns.test.mjs tests/ui/video-drafts-service-dns-regressions.test.mjs tests/ui/render-harness.test.mjs`.
- [ ] Commit: `test: lock services apply verification and failure retention` plus implementation commit if needed.

## Task 6: Packaging, release and repository regression gates

**Files:**
- Modify: `luci-app-zapret2-manager/Makefile`, `tests/packaging.test.mjs`
- Modify only relevant UI tests/source if a gate exposes a regression.

- [ ] Add RED packaging assertions for shipped `z2m-draft-model.js` and `z2m-services-model.js`, LuCI r143, backend/meta r137 and no legacy/countdown/fake catalog runtime.
- [ ] Run `node --test tests/packaging.test.mjs` and confirm RED before changing release/source.
- [ ] Bump only LuCI release 142 -> 143; do not change backend/meta Makefiles or ACL/menu.
- [ ] Run focused tests, `node --check` for every changed LuCI JS file, `tools/run-all-tests.sh`, `git diff --check`.
- [ ] Check CSS brace balance, menu/ACL JSON parsing, local-only assets, no legacy wrappers, no secrets, no demo values, no automatic rollback countdown, no temporary workflow files and no extra branches.
- [ ] Commit: `build: release LuCI r143 for draft services parity`.

## Task 7: Whole-branch review and exact-head integration

**Review process:**

- [ ] Create an SDD ledger at `.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/progress.md` and record each task base/head, review verdict, fix-loop round and deferred minor.
- [ ] After every task, dispatch a fresh task implementer, generate a review package from the recorded base SHA, dispatch a task reviewer with the brief/report/package, and fix every Critical/Important finding through the implementer. Never apply controller-side fixes. Re-review each fix range.
- [ ] After all tasks, compute `MERGE_BASE=$(git merge-base main HEAD)`, generate the full review package, and dispatch the strongest available whole-branch code reviewer. Fix all Critical/Important findings in one fix wave and run one scoped re-review.
- [ ] Re-run the full verification after review fixes; record exact focused count, full count, zero red failures and final `git diff --check` output.

**Exact-head CI and PR:**

- [ ] Confirm `git status --short` is clean, `git rev-parse HEAD` is the tested SHA, and `git rev-parse main` remains `bc184396aa51ba8ead93b62a483c2f94fef972eb` before push.
- [ ] Push only `feat/holyversion-reference-parity` without force: `git push origin feat/holyversion-reference-parity`.
- [ ] Create/update draft PR to `main` with title `feat: unify apply flow and match holyversion services` and body containing scope, canonical-reference parity, real-data-only rule, global draft/apply, category switches, semantic diff, partial apply, no 60-second rollback, versions, exact focused/full counts, exact head SHA, CI workflow/job, and router verdict `PARTIAL`.
- [ ] Capture the PR number and exact head SHA with `gh pr view --json number,headRefOid,baseRefName,isDraft,mergeable,reviews,statusCheckRollup`.
- [ ] Wait for CI for that exact SHA using `gh pr checks <number> --watch`; record the workflow and job names and require success.
- [ ] Before merge re-check: PR head equals tested SHA, CI success, full gate 0 red, `isDraft=false`, `mergeable=true`, no `REQUEST_CHANGES`, no unresolved threads, and no commits after verification.
- [ ] Merge with a merge commit and expected head SHA using GitHub CLI, never squash/rebase/force-push.

**Post-merge permanent branch alignment:**

- [ ] Fetch `origin/main`, verify the merge commit is the new `main` head, then fast-forward `feat/holyversion-reference-parity` to that exact commit with `git merge --ff-only origin/main`.
- [ ] Push the permanent branch normally, verify `git rev-parse main` equals `git rev-parse feat/holyversion-reference-parity` and both equal `origin/main`.
- [ ] Verify no additional local or remote branches were created by this work; keep both `main` and `feat/holyversion-reference-parity`.
- [ ] Leave router acceptance explicitly `PARTIAL` and report PR URL, merge SHA, exact verification counts, CI job, and final ref equality.
