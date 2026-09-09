# Task 15 report — production-surface reduction

Date: 2026-09-09

## Scope

Task 10–14 call-graph evidence identified eight production UCode modules with
no production caller or deployment-manifest entry. They belonged to the
retired Manager-owned candidate Scanner. The retained typed Detect shell,
shared runtime adapter, transient cleanup, state/lock boundary, Strategy Apply,
rollback, receipt, and Components/Resources lifecycle owners were not changed.

Deleted production modules:

- `scanner-targets.uc`
- `scanner-solver.uc`
- `scanner-results.uc`
- `scanner-reconcile.uc`
- `scanner-model.uc`
- `scanner-generator.uc`
- `scanner-dependency-preflight.uc`
- `scanner-compiler-authority.uc`

Deleted only test-only contracts and fixtures that imported those seams. The
package closure assertion now proves the retained `scanner-cli.uc` and
`scanner-cli-entry.uc` surface plus the absence of all eight modules.

## Verification

Canonical WSL UCode affected-suite command:

```text
node --test --test-concurrency=1 tests/native/avatar-strategy-scanner-package.test.mjs tests/product/avatar-strategy-apply.test.mjs tests/product/z2k-old-scanner-removal-closure.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/product/scanner-start-order.test.mjs tests/product/scanner-history-nfqueue-contract.test.mjs
```

Result: `53 passed, 0 failed, 0 skipped`.

Scanner UI/current Detect command plus Node syntax checks passed: `44 passed,
0 failed, 0 skipped`; `z2m-scanner.js`, `z2m-maintenance.js`, and
`z2m-assets.js` passed `node --check`; `git diff --check` passed.

Components/Resources/lifecycle affected suite passed after synchronizing two
pre-existing `repair: false` RPC expectations: `107 passed, 0 failed,
0 skipped`.

## Size evidence

Task 1 baseline recorded 469 production package files and `scanner.c` at
58,634 source bytes. Task 11 had already removed `scanner.c`; this task removed
eight additional production files, leaving 461 production package files. The
current source measurements are recorded in `size-baseline.json`.

The user-required APK policy is CI-only. No local APK was built or used. The
APK byte/hash/native-helper `after` values remain explicitly pending Task 16's
fresh CI artifact; the hard `after.apkBytes <= before.apkBytes` gate is not
claimed here.

## Boundary

Task 15 remains `IN_PROGRESS` in the ledger until Task 16 supplies the exact
candidate CI APK and proves the hard size budget. No merge, branch deletion, or
worktree deletion was performed.
