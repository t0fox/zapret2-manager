---
id: p01-dashboard
title: "P01 — Главная / Dashboard"
type: parity
status: current
authority: evidence
updated: 2026-08-16
publish: false
tags: [p01, dashboard, avatar, parity]
---

# P01 — Главная / Dashboard

P01-T supersedes the old frozen-donor implementation evidence in this page.
The current source-level transplant matrix is
[`../avatar-transplant-audit.md`](../avatar-transplant-audit.md).

## Provenance and execution boundary

| Field | Evidence |
|---|---|
| Donor | `G:\avatarDD\zapret-gui` |
| Historical P01 donor commit | `60bc16a5ddc5f43d97d414b99920c3d13da3151a` |
| P01-T current donor commit | `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` |
| Donor page source | `web/js/pages/dashboard.js` |
| Donor styles | `web/css/style.css` (`page-header`, `status-grid`, `status-card`, log and responsive blocks) |
| Z2M worktree | `G:\zapret2-manager\.codex-avatar-parity` |
| Branch | `codex/avatar-ui-parity` |
| Historical P01 start HEAD | `618318492964aa923b0e5ec64a6e002a57f54817` |
| P01-T start HEAD | `21fe4d2ee8c20e4fe6d44ca802e266903c82b8f2` |
| Primary checkout | `G:\zapret2-manager` — untouched |
| Scope | P01 only; P02 and all new backend milestones are not started |
| P01-T source closure | T01–T06 local source/contracts `PASS`; custom approximation remaining `0` |
| P01-T browser/target gates | `NOT_RUN`; no current browser or target claims are inherited from historical P01 evidence |

Historical start-state evidence above refers to the earlier P01 slice. For
P01-T, the isolated worktree already contained 12 pre-existing changed or
untracked files; unrelated changes are preserved and excluded from this task.

## Accepted P01 section inventory

The raw frozen donor contains product-catalog sections, but the current P01
acceptance explicitly excludes those sections from the Z2M Dashboard. The
accepted ordered composition is:

```text
DONOR_SECTIONS: [page-header, status-grid, quick-actions, recent-events]
Z2M_SECTIONS: [page-header, status-grid, quick-actions, recent-events, Проверить ресурс]
MISSING_DONOR_SECTIONS: 0
EXTRA_Z2M_SECTIONS: 0
INTENTIONAL_Z2M_EXTENSIONS: [Проверить ресурс]
```

The status grid contains `nfqws2`, `Стратегия`, `Автозапуск`, `Система`, and
`zapret2`. VPN/Туннели, Мониторинг, Healthcheck, and “Что стоит сделать” are
not Dashboard sections. Donor `/api/*`, sidebar, and backend conventions are
excluded; Z2M keeps LuCI `E()`, shell helpers, router, and existing RPC
authority.

## Current Z2M inventory before P01

| Area | Existing implementation | P01 decision |
|---|---|---|
| Route | `dashboard` normalized to module `overview` | Keep canonical route and alias compatibility |
| Home nav | Primary `Главная` plus redundant secondary `Обзор` | Add `hideSecondary` only for Home; leave other groups unchanged |
| Runtime | `ctx.api.service.status()` plus structured status-v3 evidence | Use process, autostart, runtime summary, engine and version fields; unknown stays `Недоступно` |
| Strategy | Deferred `ctx.api.strategy.preview()` and model normalization | Keep active Strategy card and extension controls without blocking first mount |
| Resource checker | `orchestra.runStart` + bounded `orchestra.runStatus` polling | Preserve unchanged backend flow and UI |
| Point rules | Existing staged strategy-owned draft flow | Preserve after donor core |
| DNS/TG | No Dashboard RPC | Keep DNS/TG product state on their own pages; no catalog calls from Dashboard |
| Events | Existing `ctx.api.monitor.eventsTail()` API/ACL | Deferred bounded read; render timestamp/level/message with loading/empty/error states |
| First mount | App shell previously waited for `module.load()` | Dashboard structure mounts before status RPC and rerenders with live data |

## Explicit gap matrix

| Donor contract | Z2M before | Result |
|---|---|---|
| Avatar page header | Old `Обзор` hero header | Transplanted donor title/description |
| Five-card status grid | Three-card custom readiness row plus hero | Donor five-card grid; no old readiness row |
| VPN/tunnel grid | Not accepted in current P01 IA | Removed from Dashboard; remains on its own pages |
| Monitoring grid | Not accepted in current P01 IA | Removed from Dashboard; remains on its own pages |
| Three quick actions | Start/Stop embedded in old status panel | One ordered quick-action panel; restart is existing stop-then-start composition |
| Recent events/logs | No Dashboard event section | Existing `events_tail` rendered as bounded read-only log |
| Home secondary nav | Redundant `Обзор` tab | Suppressed only for Home |
| Resource checker | Existing and product-critical | Retained after donor core |
| Strategy/rules/advice | Existing Z2M extensions | Only accepted `Проверить ресурс` remains in Dashboard; no catalog/advice creep |

## File and dependency closure

