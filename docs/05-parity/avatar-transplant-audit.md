---
id: avatar-transplant-audit-p01-t
title: "P01-T Avatar transplant audit and retro-closure"
type: parity
status: current
updated: 2026-08-16
authority: evidence
publish: false
tags: [avatar, transplant, p01, audit]
---

# P01-T — Avatar transplant audit and retro-closure

This document is the source-level audit for the P01 Dashboard/shared UI
retro-transplant. It is not a screenshot parity claim. Every row records the
actual donor source, the current Z2M implementation, the integration boundary,
and the classification that must be closed before this task can finish.

## Frozen donor for this P01-T cycle

| Field | Value |
|---|---|
| `AVATAR_REMOTE` | `avatarDD/zapret-gui` |
| `AVATAR_DONOR_BRANCH` | `main` |
| `AVATAR_DONOR_HEAD` | `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` |
| `AVATAR_DONOR_DIR` | `G:\avatarDD\zapret-gui` |
| `AVATAR_DONOR_CLEAN` | `YES` |
| `AVATAR_DONOR_FETCHED_AT` | `2026-08-16T16:17:00.8337071+03:00` |
| `OLD_FROZEN_REFS_CURRENT_AUTHORITY` | `NO`; retained only as historical evidence |
| `P02_STARTED` | `NO` |

The donor SHA was resolved from a fresh `git fetch origin main` and is frozen
for the complete P01-T cycle. The donor checkout was clean at resolution time
and was not modified.

## Worktree and pre-transplant baseline

| Field | Evidence |
|---|---|
| `ACTIVE_WORKTREE` | `G:\zapret2-manager\.codex-avatar-parity` |
| `BRANCH` | `codex/avatar-ui-parity` |
| `PRE_TRANSPLANT_HEAD` | `21fe4d2ee8c20e4fe6d44ca802e266903c82b8f2` |
| `INITIAL_DIRTY_STATE` | 12 pre-existing changed/untracked task-adjacent files; unrelated engine/maintenance changes preserved |
| `PRIMARY_CHECKOUT` | `G:\zapret2-manager`; untouched |
| `PRE_TRANSPLANT_TESTS` | `node --test tests/ui/dashboard-parity-contract.test.mjs tests/ui/log-ux-contract.test.mjs tests/ui/p01-5-runtime-navigation.test.mjs tests/native/status-timeout-regression.test.mjs tests/product/engine-lifecycle-contract.test.mjs` — 38/38 passed |
| `PRE_TRANSPLANT_BROWSER_1280` | `NOT_RUN`; no callable browser/CDP control surface was available during baseline capture |
| `PRE_TRANSPLANT_BROWSER_768` | `NOT_RUN`; no callable browser/CDP control surface was available during baseline capture |
| `PRE_TRANSPLANT_BROWSER_390` | `NOT_RUN`; no callable browser/CDP control surface was available during baseline capture |
| `PRE_TRANSPLANT_RUNTIME_STATE` | `NOT_RUN`; fresh target query is still required and will not be inferred from historical reports |

The existing dirty files were inspected before edits. Only P01-T files will be
changed; unrelated dirty changes will remain uncommitted and untouched.

## P01-T2 start state

| Field | Evidence |
|---|---|
| `ACTIVE_WORKTREE` | `G:\zapret2-manager\.codex-avatar-parity` |
| `INITIAL_HEAD` | `a39ca7a05134e2c89b129ead64a616fef1bedf9c` |
| `P01_T_PREVIOUS_REALITY` | `MOSTLY_AUDIT_WITH_CUSTOM_UI_RETAINED` |
| `INITIAL_DIRTY_STATE` | Pre-existing changes in `z2m-maintenance-model.js`, `z2m-overview.js`, `z2m-shell.js`, `deploy-engine-single-upstream-target.sh`, native/product/UI tests, `Makefile`, engine worker/service; untracked `tests/ui/log-ux-contract.test.mjs` |
| `P02_STARTED` | `NO` |

