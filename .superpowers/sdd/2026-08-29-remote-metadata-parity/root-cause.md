---
id: sdd-2026-08-29-remote-metadata-parity-root-cause
title: "Remote metadata parity: root cause and correction"
type: evidence
status: complete
updated: 2026-08-29
publish: false
tags: [z2m, remote-metadata, lifecycle, evidence]
---

# Root cause and correction

## Observed failures

The release UI mixed two different authorities. A locally installed TG provider
was copied into the remote `versions[]` catalog, so the installed build could
look like the upstream latest release even when the remote catalog was missing.
The same boundary was unsafe in three other places: a fulfilled RPC response
with `ok: false` was accepted as data, an empty upstream array was rejected or
collapsed into unavailable, and the Components page fetched remote catalogs in
the first render.

The browser also exposed a consequence of removing the synthetic row: the
Telegram card dereferenced `latest.displayVersion` when a provider had no
compatible remote candidate.

## Corrections

- `proxy_provider_versions`, `tg_product_versions`, `engine_releases_read`, and
  `z2k_versions` keep local installation truth separate from remote rows.
- Valid `[]` responses are represented as `remoteState: empty`; transport,
  schema, and fulfilled-`ok:false` failures are represented as unavailable or
  an explicit error. Malformed non-empty release records remain metadata
  failures and preserve a last-known-good payload.
- Full release identity (`sourceId`, tag, release id, name, publication time,
  body, URL, artifact and digest) travels with every remote version row.
- Components now boots from local manager/engine/Z2K status and hydrates Engine
  and Z2K remote catalogs later, with two active metadata requests maximum.
- Telegram deferred reads are generation-guarded and start again on a cached
  page revisit; the empty-catalog card renders `Нет данных` instead of throwing.
- Stale metadata remains browseable but cannot authorize a mutation. Empty or
  unavailable metadata never fabricates a selectable installed release.

## Non-goals and boundary

This change does not build or install any APK and does not change provider
package formats. The existing Go runtime path remains APK-based because that is
the product's current OpenWrt package contract; the source-only router check
used the already-installed provider and only replaced manager JS/UCode files.
