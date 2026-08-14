# Avatar Frontend to zapret2-manager Mapping

**Initial BASE_HEAD:** `origin/main@984e5e617c610106a03777ece4b74a16ad3ef862`

**Rebased target base:** `origin/main@b336e55a feat(assets): connect registry environment to strategy scanner`
**Donor:** `avatarDD/zapret-gui@7263810c2923bb70f30fe2c41de45dac0feef492`
**Reviewed reference:** `947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c`
**Scope:** `web/**` only; donor Python/API/backend is excluded.

| Donor file | Responsibility/dependencies | Decision | Target file(s) | Existing z2m contract | Test coverage |
|---|---|---|---|---|---|
| `web/css/style.css` | Base surfaces, cards, forms, badges, tables, responsive rules; depends on donor class names and all donor pages | ADAPT selected rules and token map; drop donor-only selectors | `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`, `z2m-components.css`, new `z2m-avatar-ui.css` | LuCI DOM plus current z2m classes | UI render/packaging, CSS token and no-sidebar checks |
| `web/css/blockcheck_scan.css` | Scan progress/result presentation | ADAPT layout patterns only | `z2m-components.css`, `z2m-blockcheck-page.js` | `blockcheck_diag_*`, `blockcheck2_*`, `blockcheckw_*`, `block_detector_*` | BlockCheck family product/UI tests |
| `web/js/components/toast.js` | Toast queue, severity, timeout, dismiss | ADAPT behavior into LuCI shell | `z2m-avatar-ui.js` / `z2m-shell.js` | `Shell.showToast`, `Api.normalizeError` | toast/error normalization tests |
| `web/js/components/confirm.js` | Modal confirmation, focus/escape/click-away cleanup | ADAPT bounded modal helper | `z2m-avatar-ui.js` | existing page action callbacks | modal lifecycle tests |
| `web/js/components/list_ui.js` | Search/filter/list empty/loading/error/table patterns | ADAPT generic rendering helpers | `z2m-avatar-ui.js`, page modules | existing `lists`, `domainHub`, strategy/resource models | render harness and empty/error tests |
| `web/js/components/sparkline.js` | Small status trend visualization | DROP unless a real bounded series exists | none initially | no fabricated progress/health values | donor-purity/dead-code gate |
| `web/js/components/setup_ui.js` | Install/update/setup cards and lifecycle | ADAPT only for Telegram Proxy/provider state cards | `z2m-avatar-ui.js`, `z2m-proxy-page-core.js` | `proxy_capabilities`, `proxy_status`, config/install methods | proxy UI tests |
| `web/js/components/transport_select.js` | Donor tunnel transport selector | DROP | none | no equivalent approved product capability | donor-purity gate |
| `web/js/components/theme.js` | Donor neon theme switcher | DROP; use current z2m theme | `z2m-ui.css` tokens | existing graphite theme | token/no-cyber-color checks |
| `web/js/components/sidebar.js` | Donor left navigation and mobile sidebar | DROP as navigation | none; current `app.js` tabs remain | current top hash tabs | top-nav/no-sidebar tests |
| `web/js/pages/dashboard.js` | Dashboard card/page structure | ADAPT visual hierarchy only | `z2m-overview.js` | `status`, `versions`, component/provider state | overview tests |
| `web/js/pages/strategies.js` | Strategy cards, filters, actions | ADAPT presentation only | `z2m-strategy.js`, `z2m-strategy-page.js` | strategy list/preview/validate/apply, scanner methods | strategy/scanner tests |
| `web/js/pages/scan.js` | Scan lifecycle/result cards | ADAPT presentation only | `z2m-strategy-workflow*.js`, `z2m-blockcheck-page.js` | Scanner and Strategy handoff | scanner UI tests |
| `web/js/pages/blockcheck.js` | One-shot diagnostic lifecycle/results | ADAPT presentation only | `z2m-blockcheck-page.js` | `blockcheck_diag_*` | M5 tests |
| `web/js/pages/block_detector.js` | Background discovery/results | ADAPT presentation only | `z2m-blockcheck-page.js` | `blockDetector*` | M5 tests |
| `web/js/pages/blockcheck2.js` | Official engine output/results | ADAPT presentation only | `z2m-blockcheck-page.js` | `blockcheck2*` | M5 tests |
| `web/js/pages/tgproxy.js` | Donor TG product UI and `/api` bindings | DROP implementation; salvage visual patterns only | `z2m-proxy-page-core.js` | existing Telegram Proxy lifecycle/settings/activity | proxy RPC/presentation tests |
| `web/js/pages/blobs.js`, `lua_scripts.js`, `hostlists.js`, `hosts.js`, `ipsets.js` | Donor resource tables/editors | DROP donor pages; ADAPT list/table pattern | existing `z2m-assets.js`, services/resources modules | current M2 `assets_*` registry RPCs plus lists/domain hub | assets/resources tests; no donor resource backend added |
| `web/js/api.js` | Browser HTTP client for donor Python API | DROP | none; retain `z2m-api.js` | explicit LuCI `rpc.declare` methods | no-live-Avatar-API test |
| `web/index.html`, donor `web/js/app.js` | standalone web shell/script loader | DROP as runtime; inspect for patterns only | existing LuCI `app.js` | LuCI view lifecycle | packaging and no-dead-route checks |

## Explicit exclusions

No donor `core/**`, `api/**`, `app.py`, `/api/...` backend, AWG, sing-box, mihomo, usque, Opera Proxy, donor DNS, donor Telegram Proxy, donor update flow, or hidden donor routes are copied.

## Provenance

Copied/adapted code remains MIT-licensed. The repository will add `docs/third-party/avatarDD-zapret-gui.md` with the donor repository, current head, reviewed reference, file-level mapping, and the donor MIT notice. Existing project `LICENSE` remains unchanged.
