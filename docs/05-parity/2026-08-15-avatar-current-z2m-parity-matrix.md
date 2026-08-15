---
id: avatar-current-z2m-parity-matrix-2026-08-15
title: "Актуальная матрица Avatar → Z2M"
type: parity
status: working-baseline
updated: 2026-08-15
---

# Актуальная матрица Avatar → Z2M

Это рабочая матрица перед адаптацией DNS и Telegram Proxy. Она построена по
текущему донору `G:/avatarDD/zapret-gui`, а не по старому snapshot или старым
заметкам.

## Зафиксированные источники

| Поле | Значение |
|---|---|
| `AVATAR_CURRENT_REF` | `avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c` |
| Донорский роутер | `G:/avatarDD/zapret-gui/web/js/app.js` |
| Z2M foundation | `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js` |
| Z2M canonical backend | `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` и typed CLI writers |
| Приёмка | `EXACT`, `PARTIAL`, `MISSING`, `NOT_APPLICABLE`, `BACKEND_NOT_READY` |

`NOT_APPLICABLE` означает, что у Z2M нет заявленного продукта или backend
контракта для этой Avatar-only зоны; это не разрешение silently пропустить
эквивалентную Z2M capability. `BACKEND_NOT_READY` означает, что UI capability
требует backend contract, которого пока нет или который не зарегистрирован.

## Матрица

