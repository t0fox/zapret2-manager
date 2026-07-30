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

## What is implemented today (r36)

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
- **Adaptive engine (Orchestra v2)** (r36, READ-ONLY): Simple Mode with
  adaptive state hero, compact status cards (adaptive behavior, engine
  capabilities, observability, limitations), manager observation history,
  diagnostic log tail parsing, semantic AUTOHOSTLIST model with integer/
  boolean validation, dynamic upstream version detection (package + binary
  evidence, not hardcoded claims). Capability matrix and raw evidence
  collapsed under Technical details. Diagnostic draft capability exposed
  for DRAFT flow (preview → apply only). Tab renamed from "Orchestra" to
  "Adaptive engine". Backend contracts `orchestra_*` preserved.
- **Shared UI design system** (r36): z2m-ui.css + z2m-ui.js with styled
  primitives (hero cards, responsive grids, badges, key/value rows,
  collapsible Technical details, callouts, mono panels, empty states,
  action rows, responsive tables). Dark-theme compatible. No external
  assets/CDN. Applied across Blockcheck, Strategies, Service Catalog and
  Adaptive engine pages.
- **DNS Providers** (r30, READ-ONLY + bounded diagnostics): component and
  conflict detection, six provider profiles, bounded diagnostics with
  confidence; DoH endpoints are data, never activation. Deployed and
  live-smoked on target at r30.
- **TG WS Proxy** (r32, FUNCTIONAL, optional): the canonical tg-ws-proxy-rs
  v1.6.5 provider (MTProto-only; MIT; pinned asset + SHA-256) as a separate
  optional signed package with a gated procd service. The manager owns the
  configuration model (DRAFT/APPLIED/RUNTIME), validate/preview/apply with
  optimistic revision + snapshot + verified rollback, start/stop/restart
  with reread listener verification, autostart, CSPRNG secret rotation
  (secret.conf 0600, TG_SECRET env only — never argv), redacted logs,
  bounded health (local listener vs upstream TCP — never "Telegram works"),
  and a two-step guarded tg:// link reveal. Bind policy: explicit LAN IPv4
  or 127.x loopback; wildcard refused; no firewall rules in v1; lifecycle
  fully independent from zapret2. Install is NEVER an RPC — the package
  arrives only through the signed feed behind the live acceptance gate
  ([docs/acceptance.md](docs/acceptance.md) — "APPROVE TG PROXY INSTALL").
  Read-only capabilities/status remain for absent installs. See
  [docs/research/tg-ws-proxy-provider.md](docs/research/tg-ws-proxy-provider.md).

> Acceptance wording is precise: r19 @ 33e0133 remains the fully mutating
> production-accepted baseline ([docs/acceptance.md](docs/acceptance.md)).
> The r20+ slices above shipped through the full local gate suite plus
> target smoke; the read-only slices (Orchestra, DNS Providers) mutate
> nothing by design, so their target evidence is installation + live
> read-only calls, not mutating drills. The TG WS Proxy functional slice
> (r32) is implemented, packaged and locally gated; its live install +
> mutating acceptance awaits the explicit approval gate
> ([docs/acceptance.md](docs/acceptance.md) §TG-proxy) — until then the
> production router runs no tg-ws-proxy.

Not implemented yet: automatic rollback timer (pending a dedicated drill).
Per-service DNS mapping (service → provider → hostname → A/AAAA) is in a
separate DNS Cowork branch (not yet merged).

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
- **tg-ws-proxy-rs** — OPTIONAL proxy (pinned v1.6.5 static-musl binary,
  hash-verified at build time; arch `aarch64_cortex-a53` only). procd init
  with hard startup gates; config + CSPRNG secret under `/etc/tg-ws-proxy/`
  (both 0600). Supervised by zapret2-manager, never embedded; install only
  behind the acceptance gate.

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

- Canonical local runner: `tools/run-all-tests.sh` (563 green / 0 red at
  r32; crashes and no-TAP count as RED by design).
  r36 adds orchestration v2 tests (26) and job-kind isolation tests (10).
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
