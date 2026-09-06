# Task 7 report — coherent Core/Detect transaction

## Scope and ruling

Task 7 is implemented on top of Task 6 HEAD `354293cd`. The existing Asset
Registry, Task 5 Detect staging/publication authority, Task 6 V3 receipt
authority, runtime composition, strategy source, catalog and Apply owners remain
canonical. No second Registry, receipt, updater or database was introduced.

Changed production scope:

- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc`
- `tests/product/z2k-coherent-transaction.test.mjs`

Prepare remains staging-only. The commit path now gates Detect digest and active
strategy compatibility before publication, journals prior receipt/Registry
membership and revision/runtime composition/Detect/catalog/selection/config/
runtime-enable evidence, and restores those owners through the existing
rollback/recovery path. The worker rejects unknown job kinds and remains only a
progress mirror.

## TDD evidence

### RED

Before production changes:

```text
node --test tests/product/z2k-coherent-transaction.test.mjs
3 passed, 2 failed, 3 skipped
```

The failures were the expected missing prior-authority rollback evidence and
missing active-strategy candidate preflight. The three behavioral cases were
skipped on Windows because `/opt/ucode/bin/ucode` is unavailable; this was a
host precondition, not a passing implementation result.

### GREEN

The focused WSL UCode run passed all three required failure injections:

```text
timeout 120s node --test tests/product/z2k-coherent-transaction.test.mjs
6 passed, 0 failed, 0 skipped
```

Covered cases:

- Detect SHA failure before commit leaves active X and Registry/runtime
  mutation counters unchanged.
- Active Avatar strategy candidate preflight failure returns
  `ECOMPATIBILITY` before commit and leaves active X unchanged; the same
  production gate explicitly covers the User source branch.
- Post-materialize readiness failure restores the physical runtime identity X
  and closes rollback without claiming activation.

## Verification commands and results

Required Task 7 suites, each run separately under bounded WSL UCode:

```text
tests/product/z2k-coherent-transaction.test.mjs       6 passed, 0 failed
tests/product/z2k-update-transaction.test.mjs          9 passed, 0 failed
tests/product/z2k-post-mutation-check-state.test.mjs   5 passed, 0 failed
```

Supporting focused suites:

```text
tests/product/z2k-lifecycle-transaction.test.mjs      14 passed, 0 failed
tests/product/z2k-receipt-v3.test.mjs                  9 passed, 0 failed
tests/product/z2k-runtime-composition.test.mjs         26 passed, 1 failed, 1 TODO
```

The single runtime-composition failure is the previously recorded unrelated
static expectation for `target.runtimeBundleDigest = target.dependencyClosure`;
the TODO is the pre-existing Task 4 transaction slice. They were not changed or
reclassified by Task 7.

Additional gates passed:

- `node --check tests/product/z2k-coherent-transaction.test.mjs`
- UCode imports for `resource-update.uc`, `runtime-composition.uc` and
  `apply.uc`
- `git diff --check`

## Commits

- `46d29b00` — `feat: activate Z2K as one coherent transaction`
- report evidence commit: will be recorded by the commit that adds this file

## Unverified boundaries and concerns

No merge, push, router deployment, browser test, package-E2E test, live Detect
process acceptance, crash/reboot recovery test, or full baseline harness was
run. Existing baseline failures remain outside Task 7 scope. The Windows host
cannot execute UCode directly; behavioral evidence above comes from the
bounded WSL run. Final human/router acceptance remains required by the plan.
