# Task 10 Report

## Status

Implemented transactional Avatar Strategy Apply, authoritative identity
reconciliation, and conservative pending-guard recovery on branch
`m5-native-state-store`.

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
  still held. A verified rollback after identity commit failure returns
  `EVERIFY` with `rolledBack: true`; failed or unverifiable rollback/identity
  restoration records volatile old/new config and candidate hashes, catalog
  digest, identities, reason, and bounded runtime outcome under
  `/tmp/zapret2-manager/last-good/` and returns `EUNCERTAIN`.
- Normal Apply is blocked while uncertainty or a pending guard exists. Explicit
  reconciliation ignores caller context and recollects authoritative config,
  candidate, runtime, and persisted Strategy selection evidence under the state
  lock. It confirms old state only with the exact old identity, commits new
  identity only from the exact persisted old Strategy identity, treats an exact
  persisted new identity as already committed, and rejects null/ordinary or
  mismatched selection hash collisions.
- Pending guards persist the exact pre-Apply config/candidate hashes, catalog
  digest, and active selection. A live lease is never stolen or cleared. A dead
  pending guard remains blocked until explicit reconciliation proves the exact
  old config, candidate, catalog, selection, and verified runtime; unknown or
  mismatched outcomes remain blocked.
- Existing Profile callers retain their transaction path, ordering, CAS,
  restart, verification, rollback, and idempotency behavior. Strategy Apply
  bypasses only the Profile idempotency shortcut so its identity projection is
  never skipped.

## Tests

Created `tests/product/avatar-strategy-apply.test.mjs` covering authoritative
input, stale and inline rejection, client-composed input rejection, full-set
delegation, admission gates, digest/config CAS, identity commit ordering,
sidecar process-boundary binding, executable success/failure/restart/rollback
transactions through `profiles_apply_candidate`, identity retry/failure,
uncertainty persistence failure, revision races, authoritative reconciliation,
ordinary output/hash collision rejection, dead/live pending guards, Apply
blocking, and no direct config writes. The production-default-disabled
`Z2M_STRATEGY_APPLY_HOOK` provides deterministic transaction/state stubs for
these tests without adding a router dependency.

## Verification

- Round 1 RED run observed failures for the missing Apply/state hooks before
  production implementation; Round 2 RED run covered selection collisions,
  pending-owner recovery, and executable transaction outcomes before the
  corresponding fixes.
- Focused Apply/Profile/model/compiler/state/Preview run: 113 tests passed.
- `git diff --check`: passed.
- Transaction boundary manually inspected in `apply_candidate_pipeline`: the
  existing snapshot, CAS, upstream restart, recollection, runtime verification,
  exact restore, restart, and rollback verification remain the only config
  transaction path.

## Concerns

- End-to-end Apply against a live router was not available in this workspace;
  native restart/runtime behavior is covered by the deterministic transaction
  hook and existing Profile transaction tests, while live-router behavior still
  requires device validation.
- The identity projection crosses the existing `profiles-apply-cli.uc` process
  boundary through a private request-nonce-bound sidecar because that
  adapter was intentionally left unchanged by Task 10 scope.

## Post-Implementation Fix Evidence

- Projection sidecars now carry an explicit marker, transaction nonce, caller
  context, selected identity, candidate digest, and previous candidate digest.
  The profile transaction consumes the sidecar only when every binding matches;
  ordinary Profile callers still take the no-projection path. Sidecars are
  created with collision-resistant names, `0600` permissions, and are removed
  after consumption or rejection.
- Apply now establishes a durable guard and lease before preflight/config
  mutation. The guard requires the last-good directory to be a real `0700`
  directory, blocks on active or stale uncertainty, and fails closed when the
  block/lease/uncertainty records cannot be persisted. The lease binds the
  expected Strategy revision and selection revision and rejects concurrent
  user updates until the transaction ends.
