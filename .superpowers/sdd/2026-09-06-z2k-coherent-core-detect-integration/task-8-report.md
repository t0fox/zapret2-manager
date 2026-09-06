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