The previous P01-T closure commit is not treated as transplant evidence. The
source comparison below is the required pre-correction truth for the current
candidate.

## P01-T2 source re-audit — pre-correction truth

Evidence uses donor source at `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` and
the current Z2M files. `YES` means actual source-derived code/structure is
present; `PARTIAL` means only some donor structure was copied; `NO` means the
current implementation is independently authored.

| Component | DONOR_FILE / SYMBOL / CSS | PRE_P01_T_Z2M_FILE / STRUCTURE | CURRENT_Z2M_FILE / STRUCTURE | ACTUAL_DONOR_CODE_PORTED | DONOR_DERIVED_DOM | DONOR_DERIVED_JS | DONOR_DERIVED_CSS | CURRENT_CLASSIFICATION |
|---|---|---|---|---|---|---|---|---|
| Dashboard composition | `web/js/pages/dashboard.js:14-254`, `render`; `.page-header`, `.status-grid`, `.card`, `.card-title`, `.actions-row`, `.log-viewer` | `z2m-overview.js`: custom `E()` section with status/resource panels | `z2m-overview.js:609-708`: custom `pageHead` + `renderStatusGrid` + `renderQuickActions` + `renderEvents` composition | `PARTIAL` | `PARTIAL` | `NO` | `PARTIAL` | `CUSTOM_APPROXIMATION` |
| Status cards | `web/js/pages/dashboard.js:21-88`, `render`/`updateCards`; `.status-card*`, `.status-dot` | `z2m-overview.js`: status cards already custom Z2M builders | `z2m-overview.js:421-439,512-529`; `z2m-ui.css:100-110` | `YES` | `YES` | `NO` for donor API/state update logic | `YES`, theme-adapted | `ADAPTED_BOUNDARY_ONLY` |
| Quick Actions | `web/js/pages/dashboard.js:204-232,562-595`, `quickAction`; `.card`, `.card-title`, `.actions-row`, `.spinner` | `z2m-overview.js`: custom lifecycle buttons/state | `z2m-overview.js:146-209,600-606`: `lifecycleAction`, `lifecycleButton`, inline feedback | `PARTIAL` | `PARTIAL` | `NO` | `PARTIAL` | `CUSTOM_APPROXIMATION` |
| Lifecycle result UI | `web/js/components/toast.js:14-89`, `Toast.show`; Dashboard `quickAction` result calls | `z2m-overview.js`: custom inline `z2m-lifecycle-feedback` | `z2m-overview.js:198-209`: custom structured result; no donor toast hierarchy for lifecycle result | `NO` for the structured result panel | `NO` | `NO` | `NO` | `INTENTIONAL_Z2M_DIFFERENCE` |
| Log viewer / Recent Events | `web/js/pages/logs.js:452-521`, `renderEntries`/`createEntryElement`; `.log-row`, `.log-time`, `.log-badge`, `.log-source`, `.log-message` | `z2m-overview.js`: custom log rows before shared adapter | `z2m-avatar-log.js:96-127` and `z2m-overview.js:531-598`: donor-derived row renderer plus Z2M normalization | `YES` | `YES` | `YES`, adapter-boundary changed | `YES`, theme-adapted | `ADAPTED_BOUNDARY_ONLY` |
| Dialogs / modals | `web/js/components/confirm.js:21-83`, `Confirm.show`/`cleanUp`; `.modal-overlay`, `.modal-content` | `z2m-shell.js`: custom `.z2m-modal/.mh/.mb/.mf` | `z2m-shell.js:315-349`, `z2m-avatar-ui.js:125-159`: custom modal/confirm hierarchy | `NO` | `NO` | `NO` | `NO` | `CUSTOM_APPROXIMATION` |

The re-audit therefore finds three actionable custom approximations with usable
donor implementations: Dashboard composition, Quick Actions, and Dialogs.
Status cards and log rows are genuine donor-derived boundaries; the lifecycle
result panel is an intentional Z2M extension because the donor only provides a
toast and does not provide the required structured human reason/details panel.

