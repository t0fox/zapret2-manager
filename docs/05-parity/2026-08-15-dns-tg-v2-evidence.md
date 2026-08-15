---
id: dns-tg-v2-evidence-2026-08-15
title: "DNS и Telegram Proxy v2: acceptance evidence"
type: parity-evidence
status: partial
updated: 2026-08-15
---

# Acceptance evidence

## Current canonical Go upstream addendum (2026-08-15)

The canonical Telegram Proxy Go source is now
`d0mhate/-tg-ws-proxy-Manager-go`; the previous
`spatiumstas/tg-ws-proxy-go` source is no longer allow-listed. The provider
consumes the official `v1.x` OpenWrt direct binary assets, verifies the
GitHub-release SHA-256, and installs the checked binary at
`/usr/bin/tg-ws-proxy`. On `root@192.168.1.1` (`aarch64_cortex-a53`), the
deployed code returned `v1.4.1`, asset
`tg-ws-proxy-openwrt-aarch64`, `artifactFormat=binary`, and
`installable=true`; the direct check downloaded and verified the 6,488,226-byte
asset successfully. The guarded manifest was independently verified `21/21`
with exact SHA-256, mode `0644`, and owner `root:root`.

The active runtime was not switched; this acceptance only changed and
validated provider discovery/preflight. Browser recheck remains `NOT RUN`
while the current browser tab is stopped at HTTP Basic Authentication.

`AVATAR_CURRENT_REF: avatarDD/zapret-gui@947e213bd66b9b8bc23ce564abcf59a4c8e8ce4c`

Документ фиксирует закрытый backend/target slice DNS v2 и Telegram Proxy v2.
Полный Avatar parity не объявляется: остальные Avatar-only строки остаются вне
этого slice. LuCI login был восстановлен в обычном browser flow, но финальный
Browser gate для DNS/TG product views закрыт после target deployment. Верхний
общий compatibility banner ранее показывал `недоступно` из-за browser ACL/RPC
пути; после финального ACL/UI deploy он подтверждён как `работает`.

## Final execution addendum (2026-08-15)

This addendum supersedes earlier pending/blocked statements below where they
conflict. The frozen product base was `2547bfec85b776588ab394591b01d888476e07fa`.
New failing browser evidence justified five narrowly scoped
DNS/TG-slice fixes: TG status now projects canonical listener/outbound health;
DNS uses `dns_product_get` for global scope when the legacy `dns.global.get` API
is absent; the app chip uses allowed canonical product status; LuCI gets
read-only `engine_status` ACL access for the engine gate; and the DNS form
collapses at the 768px tablet boundary.
No backend milestone beyond DNS/TG/M6 was started.

Final target deployment used the guarded manifest in
`scripts/deploy-dns-tg-v2-target-2547bfec.sh`; it contains 17 entries and was
verified independently as `17/17` SHA256 matches, `0644`, `root:root`.

Target readback: `DNS_OK=true`, `DNSMASQ=true`, `TG_OK=true`, `TG_READY=true`,
`TG_RUNNING=true`, selected provider `rust`. DNS, TG and M6 target canaries had
already passed and cleanup/restore was verified before the final UI-only deploy.

Browser acceptance against the deployed manifest:

- DNS and Telegram Proxy rendered at 1280, 768 and clean 390px navigations.
- No horizontal overflow: tablet document width was `753` for a `768px`
  viewport; mobile document width was `375` for a `390px` viewport.
- The shared status chip read `работает`; DNS showed active `dnsmasq-uci`
  without the engine-gate blocker, and Telegram Proxy showed Rust `2.0.0`.
- Stable authenticated capture: console warnings/errors `0`, HTTP/network bad
  responses `0`, loading failures `0`.
- Safe DNS primary control `Проверить DNS` completed with `DNS отвечает` and no
  backend error. TG stop/restart/install/reveal actions were intentionally not
  exercised because they mutate runtime or expose secret-bearing UI.

The current target is therefore the frozen `2547bfec` backend/runtime plus the
five evidence-driven DNS/TG-slice fixes committed in `52759f97`. Canonical
`origin/main` was verified at `ace945a7` as an ancestor and the integrated
result was pushed without force; the final remote head is recorded below.

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
| `BROWSER_DESKTOP` | `PASS` — clean 1280px DNS/TG render; no horizontal overflow |
| `BROWSER_TABLET` | `PASS` — clean 768px DNS/TG render; document width 753px, no overflow |
| `BROWSER_MOBILE` | `PASS` — clean 390px DNS/TG render; document width 375px, no overflow |
| `BROWSER_CONSOLE_ERRORS` | `0` in the stable post-deploy capture; transient aborted navigation requests were excluded from acceptance |
| `NETWORK_404` | `0` in the stable post-deploy capture; bad responses and loading failures were `0` |
| `DEAD_PRIMARY_CONTROLS` | `PARTIAL` — DNS `Проверить DNS` passed; TG destructive/reveal actions intentionally not exercised |

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
focused regression test is green. A second browser-only projection defect was
then found: listener/outbound fields were read from legacy proxy status instead
of canonical `tg_product_status`. `canonicalProjection()` now maps the
listener collection and health route into the shared UI model.

