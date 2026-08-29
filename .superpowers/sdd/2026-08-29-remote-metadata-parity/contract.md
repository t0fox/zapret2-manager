---
id: sdd-2026-08-29-remote-metadata-parity-contract
title: "Remote metadata parity contract"
type: evidence
status: complete
updated: 2026-08-29
publish: false
tags: [z2m, remote-metadata, contract, evidence]
---

# Contract

## Authorities

| Field | Authority | Rule |
| --- | --- | --- |
| installed version, package, runtime health | local runtime and registry | Always shown independently of remote metadata |
| selectable remote versions | validated upstream catalog | Every row carries its own release identity |
| latest remote version | validated compatible candidates | `null` when the catalog is empty or unavailable |
| changelog | selected row's release identity | Empty body is different from missing row |
| mutation eligibility | fresh checked snapshot and token | Browse or stale data never authorizes mutation |

## Remote state matrix

| State | Browse UI | Latest/selector | Mutation |
| --- | --- | --- | --- |
| `not-loaded` | local bootstrap only | no remote latest | blocked |
| `fresh` | show catalog | show compatible latest | allowed only after fresh check |
| `stale` | show LKG with warning | show for browsing | blocked until fresh check |
| `empty` | show explicit empty state | `null`, no synthetic row | blocked |
| `unavailable` | preserve local truth and show error | `null`, no synthetic row | blocked |

`REMOTE_EMPTY` requires a schema-valid array with zero compatible candidates.
Malformed non-empty records, transport failures, HTTP failures, and fulfilled
RPC envelopes with `ok: false` do not qualify as empty.

## Performance and lifecycle

- Components local bootstrap does not wait for Engine releases or the Z2K
  catalog; remote enrichment is deferred.
- Deferred metadata is generation-guarded and capped at two active requests.
- Telegram browse is cache-first. Explicit refresh is bounded per provider;
  mutation uses a fresh check and a snapshot-bound token.
- A cached revisit creates a new page generation and must rehydrate deferred
  metadata exactly once for that generation.
- Last-known-good metadata may be used for browsing but never for a mutation
  precheck.
