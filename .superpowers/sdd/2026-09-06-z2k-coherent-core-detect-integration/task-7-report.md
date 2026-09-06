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

## Fix-round 2 — re-review Important findings

Fix-round 2 started from `39efac3b` with the existing implementation and
fix-round 1 evidence preserved. The implementation/test commit is
`686a9166` (`fix: bind Task 7 apply to active strategy state`).

### Findings closed

- `runtime_strategy_preflight` now rejects unknown, missing, and malformed
  `sourceId` values with `ECOMPATIBILITY`. Official Z2K, Avatar, and User
  selections must each be present in the candidate catalog and pass candidate
  closure/native readiness evidence. The focused UCode cases cover both
  rejection and valid paths.
- The persisted Z2K plan token now includes a bounded digest of the prior
  selected strategy identity, selection revision, compiled catalog identity and
  source inputs, config SHA, and runtime-enable presence/value. Apply reads a
  fresh fail-closed active snapshot and compares it to the prepared snapshot
  before consuming the prepared target or performing mutation.
- Pending activation carries the prior activation snapshot plus the
  transaction-owned source snapshot and candidate catalog identity. A durable
  `CATALOG_ACTIVATED` phase is written before receipt finalization, including
  the crash window after catalog publication. Rollback uses an active-state
  guard: it restores only prior or transaction-owned source/catalog state and
  refuses to overwrite a newer user strategy/config/enabled state, preserving
  `ERECOVERY_REQUIRED` evidence instead.

### Fix-round TDD

Before the production changes, the bounded WSL/UCode focused test reproduced
the defects:

```text
tests/product/z2k-coherent-transaction.test.mjs  14 passed, 3 failed, 0 skipped
```

The three failures were the unknown/missing-source preflight bypass, the
recognized-source closure bypass, and the absent prepare-state guard seam.
The Windows host run remains a host-precondition check only because
`/opt/ucode/bin/ucode` is unavailable there.

After implementation, the focused GREEN run was:

```text
tests/product/z2k-coherent-transaction.test.mjs  18 passed, 0 failed, 0 skipped
```

It covers unknown, missing, and malformed source IDs; valid official/Avatar/
User candidate paths; selection/catalog/config/enabled stale changes with zero
mutation count; token rebinding; and rollback refusal when a newer user config
is observed.

### Bounded verification

Under WSL UCode (`/opt/ucode/bin/ucode`, `/opt/ucode/lib`):

```text
tests/product/z2k-coherent-transaction.test.mjs  18 passed, 0 failed
tests/product/z2k-update-transaction.test.mjs      9 passed, 0 failed
tests/product/z2k-post-mutation-check-state.test.mjs  5 passed, 0 failed
tests/product/z2k-lifecycle-transaction.test.mjs  14 passed, 0 failed
tests/product/z2k-receipt-v3.test.mjs               9 passed, 0 failed
tests/product/z2k-detect-artifact.test.mjs         20 passed, 0 failed
tests/product/z2k-runtime-composition.test.mjs     26 passed, 1 failed, 1 TODO
```

The runtime-composition failure is the previously recorded unrelated static
expectation for `target.runtimeBundleDigest = target.dependencyClosure`; the
TODO remains the pre-existing Task 4 transaction slice. No unrelated Scanner
work was changed.

Additional checks passed:

- `node --check tests/product/z2k-coherent-transaction.test.mjs`.
- `git diff --check` before implementation commit.
- UCode imports for `resource-update.uc`, `runtime-composition.uc`, and
  `apply.uc`; the worker remains an executable shebang coordinator rather than
  an importable module.
- `node scripts/validate-knowledge.mjs`.
- `node scripts/docs.mjs verify`, Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.
- `node --test tests/knowledge/*.test.mjs`: 29 passed, 4 failed because the
  checked-out `.artifacts/docs-public` build is absent; no public build was
  generated in this scoped fix.

The final Windows-host focused run is intentionally not behavioral evidence:
`7 passed, 0 failed, 11 skipped`; the UCode cases are skipped because the
required `/opt/ucode/bin/ucode` binary is unavailable on the host. No
router/browser/deployment/push/merge, live crash/reboot, live Detect process,
or full baseline harness was run. Public Quartz artifact checks, router
acceptance, and end-to-end prepare/apply remain unverified.

## Fix-round 3 — provenance-bound strategy admission