`DNS_UI_GLOBAL_SCOPE_ROOT_CAUSE`: the DNS view called the absent legacy
`ctx.api.dns.global.get()` during load, so all canonical DNS RPCs succeeded but
the view never rendered. `globalRead()` now reuses the already requested
`dns_product_get` response as the fallback global scope; the focused regression
test covers this contract.

`APP_STATUS_CHIP_ROOT_CAUSE`: the shared app header depended on a legacy status
call that timed out in the browser batch. The canonical DNS/TG product status
calls are ACL-allowed and now derive the shared `работает`/`остановлена` chip;
legacy status remains the fallback.

`ENGINE_GATE_ACL_ROOT_CAUSE`: `z2m-engine-gate` called
`zapret2-manager-engine.engine_status`, but the LuCI ACL had no read entry for
that object. The ACL now grants only `engine_status` read access; no engine
write permission was added.

`DNS_TABLET_OVERFLOW_ROOT_CAUSE`: the DNS form kept fixed `215px 288px 240px`
columns at a 768px viewport. The responsive collapse breakpoint is now 800px,
and the final browser sweep measured no overflow.

## Real router acceptance

Target: `root@192.168.1.1`, OpenWrt aarch64.

- Engine: `engine_providers` and `engine_status` succeed after registration and parser compatibility fixes.
- Telegram provider: catalog, status and preflight succeed; Rust is active/running, config is preserved, drift is false, and health checks pass.
- Go availability: canonical `check_updates` returned `latestPackageVersion: 0.9.3-r2`, `providerSwitch: true`, `installable: false`; no switch or install was attempted.
- DNS canary: pure preview reported `zeroWrites: true` and the requested add diff; validate passed; apply verified process/port/entry; reread contained the entry; canonical rollback restored empty overrides and `registered: false`.
- M6 canary: route preview and validate were pure; apply/status/remove/reconcile passed; the first conflicting profile correctly returned `EDOMAINCONFLICT` and the prior Service DNS selection was restored. The successful canary ended with no route and no temporary asset.

## Historical target manifest snapshot

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

The table above is retained as the earlier backend-registration snapshot. The
final guarded manifest supersedes it and contains 17 entries. Final hashes
that changed after browser evidence were:

| PATH | FINAL REPO/TARGET SHA256 | MODE | OWNER |
|---|---|---|---|
| `/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json` | `82ccec74642e776f46bca4d87bd5d132063567f3162f5824b8cfe3bc66166fc8` | 0644 | root:root |
| `/www/luci-static/resources/view/zapret2-manager/app.js` | `2e310dc03560759eb1186c07074e2f2a33f5788998e386da4061f7d85b16e0c2` | 0644 | root:root |
| `/www/luci-static/resources/view/zapret2-manager/z2m-dns.js` | `ad4b8486e94ef3c7fe9e55d71c0ee457966b56d7bb9d8ef561b917130772dee4` | 0644 | root:root |
| `/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js` | `2444c9c23a8ed634155410624ea06bb1499b3ca63b1b8e5924e97856552883e9` | 0644 | root:root |
| `/www/luci-static/resources/view/zapret2-manager/z2m-ui.css` | `38577b7af5d3e8ea9c09dc6c876ae550d8b75366bc85f1e570f362abc081dac6` | 0644 | root:root |

Independent final target verification: `17/17` entries matched the manifest,
all were regular `0644` files owned by `root:root`.

## Local verification

Focused DNS/TG/UI/M6/Asset suite after commit: `43 passed, 0 skipped,
0 failed`. The separate UI surface group was `22/22`, TG v2 was `8/8`,
Service DNS/M6 routing was `9/9`, and the new focused regression contract was
`5/5`. `node --check` passed for all `57` LuCI JavaScript files and
`git diff --check` passed.

## Finishing run and remaining gates

- LuCI authentication: recovered through the normal `root` + empty-password
  login form. The router warns `No password set!`; this is a target security
  warning, not a login failure.
- `UCODE_RUNTIME: NOT_AVAILABLE`; the pinned harness path
  `/opt/ucode/bin/ucode` is absent. The exact diagnostic is `null !== 0` with
  `UCODE_BIN=null`, `UCODE_LIBRARY_PATH=null`.