Changed P01 runtime files:

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`
  — Dashboard composition, existing resource checker, status/event states and
  quick actions.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js`
  — Home's explicit `hideSecondary` contract and direct `Главная` item label.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
  — Conditional secondary-nav render, preserving all other groups.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
  — Scoped donor Dashboard cards, grid, logs and 1280/768/390 responsive rules.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js`
  — Donor-derived log row/badge/viewer renderer with a thin Z2M event adapter;
  donor HTTP/SSE/API code is excluded.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
  — Dashboard eager mount before RPC completion; other pages keep the existing loading contract.
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc`
  and `strategy-status.uc` — bounded fast canonical status projection.
- `scripts/deploy-dashboard-parity-target.sh` — explicit SCP-compatible manifest,
  including `app.js`.

Test/documentation files:

- `tests/ui/dashboard-parity-contract.test.mjs`
- `tests/native/dashboard-runtime-contract.test.mjs` and
  `tests/ui/parity/dashboard-runtime-model.mjs` — bounded status/events
  degradation cases (success, failure, timeout, events error, events empty).
- `tests/ui/parity/` — strict manifest schema/validator, browser evidence
  template, CSS/module dependency closure, navigation report, and donor
  inventory checks.
- `docs/superpowers/plans/2026-08-16-dashboard-parity.md`
- this page ledger.

No donor `/api/*`, donor Python, donor sidebar, new backend method, TG/DNS
backend implementation, or unrelated page file is part of the closure.

## Focused verification ledger

| Check | Status | Evidence |
|---|---|---|
| Focused Dashboard contract RED before implementation | PASS | Multiple RED-first checks covered composition, unused Orchestra reads, structured status fields, eager mount, and shell chrome |
| Focused Dashboard contract GREEN | PASS | `node --test tests/ui/dashboard-parity-contract.test.mjs`; 10/10 passed |
| Canonical status timeout regression | PASS | `node --test tests/native/status-timeout-regression.test.mjs`; 1/1 passed |
| Bounded runtime degradation contract | PASS | Fresh focused suite: 6/6; status success/failure/timeout plus independent events error/empty |
| Target cold status | PASS | `ubus -t 3`: `RC=0`, ~558 ms wall, schema 3, autostart true, engine installed true |
| Target runtime process evidence | PASS | `runtimeSummary.process.found=true`; browser card `Работает`, PID 12136; Start disabled, Stop/Restart enabled |
| Target events | PASS | `ubus -t 3`: `RC=0`, ~218 ms wall, `ok=true`, 846 returned events |
| Browser first Dashboard paint | PASS | Current authenticated browser: ~3.66 s after eager mount; previous measured ~5.22 s |
| Browser responsive evidence | PASS | Fresh in-app browser exact widths 1280/768/390: 5 cards, header split, no forbidden sections, wrapped narrow navigation, no visible overflow/clipping, events loaded |
| Package/build checks | NOT_RUN | No APK build/install by instruction |
| Target deploy | PASS | `ef5c18a20db92cab19dd821df4300339164bc6b1`; guarded direct SCP-compatible script; rpcd reloaded |
| Target hashes/owners/modes | PASS | All 6 deployed Dashboard frontend/ACL assets matched local SHA-256; target `root:root`, `0644`; status UCode assets also matched local SHA-256 |
| Browser 1280x900 | PASS | Exact viewport evidence in `docs/05-parity/evidence/dashboard-278e2aa.json` |
| Browser 768x900 | PASS | Exact viewport evidence in `docs/05-parity/evidence/dashboard-278e2aa.json` |
| Browser 390x844 | PASS | Exact viewport evidence in `docs/05-parity/evidence/dashboard-278e2aa.json` |
| Console/network acceptance | PASS | Fresh CDP capture: shared LuCI shell `uci/get` HTTP 200, 0 console errors, 0 network 404s, no forbidden DNS/TG RPCs |
| P02 and later Avatar pages | NOT_STARTED | Explicitly outside this task |

## Final acceptance update

This section is intentionally completed only after local verification, exact
target deployment, and browser acceptance. The final entry must include the P01
commit SHA and exact PASS/PARTIAL/NOT_RUN/BLOCKED evidence. Full Avatar parity
must not be claimed from this page-only slice.

### Target hash evidence

| Asset | SHA-256 |
|---|---|
| `app.js` | `8e000a5913e0728c19a7a799866f1c0cfb2c31c41f88ffa83b772fcd92cd6a64` |
| `z2m-overview.js` | `49e9fed0ab047310d166fe968fc29bcac9a304aacd6932e39cc9e84442c94c20` |
| `z2m-navigation.js` | `84376d87d07bac3ea000d4b093bcbde6dd70ee1b8a0468c79c0b07c8e34cef42` |
| `z2m-shell.js` | `3006d5b62bc235eacc08c81c4bdb4556eb6e6713e5f7d2237b21355dfdc83c33` |
| `z2m-ui.css` | `6bb069337e4a81bc91df5cac4276dd17d0037213e4a4aa8185b4dd8df6b92907` |
| `luci-app-zapret2-manager.json` | `f96acdb085e6982a59dd47d4599ffb0536b1a3101b6c4d1c5ea51fe5223c9bf6` |
| `core/status-collector.uc` | `6f0c249a5b72bdd11faca44465e89336efe54bc20f5336c19a89c60d513746b4` |
| `strategy-status.uc` | `58c37d3b40bc026f9af8f9d9d9423e0fd72f0128f277d50e8c206de6682cc5cd` |
