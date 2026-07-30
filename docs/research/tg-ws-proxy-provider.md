# ADR: TG WS Proxy provider selection (Phase F)

> Status: **decided** (2026-07-28), **implemented** (2026-07-28, r32).
> Scope of this ADR: pick the canonical third-party TG WS Proxy
> implementation the manager *supervises* (read-only adapter first, then
> the functional package/configuration slice). The manager never implements
> the proxy itself and never shells out from the browser.
>
> **Update (r32):** the functional slice is implemented. The packaging
> layout (previously "remaining unknown #3") is now decided (§Constraints
> + §Packaging below); the secret mechanism is the environment variable
> path (§Secret mechanism) — argv carries NO secret, so the `/proc` argv
> exposure concern is closed with the env-var residual documented. Live
> install + mutating acceptance remains behind the explicit gate
> (docs/acceptance.md §TG-proxy).

## Decision

**Canonical v1 provider: `valnesfjord/tg-ws-proxy-rs`, release `v1.6.5`.**

| Field | Value | Source |
|---|---|---|
| Project | `valnesfjord/tg-ws-proxy-rs` — "Telegram MTProto WebSocket Bridge Proxy", a Rust port of Flowseal/tg-ws-proxy | GitHub repo API |
| Upstream URL | https://github.com/valnesfjord/tg-ws-proxy-rs | — |
| License | **MIT** (SPDX `MIT`, GitHub license API field) | repo API `license.spdx_id` |
| Pinned release | `v1.6.5` (published 2026-07-23T15:16:57Z, not a draft/prerelease) | releases API |
| Pinned source commit | `a14a97aee20a1da428eb7dbd5fbe23195eba0b9d` (`refs/tags/v1.6.5`, lightweight tag → commit) | git refs API |
| Pinned asset | `tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz` (1 929 556 bytes) | release assets API |
| Asset SHA-256 | `54803f09f9b4a83b27e7d6fa2dd7bbeb51df04d6365f29b5746086d2830dc45a` | release asset `digest` field (sha256), re-verified 2026-07-28 |
| Target ABI | `aarch64-unknown-linux-musl` (fully static musl binary) — matches the target (`aarch64_cortex-a53`, OpenWrt 25.12.5, musl) | asset name + README |
| Build reproducibility | GitHub-Actions-built release assets; upstream documents reproducible local builds (`cargo zigbuild --release --target aarch64-unknown-linux-musl` / gcc-aarch64-linux-gnu cross). Binary reproducibility (byte-identical rebuild) is **not proven** — the SHA-256 pin is the trust anchor, not a reproducible-build proof. | README §cross-compilation |
| Package plan | Later slice: manager-owned OpenWrt package (`tg-ws-proxy-rs`) wrapping the pinned static binary + procd init + UCI config, signed by our APK key, installed only with an explicit operator action. This slice ships **no** installer. | — |

## Protocol reality: MTProto-only

The selected Rust implementation is an **MTProto bridge only**:

- The CLI has **no `--mode` flag and no SOCKS5 listener mode** (full flag
  inventory reviewed at v1.6.5: `--port/--host/--link-ip/--secret/--dc-ip/
  --listen-faketls-domain/--cf-*/--mtproto-proxy/--outbound-proxy/--log-file/…`
  — no mode switch anywhere).
- `--secret` is optional (default: random per start). Its absence does **not**
  change the protocol — the binary still speaks MTProto to the client and
  WS/TLS upstream.

Therefore the adapter rule is:

```
provider == tg-ws-proxy-rs            →  mode = mtproto     (identity defines protocol)
provider unknown, no trusted evidence →  mode = unknown     (NEVER default socks5)
absence of --mode / --secret          →  NOT evidence of anything
```

Inferring `no --mode / no --secret ⇒ socks5` is explicitly forbidden: for this
provider that inference is false, and for an unknown provider it is a
fabrication.

## Provider features (v1.6.5 README, verbatim scope)

- Telegram MTProto TCP listener (default port **1443**, default host
  auto-detect: binds `0.0.0.0` when a LAN IP is detected, else `127.0.0.1`).
- WSS/TLS bridge to `kwsN.web.telegram.org` with per-DC SNI/IP routing.
- Inbound FakeTLS (`--listen-faketls-domain`, `ee` secrets).
- Multiple secrets (`--secret` repeatable / comma-separated).
- Per-DC IP mappings (`--dc-ip`, default DC2+DC4).
- Cloudflare-proxied domains (`--cf-domain`, `--default-domains`, `--cf-priority`,
  `--cf-balance`).