- `STRATEGY_FULL_SUITE: NOT_RUN`; no Strategy PASS is claimed from this host.
- Project ucode bootstrap: `NOT RUN`; `wsl` cannot create a distro instance and
  returns `Wsl/Service/CreateInstance/E_ACCESSDENIED`. Git Bash has no Linux
  compiler or CMake, and Docker has no running daemon.
- Target frontend deployment: `PASS`; the guarded script deployed the final
  17-entry manifest, reloaded rpcd, and independent verification returned
  `17/17` hash/mode/owner matches.
- `ROUTER_E2E`: DNS/TG/M6 backend canaries PASS; post-deploy DNS/TG Browser
  product views PASS. Full Strategy/ucode runtime remains `NOT RUN`.

## Final candidate checkpoint

The canonical remote was reachable in the final execution environment. The
candidate is a clean linear DNS/TG v2 stack from `CANONICAL_BASE` through the
focused acceptance commits; no replay branch or force push was used.

| Field | Result |
|---|---|
| `CANONICAL_BASE` | `ace945a756aea596a85c7f83fa74d771cca172b6` — verified `origin/main` before push |
| `FEATURE_HEAD` | `2547bfec85b776588ab394591b01d888476e07fa` |
| `FEATURE_STACK_CLEAN` | `PASS` — 9 commits after base, all DNS/TG, test-evidence, or docs-evidence scope |
| `INTEGRATION_METHOD` | Existing clean linear stack; no replay or merge |
| `INTEGRATION_HEAD` | `2547bfec85b776588ab394591b01d888476e07fa` |
| `TARGET_DEPLOY_MANIFEST` | [`scripts/deploy-dns-tg-v2-target-2547bfec.sh`](../../scripts/deploy-dns-tg-v2-target-2547bfec.sh) |
| `TARGET_BUILD_SHA` | `2547bfec85b776588ab394591b01d888476e07fa` |
| `FINAL_DNS_TG_HEAD` | `52759f97` — focused DNS/TG acceptance commit |
| `PUSHED_MAIN_HEAD` | `e0f43b0f59e780e689e1489ea23addcb38428143` — verified after the main push |
| `DNS_TG_V2_STATUS` | `COMPLETE` |
| `NEXT_MILESTONE` | `FULL AVATAR UI PARITY CLOSURE` |
| `CURRENT_BROWSER_BUILD_MATCH` | `PASS` — router matches the final 17-entry deployment manifest; the manifest includes the five evidence-driven committed DNS/TG-slice fixes |

The bounded deployment script contains 17 changed runtime/frontend files,
their SHA256 values, `0644 root:root` installation, backup-before-write, a
post-copy hash check, and an `rpcd reload`. It is guarded by
`CONFIRM_TARGET_DEPLOY=YES` and was executed; the target backup remains at
`/tmp/z2m-dns-tg-v2-2547bfec/backup`.

## Fresh execution-acceptance regression

These counts were collected again after restoring the preserved candidate;
they are not carried forward from the earlier local gate.

| Group | Result | Classification |
|---|---|---|
| DNS/TG/M6/UI | `43 passed, 0 skipped, 0 failed` | PASS |
| UI | `22/22` | PASS |
| TG v2 | `8/8` | PASS |
| Service DNS | `9/9` | PASS |
| M6 | `9/9` | PASS |
| JavaScript syntax | `57 files, 0 errors` | PASS |
| M2 Profiles | `46 passed, 2 failed` (`48` total) | Infrastructure: missing `/opt/ucode/bin/ucode` |
| M5 BlockCheck family | `1 passed, 11 failed` (`12` total) | Infrastructure: missing `/opt/ucode/bin/ucode` |
| Scanner product | `32 passed, 109 failed` (`141` total) | Infrastructure: missing `/opt/ucode/bin/ucode` |
| RPC/ACL mixed regression | `24 passed, 18 failed` (`42` total) | Infrastructure failures in legacy ucode-backed groups; DNS/TG/M6 RPC/ACL groups pass |
| Strategy full suite | `NOT_RUN` | Linux ucode runtime is unavailable; no Strategy PASS is claimed |
| Native/root | `NOT RUN` | host gate reports `native tests require Linux` |
| Docs freshness / diff check | `PASS / PASS` | PASS after mapped product-doc update |

No test or test harness was modified to bypass the missing runtime.

## Current execution blockers

`TARGET_DEPLOY: PASS`: legitimate SSH access was available in the final
execution environment. The final manifest was deployed and independently
verified; DNS/TG/M6 target evidence and the post-deploy Browser product-view
gate are recorded in the addendum above. Remaining separate limitation is the
missing Linux ucode runtime (`UCODE_RUNTIME: NOT_AVAILABLE`,
`STRATEGY_FULL_SUITE: NOT_RUN`). Canonical GitHub/main verification and push
completed without force; the final remote SHA is reported in the handoff.
