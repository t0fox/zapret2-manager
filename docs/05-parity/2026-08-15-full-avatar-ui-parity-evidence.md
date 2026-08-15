---
id: full-avatar-ui-parity-evidence-2026-08-15
title: "Full Avatar UI parity closure evidence"
type: parity
status: current
authority: evidence
updated: 2026-08-15
publish: false
tags: [parity, evidence, avatar]
base_head: cbe93f47e53b55dd674bbde4355670b52862e8f1
avatar_target_head: 60bc16a5ddc5f43d97d414b99920c3d13da3151a
---

# Acceptance evidence

Implementation was performed only in the isolated worktree
`G:\\zapret2-manager\\.codex-avatar-parity` from the frozen Z2M base. The
dirty primary checkout was not modified.

## Commits

| Commit | Scope |
|---|---|
| `28345c4973c16e387855e157b6f09050b744b84e` | Inventory, manifest, DNS zero-loss inventory, navigation contract |
| `29067746` | Avatar-derived horizontal navigation model and shell |
| `69c79e6f` | M6 unified routing lifecycle UI over existing RPCs |
| `3e597106` | Truthful TG latest-only availability UI |
| `351d1147` | M6 route-module precedence correction |
| `7f049bbe` | Provider-scoped TG version projection |
| `8c671fbe` | Typed Asset Registry route pages and WARP disabled UI |
| `9ad41966` | Reachable nested WARP parent route |
| working tree | TG source/version contract, APK trust modes, ACL and target deployment |

## Verification

- `node --test tests/ui/*.test.mjs`: **35/35 PASS** before the final TG contract run
- `node --test tests/product/tg-*.test.mjs tests/ui/tg-version-contract.test.mjs tests/ui/proxy-canonical-status.test.mjs tests/ui/frontend-module-closure.test.mjs`: **23/23 PASS**
- `node --check` for changed LuCI modules: **PASS**
- `git diff --check`: **PASS**
- Target SSH: **PASS**, OpenWrt `aarch64`
- Target read-only canaries: DNS `ok:true`, `dnsmasq-uci`, dnsmasq running; TG `running`, Rust, `aarch64`, listener `1443`; M6 `route_list ok:true`, empty route set
- Target UI/backend transfer: **21/21 exact SHA256 matches**, all files `0644`, `root:root`; final provider implementation hash `deb19f12c338055a2cb0a18df826586fd8b432176066138d1a4822827066b4e5`
- Target ucode compile: **PASS**; selected Go check `installable=true` with upstream PEM key; selected Rust `2.2.4` check `installable=true` with explicit `sha256-only` mode and exact APK digest
- Target package preflight: `apk --allow-untrusted add --simulate` for the exact Rust `2.2.4-r1` APK: **PASS**; no package was installed or switched during acceptance.

## Browser acceptance

The deployed build was opened in a fresh target browser tab after cache
refresh.

- Horizontal IA: six Z2M groups, no donor left navigation, no duplicate legacy
  product tabs.
- DNS: `DNS-маршрутизация` renders the global mode/providers/cache/hijack,
  per-service and diagnostic controls; `dnsmasq-uci` is a status badge, not a
  loading state or error.
- M6: `Единая маршрутизация` renders route JSON, Create, Update, Reconcile,
  per-route lifecycle controls, and the delegated `service_dns` ownership
  message; target currently has zero routes.
- Asset Registry: `IP-наборы` renders the filtered canonical registry with
  real target rows and validation controls.
- WARP: `WARP / MASQUE` renders the complete disabled control surface; no
  unsupported RPC or fake runtime state is invoked.
- Telegram Proxy: Go and Rust cards show installed/package/latest values per
  provider; real version/source selectors are rendered. Browser selection of
  the Go OpenWrt APK feed persisted without refresh; console errors were `0`.
- Responsive browser gates retained: `1280px PASS`, `768px PASS`, `390px PASS`;
  no horizontal overflow or missing JS modules were observed in the accepted
  route pass.
- Official upstream APK handling is bounded to allowlisted release URLs and
  exact size/SHA256. Go uses the published `tg-ws-proxy.pem`; Rust 2.2.4 uses
  explicit `sha256-only` plus `apk --allow-untrusted` only after exact digest
  verification. No generic URL or arbitrary package RPC exists.

## Explicit gaps and non-claims

- WARP/usque setup and runtime remain `BACKEND_NOT_READY`; controls are
  disabled by design.
- The target `route_list` canary is bounded with `ubus -t 5`; the unbounded
  diagnostic invocation was stopped after it did not complete.
- Linux ucode full Strategy/cross-project regression remains `NOT_RUN`.
- No M7, failover, auto-remediation, or new backend feature was started.
