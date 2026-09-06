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
- report evidence commit: `524ddca6` — `docs: record Task 7 transaction evidence`

## Unverified boundaries and concerns

No merge, push, router deployment, browser test, package-E2E test, live Detect
process acceptance, crash/reboot recovery test, or full baseline harness was
run. Existing baseline failures remain outside Task 7 scope. The Windows host
cannot execute UCode directly; behavioral evidence above comes from the
bounded WSL run. Final human/router acceptance remains required by the plan.

## Fix-round 1 — independent-review findings

Fix-round started from `93f9cf00` with the existing Task 7 changes retained.
The implementation and focused-test changes are committed as
`c4956c09` (`fix: close Task 7 transaction crash windows`).

Critical findings closed:

- Apply now consumes `target.priorActivation`, persisted during prepare; the
  apply path has no free-scope `priorStrategy` reference.
- Registry mutation intent and expected revision are durable in
  `REGISTRY_COMMITTING` before the Registry writer. Recovery handles this and
  the later `RUNTIME_ACTIVATING`, `SOURCE_ACTIVATING`, and source/catalog
  phases conservatively, preserving the marker until Registry/runtime/catalog/
  Detect/receipt evidence is coherent or compensation succeeds.
- Runtime activation intent is durable before physical activation, so a crash
  before `MATERIALIZED` is treated as physically activated and is rolled back
  against the captured prior runtime composition.

Important findings closed:

- Source/catalog rollback intent is journaled before source activation.
- Candidate strategy preflight uses the new Core snapshot catalog: the
  official canonical ID must be present, and Avatar/User selections must remain
  present and pass candidate closure/native readiness.
- Selection, compiled catalog identity/source inputs, config bytes/digest and
  runtime enable state are snapshotted fail-closed; null/failed snapshots do
  not proceed to mutation.
- Catalog rollback restores the captured generation/index identity and
  verifies it, rather than rebuilding an unrelated catalog.
- Focused regression seams now cover Detect SHA, active-strategy preflight,
  post-materialize readiness, Registry intent crash, runtime intent crash,
  ambiguous PREPARED recovery retention, and catalog identity mismatch.

### Fix-round TDD and bounded verification

RED was reproduced before the production implementation:

```text
node --test tests/product/z2k-coherent-transaction.test.mjs
3 passed, 4 failed, 5 skipped
```

The failures were the new missing crash-window/prior-snapshot contracts; the
Windows host skipped UCode behavioral cases because `/opt/ucode/bin/ucode` is
not available there.

GREEN focused result under WSL UCode:

```text
tests/product/z2k-coherent-transaction.test.mjs  14 passed, 0 failed, 0 skipped
```

The final Windows-host run is intentionally honest:

```text
tests/product/z2k-coherent-transaction.test.mjs  7 passed, 0 failed, 7 skipped
```

Supporting bounded WSL results:

```text
tests/product/z2k-update-transaction.test.mjs          9 passed, 0 failed
tests/product/z2k-post-mutation-check-state.test.mjs   5 passed, 0 failed
tests/product/z2k-lifecycle-transaction.test.mjs      14 passed, 0 failed
tests/product/z2k-receipt-v3.test.mjs                  9 passed, 0 failed
tests/product/z2k-detect-artifact.test.mjs             20 passed, 0 failed
tests/product/z2k-runtime-composition.test.mjs         26 passed, 1 failed, 1 TODO
```

The runtime-composition failure remains the known unrelated static mismatch
for `target.runtimeBundleDigest = target.dependencyClosure`; the TODO remains
the pre-existing Task 4 transaction slice. No unrelated test or Scanner work
was changed.

Additional checks:

- `node --check tests/product/z2k-coherent-transaction.test.mjs` passed.
- `git diff --check` passed before commit.
- WSL UCode `/opt/ucode/bin/ucode` with `/opt/ucode/lib` was available;
  `resource-update.uc`, `runtime-composition.uc`, and `apply.uc` imported
  successfully. The worker is an executable UCode script with a shebang, so a
  module-import check is not applicable.
- `node scripts/validate-knowledge.mjs` passed.
- `node scripts/docs.mjs verify` passed with Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- Knowledge tests: 29 passed, 4 failed because the checked-out public Quartz
  build artifact was absent; no public build was generated in this scoped fix.

### Fix-round boundaries

No router/browser/deployment/push/merge, live crash/reboot, live Detect process,
or full baseline harness was run. Public Quartz build output and its four
artifact-dependent leak tests remain unverified. Final report evidence commit
is the separate report commit following implementation `c4956c09`.
