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
| Dashboard header/composition | `web/js/pages/dashboard.js` | `render`; `.page-header` | `z2m-overview.js` | `CUSTOM_APPROXIMATION` | LuCI shell and Russian copy | Preserve donor composition/class structure; adapt Z2M mount and copy | `ADAPTED_BOUNDARY_ONLY` |
| Status cards/grid | `web/js/pages/dashboard.js` | `render`, `updateCards`; `.status-card*` | `z2m-overview.js`, `z2m-ui.css` | `CUSTOM_APPROXIMATION` | Z2M runtime/status data and Graphite tokens | Transplant donor card structure and CSS behavior; keep canonical data adapter | `ADAPTED_BOUNDARY_ONLY` |
| System card semantics | `web/js/pages/dashboard.js` | system card branch | `z2m-overview.js` | `INTENTIONAL_Z2M_DIFFERENCE` | OpenWrt/uptime/memory/overlay are required Z2M facts | Keep data semantics; transplant donor visual shell | `INTENTIONAL_Z2M_DIFFERENCE` |
| Quick Actions | `web/js/pages/dashboard.js` | `quickAction`; `.actions-row` | `z2m-overview.js`, `z2m-shell.js` | `CUSTOM_APPROXIMATION` | Z2M RPC and truthful runtime convergence | Retain donor action layout/pending lock; adapt lifecycle RPC/result adapter | `ADAPTED_BOUNDARY_ONLY` |
| Lifecycle result presentation | `web/js/pages/dashboard.js`, `web/js/components/toast.js` | `quickAction`, `Toast.*` | `z2m-overview.js`, `z2m-shell.js` | `ADAPTED_BOUNDARY_ONLY` | Human Russian title/reason and Z2M error semantics | Keep donor notification lifecycle; ensure structured result and collapsed technical details | `ADAPTED_BOUNDARY_ONLY` |
| Recent Events viewer | `web/js/pages/logs.js`, `web/js/pages/dashboard.js` | `createEntryElement`, `renderLogs`; `.log-row*` | `z2m-avatar-log.js`, `z2m-overview.js`, `z2m-maintenance.js`, `z2m-ui.css` | `CUSTOM_APPROXIMATION` | Z2M canonical event schema and Russian severity adapter | Extract donor-derived normalized log component; preserve `eventsTail` boundary | `ADAPTED_BOUNDARY_ONLY` |
| Confirmation/dialog | `web/js/components/confirm.js` | `Confirm.show`; `.modal-overlay` | `z2m-shell.js`, `z2m-avatar-ui.js`, engine/proxy pages | `ADAPTED_BOUNDARY_ONLY` | Z2M operation semantics, Graphite tokens, Russian copy | Verify donor cleanup/focus/dismissal behavior and reuse shared boundary | `ADAPTED_BOUNDARY_ONLY` |
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

These are updated only after the final audit and fresh verification:

```text
AUDITED_COMPONENTS: 11
TRANSPLANTED_EXACT: 0
ADAPTED_BOUNDARY_ONLY: 8
INTENTIONAL_Z2M_DIFFERENCE: 3
NO_USABLE_DONOR: 0
CUSTOM_APPROXIMATION_REMAINING: 0
```

The final source audit closes the custom-approximation classification for the
eleven audited P01 components. This is not a full completion claim: browser,
target deployment, and lifecycle-canary evidence remain separately gated below.

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
| Browser 1280 / 768 / 390 | `NOT_RUN` | local Edge 151.0.4129.78 CDP was available, but target LuCI returned `Authorization Required` (HTTP 403) with no authenticated cookie |
| Direct SCP/target SHA/owner/mode | `PASS` | clean candidate `a06270489b465154322f2821b8e49bb7f54d1c06`; six frontend files matched source SHA-256; target owner/mode root:root/0644 |
| Start → RUNNING/NFQUEUE 300 → Restart → Stop | `PASS` | `ubus call zapret2-manager start/restart/stop`; running states confirmed PID + NFQUEUE 300 registration/owner match |
| Final `NFQWS2_ENABLE=0`, `STOPPED` | `PASS` | target config `NFQWS2_ENABLE=0`; final `runtimeSummary.status=stopped`, `reasonCode=process-confirmed-absent` |

## Verification requirements

Closure requires all of the following fresh evidence:

- focused TDD suites pass after every deploy-relevant slice;
- modified documentation passes `node scripts/validate-knowledge.mjs`;
- donor/module/CSS dependency closure has no missing assets or unused shipped
  donor application code within the audited P01 scope;
- exact committed candidate is deployed by direct SCP with owner/mode and SHA
  verification;
- real browser acceptance passes at 1280, 768 and 390 with zero console errors,
  404s, missing modules, unexpected RPC failures and horizontal overflow;
- bounded real lifecycle canary proves Start → RUNNING/NFQUEUE 300 → Restart →
  RUNNING → Stop → STOPPED, and final target state is `NFQWS2_ENABLE=0`;
- `P02_STARTED: NO` remains true.

No completion claim is valid while any required evidence is `NOT_RUN`.
