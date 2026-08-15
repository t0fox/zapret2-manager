---
id: avatar-current-z2m-parity-matrix-2026-08-15
title: "Full Avatar UI parity closure: frozen baseline matrix"
type: parity
status: current
updated: 2026-08-15
source_manifest: 2026-08-15-full-avatar-ui-parity-manifest.yaml
authority: evidence
publish: false
tags: [parity, avatar, matrix]
---

# Full Avatar UI parity closure: frozen baseline matrix

This matrix is rebuilt from the frozen references, not carried forward from
the previous DNS/TG matrix. The machine-readable source with the complete
interaction fields is
[`2026-08-15-full-avatar-ui-parity-manifest.yaml`](2026-08-15-full-avatar-ui-parity-manifest.yaml).

| Field | Value |
|---|---|
| `Z2M_BASE_HEAD` | `cbe93f47e53b55dd674bbde4355670b52862e8f1` |
| `AVATAR_TARGET_HEAD` | `60bc16a5ddc5f43d97d414b99920c3d13da3151a` |
| `PARITY_ROWS_TOTAL` | `45` |
| `BACKEND_SUPPORTED_ROWS` | `42` — all current Z2M-backed rows have an implemented UI surface |
| `PARITY` | `3` — M6 route CRUD/lifecycle/ownership UI |
| `ADAPTED` | `4` — TG provider/version/source controls use the canonical Z2M lifecycle |
| `PARTIAL` | `34` — existing backend-supported surfaces retain their documented semantic differences |
| `MISSING` | `0` |
| `BACKEND_NOT_READY` | `3` — WARP/usque UI-only scope |
| `NOT_APPLICABLE` | `1` — excluded Avatar-only product family |
| `DNS_CAPABILITY_COUNT` | `24` |
| `M6_BACKEND_CLASSIFICATION` | `BACKEND_SUPPORTED_UI_PARITY` |

## Frozen navigation inventory

Avatar page order is translated into the Z2M horizontal navigation model. The
Avatar sidebar is evidence only and is not a transplant target.

| Order | Group | Primary pages and children |
|---:|---|---|
| 1 | Главная | dashboard |
| 2 | Обход DPI (nfqws2) | control; strategies; scan |
| 3 | VPN и маршрутизация | unified-routing; warp; warp-setup; warp-in-warp; telegram-tunnel |
| 4 | Списки и данные | lists; hostlists; ipsets; blobs; lua; hosts; dns-routing |
| 5 | Диагностика | diagnostics; blockcheck; logs; monitor |
| 6 | Система | updates; zapret; autostart; settings |

## Interaction matrix

`PARTIAL` and `MISSING` are intentional baseline findings. Any such row that
is backend-supported blocks the final parity claim until the implementation
and Browser evidence are closed. `BACKEND_NOT_READY` is reserved here for the
explicit TG backend capability gaps and the approved WARP/usque disabled UI.

