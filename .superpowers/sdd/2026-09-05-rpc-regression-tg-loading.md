# RPC/state regression and Telegram loading evidence

Date: 2026-09-05 (Europe/Moscow)

Status: implementation deployed and pushed; full LAN traffic acceptance is not
claimed because the available client was forced through an administrator-owned
VPN split route.

## Root cause

The regression was a broken ownership chain, not a missing network connection.
LuCI was receiving several valid-but-incomplete or incorrectly projected states
from the `z2m-api.js` facade and then presenting them as unavailable. The Engine
facade also dropped the explicit refresh request, while clean-install state
mixed package-static Z2K files with installed runtime evidence. The backend
needed to distinguish installed Engine compatibility, candidate compatibility,
remote-empty/unavailable catalog state, and deferred Z2K authority.

Telegram had three UCode compatibility defects in the synchronous install path:
`String.lastIndexOf()` was used by the shared lifecycle repair, `join()` was
called with JavaScript argument order, and `run()` was declared after the first
function that executed it. These exceptions occurred before the durable
operation could reach a terminal state, leaving the UI at `RUNNING/PREPARE`.

## Loading/UI correction

The Telegram install flow now paints a pending state before invoking the
synchronous RPC, keeps action controls disabled only while the request is
active, and renders backend-owned progress with an accessible `progressbar`.
The client-side fake progress ticker was removed. Polling is bounded at 120 s;
an observation timeout becomes an explicit `UNKNOWN` state with a recovery
instruction. RPC failures remain inline operation errors and are never rewritten
as a LuCI/network-session message. Progress motion is short and disabled for
`prefers-reduced-motion`.

This was reviewed against the Emil design-engineering, design-consultation,
design-review, and Web Interface Guidelines directions used for this task.

## Source delivery

Implementation commit pushed to `origin/main`:

`96464b0493085d88961570c243eae028fc030582`

The implementation commit contains these task-owned files:

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runtime-state.js`
- `tests/product/tg-install-owner-contract.test.mjs`
- `tests/ui/clean-install-truth-regression.test.mjs`
- `tests/ui/tg-installation-loading-design.test.mjs`
- `tests/ui/tg-settings-presets-contract.test.mjs`
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh`
- `zapret2-manager/files/usr/libexec/zapret2-manager/preflight-cli.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc`

## Router/runtime evidence

Router: Cudy WBR3000UAX v1, OpenWrt 25.12.5
`r33051-f5dae5ece4`, mediatek/filogic, aarch64, kernel 6.12.94.

- Manager package: `zapret2-manager-full-0.1.0-r156`.
- Official Engine: `v1.0.5`, runtime commit
  `0b8182d24a887059a628d7266577c4ba8e9b8f2d`, asset SHA256
  `40040fef1747012a68f2dd5892b9a0bece91846e9bce37b59e35b641fdcb2a4e`.
- Z2K catalog: `strategies_catalog_status` returned `ok:true`, 740 physical
  entries, including the 8 Z2K records; generation source commit
  `f9dd3ea47a2239514f396a843b475c92c33f0b4c`.
- Active strategy: `z2k:z2k_all_in_one`, origin `z2k_builtin`.
- `status_fast`: `serviceState=running`, one `nfqws2` PID, NFQUEUE `300`,
  registered/owner-matched, rules present, queue dropped/user-dropped `0`.
- Runtime command contains the full TLS/HTTP, YouTube/GoogleVideo QUIC, and
  Discord UDP profile composition; nft table `inet zapret2` exists.
- Runtime error search for Lua/blob/hostlist/ipset was empty after restart.
- Telegram: Rust `2.3.3`, package version `2.3.3-r1`, PID/listener
  `192.168.1.1:1443`, health `ok:true`; upstream TCP probe is explicitly
  degraded/informational and is not treated as Telegram media proof.
- Telegram backend SHA256 on router:
  `7e52ddfcb8c69780b4ec4d383758ef737de4521eb2c3d4da28cd9cd099b526b8`.
- `/etc/init.d/zapret2-manager restart` at `2026-09-05T13:16:32Z` returned
  rc `0`; the canonical strategy and running runtime remained intact.
