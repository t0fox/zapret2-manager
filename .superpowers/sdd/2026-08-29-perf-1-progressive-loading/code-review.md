# PERF-1.2 code review

## Scope

This slice removes first-render read waterfalls from the Dashboard and
Telegram Proxy UI. It does not change product semantics, mutation authority,
update-source policy, or Z2K lifecycle behavior. The user explicitly required
work in the current `main` checkout, without agents, APKs, new branches,
merges, or pushes; those boundaries were followed.

## Root cause

The LuCI app shell already fetched `status_fast`, but the Dashboard loader
fetched it again and waited for management, version, resource, strategy, and
optional product reads before the page became complete. Telegram Proxy used a
single `Promise.allSettled()` containing local reads, journal data, catalog and
version metadata, and the default upstream health probe. A slow optional or
remote call therefore held the entire page skeleton.

There was also a lifecycle edge in the app coordinator: a deferred block calls
`ctx.rerender()`, and the coordinator used to unmount the active module before
every rerender. That cleared page-local deferred state and invalidated the
remaining scheduler work.

## Review of the implementation

- `app.js` reuses the shell snapshot and accepts rerenders from the same live
  module/route. It still calls the module unmount hook when navigation leaves
  that page, so stale deferred callbacks cannot repaint another route.
- `z2m-overview-loading.js` returns after the initial status snapshot and uses
  a page-local scheduler with a maximum of two deferred lanes. Preview, events,
  recommendations, Telegram status, canonical strategy, system, version, and
  resource blocks publish independently with per-block timeout and generation
  guards.
- `z2m-overview-model.js` uses the status snapshot's strategy identity as an
  immediate fallback; canonical `strategies.get` remains enrichment, not a
  first-paint prerequisite.
- `z2m-overview.js` renders the deferred map and keeps the Dashboard card on
  local Telegram product status. It does not request `proxy.health` for the
  ordinary Dashboard navigation.
- `z2m-proxy-page-core.js` makes the first Telegram render local-only: canonical
  `tg_product_status`, capabilities, applied config, and operation recovery.
  Catalog, versions, raw proxy status, and the journal are bounded deferred
  reads. Full health is still available only through the explicit Check action.

## Backend contract review

`tg_product_status()` was inspected in `tg-product.uc`. Its status model already
uses `proxy_provider_status()`, `proxy_status()`, `proxycfg_get()`, and
`proxycfg_health({ upstream: false })`. The frontend therefore reuses that
canonical local status for the initial product state. `proxycfg_health()` with
the default upstream behavior remains an intentional explicit verification
path, not a navigation read.

No backend file was changed. No Registry, PREPARE/CONFIRM/APPLY, rollback,
watchdog, update-source, or transaction-polling code was changed.

## Review verdict

The candidate behavior is covered by the progressive Dashboard and Telegram
tests and by the live router/browser observations recorded in `after.md` and
`live-browser.md`. The repository-wide PERF-1 command still has an unrelated
missing `z2m-scanner-hub.js` fixture in this checkout; that boundary is recorded
instead of being silently ignored.