- Cloudflare Workers TCP-tunnel fallback (`--cf-worker-domain`).
- Upstream MTProto proxy fallback (`--mtproto-proxy`, 60s per-proxy cooldown).
- Direct TCP :443 fallback (last resort).
- Outbound proxy for upstream connections (`--outbound-proxy` http/socks5/socks5h —
  note: this is an *upstream* connector, NOT a SOCKS5 *server* mode).
- Bounded logging (`-q`, `-v`, `--log-file` — file logging without ANSI).

## Constraints adopted by the manager

1. The proxy is a **separate optional package**; the manager supervises, never
   embeds it. A missing install is a normal state (`installed:false`), not an
   error.
2. ~~This slice is read-only~~ **(r32)** The adapter is now functional:
   configuration, lifecycle, secret rotation and health via ubus
   (docs/contracts/ubus.md). Capabilities/status stay read-only.
3. The install path uses a **signed/pinned** package (SHA-256 pinned asset at
   build time, our APK signature). `apk add --allow-untrusted` is forbidden;
   the trusted-key install procedure is the only permitted one.
4. Default exposure policy is **LAN-only**: the listener binds the explicit
   LAN IPv4 (or a 127.x loopback for diagnostics); an empty/wildcard or
   non-local bind is REFUSED (no wildcard fallback). No firewall rules are
   installed in v1. A wildcard listener (foreign configs only) is reported
   with an explicit "all local interfaces" warning and is **never** equated
   with WAN reachability (that depends on firewall input policy, which the
   manager does not scan).
5. Secret file mode must be `0600`; broader permissions refuse startup. The
   manager never returns secret content, previews, or derived values; it
   generates/rotates the secret at `0600` and redacts secret-shaped tokens
   from anything it returns.
6. No browser-side shell: LuCI calls only ubus methods.
7. No SOCKS5 is claimed for the Rust provider anywhere
   (`socks5Supported:false` in capabilities).

## Packaging (decided at r32)

- OpenWrt package `tg-ws-proxy-rs` (`tg-ws-proxy-rs/Makefile`): pinned
  `PKG_SOURCE` + `PKG_HASH` (the download machinery IS the build-time SHA-256
  gate — a mismatch fails closed), `PKG_FLAGS:=nonshared` (never arch:all),
  `DEPENDS:=@TARGET_mediatek_filogic` (the only packaged+tested target;
  others are added only after real packaging+smoke). The same pinned asset is
  staged by the manual APK pipeline (`tools/build-apk-manual.sh`) with
  `sha256sum -c` before packaging — version and hash are read from the
  package Makefile (single pin source).
- Installed files: `/usr/bin/tg-ws-proxy` (0755), `/etc/init.d/tg-ws-proxy`
  (procd, hard startup gates), `/etc/tg-ws-proxy/config.conf` (stock,
  0600, inert: `ENABLED=0` + empty HOST), MIT LICENSE + attribution at
  `/usr/share/licenses/tg-ws-proxy-rs/LICENSE` (vendored from the pinned
  source commit — the asset carries no LICENSE). conffiles: config.conf +
  secret.conf (operator state survives upgrades). postinst is inert: NO
  enable, NO start — first run is an explicit operator action via the
  manager.
- procd service: bounded respawn (3600/5/5 — no infinite restart loop),
  stdout/stderr through procd/syslog, `reload` = full restart (no
  live-reload exists). Startup gates refuse on: missing binary/config/
  secret, `ENABLED != 1`, secret mode != 0600 or malformed, empty/wildcard/
  non-local HOST (127.x loopback allowed), invalid PORT, or a held port.
  Fully independent from `/etc/init.d/zapret2` (verified by static gates in
  both directions).

## Secret mechanism (decided at r32)

- The provider at v1.6.5 has an environment alias for **every** flag except
  `--dc-ip` (README §Usage). The MTProto secret therefore reaches the process
  ONLY via `TG_SECRET`; argv carries only `--dc-ip` pairs (IPs are not
  secret). **The `/proc/<pid>/cmdline` exposure concern is closed.**
  Residual, accepted and documented: the secret is visible to root via
  `/proc/<pid>/environ` — on OpenWrt everything privileged is root already;
  env-only still removes it from `ps` for all users.
- Generation: CSPRNG (`/dev/urandom` via od), exactly 32 lowercase hex chars
  (the provider-required format), written atomically to
  `/etc/tg-ws-proxy/secret.conf` at 0600 with readback verification.
  Rotation: same path + service restart only when running. The value is never
  returned by any RPC, never in state.json (state keeps only sanitized
  config), never in events/logs/diagnostics/backups.
