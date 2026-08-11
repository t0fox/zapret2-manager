# Task 10 Report

## Status

Implemented transactional Avatar Strategy Apply and identity reconciliation on
branch `m5-native-state-store`.

## Implementation

- Added `strategy_apply(input, context)` and `reconcile` dispatch in
  `strategy-cli.uc`.
- Apply accepts only persisted `strategy_id`, `revision`, and
  `catalog_digest`; inline Strategy data and client candidate/command/args
  fields are rejected before compilation or mutation.
- Apply resolves the persisted Strategy on the server, compiles it through the
  existing Strategy compiler, requires non-empty enabled Profiles, complete
  dependencies, complete native preflight, a server candidate digest, and the
  current upstream config hash.
- Strategy Apply delegates the Replace Full Set to
  `profiles_apply_candidate`; no second config writer or Apply engine was
  added.
- Added an internal projection sidecar only to carry the narrow identity
  projection across the existing profile transaction process boundary.
- The projection commits selected identity only after restart and five-check
  runtime verification. Identity commit retries once while the config lock is
  still held. Identity or rollback restoration failures record volatile
  old/new hashes, identities, reason, and runtime outcome under
  `/tmp/zapret2-manager/last-good/` and return `EUNCERTAIN`.
- Normal Apply is blocked while uncertainty exists. Explicit reconciliation
  requires verified runtime plus exact old/new config and identity evidence;
  it either confirms the old state or commits the verified new selection.
- Existing Profile callers retain their transaction path, ordering, CAS,
  restart, verification, rollback, and idempotency behavior. Strategy Apply
  bypasses only the Profile idempotency shortcut so its identity projection is
  never skipped.

## Tests

Created `tests/product/avatar-strategy-apply.test.mjs` covering authoritative
input, stale and inline rejection, client-composed input rejection, full-set
delegation, admission gates, digest/config CAS, identity commit ordering,
retry/rollback/uncertain behavior, reconciliation, Apply blocking, and no
direct config writes.

## Verification

- RED run observed failures for the missing Apply/state hooks before production
  implementation.
- Focused Apply/Profile/model/compiler/state/Preview run: 99 tests passed.
- `git diff --check`: passed.
- Transaction boundary manually inspected in `apply_candidate_pipeline`: the
  existing snapshot, CAS, upstream restart, recollection, runtime verification,
  exact restore, restart, and rollback verification remain the only config
  transaction path.

## Concerns

- End-to-end Apply against a live router was not available in this workspace;
  native restart and runtime failure injection remain covered by the existing
  transaction tests and source-order assertions.
- The identity projection crosses the existing `profiles-apply-cli.uc` process
  boundary through a private candidate-digest-keyed sidecar because that
  adapter was intentionally left unchanged by Task 10 scope.
