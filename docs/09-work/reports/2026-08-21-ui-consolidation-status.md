# UI consolidation status — 2026-08-21

## Scope boundary

This slice changes only the LuCI product information architecture and presentation
composition. The DNS backend and all production Scanner execution authorities are
unchanged. Home, Strategies, and Telegram Proxy remain visual references; their
page implementations are not redesigned. WARP remains a UI-only placeholder
because no production backend owner was proven.

## Donor study

| Capability | Avatar | Z2K | old Z2M | new Z2M | what borrowed |
|---|---|---|---|---|---|
| Updates / update state | `avatarDD/zapret-gui` `web/js/pages/update_checker.js`, `api/update_checker.py` | `webpanel/www/js/pages/update.js`, job modal/poller | Versions were mixed into Maintenance with runtime facts | System → Updates | Installed-version cards and explicit “availability is not checked” state; no fabricated update result |
| Engine lifecycle / autostart | `web/js/pages/zapret_manager.js`, `web/js/pages/autostart.js`, `api/healthcheck.py` | `z2k-auto-update.sh`, init/runtime lifecycle | Maintenance → Zapret/Autostart aliases | System → Engine | Existing Z2M EnginePanel remains the owner; tab consolidation only |
| Manager settings | `web/js/pages/settings.js` | `webpanel/www/js/pages/toggles.js` | No canonical manager settings page; route landed in Maintenance | System → Settings | Existing manager UI advanced-mode state, with an explicit no-settings-RPC boundary; no invented backend |
| Backups | `api/backup.py`, `core/backup.py` | update/job safety patterns | Maintenance backup list/preview/restore | System → Backups | Existing bounded backup/restore workflow and verification |
| Diagnostics monitoring | `web/js/pages/diagnostics.js`, `api/diagnostics.py`, `api/healthcheck.py` | `webpanel/www/js/pages/diag.js` | Maintenance diagnostics export plus separate Monitor | Diagnostics → Monitoring | Health summary, warnings, runtime facts and diagnostics export compose existing read-only RPCs |
| Logs / Events | `web/js/pages/logs.js` | `diag.js` event/job presentation | Maintenance Events viewer duplicated Logs | Diagnostics → Logs | AvatarLog remains the single semantic viewer; Maintenance no longer loads or renders events |
| DNS routing | `web/js/pages/dns_routing.js`, `core/dns_routing.py` | dashboard/toggle task-first patterns | Existing canonical DNS facade and rich DNS page | DNS | Task-first summary and selected-provider/status framing; canonical DNS RPC ownership preserved |
| Scanner / BlockCheck | `web/js/pages/scanner.js`, BlockCheck diagnostics | `strategies.js` and diagnostic controls | Scanner product already had Search/Diagnostics/History | Сканирование | Existing Scanner production API and BlockCheck/BlockCheck2/blockcheckw controls remain in Diagnostics; no second runtime |

Donor revisions studied: Avatar `15808e10a532...` and Z2K enhanced `54b6765f2ab...`.

## Route and module evidence

| Old route | Canonical route/tab | Module after change |
|---|---|---|
| `#/updates` | `#/updates` / System → Updates | shared `Maintenance` object, `id: system` |
| `#/zapret` | `#/engine` / System → Engine | same shared System object |
| `#/autostart` | `#/engine` / System → Engine | alias, same shared System object |
| `#/maintenance` | `#/updates` / System → Updates | alias, same shared System object |
| `#/settings` | `#/settings` / System → Settings | same shared System object |
| `#/monitor` | `#/monitor` / Diagnostics → Monitoring | shared `Diagnostics` object |
| `#/logs` | `#/logs` / Diagnostics → Logs | shared `Diagnostics` object; one AvatarLog renderer |
| `#/diagnostics` | `#/diagnostics` / Diagnostics → Monitoring | alias-compatible Diagnostics entry |

The app registers `system: Maintenance` once and assigns `updates`, `engine`,
`backups`, and `settings` to that same object. It registers `diagnostics:
Diagnostics` once and assigns `monitor` and `logs` to that same object. Thus the
legacy names are reachability aliases, not independent lifecycle instances.

## Lazy-load contract

- System loads only `versions` for Updates, EnginePanel data for Engine,
  `backup_list` for Backups, and the existing browser UI state for Settings.
- Diagnostics loads the Monitoring read-only set only on Monitoring and
  `events_tail` only on Logs.
- Inactive inner tabs do not trigger their RPCs during the active tab load.
- Events, uptime, RAM, Overlay and diagnostics export are absent from System;
  they are composed under Diagnostics.

## Verification

- `node --test tests/ui/system-diagnostics-consolidation.test.mjs`: **5/5 PASS**.
- Existing focused Scanner IA and DNS donor contracts remain green.
- Screenshot capture was explicitly excluded by the user; no screenshot evidence
  is claimed.
- Full legacy UI suite still contains unrelated baseline reds and old assertions
  for the retired Maintenance Events viewer; these remain listed in the final
  handoff rather than being hidden.
