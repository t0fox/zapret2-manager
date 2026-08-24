# TG Proxy Feed-Authoritative Provider Lifecycle (Variant 1) — Design

Date: 2026-08-24
Status: approved (variant 1 selected by product owner)
Scope: Workstream B of the TG fully-managed lifecycle task.
Non-goals: Engine producer/install flow, engine-operation-worker,
patches/engine, canonical Engine release pipeline (separate workstream).

## 1. Product contract

Both providers (`tg-ws-proxy-rs`, `tg-ws-proxy-go`) are installed ONLY as
signed Z2M provider APKs from the Z2M provider feed. There is no
direct-release binary-copy path and no bootstrap fallback after migration.

Supply chains:

```
Rust: upstream release artifact (pinned version + SHA256)
      -> Z2M package builder (tg-ws-proxy-rs Makefile, PKG_HASH pinned)
      -> signed tg-ws-proxy-rs APK in Z2M provider feed
Go:   upstream source (pinned commit + real PKG_MIRROR_HASH)
      -> reproducible SDK build (tg-ws-proxy-go Makefile)
      -> signed tg-ws-proxy-go APK in Z2M provider feed
```

Runtime authority is the Z2M provider feed/package manifest. GitHub upstream
metadata may be used for discovery/update/build input only — never as the
runtime install authority on the router.

## 2. Provider feed contract

A provider feed release publishes:

- `tg-ws-proxy-rs_<version>_<arch>.apk`, `tg-ws-proxy-go_<version>_<arch>.apk`
- `SHA256SUMS` covering all artifacts
- `provider-feed-manifest.json` (schema `zapret2.provider-feed.v1`):

```
{
  schema: "zapret2.provider-feed.v1",
  feedCommit / releaseTag,
  providers: {
    "tg-ws-proxy-rs": { versions: [ { version, packageVersion, architecture,
        artifactFilename, artifactSha256, artifactSize, downloadUrl,
        sourceRepository, sourceRef, installMode: "apk-package",
        compatibility: "supported" } ] },
    "tg-ws-proxy-go": { ... same shape ... }
  }
}
```

Producer ↔ consumer contract test: the SAME fixture validates the manifest
writer output and the ucode consumer parser. Neither side may drift alone.

## 3. Unified runtime transaction (both providers identical)

```
candidate -> checkToken -> resolve from feed manifest -> verify digest ->
apk add <pkg>=<pkgVersion> -> owner-surface verification ->
config/secret guarantee -> enable -> start -> hard local health gate ->
state commit -> cleanup.
```

- `installMode` becomes `apk-package` for BOTH providers;
  `install_direct_candidate` is deleted together with its dead-end
  `ETG_SERVICE_OWNER_MISSING` path (clean routers must be first-class).
- Browser keeps passing only `{ provider, checkToken }`; the feed resolves
  everything else. Arbitrary URLs are never accepted from the client.
- Failure at any step => fail-closed rollback via existing
  `restore_previous()` machinery; no false Installed/Running, no stale lock,
  no orphan process, no partial state.

## 4. Config/secret ownership (single answer)

The provider APK owns `/usr/bin/tg-ws-proxy`, `/etc/init.d/tg-ws-proxy`,
and ships a default `/etc/tg-ws-proxy/config.conf` (conffile). The manager
transaction guarantees secret/state files exist with correct permissions
BEFORE start (manager-owned surface), and preserves user config across
switch/update/remove-preserve paths via the existing snapshot machinery.

Post-install mandatory surface on a clean router:
binary (executable) + init script + config.conf + secret/state +
working service lifecycle actions.

## 5. Hard post-install health gate (local only)

Implemented in `proxy-provider.uc` (TG lifecycle domain; NOT health-run.sh /
Service Health Matrix). Gate steps, all hard:

1. expected provider package installed (`apk info -e`);
2. `/usr/bin/tg-ws-proxy` exists and executable;
3. `/etc/init.d/tg-ws-proxy` exists;
4. config exists;
5. secret exists with correct permissions;
6. service enabled per requested state;
7. exactly one `tg-ws-proxy` process;
8. process owns the TCP listener (netstat -tulpn evidence);
9. listener sits on expected HOST:PORT (bounded local TCP probe allowed);
10. backend reread matches committed provider/version.

External Telegram/WAN reachability is NEVER an install gate. It is reported
separately as network health: healthy/degraded/unavailable.

## 6. Go supply chain fix

`PKG_MIRROR_HASH:=skip` is not a pin. The real mirror hash for the pinned
upstream commit must be computed (SDK `make package/tg-ws-proxy-go/download`
reports the computed hash on mismatch) and committed. A producer-side gate
fails any release where a provider Makefile carries `PKG_MIRROR_HASH:=skip`.

Until that lands, the Go producer is NOT release-ready — enforced by CI.

## 7. Testing strategy

TDD throughout. Behavioral sandbox tests execute the REAL `proxy-provider.uc`
transaction code under ucode with stubbed `run()` boundaries
(package manager, network, filesystem, service). Required coverage:

- clean install Rust / Go (owner surface created by APK, no preinstall)
- update Rust / Go (config preserved)
- switch Rust->Go / Go->Rust (one active provider at all times)
- failed install / failed health / failed switch -> full rollback
- SHA mismatch, wrong arch, corrupt manifest rows rejected
- remove cleanup; reboot persistence modeled via enabled-state assertions
- one active process/provider; no duplicate nft ownership

CI gates: provider-feed manifest contract, provider Makefile pinning gate
(no `skip` hashes), sandbox transaction suite. CI does not replace the
real-router acceptance below.

## 8. Real-router acceptance

Target: root@192.168.1.1 (OpenWrt 25.12.5, aarch64, manager present,
providers absent — verified by read-only SSH probe). Acceptance drives ONLY
the canonical ubus/UI path: install Rust, reboot, switch Go, reboot,
switch back, remove; asserting the §5 gate items plus absence of stale nft
rules and orphan processes at every stage.

## 9. LuCI cross-check (Workstream A interplay)

Telegram operations stay bounded async (existing jobs model); long installs
must never hold the LuCI RPC synchronously. After B changes, all v1 pages are
re-driven in the browser (see Workstream A acceptance list).