- No full router reboot was performed.

These direct read-only RPC checks all returned bounded parseable JSON with
`rc=0` and `ok=true`: `status_fast`, `events_tail`, `strategies_list`,
`strategies_catalog_status`, `proxy_status`, `proxy_health`, and
`proxy_logs_tail`. The full Logs page rendered 60 records. Current rpcd has one
running process; the remaining crash-loop line is historical log content from
the pre-fix baseline, not a current rpcd process.

## Browser evidence

The real LuCI page at `192.168.1.1` showed:

- Home: `nfqws2` working and `z2k:z2k_all_in_one` as active.
- Strategies: `Z2K 8`, active canonical strategy, selected/applied state.
- Logs: connected page with 60 records, not an empty shell.
- Telegram health interaction: `Проверяем Telegram` → accessible
  `progressbar "Выполнение операции"` → terminal `Работает с ограничениями`.
- Browser Console had zero errors after `13:00Z`; earlier session-expiry and
  pre-fix `tg_product_switch` errors are retained as historical evidence.
- Body text did not contain `â†’`; the rendered separator was `→`.

## Traffic evidence and boundary

The first direct Windows client requests did not traverse the router: the client
had split routes for these address ranges through `tun_dkdzmecvd`, and adding
temporary host routes required administrator elevation. I therefore used a
short-lived SSH SOCKS path to exercise the router egress and added five temporary
nft counters only for evidence. Handles `12215`–`12219` were deleted afterwards;
the normal nft ruleset and runtime were left in place.

Router-side evidence from that egress path:

| Timestamp UTC | Gate | Client result | nft counter | Conntrack evidence |
|---|---|---|---:|---|
| 2026-09-05T13:26:27Z | RKN TLS `4kporn.xxx` | HTTPS 403, curl rc 0 | 21 pkt / 8518 B | TCP 443, mark `1073741824` |
| 2026-09-05T13:26:27Z | YouTube TLS | HTTP 204, curl rc 0 | 30 / 5176 B | TCP 443, mark `1073741824` |
| 2026-09-05T13:26:27Z | GoogleVideo TLS | HTTP 302, curl rc 0 | 16 / 2628 B | TCP 443, mark `1073741824` |
| 2026-09-05T13:28:08Z | YouTube QUIC Initial | ncat rc 0 | 1 / 1228 B | UDP 443, 1 packet / 1228 B, mark `1073741824` |
| 2026-09-05T13:28:25Z | Discord STUN probe | ncat rc 0 | 1 / 48 B | UDP 3478, 1 packet / 48 B, mark `1073741824` |

This proves profile matching and NFQUEUE marking on router egress. It does not
prove the requested end-to-end direct-LAN client gates, successful YouTube
playback, GoogleVideo media transfer, or Discord Voice session. Consequently
the full Z2K All-in-One traffic acceptance is **НЕ ПОДТВЕРЖДЕНО / НЕ ЗАВЕРШЕНО**.

## Verification commands/results

- `node --test --test-concurrency=1 tests/ui/tg-installation-loading-design.test.mjs tests/ui/tg-installation-ux-contract.test.mjs tests/ui/telegram-proxy-overview-contract.test.mjs tests/product/tg-install-owner-contract.test.mjs tests/ui/tg-settings-presets-contract.test.mjs tests/ui/tg-runtime-rpc-regression.test.mjs tests/ui/clean-install-truth-regression.test.mjs`
  — 54 passed, 0 failed.
- `node scripts/validate-knowledge.mjs` — passed.
- `git diff --check` — passed.
- Broad 114-file related product/UI run was attempted. Existing host/fixture
  failures were recorded rather than hidden: disabled `sudo`, missing host UCode
  runtime for UCode behavioral tests, and pre-existing compiler/catalog fixture
  assumptions. The focused task-owned suite above is the authoritative green
  regression gate for this change.
- APK build — intentionally not run per explicit user instruction.

No partial package state was published. The live router retained the verified
runtime while source and static files were synchronized by SHA256 before the
push.