| Avatar page/component | Capability | Interaction | Z2M backend capability | Current Z2M UI | Status | Required action | Donor files |
|---|---|---|---|---|---|---|---|
| Dashboard | Service/runtime overview, health cards, current Strategy | Open page, refresh, follow status shortcuts | `status`, `events_tail`, service lifecycle | Overview renders status and service controls | PARTIAL | Adapt card hierarchy, current Strategy identity, refresh and error/empty states | `web/js/pages/dashboard.js`, `web/js/components/sidebar.js` |
| Control | Start/stop/restart and result feedback | Click lifecycle action, confirm, observe result | `start`, `stop`, `restart`, native init owner | Controls are distributed across Overview/Maintenance | PARTIAL | Preserve native owner and expose Avatar result/progress semantics in one product flow | `web/js/pages/control.js` |
| Strategies | Catalog, search/filter, detail and metadata | Select, favorite, duplicate, edit, preview, validate, apply | `strategies_*`, compiler, Preview→Validate→Apply | Strategy page and canonical aggregate exist | PARTIAL | Close donor list/detail states, metadata, keyboard actions and all result/error states | `web/js/pages/strategies.js`, `web/js/components/list_ui.js` |
| Strategy scanner hub | Quick/standard/full selection and target setup | Start, stop, resume, select result, hand off to apply | `scanner_start`, `scanner_status`, `scanner_results`, `scanner_resume`, `scanner_save_generated` | Scanner page exists with native lifecycle | PARTIAL | Adapt donor tabs/progress/ranking and prove every handoff with frontend tests | `web/js/pages/strategy_scan_hub.js`, `web/js/pages/scan.js`, `web/js/components/proxy_table.js` |
| BlockCheck hub | Separate BlockCheck, BlockCheck2 and BlockCheckW flows | Choose mode, start/stop, inspect output/results | `blockcheck_*`, `blockcheck2_*`, `blockcheckw_*` | BlockCheck page and backend verticals exist | PARTIAL | Match donor mode navigation, stream/terminal-tail, result empty/error states | `web/js/pages/blockcheck_hub.js`, `web/js/pages/blockcheck.js`, `web/js/pages/blockcheck2.js` |
| Block Detector | Background DNS discovery and findings | Start/stop monitor, inspect findings, candidate handoff | `block_detector_*` | Backend and page surface are present but donor behavior is not closed | PARTIAL | Adapt monitor tab, polling, findings and safe list/Strategy handoff | `web/js/pages/block_detector.js` |
| Diagnostics | Diagnosis, deep trace and traceroute | Run, cancel, inspect classified evidence | `blockcheck_diag_*`, `diagnostics_export` | Diagnostics are reachable through BlockCheck/Monitoring | PARTIAL | Provide donor-equivalent run controls, classified failures and export behavior | `web/js/pages/diagnostics.js` |
| Services/Domains | Service catalog and domain membership | Search/filter, add/remove domain, inspect references | `domain_hub_*`, `lists_*`, service-DNS writers | Domain Hub and Services page exist | PARTIAL | Adapt donor grouping, search, empty states and domain mutation feedback | `web/js/pages/hosts.js`, `web/js/pages/hostlists.js`, `web/js/pages/lists.js` |
| Hostlists | Named hostlist CRUD/import/update | Create/import/edit/delete/refresh | Asset registry and lists RPCs | Resources/Services expose partial asset behavior | PARTIAL | Map file/list lifecycle, validation, references and import errors | `web/js/pages/hostlists.js` |
| IP sets | Named IP set CRUD/import/update | Create/import/edit/delete/refresh | No equivalent named IP-set product RPC in current Z2M scope | No dedicated UI | BACKEND_NOT_READY | Decide backend contract, then add product page and tests before parity claim | `web/js/pages/ipsets.js` |
| Lua scripts | List/edit/import/delete script assets | Open editor, save, delete, dependency warning | Only native preflight checks are present | No dedicated UI | BACKEND_NOT_READY | Add safe asset registry contract or explicitly scope out the Avatar capability | `web/js/pages/lua_scripts.js` |
| Blobs | Binary asset registry and Strategy references | List/import/delete/stats | Typed asset registry exists, no Avatar blob UI equivalent | Resources page is a Z2M adaptation | PARTIAL | Adapt binary-safe list/import/reference states and verify Strategy linkage | `web/js/pages/blobs.js`, `web/js/components/proxy_table.js` |
| DNS routing | Per-domain resolver rules and quick presets | Add rule, select DNS server, delete, apply, toast result | Existing DNS/provider/service-DNS writers; canonical `dns_product_*` facade | DNS page is provider/service oriented and not donor-shaped; authenticated browser run currently renders a backend error behind the stopped/unavailable engine state | PARTIAL | Preserve canonical facade and single DNS writer; reproduce after restoring target engine/backend readiness | `web/js/pages/dns_routing.js`, `web/js/components/toast.js` |
| DNS providers | Provider catalog and diagnosis | Inspect providers, diagnose, select/apply | `dnsprov_*`, `dns_select_provider`, global/override DNS writers | DNS page exposes partial provider and dependency-gate states; live browser controls were not reachable behind the backend error | PARTIAL | Preserve native ownership while matching donor cards, errors and disabled states | `web/js/pages/dns_routing.js`, `web/js/pages/diagnostics.js` |
| Telegram Proxy | Install/uninstall, engine detection, status polling | Confirm install/remove, poll progress, start/stop/restart | `proxy_*`, registered provider RPC, canonical Go/Rust runtime model | Authenticated responsive run has no horizontal overflow and shows Rust 2.0.0/running details, but the deployed pre-fix header chip mislabels the installed provider collection as `Не установлен` | PARTIAL | Deploy and recheck the `providerInstalled()` fix; keep provider lifecycle delegated to the existing owner | `web/js/pages/tgproxy.js`, `web/js/components/setup_ui.js`, `web/js/components/confirm.js` |
| Telegram Proxy config | TG-WS config, tunnels, routes, secret rotation | Edit/save, add/remove route, rotate secret, connect-info copy | `proxy_config_*`, `proxy_secret_rotate`, runtime adapter | Existing config surface is narrower than donor; reveal/clipboard and destructive actions remain intentionally unexercised in this run | PARTIAL | Match donor forms, validation, tunnel rows, clipboard and destructive confirmations | `web/js/pages/tgproxy.js`, `web/js/components/toast.js` |
| Monitoring | Runtime health and tunnel/service observations | Poll, filter, inspect event/log details | `monitor_snapshot`, `proxy_health`, `events_tail` | Monitor and Maintenance pages exist | PARTIAL | Adapt donor polling/visibility behavior and complete stale/error/empty states | `web/js/pages/tunnel_monitor.js`, `web/js/pages/logs.js` |
| Maintenance | Logs, backups, updates, expert/settings surface | Inspect, export, backup/restore, update, toggle expert controls | `maintenance_status`, backup RPCs, versions | Maintenance page is native LuCI surface | PARTIAL | Close donor settings/autostart/update interactions where Z2M backend supports them | `web/js/pages/settings.js`, `web/js/pages/autostart.js`, `web/js/pages/update_checker.js` |
| Unified routing | Destination selectors, primary/fallback methods, failover | CRUD route, preview/apply/remove, monitor | No complete unified route aggregate in current product | No equivalent product tab | BACKEND_NOT_READY | Implement/approve scope before frontend parity work; do not fake controls | `web/js/pages/routing_unified.js` |
| Tunnel monitor/optimizer | Health history, failover and optimization | Inspect, tune, switch method | No Avatar-equivalent tunnel product contract in Z2M | No equivalent product tab | NOT_APPLICABLE | Revisit only if Z2M declares a corresponding tunnel product | `web/js/pages/tunnel_monitor.js`, `web/js/pages/tunnel_optimizer.js` |
| AWG / sing-box / mihomo / usque / WARP / Opera | Separate proxy product lifecycles | Install/configure/start/stop each product | Outside current Z2M product contract | No corresponding tabs | NOT_APPLICABLE | Record scope decision; never count absence as parity for Z2M-owned capabilities | `web/js/pages/awg_*.js`, `web/js/pages/singbox_*.js`, `web/js/pages/mihomo*.js`, `web/js/pages/usque*.js`, `web/js/pages/warp*.js`, `web/js/pages/opera_proxy.js` |
| Shared interaction primitives | Confirm modal, toast, tables, filtering, responsive states | Confirm/cancel, toast result, keyboard/filter, mobile layout | Z2M Shell/components/CSS equivalents exist | Foundation has adapted primitives, coverage is incomplete | PARTIAL | Reuse donor behavior within Z2M Graphite/LuCI shell and test non-destructive interactions | `web/js/components/confirm.js`, `web/js/components/toast.js`, `web/js/components/list_ui.js`, `web/css/style.css` |

## Current baseline conclusion

The current Z2M frontend is a `FRONTEND FOUNDATION / PARTIAL TRANSPLANT`. It is
not an Avatar parity completion. DNS and Telegram Proxy are the next two
product slices, and each must use the donor component behavior while retaining
Z2M's horizontal navigation, Graphite/LuCI shell, canonical RPCs and
OpenWrt-native writers.

The matrix must be refreshed after DNS/TG implementation and again after the
whole-product closure pass. A final report may call a row `EXACT` only with
donor source evidence, adapted implementation, automated frontend coverage and
real Browser evidence. Any unexplained backend-supported `PARTIAL` or `MISSING`
row blocks an `AVATAR_UI_PARITY: COMPLETE` claim.

## 2026-08-15 implementation delta

DNS routing now has donor-adapted per-domain rule, delete and quick-preset
interactions over the canonical `dns_product_*` facade. Telegram Proxy now has
donor-adapted install-progress, connection reveal/QR-link and clipboard
interactions over the canonical `tg-product.v2` model. These are adapted
surfaces, not `EXACT` rows: target Engine/provider RPC registration and the
real DNS/TG canaries pass, while the required Browser gate is currently
blocked by LuCI HTTP `403` with `x-luci-login-required: yes`.