## Exact donor manifest

The following mappings were read from `AVATAR_DONOR_HEAD`, not reconstructed
from screenshots or the previous parity documents.

| Z2M component | Avatar page/component | Donor files | Donor JS symbols | Donor CSS selectors | Donor DOM/behavior/state/responsive evidence | Donor dependencies |
|---|---|---|---|---|---|---|
| Dashboard composition/header | Dashboard | `web/js/pages/dashboard.js:14-262` | `render` | `.page-header`, `.page-title`, `.page-description` | Header followed by status grids, Quick Actions and Recent Logs; static first paint | donor standalone `API`, global `NfqwsSyntax`, global `App` |
| Status card/grid | Dashboard | `web/js/pages/dashboard.js:14-202,264-532` | `render`, `updateCards`, `updateVpnCards`, `updateEngineCards`, `updateMonitoringCards`, `_toggleCard` | `.status-grid`, `.status-card`, `.status-card-header`, `.status-card-icon`, `.status-card-label`, `.status-card-value`, `.status-card-detail`, `.status-dot` | Five core cards plus donor-only VPN/Monitoring grids; running/stopped semantic classes; cards hide when optional donor products are absent; 768px two-column and 480px one-column rules | donor `/api/dashboard/status`, donor product payloads; Z2M must replace only this boundary |
| Quick Actions | Dashboard | `web/js/pages/dashboard.js:204-233,562-595` | `quickAction`, `bindEvents`, `onContentClick` | `.card`, `.card-title`, `.actions-row`, `.btn`, `.spinner` | Three ordered actions; all buttons disabled during one pending mutation; action button shows spinner; success/error uses donor Toast; visibility polling pauses while hidden | donor `/api/{start,stop,restart}`, `Toast`, `NfqwsSyntax` |
| Recent Events/log viewer | Dashboard and Logs | `web/js/pages/dashboard.js:235-253,534-560`; `web/js/pages/logs.js:51-216,380-522,618-655,776-811` | `renderLogs`, `render`, `addEntry`, `createEntryElement`, `scrollToBottom`, `showNewMessageIndicator`, `destroy` | `.log-viewer`, `.log-entry`, `.log-time`, `.log-badge`, `.log-source`, `.log-message`, `.logs-viewer`, `.logs-empty`, `.logs-scroll-bottom`, responsive log rules | Dashboard uses bounded three-column rows; full donor Logs adds source/severity, bounded viewer, empty state, auto-scroll, pause/new-message indicator, and teardown | donor `/api/logs`, SSE/EventSource, `NfqwsSyntax`, `Clipboard`, `Toast`; Z2M uses `eventsTail` adapter |
| Confirmation/dialog | Confirm component | `web/js/components/confirm.js:21-86` | `Confirm.show`, `cleanUp` | `.modal-overlay`, `.modal-content`, `.modal-header`-equivalent structure | Promise result; replaces old overlay; cancel/confirm buttons; click-away and Escape dismissal; cleanup removes overlay | standalone DOM and inline donor theme styles; Z2M shell/modal boundary |
| Action/result notification | Toast component and Dashboard | `web/js/components/toast.js:30-102`, `web/js/pages/dashboard.js:562-595` | `Toast.show`, `Toast.success/error/warning/info`, `quickAction` | `.toast`, `.toast-icon`, `.toast-text`, `.toast.error/.success/.warning` | bounded queue, deduplication, ARIA role, click/timeout dismissal; donor has no structured human title/reason result panel | donor global `#toast-container`; Z2M `Shell.showToast` and lifecycle adapter |
| System card | Dashboard | `web/js/pages/dashboard.js:59-72,289-372` | `updateCards` system branch | `.status-card*` card shell | donor displays platform/model/CPU; Z2M intentionally displays OpenWrt/uptime/memory/overlay while reusing the visual shell | donor status payload replaced with Z2M maintenance/status RPC |
| Page lifecycle/navigation | Dashboard/App | `web/js/pages/dashboard.js:603-664`, `web/js/app.js` | `startPolling`, `stopPolling`, `onVisibilityChange`, `bindEvents`, `destroy` | `.content`, `.sidebar` (donor-only and excluded) | donor stops polling on hidden/destroy and removes delegated listeners; donor sidebar is excluded; Z2M horizontal navigation is intentional | donor global `App` and sidebar replaced by LuCI view lifecycle |

