# Task 9 report — semantic autocircular pool identity

## Scope and status

Task 9 is implemented on reviewed HEAD `5e3c451a` in the requested isolated
worktree. Scanner work, merge, push, router deployment and browser acceptance
were not touched or run.

## TDD evidence

RED was observed before production implementation:

```text
node --test tests/product/z2k-autocircular-pool-identity.test.mjs
1 failed, 0 passed, 4 skipped
AssertionError: identity module must exist
```

The failure was caused by the missing Task 9 identity module. After the module
and wiring were implemented, the same focused contract passed under the
bounded WSL UCode host.

## Implementation

- Added `z2k-autocircular-identity.uc` with the requested
  `z2k_pool_semantic_digest(pool)` and
  `z2k_learned_state_reconcile(oldIdentity,newIdentity,rows)` interfaces.
- The digest uses the current semantic pool contract (`key`, `runtimeKey`,
  `protocol`, `size`, ordered strategy arms), canonical object-key ordering,
  and SHA-256. Alias/display/volatile metadata is not included; strategy-arm
  order remains semantic.
- Added schema-1 Manager sidecar persistence at
  `/etc/zapret2-manager/state/autocircular/pool-identity.json` with atomic
  temporary write plus rename. Malformed identity fails closed.
- Added `strategies_autocircular_reconcile` to the existing Strategies owner.
  It preserves unchanged rows, resets only changed pool keys, performs the
  one-time legacy reset when no identity exists, skips aliases, and restores
  parsed prior rows if sidecar commit fails.
- Wired reconciliation into the existing Resource Center Core commit path
  after Detect finalization and before lifecycle closure; failure enters the
  existing rollback authority. No second updater, database, receipt, or TSV
  column was introduced.

## GREEN and verification evidence

Focused and relevant aggregate:

```text
node --test \
  tests/product/z2k-autocircular-pool-identity.test.mjs \
  tests/product/discord-voice-autocircular.test.mjs \
  tests/product/z2k-legacy-migration.test.mjs \
  tests/product/z2k-coherent-transaction.test.mjs \
  tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-post-mutation-check-state.test.mjs \
  tests/product/z2k-receipt-v3.test.mjs \
  tests/product/z2k-final-lifecycle-ownership.test.mjs
83 passed, 0 failed, 0 skipped, 0 TODO
```

The focused Task 9 + Discord command alone passed `22/22`, including same,
changed, legacy, malformed-sidecar fail-closed, clone-stability and wiring
cases.

Additional checks:

```text
node --check tests/product/z2k-autocircular-pool-identity.test.mjs — passed
UCode imports through the relevant suites — passed under /opt/ucode/bin/ucode with /opt/ucode/lib
node scripts/validate-knowledge.mjs — passed
node scripts/docs.mjs verify — passed (Quartz SHA ab346fa66a895e12d63a308e70ce330ba795822a)
git diff --cached --check — passed before implementation commit
git diff --check — passed
```

## Commits and boundaries

Implementation/test commit:

```text
cb65bc9d8bbd7bb07c33682cd6cd1cab1ce23884
feat: bind autocircular learning to pool identity
```

This report is committed separately so the implementation hash remains exact.
No router, browser, deploy, merge or push was run. Full project/Scanner parity
was not claimed; only the focused Task 9 and explicitly relevant lifecycle
gates above were run.

## Fix-round 1 — independent review closure

### RED

The review-contract tests were run before the fix-round implementation. The
new failure-injection and lifecycle-order assertions failed because the
production identity path was still caller-overridable, the Core path had no
prepare/commit boundary before Detect finalization, and the test transaction
seam did not yet exist. The pre-fix focused result was 5 passed and 6 failed;
the failures were intentional contract failures, not a claim against the
reviewed implementation.

### GREEN and implementation evidence

- The sidecar authority is now the fixed Manager-owned path
  `/etc/zapret2-manager/state/autocircular/pool-identity.json`; the
  `Z2M_AUTOCIRCULAR_IDENTITY_PATH` caller environment is ignored. The
  regression test proves that an attempted redirect does not change the
  authority.
- `strategies_autocircular_prepare()` is read-only and captures prior
  state/identity. `strategies_autocircular_commit()` checks both primary
  writes and every compensating state/identity result. A failed compensation
  returns `ERECOVERY_REQUIRED` and never reports success.
- `state_save_rows()` now checks directory creation and the existing atomic
  rename plus permission-update result; normalization also propagates a
  failed write instead of silently continuing.
- Core journals autocircular intent, commits the learned state and sidecar
  while the Detect backup remains open, then calls
  `z2k_detect_finalize()`. The canonical rollback coordinator now restores
  learned state/sidecar before closing the rollback result and includes the
  still-open Detect publication, so the injected post-sidecar failure test
  restores Registry, runtime, source, catalog, strategy, config, Detect, and
  learned state to the prior LKG.
- TSV wire semantics remain five columns; no second updater, database,
  receipt, or fake state was introduced.

Fix-round focused and Discord suite:

```text
node --test tests/product/z2k-autocircular-pool-identity.test.mjs tests/product/discord-voice-autocircular.test.mjs
28 passed, 0 failed, 0 skipped, 0 TODO
```

The focused fix-round contract includes same/changed/legacy/malformed cases,
fixed-authority regression, ordering proof, primary state-write failure,
post-state-write sidecar failure, compensation failure, and full LKG rollback
coverage.

Relevant bounded update/lifecycle/receipt/transaction/Detect/runtime-guard
suite:

```text
node --test tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-post-mutation-check-state.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-runtime-guard.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs
82 passed, 0 failed, 18 skipped, 0 TODO
```

Additional evidence:

```text
node --check tests/product/z2k-autocircular-pool-identity.test.mjs — passed
UCode direct imports of identity, Strategies, and Resource Center — passed
node scripts/validate-knowledge.mjs — passed
node scripts/docs.mjs verify — passed; Quartz SHA ab346fa66a895e12d63a308e70ce330ba795822a
git diff --check — passed
git diff --find-renames --stat — passed; only the four Task 9 implementation/test files were dirty before this report append
```

### Fix-round commit and boundaries

Fix-round implementation/test commit:

```text
375e79e5a4ca4d1d2c59aefc78b45bc165d3b2a4 fix: close autocircular rollback window
```

The report is committed separately as the following commit on this worktree;
its exact hash is returned with the final clean-HEAD evidence. No router,
browser, deploy, merge or push was run. Scanner work and unrelated user/runtime
data remain outside this scope.
