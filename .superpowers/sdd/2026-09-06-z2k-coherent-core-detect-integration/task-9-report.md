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