## Classification model

The classification is source-level and uses the project contract:

- `TRANSPLANTED_EXACT` — donor frontend implementation retained with only
  trivial localization or integration changes.
- `ADAPTED_BOUNDARY_ONLY` — donor frontend implementation substantially
  retained while API/router/state is replaced.
- `INTENTIONAL_Z2M_DIFFERENCE` — explicit approved Z2M product requirement.
- `NO_USABLE_DONOR` — the frozen donor has no usable equivalent.
- `CUSTOM_APPROXIMATION` — Z2M independently reimplemented a usable donor
  component. This is a failure state and may not remain at closure.

## Initial transplant matrix

| Component | Donor file(s) | Donor symbol/selector | Current Z2M file(s) | Current classification | Intentional difference | Required action | Final classification |
|---|---|---|---|---|---|---|---|
| Dashboard header/composition | `web/js/pages/dashboard.js` | `render`; `.page-header` | `z2m-avatar-dashboard.js`, `z2m-overview.js` | `ADAPTED_BOUNDARY_ONLY` | LuCI shell and Russian copy | Completed in `z2m-avatar-dashboard.js`; Z2M supplies normalized data and extension | `ADAPTED_BOUNDARY_ONLY` |
| Status cards/grid | `web/js/pages/dashboard.js` | `render`, `updateCards`; `.status-card*` | `z2m-overview.js`, `z2m-ui.css` | `ADAPTED_BOUNDARY_ONLY` | Z2M runtime/status data and Graphite tokens | Preserve donor card structure while retaining canonical data adapter | `ADAPTED_BOUNDARY_ONLY` |
| System card semantics | `web/js/pages/dashboard.js` | system card branch | `z2m-overview.js` | `INTENTIONAL_Z2M_DIFFERENCE` | OpenWrt/uptime/memory/overlay are required Z2M facts | Keep data semantics; transplant donor visual shell | `INTENTIONAL_Z2M_DIFFERENCE` |
| Quick Actions | `web/js/pages/dashboard.js` | `quickAction`; `.actions-row` | `z2m-avatar-dashboard.js`, `z2m-overview.js` | `ADAPTED_BOUNDARY_ONLY` | Z2M RPC and truthful runtime convergence | Completed in `z2m-avatar-dashboard.js`; Z2M supplies lifecycle descriptors and callback | `ADAPTED_BOUNDARY_ONLY` |
| Lifecycle result presentation | `web/js/pages/dashboard.js`, `web/js/components/toast.js` | `quickAction`, `Toast.*` | `z2m-overview.js`, `z2m-shell.js` | `INTENTIONAL_Z2M_DIFFERENCE` | Required structured Russian result/reason/details panel | Keep structured Z2M result and add donor toast boundary for action notification | `INTENTIONAL_Z2M_DIFFERENCE` |
| Log viewer / Recent Events | `web/js/pages/logs.js`, `web/js/pages/dashboard.js` | `createEntryElement`, `renderLogs`; `.log-row*` | `z2m-avatar-log.js`, `z2m-overview.js`, `z2m-maintenance.js`, `z2m-ui.css` | `ADAPTED_BOUNDARY_ONLY` | Z2M canonical event schema and Russian severity adapter | Preserve donor-derived normalized log component and `eventsTail` boundary | `ADAPTED_BOUNDARY_ONLY` |
| Dialogs / modals | `web/js/components/confirm.js` | `Confirm.show`; `.modal-overlay` | `z2m-shell.js`, `z2m-avatar-ui.js`, engine/proxy pages | `ADAPTED_BOUNDARY_ONLY` | Z2M operation semantics, Graphite tokens, Russian copy | Completed with donor modal-overlay/content/header/body/footer hierarchy and existing cleanup callbacks | `ADAPTED_BOUNDARY_ONLY` |
| Dashboard lifecycle/page teardown | `web/js/pages/dashboard.js` | `startPolling`, `destroy` | `z2m-overview.js`, `app.js` | `ADAPTED_BOUNDARY_ONLY` | LuCI view mount/unmount and horizontal nav | Keep donor teardown semantics; prove no duplicate bindings/zombie pollers | `ADAPTED_BOUNDARY_ONLY` |
| Loading/empty/error states | `web/js/pages/dashboard.js`, `web/js/pages/logs.js` | initial render, empty log state, bounded error state | `z2m-overview.js`, `z2m-avatar-log.js`, `z2m-shell.js` | `CUSTOM_APPROXIMATION` | Z2M RPC envelopes and Russian product copy | Retain donor first-paint/empty viewer shape through shared Z2M shell adapter | `ADAPTED_BOUNDARY_ONLY` |
| Donor-only VPN/Monitoring cards | `web/js/pages/dashboard.js` | `updateVpnCards`, `updateEngineCards`, `updateMonitoringCards` | no supported P01 Z2M equivalent | `INTENTIONAL_Z2M_DIFFERENCE` | No canonical Z2M backend capability in P01; no invented state | Exclude donor-only product cards and document the boundary | `INTENTIONAL_Z2M_DIFFERENCE` |
| Donor sidebar/global theme/backend | `web/js/components/sidebar.js`, `web/css/style.css`, `web/js/api.js` | donor sidebar/API/theme | `app.js`, `z2m-shell.js`, `z2m-api.js`, `z2m-ui.css` | `INTENTIONAL_Z2M_DIFFERENCE` | LuCI, Graphite, horizontal nav, rpcd/ubus/ucode | Keep excluded; no donor backend/theme copied | `INTENTIONAL_Z2M_DIFFERENCE` |

