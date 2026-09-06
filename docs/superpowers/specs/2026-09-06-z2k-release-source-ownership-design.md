---
id: z2k-release-source-ownership-design
title: "Z2K release families and Core-owned strategy source"
type: spec
status: approved
authority: user-approved-contract
updated: 2026-09-06
publish: false
tags: [z2k, lifecycle, strategy-source, rpc, regression]
---

# Z2K release families and Core-owned strategy source

## Context and observed failure

The current router is running the same regression as the source tree: the
release parser accepts only `r-*`, so the authoritative `p-82.14` release is
discarded and the first bounded legacy row (`r-82.7`) is reported as latest.
The strategy source refresh path also independently follows the Z2K branch
HEAD. These two authorities can therefore disagree about the release, source
commit, compiler inputs, catalog, and runtime assets. The UI then reports a
generic network/session message for backend failures and can leave Telegram
health in a pending state.

## Design decisions

1. `z2k-versions.uc` accepts both `r-<major>.<minor>` and
   `p-<major>.<minor>` families. Numeric fields, chronology, and the
   authoritative manifest/tag identity are carried in catalog rows. Latest is
   derived from the authoritative reconciled release, never from array index.
   A fresh manifest/tag disagreement is a typed fail-closed error.
2. Browse remains bounded and cache-first. Mutation-grade resolution remains
   commit-bound and fresh. The installed release is retained outside the
   window when necessary, with no false `latest` flag.
3. Z2K strategy source refresh is Core-owned. A direct
   `strategies_source_refresh("z2k")` RPC is rejected with `EMANAGED`; the
   Core lifecycle is the only path allowed to prepare, compile, validate,
   activate, and publish a Z2K source snapshot.
4. Z2K source snapshots and strategy entries carry one
   `z2kCompatibilityIdentity`, derived from the selected Core release,
   immutable source commit, compiler snapshot digest, and managed runtime
   contract. Strategy apply rejects a mismatched identity before mutation.
5. Core update candidates are coherent units: release metadata, source
   snapshot, compiler inputs, catalog, resource bundle, and activation receipt
   are prepared together. Existing Asset Registry, generation pointer,
   runtime activation, receipt, and rollback authorities remain canonical.
   There is no second updater or database.
6. Read-only RPCs always return bounded JSON-shaped success or typed error
   objects. LuCI renders the backend error and clears loading in every promise
   branch. Telegram checks settle success or failure; they cannot remain
   pending after timeout/error. Status-card separators are plain UTF-8 text,
   not mojibake.

## Data flow

`LuCI view/model -> z2m-api.js -> rpcd zapret2-manager -> canonical UCode
module -> bounded JSON`

Z2K Core owns:

`release manifest/tag -> immutable source snapshot -> official compiler ->
catalog generation -> Asset Registry/runtime activation -> strategy state`

The source catalog coordinator may still merge Avatar and user entries, but it
must consume the Core-owned Z2K snapshot and may not fetch or activate a Z2K
snapshot itself.

## Failure and rollback contract

- Invalid release family, stale identity, inconsistent manifest/tag, missing
  compiler input, missing dependency, or runtime mismatch returns a typed
  error and leaves the current/LKG activation untouched.
- A Core transaction writes a durable candidate journal before activation and
  uses the existing compensation path on publication, postflight, or process
  verification failure.
- Active canonical strategy selection and semantic pool identity survive
  disable/re-enable, service restart, and Core lifecycle operations.
- UI never translates a backend error into “LuCI or network unavailable”.

## Verification boundary

Automated RED/GREEN tests cover release families, authoritative ordering,
fresh inconsistency, managed refresh rejection, compatibility identity,
apply fail-closed behavior, RPC JSON shape, UI error settlement, and UTF-8
separator rendering. Router acceptance separately proves the exact Core
transaction, catalog membership, runtime/native gates, logs, and real LAN
traffic. No APK build is part of this task.
