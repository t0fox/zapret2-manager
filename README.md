# zapret2-manager

A clean OpenWrt **feed** providing two packages that manage the upstream
**zapret2** DPI-bypass engine (bol-van/zapret2) through LuCI.

> **Management layer only.** This feed does not implement DPI bypass, strategy
> rotation, blockcheck, autohostlists, or firewall rules. All of that lives in
> upstream zapret2. **Any line that duplicates an upstream function is a
> defect** — see [docs/upstream-mapping.md](docs/upstream-mapping.md).

> **Production-accepted baseline: r19 @ 33e0133.** Six acceptance phases are
> verified on the live target (trusted signed install without bypass, backup
> restore, strategy apply+rollback, DNS apply+rollback, blockcheck quick job,
> real reboot with autostart + watchdog observation). Detailed evidence:
> [docs/acceptance.md](docs/acceptance.md).

## What is implemented today (r31)

**Production-accepted with mutating drills (r19 @ 33e0133):**

- **Three-level state** (RUNTIME / APPLIED / DRAFT) with explicit drift.
- **Service control** with paused flag, passthrough, watchdog, events.
- **Strategies**: lossless applied-profile reader (`profiles_list`), draft
  profile CRUD with optimistic concurrency, safe apply pipeline
  (validate → preview → snapshot → native dry-run → sanctioned write →
  upstream restart → five-check verify → rollback), idempotency guard.
- **Jobs + Blockcheck**: generic job lifecycle (crash recovery, timeouts,
  cancellation, cleanup), upstream blockcheck2 wrapper with recommendations
  and provenance (standard/custom test sets).
- **Backups/Maintenance**: SHA-256-manifest scoped backups with
  preview/restore/delete, events, versions, redacted diagnostics export.
- **DNS**: validated domain→IPv4 overrides through one manager-owned
  addnhosts file with apply/rollback.
- **Lists**: ownership-aware user list editing (domainInclude/domainExclude).

**Later slices (r20–r31) — verified on target as noted per slice:**

- **Service Catalog** (r2x): validated versioned catalog (11 services),
  digest/staleness/overlap checks, ownership-safe domainInclude ledger,
  list/get/status/preview/apply with optimistic revision + file-hash gates,
  sanctioned writer, verification and rollback.
- **Service Health Matrix** (r2x): persistent jobs probing local/upstream
  DNS, TCP 443, TLS, HTTP with cancellation and structured result classes.
- **Orchestra adapter** (r2x, READ-ONLY): capabilities/status/events/history
  over the live nfqws2 argv and Lua bundle evidence; honestly unavailable
  history/events (autostate proven in-process only; no slm_preload_* APIs
  in pinned upstream).
- **DNS Providers** (r30, READ-ONLY + bounded diagnostics): component and
  conflict detection, six provider profiles, bounded diagnostics with
  confidence; DoH endpoints are data, never activation. Deployed and
  live-smoked on target at r30.
- **TG WS Proxy adapter** (r31, READ-ONLY): `proxy_capabilities` /
  `proxy_status` for the canonical tg-ws-proxy-rs v1.6.5 provider
  (MTProto-only; MIT; pinned asset + SHA-256). Honest `installed:false`
  when absent; package/binary/process/init/listener/config/secret/log/arch
  detection with structured warnings; secret values never returned; no
  mutation methods in this slice. See
  [docs/research/tg-ws-proxy-provider.md](docs/research/tg-ws-proxy-provider.md).

> Acceptance wording is precise: r19 @ 33e0133 remains the fully mutating
> production-accepted baseline ([docs/acceptance.md](docs/acceptance.md)).
> The r20+ slices above shipped through the full local gate suite plus
> target smoke; the read-only slices (Orchestra, DNS Providers, TG WS
> Proxy) mutate nothing by design, so their target evidence is
> installation + live read-only calls, not mutating drills.

Not implemented yet: TG WS Proxy **mutations** (trusted package install,
start/stop, config apply, secret rotation — future slice), Telegram
alerts, automatic rollback timer (pending a dedicated drill).

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
  Status collector, rpcd/ubus object, watchdog init script, paused-flag logic,
  profiles/jobs/backup/dns backends.
- **luci-app-zapret2-manager** — frontend (LuCI JS). Depends on `luci-base`,
  `zapret2-manager`. Menu entry: **Services → Zapret 2 Manager** (8 pages).

## Branch stack (history)

This repo was developed as a gstack branch stack. Each branch was one vertical
slice that left the router in a working state. Current work continues as
deadline-driven implementation runs on `main`.

| Branch | Slice |
|---|---|
| `ui/00-repo-skeleton` | repo structure, docs, tools, license |
| `ui/01-package-skeleton` | two Makefiles, ACL, empty overview, postinst cache reset |
| `ui/02-status-json` | three-level status.json, NFQUEUE qlen, ubus `status` |
| `ui/03-overview-page` | read-only Overview page, divergence warning |
| `ui/04-service-control` | start/stop/restart, paused flag, no full-fw-restart |
| `ui/05-passthrough` | passthrough toggle (diagnostic) |
| `ui/06-watchdog` | init.d daemon, thresholds, events.ndjson |

## Verification

- Canonical local runner: `tools/run-all-tests.sh` (509 green / 0 red at
  r31; crashes and no-TAP count as RED by design).
- Live acceptance: [docs/acceptance.md](docs/acceptance.md) — every mutating
  path verified on the router with rollback drills.
- Mock tests are not proof. See [docs/architecture.md](docs/architecture.md)
  for the state model and [docs/upstream-mapping.md](docs/upstream-mapping.md)
  for what the manager reads versus controls.

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
