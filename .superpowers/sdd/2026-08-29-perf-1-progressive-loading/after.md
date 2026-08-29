# PERF-1.2 after

## Implementation result

The Dashboard now reuses the app-shell `status_fast` snapshot. Its first
meaningful render is followed by independent deferred blocks with a maximum of
two in-flight jobs. Telegram Proxy returns its core page from local data and
defers catalog/version/journal/raw-status enrichment. Ordinary navigation does
not call `proxy.health({})`; the explicit Check action remains the owner of the
full health probe.

## Browser checkpoints

With cache disabled and a hard reload of the deployed source:

- At the 2.5 s snapshot, Dashboard runtime cards and a populated event tail
  were visible; the page was not held by recommendations, catalog, or Telegram
  metadata.
- At the 7.0 s snapshot, the Telegram card, recommendations, and Components
  summary had arrived independently. The card showed local provider/version and
  truthful `Telegram DC: Проверка не выполнена` rather than claiming upstream
  success.
- Telegram Proxy became a usable page after the local core load: heading,
  provider Rust, version 2.3.0, process/listener state, settings entry points,
  and explicit Check controls were present while upstream remained unconfirmed.
- The post-deploy CDP capture showed the Telegram core batch as
  `tg_product_status`, `proxy_capabilities`, `proxy_config_get`, and
  `tg_product_operation_status`. The deferred source schedule is
  `proxy_status`, `tg_product_catalog`, `tg_product_versions`, and
  `events_tail`, with at most two lanes. No ordinary `proxy_health` call was
  observed in that capture. The final app lifecycle patch changes only rerender
  retention, not this RPC schedule.

These fixed-wait checkpoints are upper bounds for the snapshots taken; they are
not claims that every device will meet the PERF-1 target budgets.

## Router read-only latency sample

Five serial SSH+ubus samples were taken on the target router. The first-call
SSH/process overhead is included, so this is an operational observation rather
than pure ubus latency.

| RPC | n | median | p95 |
| --- | ---: | ---: | ---: |
| `status_fast` | 5 | 304.4 ms | 321.3 ms |
| `tg_product_status` | 5 | 179.1 ms | 1695.2 ms |
| `proxy_capabilities` | 5 | 275.6 ms | 292.6 ms |
| `proxy_config_get` | 5 | 349.3 ms | 377.1 ms |
| `tg_product_operation_status` | 5 | 178.7 ms | 183.9 ms |
| `proxy_status` | 5 | 444.8 ms | 491.5 ms |
| `events_tail` | 5 | 204.6 ms | 237.5 ms |

The large `tg_product_status` p95 is retained as measured; it is not smoothed
away. Catalog/version calls were not repeatedly exercised to avoid intentionally
exhausting the existing GitHub/update-source budget.

## Verification

Passing focused UI run:

```text
node --test tests/ui/dashboard-parity-contract.test.mjs \
  tests/ui/dashboard-staged-loading.test.mjs \
  tests/ui/telegram-proxy-progressive-loading.test.mjs
19 tests, 19 pass, 0 fail
```

Passing broader relevant Dashboard/Telegram/TG/proxy UI run:

```text
91 tests, 91 pass, 0 fail
```

`node --check` passed for all five changed frontend JavaScript files and
`git diff --check` passed. The PERF-1 contract command reports 12/14 passing;
the two failures stop while reading the pre-existing missing
`luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-hub.js`.
The focused product gates were run in WSL, where the repository's UCode harness
is available: `tests/product/update-source*.mjs` passed 35/35 and
`tests/product/tg-provider-transaction.test.mjs` passed 12/12. Running those
same tests directly under Windows remains unavailable because that host has no
usable `ucode` command; no backend change in this slice depends on the Windows
runner result.
