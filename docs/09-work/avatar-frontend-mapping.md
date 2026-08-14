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

## Actual donor provenance matrix

The rows below are based on the inspected donor source at `7263810c2923bb70f30fe2c41de45dac0feef492` (the reviewed reference `947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c` has the same `web/**` implementation). They distinguish actual adapted code from project-owned replacements.

| TARGET_FILE | DONOR_FILE | DONOR_COMMIT | COPIED/ADAPTED CODE AREA | MAJOR MODIFICATIONS | WHY IT WAS REUSED |
|---|---|---|---|---|---|
| `z2m-avatar-ui.js` | `web/js/components/confirm.js` | `7263810c...` | Promise confirmation, cancel/OK actions, Escape and click-away cleanup | LuCI `E()` DOM construction, existing graphite classes, no donor IDs/inline styles, bounded single-resolution guard | Preserve the donor's reliable modal lifecycle without importing its standalone shell |
| `z2m-avatar-ui.js` | `web/js/components/list_ui.js` | `7263810c...` | `attachTableFilter`: search, row visibility, count, Escape clear, destroy | LuCI-compatible bounded table adapter; no donor `Utils.debounce`, local timer, no localStorage or donor list markup | Reuse the donor's table/list interaction for the canonical M2 table |
| `z2m-avatar-ui.js` | `web/js/components/toast.js` | `7263810c...` | max-five toast queue, type/message deduplication, role, click/timeout dismissal | Existing `z2m-toasts` host and `err/warn/ok` classes; no donor SVG/icon HTML or neon styling | Prevent repeated RPC failures and polling events from flooding LuCI |
| `z2m-avatar-ui.css` | `web/css/style.css`, `web/css/blockcheck_scan.css` | `7263810c...` | Card, badge, state, details, rail, responsive and scan-result surface patterns | Token map to current graphite variables; only consumed selectors; no sidebar/theme/product selectors | Keep Avatar's compact card/rail rhythm while retaining the target theme |
| `z2m-assets.js` | `web/js/components/list_ui.js`, `web/js/components/confirm.js` | `7263810c...` | Search/count interaction and destructive-action confirmation | Uses canonical `assets_*` RPCs, stable IDs and shared LuCI confirm; no arbitrary path or donor API | Make the now-main M2 registry readable and safe without adding a file manager |
| `z2m-overview.js` | `web/js/pages/dashboard.js` | `7263810c...` | Dashboard card hierarchy and status-card presentation | Real `status`, `preview`, and DNS service envelopes only; no fabricated health percentages | Give Overview a compact readiness summary grounded in existing backend data |
| `z2m-blockcheck-page.js` | `web/js/pages/blockcheck.js`, `blockcheck2.js`, `block_detector.js`, `scan.js` | `7263810c...` | Progress panel, bounded logs, result cards, positive-result handoff and separate detector surface | Existing typed BlockCheck/M5 RPCs and independent lifecycles; donor HTTP calls and backend assumptions removed | Preserve useful diagnostic presentation while keeping target ownership boundaries |
| `z2m-proxy-page-core.js` | `web/js/components/setup_ui.js`, `tgproxy.js` | `7263810c...` | Install/provider state-card vocabulary and confirmation interaction | Existing Telegram Proxy RPCs, no donor package routes or `/api/tgproxy` calls; provider failures remain typed | Improve provider lifecycle clarity without transplanting donor TG implementation |
| `z2m-api.js` | `web/js/api.js` | `7263810c...` | NONE — donor HTTP client is intentionally dropped | Project-owned allowlisted LuCI RPC adapter and typed error normalization | Backend authority and authentication must remain the target's rpcd/ubus contract |

`7263810c...` is shorthand only inside this matrix; the full donor commit is recorded above and in `docs/third-party/avatarDD-zapret-gui.md`.

## Explicit exclusions

No donor `core/**`, `api/**`, `app.py`, `/api/...` backend, AWG, sing-box, mihomo, usque, Opera Proxy, donor DNS, donor Telegram Proxy, donor update flow, or hidden donor routes are copied.

## Provenance

Copied/adapted code remains MIT-licensed. The repository will add `docs/third-party/avatarDD-zapret-gui.md` with the donor repository, current head, reviewed reference, file-level mapping, and the donor MIT notice. Existing project `LICENSE` remains unchanged.
