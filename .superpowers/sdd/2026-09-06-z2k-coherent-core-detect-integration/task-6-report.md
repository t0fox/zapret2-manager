# Task 6 report — coherent activation receipt V3

## Scope and ruling

The initial Task 6 receipt authority changes were limited to `asset-registry.uc`,
`z2k-installed-release.uc`, `runtime-composition.uc`, and the executable
`z2k-receipt-v3.test.mjs`. The SDD report is included as required evidence.
The Registry wire bundle ID remains `z2k-curated-lua`; no second Registry,
receipt authority, or database was introduced. V1/V2 remain readable and are
classified as `LEGACY_VERIFIED`; V3 is `COHERENT_VERIFIED`.

V3 verifies release/source/manifest/classification identity, exact lifecycle
membership, Detect identity and digest evidence, compiler/catalog/runtime
digests, compatibility identity, installed authority revision, and release /
source provenance. Extra or missing lifecycle assets and mismatches fail
closed.

## TDD evidence

RED (bounded WSL UCode):

```text
wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-receipt-v3.test.mjs'
5 tests, 2 passed, 3 failed, 0 skipped, 0 todo
```

The failures were the expected missing V3 acceptance, missing
`LEGACY_VERIFIED` classification, and missing V3 physical receipt contract.
The Windows host run had 5 skipped tests because `/opt/ucode/bin/ucode` is
not present on Windows; it was not used as RED evidence.

GREEN (bounded WSL UCode):

```text
timeout 90s node --test tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-runtime-summary.test.mjs tests/product/z2k-update-transaction.test.mjs
19 tests, 19 passed, 0 failed, 0 skipped, 0 todo
```

The receipt tests cover complete V3 identity, missing/different Detect,
extra/missing assets, source/release provenance mismatch, V1/V2 legacy state,
and preserved wire ID. The relevant native wrapper phase reported 42/42
passed. A first combined UCode import command had a shell quoting error; the
three imports were rerun separately and all reported `*-import-ok`.

## Verification gates

- `node --check tests/product/z2k-receipt-v3.test.mjs`: passed.
- UCode imports for all four modified `.uc` modules: passed.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `node scripts/docs.mjs verify`: Quartz SHA verified.
- `git diff --check`: passed.
- `git diff --find-renames --stat`: passed.

## Files and commit

Files changed:

- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `tests/product/z2k-receipt-v3.test.mjs`
- this report

Initial implementation commit: `7e0d4123` (`feat: record coherent Z2K activation receipts`).
The report was retained in the SDD workspace and is included with the fix-round
commit below.

## Pre-existing failures and boundaries

The broad baseline recorded in the SDD ledger already contained failures in
native package-helper/avatar/atomic-write/service-start/Lua-init tests and
product autocircular/avatar parity/apply/integration/preview/RPC/scanner
integration/planner tests, plus the WSL linked-worktree Git-pointer issue.
They were not fixed or reclassified by Task 6. No router deployment, browser
acceptance, package-E2E acceptance, or live Detect acceptance was run.

## Fix-round 1 — independent review corrections

### Findings addressed

1. `z2k_registry_receipt_state()` canonically returns `LEGACY_VERIFIED` for
   V1/V2, but Resource Center rollback/recovery consumers still required the
   old `confirmed` state. The V1 reconciliation, rollback revision calculation,
   finalized-pending recovery, and V3 rollback receipt comparison now consume
   `LEGACY_VERIFIED` / `COHERENT_VERIFIED` through one bounded helper. Installed
   release confidence remains `confirmed` for callers that use that separate
   confidence contract.
2. V3 validation no longer falls back to `z2kMembership`. Both installed
   authority and runtime composition require non-empty canonical
   `runtimeMembership`; every member is checked against the receipt release,
   source commit, Registry provenance, physical type, digest and size.

### TDD RED

After adding regressions and before the fix, bounded WSL UCode reported:

```text
node --test tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-runtime-composition.test.mjs
51 tests, 46 passed, 4 failed, 1 todo
```

The expected new failures were the absent rollback/finalized test seams and
the missing-runtimeMembership regressions. The remaining failure was the
pre-existing runtime-composition static expectation for
`target.runtimeBundleDigest = target.dependencyClosure`; it is unrelated to
this fix-round. The independent review's earlier 14-pass/2-fail authority
result was the same V2 state-classification regression before the focused
assertions were updated to the canonical state.

### Changes and GREEN evidence

- `resource-update.uc` now accepts canonical legacy/coherent receipt states in
  rollback revision and finalized recovery, compares V3 rollback identity, and
  exposes restricted test seams for those lifecycle invariants.
- `z2k-installed-release.uc` and `runtime-composition.uc` require canonical
  V3 `runtimeMembership` and reject cross-release/source members.
- Focused regressions were added to the existing authority, receipt, and
  runtime-composition tests.

Fix-round files:

- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `tests/product/z2k-installed-release-authority.test.mjs`
- `tests/product/z2k-receipt-v3.test.mjs`
- `tests/product/z2k-runtime-composition.test.mjs`
- this report

Fresh bounded WSL results:

```text
z2k-installed-release-authority.test.mjs: 17 passed, 0 failed
z2k-receipt-v3.test.mjs:                  6 passed, 0 failed
z2k-runtime-summary.test.mjs:             5 passed, 0 failed
z2k-update-transaction.test.mjs:          9 passed, 0 failed
z2k-lifecycle-transaction.test.mjs:      14 passed, 0 failed
z2k-detect-artifact.test.mjs:             20 passed, 0 failed
z2k-runtime-composition.test.mjs:        26 passed, 1 pre-existing static failure, 1 existing TODO
```

The attempted combined multi-file Node invocation emitted only `TAP version 13`
through the WSL wrapper and returned no usable exit status; the suites above
were rerun individually with complete TAP results. This is runner evidence,
not a production failure.

### Commit and remaining boundaries

Fix-round implementation commit: `0b6b0f02` (`fix: reconcile coherent Z2K receipt recovery`).
Report evidence commit: `da03f653` (`docs: record Task 6 fix-round evidence`).

`node --check` for all three changed test modules, all four modified UCode
imports, knowledge/Quartz validators, and `git diff --check` passed before the
commits. The worktree is clean. No router, browser,
package-E2E, deployment, or live Detect acceptance was run. The one unrelated
runtime-composition static mismatch and the existing Task 4 TODO remain open
and were not changed.

## Fix-round 2 — re-review Important findings

### RED evidence

The focused regressions were first run against the pre-fix-round production
paths. The bounded WSL UCode RED output was:

```text
V3 canonical-member regression: failed true !== false
production-shaped finalization: Type error, missing coherent-finalization export
canonical LEGACY_VERIFIED reconciliation: Type error, missing reconciliation export
```

These failures identified the missing production finalization evidence path,
the stale V1 consumer contract, and the incomplete shared member validator.
The FINALIZED runtime-proof regression was then kept fail-closed until its
fixture supplied a real canonical package composition and complete materialized
and process evidence.

### Changes

1. `resource-update.uc` now builds the sole finalization request from the
   committed candidate, activation process proof, Detect identity, native
   source validation, and the real `catalog_refresh_rebuild().indexDigest`.
   Missing evidence aborts and compensates before receipt mutation. The
   existing wire bundle id remains `z2k-curated-lua`; no second receipt or
   database was introduced.
2. The durable pending record carries `catalogRestoreRequired` across source
   activation and rollback. Rollback rebuilds the catalog before Detect
   restoration is closed, preserving atomic recovery when catalog mutation has
   already occurred.
3. V1 reconciliation consumes canonical `LEGACY_VERIFIED`; V1/V2 remain
   readable but cannot satisfy V3 coherent FINALIZED recovery.
4. Installed-release, Registry, and runtime-composition validation now require
   Core-owned canonical lifecycle members (`owner=z2k-core`, allowed kind,
   canonical role/order) and bind every V3 member to receipt release/source
   provenance.
5. FINALIZED recovery now requires a `COHERENT_VERIFIED` V3 receipt and
   independently verifies resolved composition, materialized bytes, process
   identity, runtime hashes, queue readiness, config identity, and Lua init
   order before clearing the marker.

### GREEN evidence

Implementation commit: `5878dcfb` (`fix: close Task 6 coherent activation lifecycle`).

Each suite was run separately with an explicit 30-second WSL timeout:

```text
z2k-receipt-v3.test.mjs:             9 passed, 0 failed
z2k-v1-reconciliation.test.mjs:      6 passed, 0 failed, 3 existing TODOs
z2k-installed-release-authority:    17 passed, 0 failed
z2k-lifecycle-transaction.test.mjs: 14 passed, 0 failed
z2k-runtime-summary.test.mjs:        5 passed, 0 failed
z2k-update-transaction.test.mjs:    9 passed, 0 failed
z2k-detect-artifact.test.mjs:       2 passed, 0 failed, 18 skipped on this host
```

The physical UCode recovery regression passed independently: valid
materialized/runtime/process evidence closed the restricted recovery seam, and
mutated runtime identity returned failure without closure. The production-
shaped finalization regression produced `asset-activation-receipt.v3`,
`COHERENT_VERIFIED`, the complete Detect/catalog/runtime evidence, and retained
`z2k-curated-lua`.

`z2k-runtime-composition.test.mjs` remained at `26 passed, 1 failed, 1 TODO`.
The one failure is the pre-existing static expectation for
`target.runtimeBundleDigest = target.dependencyClosure`; it is unrelated to
this fix-round and was not weakened or changed.

Additional bounded gates passed:

```text
node --check: all changed product test modules passed
UCode imports: asset-registry.uc, z2k-installed-release.uc,
               runtime-composition.uc, resource-update.uc all passed
git diff --check: passed
scripts/validate-knowledge.mjs: Knowledge validation passed
scripts/docs.mjs verify: Quartz SHA verified
```

### Scope and remaining boundaries

The implementation scope is the four Task 6 authority/lifecycle modules plus
the focused receipt, reconciliation, Detect rollback, and lifecycle-order
regressions required by the review. Adjacent `resource-update.uc` changes are
limited to the canonical activation/finalization and rollback/recovery
consumers. Registry/receipt authority remains singular, and no second database
or alternate wire bundle id was added.

No router deployment, browser acceptance, package-E2E acceptance, live Detect
process acceptance, or router crash/reboot test was run. The host-skipped Detect
behavioral cases, the unrelated runtime-composition static mismatch, and the
existing TODOs remain explicit verification boundaries.

Report evidence commit: the documentation commit immediately following
`5878dcfb`; the final handoff records its exact HEAD hash.
