---
id: dns-tg-v2-evidence-2026-08-15
title: "DNS и Telegram Proxy v2: acceptance evidence"
type: parity-evidence
status: partial
updated: 2026-08-15
---

# Acceptance evidence

`AVATAR_CURRENT_REF: avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c`

Документ фиксирует закрытый backend/target slice DNS v2 и Telegram Proxy v2.
Полный Avatar parity не объявляется: остальные Avatar-only строки остаются вне
этого slice. LuCI login был восстановлен в обычном browser flow, но финальный
Browser gate остаётся незакрытым из-за найденного дефекта pre-fix frontend,
невыкладки исправления на target и DNS engine/backend error.

## Required final fields

| Field | Result |
|---|---|
| `AVATAR_CURRENT_REF` | `avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c` |
| `PARITY_ROWS_TOTAL` | `22` |
| `EXACT` | `0` |
| `ADAPTED` | `2` — DNS routing и TG interaction surface |
| `PARTIAL` | `17` |
| `MISSING` | `0` |
| `NOT_APPLICABLE` | `2` |
| `BACKEND_NOT_READY` | `3` — IP sets, Lua scripts, unified routing |
| `BROWSER_DESKTOP` | `FAIL` — authenticated; no horizontal overflow, but deployed pre-fix TG header still says `Не установлен`; DNS renders `Backend вернул ошибку.` |
| `BROWSER_TABLET` | `FAIL` — authenticated; same product-state and DNS defects, no horizontal overflow |
| `BROWSER_MOBILE` | `FAIL` — authenticated; same product-state and DNS defects, no horizontal overflow |
| `BROWSER_CONSOLE_ERRORS` | `0` new errors after authenticated reload; one earlier login-transition `uci/get -32002 Access denied` was recorded |
| `NETWORK_404` | `0` observed in the authenticated document/assets/ubus capture; final post-fix capture remains pending |
| `DEAD_PRIMARY_CONTROLS` | `NOT VERIFIED` — DNS safe Preview/Validate could not be reached behind the backend error; TG destructive/reveal actions were not exercised |

## Implemented slice

- DNS has typed canonical facade `dns_product_get/providers/status/validate/preview/apply/rollback`.
- DNS preview is pure and computes the requested override diff; apply and rollback delegate to the existing DNS writer.
- Empty DNS rollback removes the manager-owned `dnsmasq.addnhosts` registration, restoring the pre-canary integration boundary.
- Telegram Proxy has one canonical `tg-product.v2` model with fixed providers `go` and `rust`; provider lifecycle remains owned by the existing provider writer and config lifecycle by the existing proxy-config writer.
- LuCI uses `ctx.api.tg.product.*`; the canonical product and UI do not call the compatibility provider API directly.
- No donor `/api/dns-routing/*` or `/api/tgproxy/*` calls were introduced.

## Root causes and target fixes

`ENGINE_RPC_ROOT_CAUSE`: target rpcd ucode scripts were mode `0777`, so rpcd
logged `Ignoring ucode script ... because it is world writable` and did not
register the Engine object. `TG_PROVIDER_RPC_ROOT_CAUSE` was the same. The
deployed files are now `0644 root:root`; rpcd was reloaded; Engine and provider
objects are present in ubus and their calls succeed.

`TARGET_UCODE_COMPATIBILITY`: the router's ucode parser rejects non-capturing
regex groups `(?:...)`. The incompatible expressions were repaired in
`remittor.uc`, `asset-registry.uc`, and `scanner-probe-executor.uc`. The local
runtime contract test is `2/2`.

`TG_UI_INSTALLED_COLLECTION_ROOT_CAUSE`: canonical `tg_product_status` returns
`installed` as a provider collection, for example
`[{"provider":"rust","installed":true,"selected":true}]`. The deployed
frontend used `installed === true`, which derived `unsupported` and displayed
`Не установлен` in the header even while the installation pane correctly
showed Rust 2.0.0 and a running process. The fix adds
`providerInstalled(value)` and applies it across the TG UI and adapter; the
focused regression test is now green. The target still contains the pre-fix
SHA256 listed in the deployment manifest because target write access was denied
in this run.

## Real router acceptance

Target: `root@192.168.1.1`, OpenWrt aarch64.

- Engine: `engine_providers` and `engine_status` succeed after registration and parser compatibility fixes.
- Telegram provider: catalog, status and preflight succeed; Rust is active/running, config is preserved, drift is false, and health checks pass.
- Go availability: canonical `check_updates` returned `latestPackageVersion: 0.9.3-r2`, `providerSwitch: true`, `installable: false`; no switch or install was attempted.
- DNS canary: pure preview reported `zeroWrites: true` and the requested add diff; validate passed; apply verified process/port/entry; reread contained the entry; canonical rollback restored empty overrides and `registered: false`.
- M6 canary: route preview and validate were pure; apply/status/remove/reconcile passed; the first conflicting profile correctly returned `EDOMAINCONFLICT` and the prior Service DNS selection was restored. The successful canary ended with no route and no temporary asset.

## Target deployment manifest

Evidence was collected after deployment. All listed files were present with
matching repository/target SHA256, mode `0644`, owner `root:root`.