## Boundary adapters

The target architecture remains:

```text
Avatar-derived component
        |
        v
dashboardAdapter / logAdapter / lifecycleAdapter
        |
        v
Z2M RPC + canonical state
```

The transplant must not import donor Python/Bottle/API/service-manager code,
donor `/api/*` calls, donor sidebar, or donor global theme. Z2M runtime state
remains separate from configuration drift; historical events do not define
current health; normal UI remains Russian; technical IDs and reason codes stay
under technical details.

## Required closure counts

These are the final counts after the real donor slices and fresh verification:

```text
P01_T2_REAUDIT_STATUS: COMPLETE
P01_T2_PREVIOUS_REALITY: MOSTLY_AUDIT_WITH_CUSTOM_UI_RETAINED
AUDITED_COMPONENTS: 6 (P01-T2 required shared components)
TRANSPLANTED_EXACT: 0
ADAPTED_BOUNDARY_ONLY: 5
INTENTIONAL_Z2M_DIFFERENCE: 1
NO_USABLE_DONOR: 0
CUSTOM_APPROXIMATION_REMAINING: 0
```

The source re-audit deliberately reopened three false transplant claims. They
are now donor-derived boundaries with Z2M-only API, state, localization, and
theme adaptations. The lifecycle result panel remains an intentional Z2M
extension because the donor only provides a toast and does not provide the
required structured human reason/details panel.

## P01-T2 real correction closure