Fix-round 3 started from `fb85c35a` after independent re-review identified
that the active strategy gate preserved only a flat canonical-ID list. The
implementation and production-shaped regression tests are committed as
`61fdc917` (`fix: bind strategy provenance in Task 7 preflight`). The sole
Asset Registry, Detect authority, V3 receipt authority, transaction journal,
and strategy-state authority remain unchanged; no second ownership mechanism
was introduced.

### Finding closed

`runtime_strategy_preflight` now requires a canonical `entries` or
`canonicalEntries` collection and binds the selected `id`/`canonicalStrategyId`
to one entry whose derived `origin`, `owner`, and strategy class agree with
the selected `sourceId`. It also validates the source-specific repository,
provenance kind, canonical namespace, and source snapshot identity for Avatar
and official Z2K. User entries retain their existing user semantics while
requiring the user provenance kind. Flat `ids`/`canonicalIds` alone no longer
authorize a selected strategy.

`resource-update.uc` now projects only verified provenance-bearing catalog
entries into the candidate catalog and retains their provenance identity. The
transaction precommit seam uses that projection and the same runtime gate,
so Avatar/User source swaps fail before Registry or runtime mutation.

### Fix-round TDD

The new bounded WSL/UCode focused run reproduced the defects before the
production changes:

```text
tests/product/z2k-coherent-transaction.test.mjs  20 tests, 17 passed, 3 failed
```

The RED failures were the old flat-list acceptance (`ok:true`), the missing
transaction provenance failure mode (`EINPUT`), and the expected mismatch
between the newly entry-shaped candidate fixture and the old gate. After the
implementation commit:

```text
tests/product/z2k-coherent-transaction.test.mjs  20 passed, 0 failed, 0 skipped
```

The passing behavioral cases cover both Avatar→User and User→Avatar
provenance mismatches, flat-list-only attribution, and zero Registry/runtime
mutation with active identity remaining `X`.

### Bounded verification

Under WSL Ubuntu UCode (`/opt/ucode/bin/ucode`, `/opt/ucode/lib`):

```text
tests/product/z2k-coherent-transaction.test.mjs  20 passed, 0 failed
tests/product/z2k-update-transaction.test.mjs      9 passed, 0 failed
tests/product/z2k-post-mutation-check-state.test.mjs  5 passed, 0 failed
tests/product/z2k-lifecycle-transaction.test.mjs  14 passed, 0 failed
tests/product/z2k-receipt-v3.test.mjs               9 passed, 0 failed
tests/product/z2k-detect-artifact.test.mjs         20 passed, 0 failed
tests/product/z2k-runtime-composition.test.mjs     26 passed, 1 failed, 1 TODO
```

The runtime-composition failure is the pre-existing unrelated static
expectation for `target.runtimeBundleDigest = target.dependencyClosure`; its
Task 4 TODO remains. A first Detect invocation exposed that this older test
harness does not forward `UCODE_LIBRARY_PATH` into its direct child UCode
calls; 13 loader-error failures (`libucode.so.0`) were corrected by rerunning
with explicit `LD_LIBRARY_PATH=/opt/ucode/lib`, after which Detect was 20/20.

Additional bounded checks passed:

- direct UCode imports for `resource-update.uc`, `runtime-composition.uc`, and
  `apply.uc`; `resource-update-worker.uc` remains an executable shebang
  coordinator rather than an importable module;
- `node --check tests/product/z2k-coherent-transaction.test.mjs`;
- `git diff --check`;
- `node scripts/validate-knowledge.mjs`;
- `node scripts/docs.mjs verify`, Quartz SHA
  `ab346fa66a895e12d63a308e70ce330ba795822a`.

The Windows-host focused run is not behavioral evidence:

```text
tests/product/z2k-coherent-transaction.test.mjs  7 passed, 0 failed, 13 skipped
```

The 13 UCode cases were skipped because `/opt/ucode/bin/ucode` is unavailable
on Windows. Knowledge tests remain a baseline boundary: `29 passed, 4 failed`
because the checked-out `.artifacts/docs-public` Quartz build is absent; no
public build was generated in this scoped fix.

### Fix-round boundaries and concerns

No router/browser/deployment/push/merge, live crash/reboot recovery, live
Detect-process acceptance, or full baseline harness was run. Scanner work and
unrelated baseline failures were preserved. Final router acceptance and
end-to-end prepare/apply behavior remain unverified.
