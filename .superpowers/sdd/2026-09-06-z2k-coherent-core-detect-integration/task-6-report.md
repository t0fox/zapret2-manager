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