| Component | DONOR_FILE | DONOR_SYMBOL_OR_DOM_BLOCK | DONOR_CSS | Z2M_DESTINATION | BOUNDARY_CHANGES | THEME_CHANGES | LOCALIZATION_CHANGES | FINAL_CLASSIFICATION |
|---|---|---|---|---|---|---|---|---|
| Dashboard composition | `web/js/pages/dashboard.js` | `render`, header/status/card/action/log composition | `.page-header`, `.status-grid`, `.card`, `.card-title`, `.actions-row`, `.log-viewer` | `z2m-avatar-dashboard.js`, `z2m-overview.js` | donor component receives normalized Z2M cards/events/actions; LuCI route and extension remain outside | Graphite variables and existing Z2M shell retained | Russian `Главная`, `Обзор состояния системы`, action/card labels | `ADAPTED_BOUNDARY_ONLY` |
| Status cards | `web/js/pages/dashboard.js` | `render`, status-card markup/icon blocks | `.status-card*`, `.status-dot` | `z2m-avatar-dashboard.js`, `z2m-overview.js` | Z2M status adapter supplies canonical runtime/strategy/system/release values | Current Graphite surfaces/borders/semantic colors retained | Russian Z2M state labels retained | `ADAPTED_BOUNDARY_ONLY` |
| Quick Actions | `web/js/pages/dashboard.js` | `quickAction`, action button/pending lock | `.card`, `.card-title`, `.actions-row`, `.btn`, `.spinner` | `z2m-avatar-dashboard.js`, `z2m-overview.js` | donor button renderer consumes Z2M lifecycle descriptors; callbacks still call Z2M service RPC | Current `.z2m-btn` is combined with donor `.btn`; Graphite palette retained | Russian start/stop/restart/pending/result copy retained | `ADAPTED_BOUNDARY_ONLY` |
| Log viewer / Recent Events | `web/js/pages/logs.js`, `web/js/pages/dashboard.js` | `createEntryElement`, bounded dashboard log composition | `.log-row`, `.log-time`, `.log-badge`, `.log-source`, `.log-message`, `.log-viewer` | `z2m-avatar-log.js`, `z2m-avatar-dashboard.js` | Z2M `eventsTail` normalized adapter supplies rows; single viewer/stack boundary retained | Existing Z2M log colors and sizing retained | Russian severity/source presentation retained | `ADAPTED_BOUNDARY_ONLY` |
| Lifecycle result UI | `web/js/components/toast.js`, dashboard quick action | `Toast.show`, `quickAction` result path | `.toast`, `.toast-icon`, `.toast-text` | `z2m-avatar-ui.js`, `z2m-overview.js` | donor toast DOM is ported; structured Z2M human result/reason panel remains intentional | Graphite toast theme retained | Russian success/error/pending copy retained | `INTENTIONAL_Z2M_DIFFERENCE` |
| Dialogs / modals | `web/js/components/confirm.js` | `Confirm.show`, cleanup/dismissal flow | `.modal-overlay`, `.modal-content`, `.modal-header`, `.modal-body`, `.modal-footer` | `z2m-shell.js`, `z2m-avatar-ui.js`, `app.js` | donor hierarchy and Escape/click-away cleanup retained around Z2M callbacks | Graphite modal surfaces/borders retained | Existing Russian operation copy retained | `ADAPTED_BOUNDARY_ONLY` |

`DONOR_DERIVED_DOM_BLOCKS: 6`  
`DONOR_DERIVED_JS_BLOCKS: 5`  
`DONOR_DERIVED_CSS_BLOCKS: 6`  
`P01_T2_REALITY: REAL_TRANSPLANT`  
`P02_STARTED: NO`

## P01-T2 final verification evidence

