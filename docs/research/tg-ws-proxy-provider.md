# ADR: TG WS Proxy provider selection (Phase F)

> Status: **decided** (2026-07-28). Scope of this ADR: pick the canonical
> third-party TG WS Proxy implementation the manager will *supervise*
> (read-only adapter first; trusted install/configure is a later slice).
> The manager never implements the proxy itself and never shells out from
> the browser.

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
2. This slice is **read-only**: capabilities + status only. No install, no
   start/stop, no config apply, no secret generation/rotation, no firewall
   mutation, no WAN probing.
3. The future install path must use a **signed/pinned** package (SHA-256 pinned
   asset, our APK signature). `apk add --allow-untrusted` is forbidden.
4. Future default exposure policy is **LAN-only**; a wildcard (`0.0.0.0`/`::`)
   listener is reported with an explicit "all local interfaces" warning and is
   **never** equated with WAN reachability (that depends on firewall input
   policy, which this slice does not scan).
5. Secret file mode must be `0600`; broader permissions produce a warning. The
   manager never returns secret content, previews, or derived values, and never
   chmods the file in this slice.
6. No browser-side shell: LuCI calls only the two ubus methods.
7. No SOCKS5 is claimed for the Rust provider anywhere
   (`socks5Supported:false` in capabilities).

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
   unverified until the future install slice runs it.
2. **Byte-reproducible build** — not proven (see table); the SHA-256 pin +
   APK signature is the integrity story for now.
3. **procd/UCI packaging layout** for the future manager-owned package
   (exact UCI schema, secret file generation flow) — designed in the install
   slice, not here.
4. **DC-IP currency** — the built-in DC2/DC4 defaults and the fetched
   `--default-domains` list are upstream-maintained data; the manager treats
   them as opaque provider behavior.
5. **License drift** — MIT confirmed at decision time via the repo license
   API; the future package slice re-checks `LICENSE` at the pinned commit
   before shipping a wrapper package.

## References

- Release metadata: `GET /repos/valnesfjord/tg-ws-proxy-rs/releases/tags/v1.6.5`
  (asset digests), fetched 2026-07-28.
- Tag pin: `GET /repos/valnesfjord/tg-ws-proxy-rs/git/refs/tags/v1.6.5`
  → `a14a97aee20a1da428eb7dbd5fbe23195eba0b9d`.
- License: `GET /repos/valnesfjord/tg-ws-proxy-rs` → `license.spdx_id = MIT`.
- CLI/feature inventory: `README.md` @ `v1.6.5` (flag table, router deployment,
  procd example, environment variables).