- Upstream MTProto fallback entries (`host:port:secret`) are secret-bearing:
  they live only in the 0600 config.conf; state.json and every RPC response
  carry `{host, port, hasSecret}` meta; a `keepSecret` edit merges the
  current secret server-side (secrets never round-trip).
- The provider prints its startup `tg://` link (embedding the secret) into
  its log: `/var/log/tg-ws-proxy.log` is pre-created 0600 by init, and
  `proxy_logs_tail` redacts exact secrets, whole `tg://proxy` URLs, and any
  dd/ee/bare-32+-hex token before returning anything.

## Detection contract (used by proxy.uc / proxy-logic.mjs)

| Item | Value |
|---|---|
| Binary candidates | `/usr/bin/tg-ws-proxy`, `/usr/local/bin/tg-ws-proxy`, `/opt/bin/tg-ws-proxy` |
| Package candidates (APK) | `tg-ws-proxy-rs`, `tg-ws-proxy` |
| Process name | `tg-ws-proxy` (via `pidof`) |
| Init path | `/etc/init.d/tg-ws-proxy` (procd, per upstream README example) |
| Enabled evidence | `/etc/rc.d/S*tg-ws-proxy` symlink |
| Config path | `/etc/tg-ws-proxy/config.conf` |
| Secret path | `/etc/tg-ws-proxy/secret.conf` |
| Log path | `/var/log/tg-ws-proxy.log` |
| Listener probe | `netstat -tulpn` (constant args, parsed by PID/program name) |
| Version source | package metadata only — the binary is never executed for discovery |
| Default port | **1443** — provider knowledge, reported as a *default*, never as an active listener |

## Rejected alternatives

### A. `d0mhate/tg-ws-proxy` Go "unified" fork (v1.4.1)

- MIT; provides **both** SOCKS5 and MTProto modes in one binary.
- Larger Go binary; integration in the wild rides on an external manager
  script (shell installer managing config/systemd-style glue) rather than a
  package — a poor fit for our signed-APK + procd model.
- Dual-mode surface widens the audit and config-safety surface (two protocols,
  two secret models) for no v1 requirement: the manager's v1 goal is a
  Telegram MTProto bridge, not a general SOCKS5 server.
- **Not selected for canonical v1.** Revisit only if a SOCKS5 server
  requirement appears; it would then be a *separate* provider profile, never
  a silent mode inference.

### B. `spatiumstas/tg-ws-proxy` Go OpenWrt package (0.9.2)

- Ships APK/IPK artifacts and `aarch64_cortex-a53` assets — closest to our
  packaging model.
- Package/fork provenance, license posture, and build trust (who builds the
  published packages, from which exact source, with what supply chain) were
  **not sufficiently reviewed** at decision time.
- **Not selected for canonical v1** pending that trust review. Kept on record
  as the leading candidate for a native-package distribution experiment.

## Remaining unknowns (recorded, not guessed)

1. **On-target runtime behavior** of the Rust binary on `aarch64_cortex-a53`
   (memory footprint under load, FD limits with `--max-connections auto`) —
   verified only when the gated live acceptance runs it
   (docs/acceptance.md §TG-proxy).
2. **Byte-reproducible build** — not proven (see table); the SHA-256 pin +
   APK signature is the integrity story.
3. ~~procd/UCI packaging layout~~ — **decided at r32** (§Packaging above:
   manager-owned KEY=value config, no UCI; CSPRNG secret flow).
4. **DC-IP currency** — the built-in DC2/DC4 defaults and the fetched
   `--default-domains` list are upstream-maintained data; the manager treats
   them as opaque provider behavior.
5. **License drift** — MIT confirmed at decision time via the repo license
   API; the r32 package re-verified it by vendoring `LICENSE` verbatim from
   the pinned source commit `a14a97ae` into the package
   (`/usr/share/licenses/tg-ws-proxy-rs/LICENSE`).

## References

- Release metadata: `GET /repos/valnesfjord/tg-ws-proxy-rs/releases/tags/v1.6.5`
  (asset digests), fetched 2026-07-28.
- Tag pin: `GET /repos/valnesfjord/tg-ws-proxy-rs/git/refs/tags/v1.6.5`
  → `a14a97aee20a1da428eb7dbd5fbe23195eba0b9d`.
- License: `GET /repos/valnesfjord/tg-ws-proxy-rs` → `license.spdx_id = MIT`.
- CLI/feature inventory: `README.md` @ `v1.6.5` (flag table, router deployment,
  procd example, environment variables).