| Gate | Result | Evidence |
|---|---|---|
| Focused transplant/parity/log tests | `PASS` | `node --test tests/ui/p01-t2-transplant.test.mjs tests/ui/dashboard-parity-contract.test.mjs tests/ui/log-ux-contract.test.mjs` — 16/16 passed |
| LuCI JavaScript syntax | `PASS` | `node --check` on dashboard, overview, avatar UI, shell, and app entrypoint |
| Direct SCP deployment | `PASS` | guarded `scripts/deploy-dashboard-parity-target.sh`; candidate `61b0dd4a4265167acf5d8d7ee6f64489988d23fa`; bounded backup `/tmp/z2m-dashboard-parity/backup` |
| Target ownership/mode | `PASS` | deployed manifest verification reported `root:root` and `-rw-r--r--` |
| Browser acceptance | `PASS` | one existing authenticated in-app Browser session at normal desktop viewport; Dashboard donor structure, cards, actions, single log viewer, modal classes, Russian copy, diagnostics checked |
| Navigation | `PASS` | `Главная → Система → Главная`; Browser Back reached `#/updates`, Forward returned `#/dashboard`, rendered page matched hash |
| Browser console/network/module/RPC diagnostics | `PASS` | `dev.logs({levels:[error,warn]})` empty; CDP event cursor returned no new events/failures; no missing module observed |
| Final target runtime | `PASS` | `/opt/zapret2/config`: `NFQWS2_ENABLE=0`; status: stopped, `process-confirmed-absent`; final queue configuration remains 300 and is not registered while stopped |

Final runtime/control changes were limited to the frontend descriptor/renderer
boundary; the existing lifecycle RPC/control sequence was not changed in this
correction, so a new Start/Restart/Stop canary was not required by the task
contract.

## P01-T current verification gate

| Gate | State | Evidence |
|---|---|---|
| T01 donor manifest/provenance | `PASS` | frozen SHA and exact source manifest above; `avatar-transplant-contract.test.mjs` |
| T02 status/card primitives | `PASS` | `avatar-status-transplant.test.mjs`; `node --check z2m-overview.js` |
| T03 log renderer/adapter | `PASS` | `avatar-log-transplant.test.mjs`; shared `z2m-avatar-log.js` |
| T04 lifecycle affordance | `PASS` | `avatar-lifecycle-transplant.test.mjs`; `p01-5-runtime-navigation.test.mjs` |
| T05 dialogs | `PASS` | `avatar-dialog-transplant.test.mjs`; `avatar-ui-components.test.mjs` |
| T06 dashboard closure | `PASS` | `avatar-dashboard-closure.test.mjs`; `dashboard-parity-contract.test.mjs` |
| Knowledge validator | `PASS_WITH_PREEXISTING_UNRELATED_ERRORS` | no new P01-T errors; unrelated legacy frontmatter/link errors remain |
| Real Browser acceptance | `PASS` | superseded by the one-session P01-T2 acceptance evidence below; no multi-resolution gate is used |
| Direct SCP/target SHA/owner/mode | `PASS` | corrective clean candidate `61b0dd4a4265167acf5d8d7ee6f64489988d23fa`; guarded manifest matched source SHA-256; target owner/mode root:root/0644 |
| Start → RUNNING/NFQUEUE 300 → Restart → Stop | `HISTORICAL_PASS` | previous candidate canary remains historical evidence; P01-T2 presentation-only correction did not repeat it |
| Final `NFQWS2_ENABLE=0`, `STOPPED` | `PASS` | target config `NFQWS2_ENABLE=0`; final `runtimeSummary.status=stopped`, `reasonCode=process-confirmed-absent` |

## Verification requirements

Closure requires all of the following fresh evidence:

- focused TDD suites pass after every deploy-relevant slice;
- modified documentation passes `node scripts/validate-knowledge.mjs`;
- donor/module/CSS dependency closure has no missing assets or unused shipped
  donor application code within the audited P01 scope;
- exact committed candidate is deployed by direct SCP with owner/mode and SHA
  verification;
- one real authenticated Browser session passes Dashboard, touched dialogs,
  navigation, console/network/module/RPC checks, and final target state is
  `NFQWS2_ENABLE=0`;
- a lifecycle canary is required only when lifecycle control behavior changes;
- `P02_STARTED: NO` remains true.

No completion claim is valid while any required evidence is `NOT_RUN`.
