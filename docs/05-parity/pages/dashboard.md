# P01 — Главная / Dashboard

## Provenance and execution boundary

| Field | Evidence |
|---|---|
| Donor | `G:\avatarDD\zapret-gui` |
| Frozen donor commit | `60bc16a5ddc5f43d97d414b99920c3d13da3151a` |
| Donor page source | `web/js/pages/dashboard.js` |
| Donor styles | `web/css/style.css` (`page-header`, `status-grid`, `status-card`, log and responsive blocks) |
| Z2M worktree | `G:\zapret2-manager\.codex-avatar-parity` |
| Branch | `codex/avatar-ui-parity` |
| Start HEAD | `618318492964aa923b0e5ec64a6e002a57f54817` |
| Primary checkout | `G:\zapret2-manager` — untouched |
| Scope | P01 only; P02 and all new backend milestones are not started |

Start-state evidence: the isolated worktree was clean before this P01 slice;
no unrelated dirty files were present.

## Frozen donor inventory

The donor `DashboardPage.render()` composes the page in this order:

1. `.page-header`: `Главная` / `Обзор состояния системы`.
2. `#status-grid` with five cards in order: `nfqws2`, `Стратегия`, `Автозапуск`,
   `Система`, `zapret2`.
3. `VPN / Туннели` and `#vpn-grid`: WARP/MASQUE, Opera Proxy, AmneziaWG,
   sing-box, mihomo, Telegram.
4. `Мониторинг` and `#monitoring-grid`: Мониторинг DNS, Healthcheck.
5. `Быстрые действия`: Запустить, Остановить, Перезапустить.
6. `Последние события`: bounded log viewer and `Все логи →`.

The donor refreshes through its own HTTP `/api/dashboard/status` and directly
uses donor `API`, router, sidebar and backend conventions. Those dependencies
are intentionally excluded. Donor composition and DOM/CSS semantics are used;
Z2M's LuCI `E()`, shell helpers, router and existing RPC authority are used for
implementation.

## Current Z2M inventory before P01

| Area | Existing implementation | P01 decision |
|---|---|---|
| Route | `dashboard` normalized to module `overview` | Keep canonical route and alias compatibility |
| Home nav | Primary `Главная` plus redundant secondary `Обзор` | Add `hideSecondary` only for Home; leave other groups unchanged |
| Runtime | `ctx.api.service.status()` and `OverviewModel.runtimeHealth()` | Use for nfqws2/zapret2 truth; unknown stays `Недоступно` |
| Strategy | `ctx.api.strategy.preview()` and model normalization | Keep active Strategy card and extension controls |
| Resource checker | `orchestra.runStart` + bounded `orchestra.runStatus` polling | Preserve unchanged backend flow and UI |
| Point rules | Existing staged strategy-owned draft flow | Preserve after donor core |
| DNS | `ctx.api.dns.serviceStatus()` | Use only as Dashboard monitoring summary; no new DNS writer |
| Events | Existing `ctx.api.monitor.eventsTail()` API/ACL | Render timestamp/level/message with loading/empty/error states |
| Telegram | Existing `ctx.api.tg.product.status()` | Show truthful Telegram card; do not change TG implementation |
| Other donor tunnels | No corresponding Dashboard status authority in this slice | Show explicit `Недоступно`, never synthetic running state |

## Explicit gap matrix

| Donor contract | Z2M before | Result |
|---|---|---|
| Avatar page header | Old `Обзор` hero header | Transplanted donor title/description |
| Five-card status grid | Three-card custom readiness row plus hero | Donor five-card grid; no old readiness row |
| VPN/tunnel grid | Not present | Donor-shaped grid with backend-backed Telegram and explicit unavailable states |
| Monitoring grid | Not present as Dashboard composition | Donor-shaped DNS/Healthcheck summary from existing read-only status |
| Three quick actions | Start/Stop embedded in old status panel | One ordered quick-action panel; restart is existing stop-then-start composition |
| Recent events/logs | No Dashboard event section | Existing `events_tail` rendered as bounded read-only log |
| Home secondary nav | Redundant `Обзор` tab | Suppressed only for Home |
| Resource checker | Existing and product-critical | Retained after donor core |
| Strategy/rules/advice | Existing Z2M extensions | Retained after donor core; no lifecycle duplicates |

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

Test/documentation files:

- `tests/ui/dashboard-parity-contract.test.mjs`
- `docs/superpowers/plans/2026-08-16-dashboard-parity.md`
- this page ledger.

No donor `/api/*`, donor Python, donor sidebar, new backend method, TG/DNS
backend implementation, or unrelated page file is part of the closure.

## Focused verification ledger

| Check | Status | Evidence |
|---|---|---|
| Focused Dashboard contract RED before implementation | PASS | `node --test tests/ui/dashboard-parity-contract.test.mjs`; 4 expected failures, missing donor markers/API/nav contract |
| Focused Dashboard contract GREEN | PASS | `node --test tests/ui/dashboard-parity-contract.test.mjs`; 4/4 passed |
| Full local UI suite | NOT_RUN | Run after final refactor |
| Package/build checks | NOT_RUN | Run after final refactor |
| Target deploy | PASS | `3b5aaaebffceb2a82fd6c2b7871011353b94be6c`; guarded P01 script; rpcd reloaded |
| Target hashes/owners/modes | PASS | All 4 changed assets matched local SHA-256; target `root:root`, `0644` |
| Browser current target viewport | PARTIAL | Dashboard rendered after backend timeouts; width reported by in-app browser `637`; no secondary Home tab, no `[object HTMLDivElement]`, no horizontal overflow |
| Browser 1280x900 | NOT_RUN | Current in-app browser viewport is 637px; exact 1280 viewport not established |
| Browser 768x900 | NOT_RUN | Exact viewport not established in current in-app browser |
| Browser 390x844 | NOT_RUN | Exact viewport not established in current in-app browser |
| Console/network acceptance | PARTIAL | Target UI shows normalized RPC errors; direct SSH `ubus -t 3 call zapret2-manager status '{}'` times out; no browser console error capture available |
| P02 and later Avatar pages | NOT_STARTED | Explicitly outside this task |

## Final acceptance update

This section is intentionally completed only after local verification, exact
target deployment, and browser acceptance. The final entry must include the P01
commit SHA and exact PASS/PARTIAL/NOT_RUN/BLOCKED evidence. Full Avatar parity
must not be claimed from this page-only slice.

### Target hash evidence

| Asset | SHA-256 |
|---|---|
| `z2m-overview.js` | `acc81596b30d298365df594cf46465203fbc24d984d58bba0718d04b556f029d` |
| `z2m-navigation.js` | `84376d87d07bac3ea000d4b093bcbde6dd70ee1b8a0468c79c0b07c8e34cef42` |
| `z2m-shell.js` | `3006d5b62bc235eacc08c81c4bdb4556eb6e6713e5f7d2237b21355dfdc83c33` |
| `z2m-ui.css` | `3518c8ce938462f71597407e8b04653f0de09928735e483c76a25d0c65a9ce69` |
