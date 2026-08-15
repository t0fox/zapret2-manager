---
id: full-avatar-ui-parity-evidence-2026-08-15
title: "Full Avatar UI parity closure evidence"
type: acceptance-evidence
status: implementation-accepted-with-explicit-backend-gaps
updated: 2026-08-15
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

## Verification

- `node --test tests/ui/*.test.mjs`: **35/35 PASS**
- `node --check` for changed LuCI modules: **PASS**
- `git diff --check`: **PASS**
- Target SSH: **PASS**, OpenWrt `aarch64`
- Target read-only canaries: DNS `ok:true`, `dnsmasq-uci`, dnsmasq running; TG `running`, Rust, `aarch64`, listener `1443`; M6 `route_list ok:true`, empty route set
- Target UI transfer: changed LuCI hashes verified on target

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
  provider. Go no longer inherits Rust `2.0.0-r1`; unavailable latest
  candidates show the exact preflight reason.

## Explicit gaps and non-claims

- TG historical version enumeration/selection and source selection remain
  backend gaps; the UI explains them and does not invent data or RPCs.
- WARP/usque setup and runtime remain `BACKEND_NOT_READY`; controls are
  disabled by design.
- The target `route_list` canary is bounded with `ubus -t 5`; the unbounded
  diagnostic invocation was stopped after it did not complete.
- Linux ucode full Strategy/cross-project regression remains `NOT_RUN`.
- No M7, failover, auto-remediation, or new backend feature was started.
