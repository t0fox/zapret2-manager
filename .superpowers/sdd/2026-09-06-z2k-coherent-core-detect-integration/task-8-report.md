# Task 8 report — legacy migration and current Lua closure

## Scope and status

Implementation is committed on top of reviewed Task 7 HEAD `c3c140e8`.
No Scanner files, merge, push, router deployment or browser acceptance were
changed or run.

Task 8 is **NOT GREEN**: the current checked-in official compiled catalog still
references two functions that exist only in the removed legacy detector. The
new closure gate fails closed and identifies the function, strategy and profile;
it does not restore `z2k-detectors.lua` as a fallback.

## TDD evidence

RED was observed before the implementation:

```text
node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs
1 failed, 0 passed, 5 skipped
```

The expected stale package-composition failure was followed by the actual
closure failure after removing the detector entry. The missing references are:

```text
z2k_mid_stream_stall — z2k_all_in_one — builtin/z2k_all_in_one.txt
z2k_http_success_positive_only — z2k_all_in_one — builtin/z2k_all_in_one.txt
z2k_mid_stream_stall — z2k_tls_circular_smart — builtin/z2k_circular.txt
z2k_http_success_positive_only — z2k_tls_circular_smart — builtin/z2k_circular.txt
```

Migration GREEN under bounded WSL UCode:

```text
tests/product/z2k-legacy-migration.test.mjs  3 passed, 0 failed
```

The closure fixture seams are GREEN under bounded WSL UCode:

```text
closure rejects a missing function ...  ok
closure fixture function resolves ...    ok
```

## Changes

- Added `z2k-migration.uc` with canonical V1/V2/V3 state classification,
  fail-closed Lua function closure, and a transaction-shaped migration
  evidence seam preserving discovered domains, source selection, exclusions
  and user strategies.
- Removed `z2k-detectors.lua` from the package runtime composition descriptor.
- Bound candidate resolution to the Lua closure gate when closure evidence is
  supplied; missing functions return blocking `ECOMPATIBILITY` with function,
  strategy and profile fields.
- Exposed read-only migration/closure seams through `resource-update.uc`.
- Added current-catalog closure and V2/V3 migration tests.

The existing Resource Center / Asset Registry transaction remains the mutation
authority. No second Registry, receipt writer, updater or database was added.
Task 9 still owns autocircular legacy-row reconciliation.

## Verification

Passed:

```text
WSL UCode: z2k-legacy-migration.test.mjs              3 passed, 0 failed
WSL UCode: z2k-runtime-summary.test.mjs               10 passed, 0 failed
node scripts/validate-knowledge.mjs                   passed
node scripts/docs.mjs verify                           passed
node --check tests/product/z2k-current-lua-function-closure.test.mjs passed
node --check tests/product/z2k-legacy-migration.test.mjs              passed
runtime-composition-package.json parse                passed
git diff --check                                        passed
```

Known/unavailable or baseline boundaries:

```text
WSL focused closure+migration+summary: 10 passed, 1 failed
Windows focused closure+migration+summary: 1 passed, 1 failed, 9 skipped
```

Windows skips are because `/opt/ucode/bin/ucode` is unavailable. The
`z2k-runtime-composition` suite is `26 passed, 1 failed, 1 TODO`; its failure
is the pre-existing static expectation for
`target.runtimeBundleDigest = target.dependencyClosure`, and the TODO is the
pre-existing Task 4 transaction slice. Knowledge tests are `29 passed, 4
failed` because `.artifacts/docs-public` is absent; no public build was
generated in this scoped task.

## Commit and boundaries

Implementation and this report are committed together as:

```text
feat: migrate legacy Z2K runtime coherently
```

The post-commit HEAD and exact file list are reported separately after the
commit. No router/browser/package-E2E/live Detect acceptance was run.