| ID | Group / page / subtab | Donor interaction | Z2M backend and current UI | Status | Evidence / browser |
|---|---|---|---|---|---|
| overview.runtime | home / dashboard | Poll cards, refresh, health shortcuts | status/events/service; z2m-overview.js | PARTIAL | readiness exists; Browser pending |
| control.lifecycle | dpi / control | Confirm start/stop/restart | native service lifecycle; distributed controls | PARTIAL | owner exists; Browser pending |
| control.feedback | dpi / control | Loading/progress/result/retry | events_tail/normalized errors; shell states | PARTIAL | primitives incomplete; Browser pending |
| strategies.catalog | dpi / strategies/list | Search/filter/select/favorite/duplicate | strategies_list/get/favorite/duplicate; z2m-strategy.js | PARTIAL | catalog reachable; Browser pending |
| strategies.detail | dpi / strategies/detail | Metadata/edit/validate | strategies CRUD/profiles; workflow modules | PARTIAL | canonical CRUD exists; Browser pending |
| strategies.apply | dpi / strategies/apply | Preview/validate/apply/runtime proof | strategies_* and coordinator | PARTIAL | authority frozen; Browser pending |
| scanner.setup | dpi / scan/setup | Select mode and target | scanner_start/status/results; z2m-scanner.js | PARTIAL | owner exists; Browser pending |
| scanner.lifecycle | dpi / scan/progress | Start/stop/resume/poll | scanner_start/stop/resume/status | PARTIAL | separate state flow; Browser pending |
| scanner.handoff | dpi / scan/results | Rank and hand off candidate | scanner_results/save_generated → Strategy | PARTIAL | ownership preserved; Browser pending |
| blockcheck.hub | diagnostics / blockcheck/hub | Switch independent modes | diag/blockcheck2/blockcheckw/detector RPCs | PARTIAL | distinct backend flows; Browser pending |
| blockcheck.run | diagnostics / blockcheck/run | Configure/run/stop | blockcheck_diag_*; z2m-blockcheck-page.js | PARTIAL | run controls exist; Browser pending |
| blockcheck.results | diagnostics / blockcheck/results | Stream output/result/retry | blockcheck2/blockcheckw output/results | PARTIAL | terminal states incomplete; Browser pending |
| block_detector.monitor | diagnostics / blockcheck/dns-monitor | Start/stop/findings/handoff | block_detector_*; same page | PARTIAL | lifecycle exists; Browser pending |
| diagnostics.run | diagnostics / diagnostics/diagnosis | Run/cancel/classify | diag RPCs/health matrix | PARTIAL | no dedicated donor page; Browser pending |
| diagnostics.export | diagnostics / diagnostics/evidence | Export/copy/error | diagnostics_export/events_tail | PARTIAL | RPC exists; Browser pending |
| services.catalog | data / services/services | Search catalog/membership | catalog/domain_hub; domain hub page | PARTIAL | reachable under old Services; Browser pending |
| services.domains | data / services/domains | Add/remove/references | domain_hub/lists; z2m-services.js | PARTIAL | canonical writer exists; Browser pending |
| assets.list | data / assets/registry | Filter/hash/revision/references | assets_list/get/references; z2m-assets.js | PARTIAL | typed registry UI exists; Browser pending |
| assets.lifecycle | data / assets/import-edit-delete | Import/update/validate/delete | assets_import/update/validate/delete | PARTIAL | safety exists; binary UI parity pending |
| routing.crud | routing / unified-routing/routes | Route CRUD/ownership | route_list/get/create/update/remove; z2m-unified-routing.js | PARITY | M6 target canary and Browser PASS; empty target route set |
| routing.lifecycle | routing / unified-routing/preview-apply | Preview/validate/apply/status/remove/reconcile | route_* lifecycle; z2m-unified-routing.js | PARITY | M6 lifecycle UI and Browser PASS |
| routing.ownership | routing / unified-routing/dependencies | CAS/foreign-state/rollback protection | revision/CAS/service_dns ownership | PARITY | Service DNS ownership visible; focused tests and Browser PASS |
| dns.global | dns / dns-routing/global | Mode/providers/hijack/cache | dns_product_*; z2m-dns.js | PARTIAL | 24 DNS controls inventoried; target PASS |
| dns.providers | dns / dns-routing/providers | Diagnose/select/provider results | dnsprov_*; z2m-dns.js | PARTIAL | target provider canary PASS; Browser pending |
| dns.per_domain | dns / dns-routing/per-domain | Add/delete/presets | canonical DNS overrides; z2m-dns.js | PARTIAL | zero-loss capability; Browser pending |
| dns.service_dns | dns / dns-routing/service-dns | Profile preview/apply | service_dns_*; service model/adapter | PARTIAL | M6 canary PASS; Browser pending |
| dns.lifecycle | dns / dns-routing/apply | Preview/validate/apply/rollback/restore | dns_product lifecycle + coordinator | PARTIAL | target DNS canary PASS; Browser pending |
| dns.diagnostics | dns / dns-routing/check | Check/readiness/success/error | dns_check/status/diagnose | PARTIAL | DNS отвечает target PASS; Browser pending |
| tg.providers | telegram / telegram-tunnel/providers | Go/Rust choice/preflight | tg_product catalog/status; proxy page core; proxy_provider_versions | ADAPTED | canonical provider lifecycle and target checks PASS |
| tg.versions | telegram / telegram-tunnel/versions | Installed/package/latest/available metadata | status + bounded proxy_provider_versions/check_updates | ADAPTED | Go 0.9.3-1/0.9.3-2 preserved, release metadata/notes and compatibility fields; target PASS; browser recheck pending auth |
| tg.version_selector | telegram / telegram-tunnel/versions | Select available version | proxy_provider_versions + provider/source/version/checkToken install input | ADAPTED | clean labels, truthful artifact filtering and shared selected-release panel; browser recheck pending auth |
| tg.source_selector | telegram / telegram-tunnel/versions | Select supported source | bounded APK feed and official GitHub provenance | INTENTIONAL_DEVIATION | source provenance is backend-only; no visible selector; browser recheck pending auth |
| tg.installation | telegram / telegram-tunnel/installation | Install/update/remove/progress/confirm | tg_product install/update/remove/purge | PARTIAL | target preflight/status PASS; browser recheck pending auth |
| tg.lifecycle | telegram / telegram-tunnel/status | Lifecycle/listener/sessions/poll | tg_product lifecycle + proxy health | PARTIAL | canonical projection target PASS |
| tg.configuration | telegram / telegram-tunnel/configuration | Edit/validate/apply config | proxy_config_* and secret owner | PARTIAL | writer preserved; Browser pending |
| tg.reveal | telegram / telegram-tunnel/connection | Confirm reveal/QR/clipboard/rotate | proxy_link_info/secret_rotate | PARTIAL | bounded secret action; Browser pending |
| monitoring.polling | diagnostics / monitor/runtime | Poll/filter/stale state | monitor_snapshot/proxy_health/events_tail | PARTIAL | old monitor reachable; Browser pending |
| maintenance.logs | system / logs/events | Refresh/filter/export/error | events_tail/proxy_logs_tail/diagnostics_export | PARTIAL | APIs exist; dedicated page pending |
| maintenance.backups | system / maintenance/backups | Create/preview/restore/delete | backup_* | PARTIAL | safety owner exists; Browser pending |
| maintenance.system | system / maintenance/system | Versions/autostart/updates/diagnostics | versions/maintenance_status/engine_* | PARTIAL | native maintenance owner preserved |
| warp.usque | routing / warp/tunnel | Full status/config/table, disabled actions | no usque backend | BACKEND_NOT_READY | complete disabled UI required |
| warp.setup | routing / warp-setup/setup | Full setup workflow/progress | no usque setup backend | BACKEND_NOT_READY | complete disabled UI required |
| warp.in_warp | routing / warp-in-warp/nested-tunnel | Full nested tunnel forms/subtabs | no WARP-in-WARP backend | BACKEND_NOT_READY | complete disabled UI required |
| shared.primitives | shared / shell | Confirm/toast/retry/loading/empty/stale/filter/table/clipboard | z2m-shell/avatar-ui; partial coverage | PARTIAL | reusable layer pending |
| scope.exclusions | excluded | AWG/sing-box/mihomo/Opera product nav | no approved Z2M mapping | NOT_APPLICABLE | explicitly excluded |

