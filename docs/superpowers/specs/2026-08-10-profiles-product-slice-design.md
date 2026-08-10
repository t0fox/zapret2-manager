# Profiles Product Slice Design

**Date:** 2026-08-10  
**Base:** `83f27241adb93ffac709249554fa4ffd5e6c6938`  
**Branch:** `m5-native-state-store`

## 1. Current State

The repository already contains the production backend for a lossless Profiles
workflow:

- `profiles.uc` parses the applied `NFQWS2_OPT` without interpreting the opaque
  `--lua-desync` grammar.
- `profiles-draft.uc` provides draft CRUD, stable IDs and per-profile optimistic
  revisions.
- `profiles-apply.uc` composes ordered fragments with ` --new `, proves a
  lossless round trip, performs pinned native preflight, previews hashes, uses a
  whole-config CAS, restarts through upstream Zapret2, verifies runtime and
  rolls back on failure.
- Existing `profiles_*` RPC methods expose these operations.

The current unified Strategy page does not expose this coherent workflow. Its
main strategy consumer is Orchestra, which is a separate recommendation and
testing subsystem.

The opaque validated nfqws2 fragment is the compatibility representation for
this first Profiles slice. It is not the final canonical Strategy domain model.

## 2. First User Flow

The current unified Strategy page gains a focused Profiles pane:

1. List actual applied profiles and ordered drafts.
2. Create, edit, clone, delete or import a draft.
3. Validate each draft as exactly one opaque nfqws2 profile fragment.
4. Reorder drafts explicitly.
5. Preview the complete resulting `NFQWS2_OPT`, native validation result and
   current/candidate hashes.
6. Show that Apply replaces the full applied profile set.
7. Confirm Apply.
8. Apply exactly once through the existing transaction, then verify runtime.
9. Reread Profiles and schema-3 status and show success or rollback failure.

Applying one draft independently or merging it into the applied set is not part
of this slice.

## 3. Sources of Truth

| Datum | Source of truth | Ownership |
|---|---|---|
| Draft profiles and explicit order | `/etc/zapret2-manager/state.json` `profiles` section | Existing manager-owned compatibility feature document |
| Applied profiles | `NFQWS2_OPT` in `/opt/zapret2/config` | Upstream Zapret2 configuration, changed only through `apply.uc` |
| Runtime state and profile count | Process, nftables and NFQUEUE observations | Derived, read-only |
| Apply snapshots and idempotency | Existing files under `/tmp/zapret2-manager` | Volatile transaction artifacts/cache |
| Strategy recommendations | Existing Orchestra/scanner subsystem | Separate and unchanged |

The draft path is verified from current HEAD through `PATHS.draft_state` and
`profiles-draft.uc`. This slice preserves it; it does not endorse the shared
legacy document as the final architecture and does not migrate it. Profile
configuration is not stored in M5 `manager-state.json`.

## 4. Data Flow

```text
profiles_list
  -> applied lossless parse + ordered draft list

draft mutation under state lock
  -> structural validation
  -> stable ID/revision or explicit reorder conflict

ordered drafts
  -> one shared compiler (`pipeline_front`)
  -> exact ` --new ` composition
  -> round-trip proof
  -> pinned native preflight
  -> candidate + diff/hash preview

confirmed apply
  -> rerun the same compiler under the config transaction
  -> config hash CAS
  -> sanctioned apply.uc write
  -> upstream restart
  -> schema-3 status recollection
  -> process/rules/NFQUEUE owner verification
  -> success or exact rollback
```

Preview is read-only. Preview and Apply use the same compiler; the UI does not
compile fragments.

## 5. API

The existing direct RPC envelopes and methods remain authoritative:

- `profiles_list`
- `profiles_create`
- `profiles_update`
- `profiles_clone`
- `profiles_delete`
- `profiles_validate`
- `profiles_import_applied`
- `profiles_apply` with `mode: "preview" | "apply"`

One narrow operation is added: `profiles_reorder(edit)`. Its request is
`{ "ids": ["p000002", "p000001"], "revisions": { "p000001": 1,
"p000002": 3 } }`: a complete ordered ID list and expected revision for every
profile. The backend compares both the complete ID set and every expected
revision while holding the existing state lock. It rejects incomplete,
duplicate, unknown or stale sets and never silently repairs input.

No strategy catalog RPC is added. The first slice does not claim that opaque
profile fragments form a canonical strategy catalog.

## 6. Storage and Concurrency

Draft operations continue under the existing state lock and preserve every
currently co-owned section of `state.json`. Updates retain per-profile expected
revision checks. Reorder receives explicit stale-write protection so two
clients cannot silently overwrite draft order.

Apply retains the config lock, whole-file SHA-256 CAS, idempotency guard,
last-good snapshot, exact-byte restoration and runtime rollback verification.
Rollback snapshots remain volatile for this slice.

No second apply engine, lock framework, state store or repository-wide migration
is introduced.

## 7. Validation and Errors

Validation occurs before live mutation and rejects:

- malformed profile input or IDs;
- empty or multiline fragments;
- fragments that parse as zero or multiple profiles;
- structural/native diagnostics;
- duplicate, missing or unknown reorder IDs;
- stale profile/order mutations;
- incomplete native preflight;
- config CAS conflicts.

Existing bounded errors remain in use: `EINPUT`, `ESTATE`, `ECONFLICT`,
`ETARGET`, `ELOCK`, `EPREFLIGHT` and `EINTERNAL`. Failed apply never marks the
draft set applied. Runtime failure reports rollback outcome; rollback failure is
an explicit critical manual-recovery condition.

## 8. Test Plan

Characterization first freezes:

- lossless parser and wire shape;
- applied/draft list envelope;
- existing RPC names and direct responses;
- current full-set compiler output;
- shared preview/apply pipeline;
- schema-3 profile count and observation behavior.

TDD then covers:

- CRUD validity, stable IDs, clone/delete/import and stale revisions;
- explicit ordering, A/B versus B/A, and every invalid/stale reorder case;
- deterministic one/many composition and exact `--new` boundaries;
- special-character escaping, empty/multiline/multiple-profile rejection;
- preview non-mutation and candidate parity with Apply;
- successful apply, validation-before-write, config conflict, runtime failure,
  exact rollback and failed-rollback reporting;
- status profile count, unchanged schema 3 and zero native-state writes;
- exact RPC contracts, safe file transport and the current unified LuCI flow;
- focused Profile/Strategy tests, affected apply/rollback/status tests,
  `scripts/test/native.sh` and the broader repository gate.

## 9. Out of Scope

- canonical Strategy schema, catalog or generator;
- Orchestra, scanner, blockcheck or auto-strategy integration;
- persistent rollback across reboot;
- Task 11 or Task 12 and repository-wide storage migration;
- DNS, Telegram or WARP/routing changes;
- large LuCI redesign or a new design system;
- a new generic state, plugin, provider or orchestration framework.

These boundaries leave a complete production Profiles flow while preserving a
future dedicated Strategy subsystem.
