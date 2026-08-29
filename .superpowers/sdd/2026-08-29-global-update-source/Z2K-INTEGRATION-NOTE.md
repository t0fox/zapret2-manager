---
id: global-update-source-z2k-integration-note
title: "Future Z2K Update Source Integration Note"
type: architecture
status: planned
authority: proposed
updated: 2026-08-29
publish: false
tags: [update-source, z2k, future-integration, selected-tag, immutable-manifest]
---

# Future Z2K integration boundary

This note is design-only. Phase A does not modify the Z2K lifecycle branch or
its implementation files.

## Adapter API

Z2K should call the shared coordinator with the same four operations:

- `update_source_browse({ sourceKey, origin, url, ttlSec, validate, normalize })`
  for ordinary catalog display; a stale valid catalog may be shown but is not
  an authority.
- `update_source_refresh(...)` for an explicit catalog refresh, retaining the
  last-known-good immutable catalog on failure.
- `update_source_fresh(...)` for selected-tag prepare/mutation authorization;
  stale catalog data must never be accepted here.
- `update_source_status(...)` to project bounded cache, attempt, success,
  origin, cooldown, and error diagnostics into the existing Z2K status model.

Suggested identity separation is a catalog source key, a selected-tag REST
source key, and an immutable manifest source key. Each key must include the
repository, architecture/bundle semantics, endpoint, selected tag, and pinned
commit where those fields affect identity. `github-rest`, `raw-content`, and
`release-download` remain separate origins.

## Exact selected-tag FRESH requirements

The future adapter must resolve the selected tag authoritatively before any
mutation token or operation is accepted:

1. Perform normally one lightweight GitHub REST tag lookup for the selected
   tag.
2. If the tag is annotated and the API requires dereferencing, allow at most
   two bounded REST calls for the tag/ref and annotated tag object.
3. Fetch the immutable `UPDATES.json` manifest by the resolved commit from
   the `raw-content` origin, validate its schema, commit/tag binding,
   provenance, complete managed membership, and required digests, then use
   that exact validated result for the operation.

The expected selected mutation budget is therefore one lightweight tag lookup
in the normal case, up to two REST requests for an annotated tag, plus one
immutable raw manifest request. No stale catalog fallback, retry loop, PAT, or
cross-origin cooldown inference is permitted.

## Warm and stale behavior

Warm catalog browsing must perform zero network requests. A stale catalog may
be returned for browsing with `stale=true` and its last-success timestamp, but
it can never authorize selected-tag mutation. `FRESH` failure is explicit and
fail-closed even when a prior catalog exists.

## Future files to adapt

After the lifecycle branch is complete, the expected adapter work is limited
to the existing Z2K surfaces:

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- the corresponding Z2K lifecycle/product tests
- only the existing Z2K Components projections in
  `z2m-components-model.js` and `z2m-maintenance.js` if their source/status
  fields need wiring

No second Z2K database, updater, receipt authority, or artifact trust path
should be created.
