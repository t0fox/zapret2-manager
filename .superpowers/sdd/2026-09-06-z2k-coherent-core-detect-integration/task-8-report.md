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

## Fix-round 1 — independent-review corrections

Fix-round baseline was `776a1ad5a6479dcaa8dc67d41b25651191cd2f73` in the
requested worktree. Scanner files and unrelated changes were not touched.

### RED before the correction

The focused command was run before implementation:

```text
wsl -e bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs"
```

It failed closed on the four real catalog references missing from the six
current modules (`z2k_mid_stream_stall` and
`z2k_http_success_positive_only`, each from the two official profiles), plus
malformed V3 classification, the missing Resource Center transaction seam, and
missing `runtimeData` preservation. No detector fallback was restored.

### Implementation

- Rehomed the reviewed detector implementation into the current
  `z2k-alert.lua` module. The current official catalog now resolves all four
  referenced callbacks from the six exact-managed Lua modules.
- Removed the stale `z2k-detectors.lua` asset from
  `resources/manifest.json`. `runtime-composition-package.json` was already
  detector-free at the fix-round baseline and remains so; `Makefile` contains
  no detector shipping entry. The legacy source file remains only as a
  non-production historical/test fixture; no production descriptor or runtime
  composition path references it.
- Made `z2k_migration_state()` require a complete V3 shape: release/version,
  source and manifest identities, runtime membership, Detect identity and
  authority digests. Malformed V3 is `NONE`; V1/V2 remains `LEGACY_Z2K`.
- Replaced the projection-only migration with pure prepare/commit/rollback
  evidence. Asset Registry finalization remains the only V3 receipt writer;
  the existing pending activation record remains the rollback authority.
- Wired migration preparation into target creation and pending activation,
  checks the legacy receipt for stale changes, verifies the finalized V3
  receipt, and re-reads authoritative post-activation strategy/config/domain
  data before committing preservation evidence. Existing rollback restores the
  legacy receipt, Registry membership, runtime composition, Detect, source,
  catalog and config on failure.
- Preservation evidence covers discovered domains, enabled source selections,
  exclusions, user strategy entries and runtime config/enabled state. Task 9's
  autocircular legacy-row reconciliation remains out of scope.
- Closure tests enumerate the current catalog references, invoke the production
  closure contract, reject a removed real callback with function/strategy/
  profile diagnostics, and reject the removed-function fixture.

### GREEN and verification evidence

Focused Task 8 plus runtime summary:

```text
node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-runtime-summary.test.mjs
16 passed, 0 failed, 0 skipped
```

The closure/migration-only command also passed `11/11`. The six-Lua closure
enumerated `z2k_dynamic_ttl`, `z2k_http_success_positive_only`,
`z2k_mid_stream_stall`, and `z2k_nohost_key`; all resolved from the six current
modules.

Relevant lifecycle/update/receipt bounded command:

```text
node --test tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/z2k-runtime-target-luaopt.test.mjs tests/product/z2k-current-upstream-membership.test.mjs
109 passed, 3 failed, 1 TODO
```

Passing suites included receipt V3, lifecycle ownership/transaction/target,
runtime LuaOPT and runtime-target checks. The three failures are boundaries,
not Task 8 focused failures: the existing runtime-composition static
expectation for `target.runtimeBundleDigest = target.dependencyClosure`, the
existing full-lifecycle changelog/API-root regex expectation, and the existing
upstream-membership test still asserting that the detector descriptor remains
in `resources/manifest.json`. The last assertion conflicts directly with this
review requirement and was not changed because it is outside the permitted
focused-test file list.

Additional bounded checks:

```text
UCode imports: z2k-migration.uc, runtime-composition.uc, resource-update.uc — import-ok
node --check tests/product/z2k-current-lua-function-closure.test.mjs — passed
node --check tests/product/z2k-legacy-migration.test.mjs — passed
runtime-composition-package.json and resources/manifest.json parse — passed
production descriptor scan for z2k-detectors — clean
git diff --check — passed
node scripts/validate-knowledge.mjs — passed
node scripts/docs.mjs verify — passed (Quartz SHA ab346fa66a895e12d63a308e70ce330ba795822a)
```

`luac`/Lua was unavailable in the verification host, so Lua bytecode
compilation was not claimed. No router, browser, deploy, merge, push, or live
Detect acceptance was run.

### Fix-round commit and boundary

Implementation commit:

```text
c0c13aa9 fix: close current Z2K runtime and wire migration
```

The report evidence is committed in the following documentation commit. The
final clean HEAD and both commit ids are returned in the delivery response.

## Fix-round 2 — stale wildcard detector and real migration rollback

Fix-round baseline was `0cec4dcbd7da052c905cca12dc1b13ba399f67f5` in the
requested worktree. Scanner work and unrelated checkout state were preserved.

### RED before fix-round 2 implementation

The review-focused RED command was run before the production-tree deletion and
rollback wiring:

```text
wsl -e bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-legacy-migration.test.mjs"
```

Result: `14 pass, 3 fail`. The failures were the physical detector file still
being present despite the Makefile wildcard, the new production-shaped rollback
test not receiving migration rollback evidence, and the missing static wiring
assertion. This was a real RED state; no detector fallback was accepted.

### Fix-round 2 implementation

- Deleted the production-tree asset
  `zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-detectors.lua`.
  The Makefile still installs `./files/*`, so the closure test now proves the
  wildcard cannot ship that path. Package JSON, resource manifest and runtime
  asset references are also asserted detector-free. The current catalog still
  has one historical source-provenance comment naming the upstream file; it is
  not a manifest, package, runtime-composition or fallback reference.
- Kept the six-module closure authoritative and fail-closed. Tests enumerate
  every current official catalog callback, prove resolution from the six current
  Lua modules, prove a present fixture resolves, and prove removal of a real
  callback returns a blocking error identifying function, strategy and profile.
- Added `z2k_migration_rollback_evidence()` to the canonical Resource Center
  rollback coordinator. Every real rollback result now carries migration
  rollback evidence; incomplete migration restoration makes recovery fail closed.
  The existing Registry/receipt/runtime/source/catalog/config authorities remain
  the single transaction authority. No second receipt, database or hidden
  detector authority was introduced.
- Migration rollback preserves the active V1/V2 receipt and discovered domains,
  source selections, exclusions, user strategies and runtime data. Successful
  coherent activation still verifies and publishes the V3 receipt through the
  existing Asset Registry authority. Task 9 autocircular legacy-row
  reconciliation remains out of scope.
- Updated directly impacted package/lifecycle expectations for detector removal,
  exact managed-asset counts, source-boundary ordering and the canonical
  runtime-bundle-digest/revision authority. Assertions were not weakened.

### GREEN and bounded verification

Focused closure, migration and runtime summary:

```text
node --test --test-concurrency=1 tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-runtime-summary.test.mjs
17 passed, 0 failed, 0 skipped, 0 TODO
```

Impacted package/closure/runtime checks:

```text
node --test --test-concurrency=1 tests/lua/test_detectors_sync.test.mjs tests/product/test_asset_provenance.test.mjs tests/product/z2k-materialization.test.mjs tests/product/z2k-removal-plan-parity.test.mjs tests/product/z2k-runtime-target-luaopt.test.mjs
15 passed, 0 failed, 0 skipped, 0 TODO
```

The final bounded lifecycle/receipt/transaction/Detect aggregate was run with
the host UCode library path configured:

```text
node --test --test-concurrency=1 tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/z2k-runtime-target-luaopt.test.mjs tests/product/z2k-current-upstream-membership.test.mjs tests/product/z2k-current-lua-function-closure.test.mjs tests/product/z2k-legacy-migration.test.mjs tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-removal-plan-parity.test.mjs
168 total: 166 passed, 1 failed, 0 cancelled, 0 skipped, 1 TODO
```

All Task 8 closure, migration, rollback, receipt and Detect subtests passed.
The single failure is the pre-existing full-lifecycle changelog/API-root static
expectation: it rejects `API_ROOT + '/commits/'` in the existing immutable
commit-evidence resolver, not in changelog manifest-history code. The one TODO
is the pre-existing Task 4 candidate-CAS transaction slice. Neither was
relabeled as a Task 8 pass or changed in this fix-round.

The earlier five-failure review inventory was inspected across the bounded
package/lifecycle gates: stale detector membership/provenance/materialization
assertions and stale runtime-composition expectations were Task 8 regressions
and are now green; the strategy-admission corpus's zero Z2K_TLS_MOD-dependent
rows and the changelog/API-root expectation remain unrelated baseline behavior.

Additional checks:

```text
UCode imports for z2k-migration.uc, runtime-composition.uc and resource-update.uc — import-ok
node --check on all nine directly impacted test files — node-checks-ok
package/manifest detector scan and Makefile wildcard check — passed
runtime package/manifest/Makefile/runtime-assets detector references — clean
node scripts/validate-knowledge.mjs — passed
node scripts/docs.mjs verify — passed (Quartz SHA ab346fa66a895e12d63a308e70ce330ba795822a)
git diff --check — passed
luac/lua availability — unavailable on this verification host; Lua bytecode compilation not claimed
```

The Detect tests require `LD_LIBRARY_PATH=/opt/ucode/lib` on this host; with
that bounded host prerequisite they passed. Without it, the host loader reports
missing `libucode.so.0` (exit 127), which is an environment limitation rather
than a production test result. No router, browser, deploy, merge or push was
run.

### Fix-round 2 commits and boundaries

Implementation commit:

```text
de07dbee fix: remove stale Z2K detector and wire migration rollback
```

The report evidence is committed separately immediately afterward. The final
clean HEAD and exact changed-file list are returned in the delivery response.