| PATH | REPO SHA256 | TARGET PRESENT | TARGET SHA256 | MODE | OWNER | REQUIRED BY | STATUS |
|---|---|---|---|---|---|---|---|
| `/usr/share/rpcd/ucode/zapret2-manager.uc` | `f3d2409a25db2cadda3006d6ffe5fa0c81efa9a8d272228f6ce83297783d668d` | yes | `f3d2409a25db2cadda3006d6ffe5fa0c81efa9a8d272228f6ce83297783d668d` | 0644 | root:root | DNS/TG RPC | PASS |
| `/usr/share/rpcd/ucode/zapret2-manager-engine.uc` | `8aa2561a9d2bf092f58cf07671e7dcee8a3b5c2122d4d1a203219517fdc5d5b0` | yes | `8aa2561a9d2bf092f58cf07671e7dcee8a3b5c2122d4d1a203219517fdc5d5b0` | 0644 | root:root | Engine RPC | PASS |
| `/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc` | `72a05cef779e605d821873b3fac9257e3bb4e3898b61daf550c7d01a1a0a720c` | yes | `72a05cef779e605d821873b3fac9257e3bb4e3898b61daf550c7d01a1a0a720c` | 0644 | root:root | TG provider RPC | PASS |
| `/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json` | `8a11475c335a54cb78121b317c22c74c234c72f8885982a6b62219825963c665` | yes | `8a11475c335a54cb78121b317c22c74c234c72f8885982a6b62219825963c665` | 0644 | root:root | DNS/TG ACL | PASS |
| `/usr/libexec/zapret2-manager/tg-product.uc` | `b4133b47dda9f2bf8a54e9e9346562be5c8e636660d75116351840f77c6afb51` | yes | `b4133b47dda9f2bf8a54e9e9346562be5c8e636660d75116351840f77c6afb51` | 0644 | root:root | TG model | PASS |
| `/usr/libexec/zapret2-manager/tg-product-cli.uc` | `2001734c920c1535e4188c94767c74bbb15aefba6ee02be612626e1f7834c34d` | yes | `2001734c920c1535e4188c94767c74bbb15aefba6ee02be612626e1f7834c34d` | 0644 | root:root | TG CLI | PASS |
| `/usr/libexec/zapret2-manager/dns-product.uc` | `032d94d589bde7cd67ed35f3255d3212f48280ccdac4d25ed544f77c85df6c89` | yes | `032d94d589bde7cd67ed35f3255d3212f48280ccdac4d25ed544f77c85df6c89` | 0644 | root:root | DNS model | PASS |
| `/usr/libexec/zapret2-manager/dns-product-cli.uc` | `d02f459e492df8986e2d1c43404681e61c25965b2fd4ad8eb2e9e43c36af4094` | yes | `d02f459e492df8986e2d1c43404681e61c25965b2fd4ad8eb2e9e43c36af4094` | 0644 | root:root | DNS CLI | PASS |
| `/usr/libexec/zapret2-manager/dns.uc` | `7a1a76e010b96eb394b6bfd090cc78b0017d510f8163848f94a5aa239b41efac` | yes | `7a1a76e010b96eb394b6bfd090cc78b0017d510f8163848f94a5aa239b41efac` | 0644 | root:root | DNS writer | PASS |
| `/usr/libexec/zapret2-manager/providers/remittor.uc` | `3488385fd3d4c4e761a582229a134a79acbcd27460d660ba9ed3e88431674146` | yes | `3488385fd3d4c4e761a582229a134a79acbcd27460d660ba9ed3e88431674146` | 0644 | root:root | Engine runtime | PASS |
| `/usr/libexec/zapret2-manager/asset-registry.uc` | `aed3abffa444d433a5b8ec8e53942c0fbef558e0e213802761df47e9b64f35d5` | yes | `aed3abffa444d433a5b8ec8e53942c0fbef558e0e213802761df47e9b64f35d5` | 0644 | root:root | M6 assets | PASS |
| `/usr/libexec/zapret2-manager/scanner-probe-executor.uc` | `10ae04f281baf606da93e5b5ac3fad81f388b14e75df7089bdf5d4633b4537e9` | yes | `10ae04f281baf606da93e5b5ac3fad81f388b14e75df7089bdf5d4633b4537e9` | 0644 | root:root | M6 probe path | PASS |
| `/www/luci-static/resources/view/zapret2-manager/z2m-api.js` | `954784412c200028aaa2f356f88d65b69545f5564175b4e54db8faccd5df7f6b` | yes | `954784412c200028aaa2f356f88d65b69545f5564175b4e54db8faccd5df7f6b` | 0644 | root:root | LuCI API | PASS |
| `/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js` | `523b338f76becae06d0c119897aa005d9f3baf183cee8b19c4b738751ff4ec45` | yes | `523b338f76becae06d0c119897aa005d9f3baf183cee8b19c4b738751ff4ec45` | 0644 | root:root | TG UI | PASS |

## Local verification

Focused DNS/TG/UI/M6/Asset suite: `65 passed, 1 skipped, 0 failed`.
The skipped test is the repository's strategy compiler test. `node --check`
passed for changed JavaScript and `git diff --check` passed.

## Finishing run and remaining gates

- LuCI authentication: recovered through the normal `root` + empty-password
  login form. The router warns `No password set!`; this is a target security
  warning, not a login failure.
- Full Strategy suite: `FAIL/NOT COMPLETE`; tests invoke the pinned harness
  path `/opt/ucode/bin/ucode`, which is absent. The exact diagnostic is
  `null !== 0` with `UCODE_BIN=null`, `UCODE_LIBRARY_PATH=null`.
- Project ucode bootstrap: `NOT RUN`; `wsl` cannot create a distro instance and
  returns `Wsl/Service/CreateInstance/E_ACCESSDENIED`. Git Bash has no Linux
  compiler or CMake, and Docker has no running daemon.
- Target frontend deployment: `NOT RUN`; direct SSH to
  `192.168.1.1:22` is denied by the execution environment before
  authentication, so the backed-up pre-fix JS remains active on the router.
- `ROUTER_E2E`: existing DNS/TG/M6 backend canaries remain PASS from the prior
  deployment; the post-fix UI browser gate is not claimed.
