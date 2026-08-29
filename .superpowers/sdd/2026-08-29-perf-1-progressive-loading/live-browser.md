# PERF-1.2 live router/browser acceptance

## Target and procedure

- Target: OpenWrt 25.12.5 at `192.168.1.1`, authenticated LuCI session.
- Browser: Codex in-app browser, cache disabled through CDP
  `Network.setCacheDisabled({ cacheDisabled: true })`.
- Deployment: source-only overlay; no APK/package build and no backend files.
- Browser console: no runtime errors observed during the final Dashboard and
  Telegram Proxy checks.

The router displayed its existing `No password set!` warning. The session was
already authorized on the local router; no password mutation was performed.

## Final browser observations

### Dashboard

After hard reload on `#/dashboard`, the 2.5 s snapshot contained:

- runtime state `Работает`, PID, strategy identity, autostart, and system shell;
- a populated `Журнал событий` tail;
- only the Telegram card still awaiting its independent product block.

At the 7.0 s snapshot the Dashboard also contained the local Telegram card
(`Rust`, `2.3.0`, listener ready, `Проверка не выполнена`), recommendations, and
the Components summary. This proves that the event and Telegram blocks can
settle independently and that one deferred block does not hold the page shell.

### Telegram Proxy

The page rendered with:

- `Работает с ограничениями`;
- `Rust · 2.3.0 · Автозапуск включён`;
- process `Запущен` and listener `192.168.1.1:1443`;
- Telegram `Не подтверждено`;
- visible explicit `Проверить` and `Проверить снова` actions.

The ordinary open therefore uses local evidence and does not claim a Telegram
DC check. The full upstream check remains an intentional button action.

The post-deploy CDP sample captured the core RPC set
`tg_product_status`, `proxy_capabilities`, `proxy_config_get`, and
`tg_product_operation_status`; the source-verified deferred set is
`proxy_status`, `tg_product_catalog`, `tg_product_versions`, and
`events_tail`, admitted two at a time. No ordinary `proxy_health` request was
present in that capture.

## Source/router/HTTP integrity

All five deployed frontend files were compared three ways: repository source,
router filesystem, and router HTTP-served bytes.

| File | Repository SHA-256 | Router SHA-256 | HTTP SHA-256 |
| --- | --- | --- | --- |
| `app.js` | `e7ce1db2c9c9464b9660249588ce578b3927c9cc691d9394cc37d6cbfb8fb5b8` | same | same |
| `z2m-overview-loading.js` | `c2fb65da4b8179523c2a5e08ff627961e983f58c0bb8edd5454f00833284326a` | same | same |
| `z2m-overview-model.js` | `b45b2297f8c84d7347c7758b441fa56e2b6e12193c935b1b96fb779b2af8545a` | same | same |
| `z2m-overview.js` | `c4bc9fdce99a13503507f969e936ae69834879e4af233dcb2fefec53576eef01` | same | same |
| `z2m-proxy-page-core.js` | `302657790e2da59d521923aad7321bc46e947b2fbfca6485ae8d801b8330704d` | same | same |

Before deployment, the prior router copies were retained at
`/tmp/z2m-perf1-progressive-20260829/`. The backup hashes were recorded before
each corresponding overwrite. The final app lifecycle patch also preserved the
same source-only rollback set.

## Acceptance boundary

The live evidence proves usable local-first rendering and removal of the
ordinary upstream health probe. It does not claim that every PERF-1 absolute
latency target is met: the live warm-navigation browser action plus snapshot
measured about 3.1 s, which includes Codex browser/action overhead and was not
treated as a pure page-latency PASS. Cache semantics remain covered by the
existing source tests. No GitHub quota was intentionally exhausted.