- Revalidation runs under the Apply lease immediately before the Replace Full
  Set. Identity commit and exact restoration use the same lease; a successful
  rollback is reported as rollback, while failed or unverifiable restoration
  records volatile uncertainty and leaves normal Apply blocked.
- Reconciliation now obtains config, candidate, identity, and runtime evidence
  from authoritative server-side reads. The CLI ignores caller hashes,
  identities, runtime claims, and request context; the state reconciler accepts
  only the internal authoritative evidence marker, rereads catalog/selection
  state under its lock, and requires exact verified old/new evidence.
- `tests/product/avatar-strategy-apply.test.mjs` now exercises the process
  boundary, stale/concurrent sidecars, guard failures, live lease conflicts,
  identity CAS retry/failure, authoritative reconciliation, bounded runtime
  evidence, rollback classification, and volatile uncertainty persistence.

## Verification Update

- Focused Apply/Profile/model/compiler/state/Preview suite: 113 passed.
- Native core state/atomic suites: 52 passed.
- Native atomic-write-json property suite: 10 passed when run as WSL root, as
  required by its production filesystem tests; the non-root invocation failed
  only its explicit root precondition.
- `git diff --check`: passed after the final implementation changes.

## Round 3 Fix Evidence

- A null `oldSelected` is now an authoritative first-Apply baseline. Dead
  pending guards can reconcile to `{ reconciled: 'pending-old', selected: null }`
  only after exact old config/candidate/catalog evidence and verified runtime
  checks; mismatched outcomes remain blocked.
- Reconciliation now runs its server-side evidence collection inside the
  configured config lock and invokes the state reconciler before releasing that
  lock. The state lock is acquired for the persisted selection read and commit,
  so ordinary config and selection mutations cannot race the evidence-to-commit
  boundary. Caller context and caller evidence remain ignored.
- If a verified Apply succeeds but guard release fails, the CLI persists a
  bounded uncertainty record containing old/new config hashes, old/new
  candidate hashes, catalog digest, identities, and verified runtime checks.
  Explicit reconciliation can confirm either old or new state and clear the
  block; persistence failure remains fail-closed.
- The deterministic Apply hook now supports candidate injection, transaction
  outcomes, state outcomes, and the real request/process-boundary adapter. New
  executable tests call `strategy_apply`, traverse `profiles-apply-cli.uc` and
  the nonce-bound sidecar, and cover success, restart/rollback failure,
  guard-release recovery, null old selection, and evidence lock serialization.

## Round 3 Verification

- Apply behavioral suite: 24 passed.
- Focused Apply/Profile/model/compiler/state/Preview suite: 113 passed.
- Native core state/atomic suites: 42 passed.
- Native atomic-write-json property suite: 10 passed as WSL root.

## Round 4 Fix Evidence

- Removed the `processBoundary` shortcut from the production Apply path.
  Strategy Apply now enters `locked_candidate_call`, writes the real request
  and nonce-bound projection sidecar, invokes the configured
  `profiles-apply-cli.uc` adapter, and consumes the sidecar only in that
  Strategy-bound child process.
- No-projection adapter calls explicitly unset all Strategy projection
  environment variables before launching `profiles-apply-cli.uc`. Ordinary
  Profile/Orchestra transactions therefore cannot inherit or consume a
  Strategy sidecar; the external sidecar remains untouched.
- Round 4 tests execute Strategy success/failure through the real adapter path
  with deterministic transaction outcomes and verify ordinary no-projection
  isolation. The direct boundary tests remain as additional binding coverage.

## Round 4 Verification

- Apply behavioral suite: 25 passed.
- Focused Apply/Profile/model/compiler/state/Preview suite: 113 passed.
- Complete `scripts/test/native.sh` gate passed: native broker 42, native
  helper 35, package helper 35, combined native/product batch 274, and the
  root-policy batch 120; all reported zero failures.
- Native atomic-write-json property suite: 10 passed as WSL root.
