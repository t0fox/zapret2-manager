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
