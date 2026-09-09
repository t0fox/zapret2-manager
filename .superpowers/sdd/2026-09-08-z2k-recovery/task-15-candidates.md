# Task 15 dead-code candidate list

Date: 2026-09-09

## Candidate set selected for deletion

The following production UCode files have no non-test production import or
runtime manifest entry after Tasks 10–14. Their public RPC/UI boundary is
already typed Detect-only, and their remaining references are obsolete tests
for the retired Manager-owned candidate scanner:

- `scanner-targets.uc`
- `scanner-solver.uc`
- `scanner-results.uc`
- `scanner-reconcile.uc`
- `scanner-model.uc`
- `scanner-generator.uc`
- `scanner-dependency-preflight.uc`
- `scanner-compiler-authority.uc`

These are the old candidate planning, state, ranking, generated-save, and
Manager-owned orchestration seams. They are not imported by any production
file and are not in the reviewed deployment manifest.

## Test-only references to remove or narrow

- `tests/fixtures/avatar-strategy-scanner/{candidates,parity,probes,recovery,targets}.json`;
  after removing the old characterization/model/result tests no current test
  imports any of these fixtures.
- `tests/product/avatar-strategy-scanner-model.test.mjs`
- `tests/product/avatar-strategy-scanner-results.test.mjs`
- `tests/product/avatar-strategy-scanner-reconcile.test.mjs`
- `tests/product/avatar-strategy-scanner-reconcile-ownership.test.mjs`
- `tests/product/avatar-strategy-scanner-handoff.test.mjs`
- `tests/product/avatar-strategy-scanner-ownership-journal.test.mjs`
- `tests/ui/scanner-targets.test.mjs`
- `tests/ui/scanner-workspace-history-handoff.test.mjs`
- `tests/ui/scanner-workspace-multi-engine.test.mjs`

The scanner handoff assertion at the end of
`tests/product/avatar-strategy-apply.test.mjs` is removed while the Strategy
Apply tests remain. The package closure test is narrowed to the retained
`scanner-cli.uc`/`scanner-cli-entry.uc` compatibility shell and the shared
runtime adapter.

## Explicitly retained

`scanner-cli.uc`, `scanner-cli-entry.uc`, `scanner-runtime-adapter.sh`,
`scanner-transient.uc`, and `scanner-state.uc` remain in this pass. The Task 10
call graph marks the CLI/entry and runtime adapter as KEEP_SHARED, and the
transient/state pair is retained until a separate caller proof resolves its
shared lock/rollback boundary. No lifecycle, rollback, Detect, or Strategy
authority is deleted.

## Size boundary

Task 1 recorded `scanner.c` at `58634` bytes, but it was already removed by
Task 11. This pass will not fabricate a local APK after the removal; the
CI-backed Task 16 artifact will supply the final APK bytes/hash. Production
file count and source byte deltas are recorded locally here.
