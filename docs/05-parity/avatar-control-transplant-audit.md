# P02 — Avatar Control transplant audit

## Scope and frozen donor

This audit covers only the `Обход DPI → Управление` route (`#/control`). It does
not reopen P01 Dashboard and does not include P03 or backend work.

- Remote: `avatarDD/zapret-gui`
- Branch: `main`
- Frozen donor HEAD: `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`
- Donor checkout: `G:\avatarDD\zapret-gui`
- Donor clean at audit start: `YES`
- Active Z2M worktree: `G:\zapret2-manager\.codex-avatar-parity`
- P02 initial HEAD: `6c3b66dbc23c20c1a6b8ef19d994d8f6e70cf74a`

The donor control source is `web/js/pages/control.js`. Its frozen composition is
the page header, status hero, process-control card, three-card status grid,
conditional firewall-rules card, and nfqws2 log card. The donor CSS selectors
are `control-status-hero`, `control-status-indicator`, `control-status-ring`,
`control-status-icon`, `control-status-text`, `control-status-label`,
`control-status-detail`, and `control-buttons`.

## Pre-implementation truth

The Z2M route and navigation label already existed, but `app.js` mapped both
`dashboard` and `control` to `z2m-overview.js`. There was no dedicated Control
module, no Control-specific status hero, no firewall details surface, and no
Control-scoped lifecycle/poll cleanup. This is the source-audit RED state
recorded by `tests/ui/p02-control-transplant-contract.test.mjs`.

## Authority mapping

| Donor responsibility | Z2M implementation authority |
| --- | --- |
| Control page composition and visual hierarchy | `z2m-avatar-control.js`, derived from frozen `control.js` |
| Lifecycle reads and mutations | `z2m-api.js` `service.status/start/stop/restart` |
| Runtime state semantics | `z2m-runtime-state.js` plus a Control-only normalized view model |
| Strategy status | existing `strategy.preview` read, rendered as a status card |
| Process status | canonical `status.runtimeSummary.process` evidence |
| Firewall status/details | structured status evidence only; no new backend writer or RPC |
| Log rows and log DOM primitive | shared `z2m-avatar-log.js` |
| Toasts/modal/shell/CSS injection | existing `z2m-shell.js` and Avatar UI primitives |

## Required evidence after implementation

The implementation must classify every required Control component as
`DONOR_TRANSPLANT`, `SHARED_REUSE`, or `Z2M_ADAPTER`; the final audit must show
`CUSTOM_APPROXIMATION_REMAINING=0`. Browser evidence must use one existing
authenticated session and include the full stopped → start → running → restart
→ running → stop → stopped lifecycle canary, route return/navigation checks,
Russian copy checks, no raw enum/reason-code visibility, no stale Control DOM,
and zero duplicate pollers/listeners.

## Final implementation classification

Frozen donor symbols transplanted into the Control module are `render`,
`fetchStatus`, `updateUI`, `fetchLogs`, `renderLogs`, `doStart`, `doStop`,
`doRestart`, `setActionPending`, `startPolling`, `stopPolling`, and `destroy`.
The donor control CSS hierarchy is retained under the scoped
`#z2m-view-control` namespace, including the status hero/indicator/ring/icon,
status text/label/detail, process controls, status grid, firewall rules card,
firewall viewer, log card, and action-result styling.

| Control component | Classification | Z2M boundary |
| --- | --- | --- |
| Page header, status hero, process-control card, status grid | `DONOR_TRANSPLANT` | `z2m-avatar-control.js` |
| Firewall details card and full-log link | `DONOR_TRANSPLANT` | `z2m-avatar-control.js` |
| Log viewer | `SHARED_REUSE` | `z2m-avatar-log.js` |
| Strategy, process, and firewall evidence cards | `Z2M_ADAPTER` | `z2m-control-model.js` |
| Lifecycle action result | `Z2M_ADAPTER` | `z2m-api.js` canonical service RPCs |
| Polling and destroy cleanup | `DONOR_TRANSPLANT` + `Z2M_ADAPTER` | bounded Control model confirmation |

Primary classification counts are `DONOR_TRANSPLANT=8`, `SHARED_REUSE=1`,
`Z2M_ADAPTER=4`, `CUSTOM_APPROXIMATION_REMAINING=0`.

## Acceptance evidence

- `GRAPHITE_THEME_PRESERVED=YES`; horizontal LuCI navigation and Z2M route
  shell are preserved.
- Normal Control content is Russian; technical product tokens (`nfqws2`,
  `NFQUEUE`, `PID`) remain intentional. `MIXED_RU_EN_PRODUCT_COPY=0` and
  `RAW_INTERNAL_ENUM_VISIBLE=0`; raw reason codes are not rendered.
- Focused P02 plus Dashboard regression gate: `23/23` passed. JavaScript
  syntax checks and `git diff --check` passed.
- One existing authenticated in-app Browser session was used. The lifecycle
  canary passed: STOPPED → Start pending → RUNNING with PID, NFQUEUE 300 and
  valid nft rules → Restart pending → RUNNING → Stop pending → STOPPED. The
  final restore was `NFQWS2_ENABLE=0`.
- Route checks passed: Главная → Управление → Главная; Управление → Система →
  Управление; Back returned `#/control`, Forward returned `#/updates`, and a
  fresh Control render produced exactly one Control root, three action buttons,
  one log container, and zero Dashboard roots. Browser warning/error log:
  `[]`.
- Final target state: `NFQWS2_ENABLE=0`, `runtimeSummary.status=stopped`,
  process absent, NFQUEUE 300 unregistered, and firewall rules absent. The
  deployed Control files are root-owned with mode `0644`.
- Deployment used direct SCP from a clean detached deploy worktree and is
  bound to Z2M commit `4d3bae39c153fbf21848d110405314f49d889c8d`; donor remains
  frozen at `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`.
- The repository-wide native gate was attempted but is not a P02 gate: it
  stopped at `35/36` because pre-existing dirty engine/proxy-provider changes
  fail `tests/native/package-helper.test.mjs`. Those files were preserved and
  no P02 source caused that failure.

`FOOTPRINT=NO` — no new backend, RPC, package, or production writer was added.
`P03=NO`. `STATUS=PASS` for the P02 Control transplant and its browser/target
acceptance contract.