## DNS zero-loss gate

The complete pre-migration control inventory is in
[`2026-08-15-dns-capability-inventory.yaml`](2026-08-15-dns-capability-inventory.yaml).
It contains `24` capabilities covering global mode/providers/switches,
dnsmasq status, provider diagnostics, per-domain rules/presets, Service DNS,
Preview/Validate/Apply/Rollback/restore, DNS check and all error/empty states.
The later DNS UI must satisfy:

```text
DNS_POST_CAPABILITIES >= DNS_PRE_CAPABILITIES
DNS_FUNCTIONAL_REGRESSIONS = 0
DNS_MISSING_CONTROLS = 0
DNS_DEAD_CONTROLS = 0
```

## Scope decisions

- M6 is `BACKEND_SUPPORTED_UI_MISSING`, not `BACKEND_NOT_READY`.
- Asset Registry is typed and supports `lua`, `blob`, `ipset`, `hostlist`,
  `geosite`, `geoip`, and `hosts`; arbitrary filesystem access is excluded.
- TG version/source enumeration is now backed by the canonical provider owner:
  only the OpenWrt APK feed and allowlisted official GitHub releases are
  exposed; every selected artifact is size/digest checked before install.
- WARP/usque is mandatory full disabled UI with `Backend пока не реализован`;
  no fake state or failed bogus RPC is acceptable.
