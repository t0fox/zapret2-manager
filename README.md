# zapret2-manager

A clean OpenWrt **feed** providing two packages that manage the upstream
**zapret2** DPI-bypass engine (bol-van/zapret2) through LuCI.

> **Management layer only.** This feed does not implement DPI bypass, strategy
> rotation, blockcheck, autohostlists, or firewall rules. All of that lives in
> upstream zapret2. This feed adds: an honest UI, three-level state reporting,
> service control with a paused flag, a watchdog, and (in later branches)
> transactions with rollback and DNS-by-domain. **Any line that duplicates an
> upstream function is a defect** — see [docs/upstream-mapping.md](docs/upstream-mapping.md).

## Target platform

| | |
|---|---|
| Device | Cudy WBR3000UAX v1 |
| OpenWrt | 25.12.5 |
| Arch | aarch64_cortex-a53 |
| Package manager | **APK** (not opkg / ipk) |
| IP stack | IPv4 only |
| NFQUEUE | 300 |

## Packages

- **zapret2-manager** — backend (ucode + ash). Depends on `zapret2`, `ucode`.
  Status collector, rpcd/ubus object, watchdog init script, paused-flag logic.
- **luci-app-zapret2-manager** — frontend (LuCI JS). Depends on `luci-base`,
  `zapret2-manager`. Menu entry: **Services → Zapret 2 Manager**.

## Branch stack

This repo is developed as a gstack branch stack. Each branch is one vertical
slice that leaves the router in a working state. Verify each on a live router
with `tools/smoke.sh` before stacking the next.

| Branch | Slice |
|---|---|
| `ui/00-repo-skeleton` | repo structure, docs, tools, license |
| `ui/01-package-skeleton` | two Makefiles, ACL, empty overview, postinst cache reset |
| `ui/02-status-json` | three-level status.json, NFQUEUE qlen, ubus `status` |
| `ui/03-overview-page` | read-only Overview page, divergence warning |
| `ui/04-service-control` | start/stop/restart, paused flag, no full-fw-restart |
| `ui/05-passthrough` | passthrough toggle (diagnostic) |
| `ui/06-watchdog` | init.d daemon, thresholds, events.ndjson |

Not in this stage: strategy editor, blockcheck2, DNS-by-domain, graph
monitoring, Telegram, tg-ws-proxy.

## Verification

Every branch is verified on a live router through `tools/smoke.sh`. Mock tests
are not proof. See [docs/architecture.md](docs/architecture.md) for the state
model and [docs/upstream-mapping.md](docs/upstream-mapping.md) for what
the manager reads versus controls.

## Attribution & license

This project is licensed under the **MIT License** (see [LICENSE](LICENSE)).

It builds on ideas from, and a code baseline of, prior work:

- **RevolutionTR/keenetic-zapret2-manager** — GPL-3.0. We adopted **ideas
  only**; no code was copied. Ideas are not copyrightable, and GPL does not
  propagate through ideas alone. Credited with thanks.
- **edwardgushchin/luci-app-zapret2** — MIT. Used as a **code baseline**;
  portions adapted under the terms of the MIT license, with attribution.

The zapret2 engine itself is **not** included or modified; it is a runtime
dependency installed separately from its own feed.
