# PERF-1.2 request matrix

The matrix distinguishes the frontend request from the backend work it
delegates. `tg_product_status` is intentionally treated as a canonical local
aggregate; its internal composition is not a reason to add duplicate critical
frontend calls.

| UI datum | Frontend RPC | Backend owner/work | Network | Duplicate decision |
| --- | --- | --- | --- | --- |
| Dashboard runtime state | `status_fast` | `status-fast.uc`; bounded `/proc`, runtime, NFQUEUE and durable strategy observations | No | One app-shell read reused by Dashboard |
| Dashboard strategy identity | `status_fast` initially; `strategies_get` deferred | Fast identity first; targeted canonical strategy read later | No | `strategies_get` no longer blocks paint |
| Dashboard strategy candidates | `strategies_preview` deferred | Strategy/catalog read model | No remote dependency required for initial paint | Independent block |
| Dashboard event tail | `events_tail` deferred | `maintenance.uc`; bounded NDJSON journal read | No | Publishes independently; no second Dashboard read |
| Dashboard recommendations | `strategies_recommendations` deferred | Strategy recommendation/catalog read model | No remote dependency required for initial paint | Independent block |
| Dashboard system facts | `engine_status`, `maintenance_status`, `versions`, `resources_status` deferred | Engine, maintenance/version, and resource registry filesystem/package reads | No navigation network dependency | Enrichment only |
| Dashboard Telegram card | `tg_product_status` deferred | `tg-product.uc`: provider status, proxy runtime, config metadata, local health with `upstream:false` | No upstream probe | Reuses local canonical product status; no normal `proxy_health` |
| Telegram basic runtime | `tg_product_status` | Same canonical local aggregate, including internal `proxy_status` and `proxycfg_get` observations | No upstream probe | One frontend aggregate; no duplicate raw status/config in critical path |
| Telegram settings/config | `proxy_config_get` in core | `proxycfg_get`; applied/draft settings and revision | No | Retained because product status exposes only redacted config metadata, not settings |
| Telegram capability surface | `proxy_capabilities` in core | Proxy capability/provider support read | No | Retained because it is a separate contract needed by controls |
| Telegram operation recovery | `tg_product_operation_status` in core | Provider operation state | No | Retained for transaction recovery |
| Telegram technical process/listener details | `proxy_status` deferred | `proxy_status`; process/listener/runtime probes | No | Delayed because the canonical product status already supplies first-paint state |
| Telegram component catalog | `tg_product_catalog` deferred | Provider catalog/update-source browse | Possible cache-miss remote metadata | Never first-render authority |
| Telegram version choices | `tg_product_versions` deferred | Provider versions/update-source browse | Possible cache-miss remote metadata | Never first-render authority |
| Telegram journal | `events_tail(limit:50)` deferred | Bounded journal read | No | One deferred request; no initial blocker |
| Explicit upstream verification | `proxy.health` only from Check action | `proxycfg_health` default upstream-capable path | Yes, intentionally | Removed from ordinary navigation, not removed from product |

## Critical path summary

Dashboard critical path: app-shell `status_fast` only; no duplicate Dashboard
`status_fast`, no GitHub dependency, and no active Telegram upstream health.

Telegram Proxy critical path: four bounded local reads needed by the core
overview/settings/operation model. Catalog, versions, journal, raw technical
status, and explicit upstream verification are outside the critical path.

## Concurrency

Both page-local schedulers admit a maximum of two deferred jobs. Generation
tokens and live-route checks reject late results after refresh or navigation.
