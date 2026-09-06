# Task 5 independent review: Z2K Detect artifact integration

Status: NOT READY

Review target: `6622f338..6685586f` in `G:\zapret2-manager\.worktrees\z2k-coherent-core-detect`.
Reviewed implementation behavior, the Task 5 plan/spec, the review package, the worker boundary, and the bounded WSL ucode tests. No router, browser, or package-E2E acceptance was performed.

## Findings

### Critical

1. **[NOT ADDRESSED] The staged Detect binary is never published to the stable runtime target.**
   - `resource-update.uc:1763-1768` downloads and preflights `root + '/z2k-detect'`, then only records diagnostics and adds the temp file to `paths`.
   - `resource-update.uc:1799` passes `staged` to `asset_registry_apply_bundle`; the Detect temp file is not included in `staged` and no `mv`, atomic publish, Registry asset, or equivalent write to `/usr/libexec/zapret2-manager/z2k-detect` exists in the Task 5 path.
   - `resource-update.uc:47` and `z2k-detect.uc:7` establish the target as metadata/preflight identity only. `cleanup()` at `resource-update.uc:768-770` removes the staged file.
   - Result: a successful update can report `diagnostics.detect.result = 'staged'` while the installed Detect binary remains absent or old. This violates the required stable target and Core lifecycle integration, and rollback cannot restore a Detect artifact that was never transactionally published.

### Important

2. **[NOT ADDRESSED] Integrated failure/rollback seams for Detect are not verified.**
   - `tests/product/z2k-detect-artifact.test.mjs:75-89` covers only the successful injected staging seam; it does not inject wrong SHA, fetch failure, chmod failure, preflight failure, missing source/manifest, stale/partial staging, or cleanup failure.
   - `tests/product/z2k-update-transaction.test.mjs` has generic asset transaction assertions, but no behavioral Detect publish/rollback assertion. In particular, it cannot catch finding 1 because it never verifies the stable target before/after apply.
   - The code has a closed cleanup path for the temporary file (`resource-update.uc:1765-1768`, `768-780`), but there is no evidence that the previous stable Detect bytes are captured and restored on later activation/postflight failure.

3. **[NOT ADDRESSED / pre-existing boundary] Production detection still routes through the legacy scanner, so “no old scanner fallback” is not proven.**
   - `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc:29` imports `scanner-state.uc`.
   - `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc:475-476` defines the production `scanner-cli-entry.uc` boundary, and `:593-594` launches it for scan work; methods remain registered at `:1488-1495`.
   - The Task 5 diff adds no Detect RPC adapter and does not remove or rewire this path. This is likely planned for Task 10/11/14, but it remains NOT ADDRESSED for the requested architecture gate and must not be called complete for the whole production boundary.

### Minor

4. **[NOT ADDRESSED] The executable preflight seam is not constrained to the fixed internal target.**
   - `z2k-detect.uc:75-82` accepts any absolute caller-supplied path; `z2k-detect.uc:85-93` accepts any absolute `stagePath`.
   - The implementation passes only internally constructed paths today, and it passes no argv, so this is not an observed external-input exploit in this diff. However, the test deliberately passes `/tmp/fixed-detect` at `tests/product/z2k-detect-artifact.test.mjs:64`, which verifies “absolute path” rather than the required fixed internal path contract.

## Requirements matrix

- Required machine strings: **ADDRESSED** — `z2k-detect.uc:41-45` maps exactly `aarch64`, `x86_64`, `mipsel`, `mips`, and `riscv64`; unsupported values return `null`. Test: `z2k-detect-artifact.test.mjs:31-38`.
- Selected source path and selected-commit manifest SHA: **ADDRESSED for candidate/staging only** — `z2k-detect.uc:47-57`, `:89-99`; test `:40-52`, `:75-89`.
- No fetch of other architectures: **ADDRESSED in the staging implementation** — one `sourcePath` is formed and one URL is fetched at `z2k-detect.uc:51`, `:89-95`; no loop over manifest architectures exists.
- Exact byte verification: **ADDRESSED in staging** — `z2k-detect.uc:96-97`; integrated wrong-SHA failure evidence is **NOT ADDRESSED**.
- Executable permission/format preflight with no user argv: **PARTIALLY ADDRESSED** — chmod and no-argv invocation are present at `z2k-detect.uc:60-72`, `:75-82`; integrated failure tests and fixed-target enforcement are missing.
- Stable `/usr/libexec/zapret2-manager/z2k-detect`: **NOT ADDRESSED** — see Critical finding 1.
- Candidate/resource-update integration preserving Task 3/4 identity and one Core lifecycle: **PARTIALLY ADDRESSED** — candidate stores `detectArtifact` at `resource-update.uc:1666`, and apply preflights it at `:1763-1768`; stable publication and Detect identity in an activation receipt/rollback authority are not present in this Task 5 diff.
- Worker boundary: **ADDRESSED** — worker delegates to `resource_center_prepare_version`/`resource_center_update` at `resource-update-worker.uc:5`, `:24-26`; the worker contains no fetch or Registry apply (`z2k-detect-artifact.test.mjs:91-99`).
- Unsupported arch, wrong SHA, ENOEXEC/permission, missing manifest/source, stale/partial staging, rollback/cleanup: **PARTIALLY ADDRESSED** — unsupported arch, ENOEXEC/EACCES injected seams and temp cleanup are present; the remaining integrated failure/rollback evidence is missing (Important finding 2).
- No second Detect updater: **ADDRESSED by this diff** — one new `z2k-detect.uc` authority and one Resource Center call site were found.
- No old scanner fallback: **NOT ADDRESSED in current production** — see Important finding 3.

## Verification evidence

Executed with WSL ucode:

```text
wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs'
```

Result: exit `0`; `15` passed, `0` failed, `0` skipped, `0` todo (`6/6` Task 5 tests and `9/9` update-transaction tests).

Additional check: `git diff --check` passed before this review. No router/browser acceptance was run. The repository's broader baseline failures were not rerun or reclassified here.

## Decision

`NOT READY`: the focused tests are green, but the implementation does not install the verified Detect bytes at the required stable target, and the requested rollback/failure and legacy-scanner boundary evidence is incomplete. Do not claim PASS or DONE_WITH_CONCERNS for this Task 5 review until the stable-target transaction and its failure/rollback tests are implemented and verified.

Reviewed HEAD: `6685586f20760f8a53b238e2348dfd7d9d6ae7f6`.

## Fix round 1: stable-target publication and rollback

Status: IMPLEMENTED — focused evidence green; router/browser acceptance intentionally not run.

### RED

The first bounded RED run after adding the fix tests used:

```text
wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs'
```

Exact result: 18 tests, 14 passed, 4 failed, 0 skipped, 0 todo. One failure was a test-harness-only UCode incompatibility from using JavaScript `String.repeat()` inside the generated UCode expression and was corrected before judging production behavior. The remaining RED failures were the intentionally absent publication/restore exports and the absent Resource Center publish-owner assertion.

### Implementation

- `z2k-detect.uc` now restricts production staging to the internal Resource Center stage prefix and production executable checks/publication to the fixed `/usr/libexec/zapret2-manager/z2k-detect` target; test-only overrides are limited to `/tmp/z2m-z2k-detect-test-*`.
- The verified selected-commit/selected-manifest-SHA bytes are copied to a same-filesystem candidate and atomically moved into the stable target. Prior bytes, SHA, size, and mode are captured in the publication record; restore verifies the captured SHA and closes rollback state.
- `resource-update.uc` publishes immediately after Detect staging and before `asset_registry_apply_bundle`, carries `detectPublication` in the existing Core pending activation authority, restores it on Registry/postflight/runtime/activation/finalization failure, and finalizes the rollback state only after the lifecycle guard's success path. Recovery handles PREPARED, ROLLED_BACK, and FINALIZED pending phases without adding a second updater/database.
- `resource-update-worker.uc` was not changed: it remains the coordinator boundary and does not fetch or apply Registry assets.

### GREEN and gates

The final bounded focused WSL run for this fix round reported: 19 tests, 19 passed, 0 failed, 0 skipped, 0 todo. This includes 10 Detect artifact/owner tests and 9 existing Z2K update-transaction tests. It covers architecture/path/commit/SHA identity, fetch/SHA/executable failures, absent staging, stable publication, post-publication verification rollback, prior stable restore, fixed target semantics, and worker ownership.

UCode imports passed for `z2k-detect.uc` and `resource-update.uc`. Syntax, knowledge/docs validators, `git diff --check`, and rename-aware diff checks were run for the final scoped change. No router, browser, package-E2E, or deployment acceptance was run.

Implementation commit: `5a604265` (`fix: publish Z2K Detect through Core transaction`).

### Scope rulings and deferred findings

The independent review's old scanner production imports remain pre-existing and are explicitly deferred to the planned Task 8/10/11/14 closure. Task 5 adds no scanner fallback, parallel RPC, separate Detect updater, or second database. No unrelated failures were fixed or reclassified.

## Fix round 2: rollback-complete lifecycle, staging cleanup, and path boundaries

Status: IMPLEMENTED — bounded focused evidence green; no router/browser acceptance.

### RED

The first bounded RED run after adding the fix-round-2 regressions used:

```text
wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 60s node --test tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-update-transaction.test.mjs'
```

Exact result: `22` tests, `19` passed, `3` failed, `0` skipped, `0` todo.

- Partial fetch/SHA/chmod/preflight failures left simulated stage bytes behind.
- Traversal input returned `EVERIFY` instead of the required `EINPUT` because `..` was still accepted by the lexical prefix check.
- The COMMITTED/late post-Registry source assertion found a direct guard-finish path without the lifecycle rollback routine.

After the production patch, the same bounded command was rerun once before correcting two test-harness expectations: `22` tests, `20` passed, `2` failed. The remaining failures were the test's backslash escaping in generated UCode and an owner-order assertion searching for `let applied` after the implementation's predeclared `applied` variable. No production failure remained in that intermediate run.

### Implementation

- Every post-Registry failure path now calls the single `z2k_rollback_after_runtime_failure` before `z2k_runtime_guard_finish`, including partial Registry apply mutation, COMMITTED evidence, post-commit read, MATERIALIZED/PROCESS_VERIFIED/SOURCE_ACTIVATED evidence, postflight/runtime/activation/finalization, catalog publication, late FINALIZED evidence, reconciliation, Detect finalization, and unexpected exceptions.
- Detect finalization now occurs while the durable `FINALIZED` receipt is present. If pending-marker clearing fails after Detect rollback state is closed, the transaction returns `ERECOVERY_REQUIRED` with a durable invariant: Registry receipt, runtime/source activation, and stable Detect bytes remain the same candidate. It does not restore Detect alone; `resource_center_recover_pending()` can verify the receipt and close the marker.
- The internal Detect stage path is registered before staging, and every fetch/SHA/chmod/preflight exception removes partial bytes. Production staging remains under the fixed Resource Center prefix.
- Production/test seams reject `..` segments, backslashes, and symlink/non-regular files; test target overrides remain limited to the controlled `/tmp/z2m-z2k-detect-test-*` prefix. The production runtime target remains fixed at `/usr/libexec/zapret2-manager/z2k-detect`.
- The Resource Center owner assertion covers Detect publication before Registry apply and stage-path registration before staging. The worker remains a coordinator and `resource-update-worker.uc` was not changed.

### GREEN and required gates

Final bounded focused WSL run:

```text
22 tests, 22 passed, 0 failed, 0 skipped, 0 todo
```

This includes architecture/path/commit/SHA identity, wrong SHA/fetch/chmod/preflight failures, partial-stage cleanup, traversal/backslash/non-regular boundaries, stable publication and restore, and Resource Center/worker ownership and post-Registry rollback assertions.

Additional bounded checks:

- UCode imports: `detect-import-ok`, `resource-import-ok`.
- `node --check tests/product/z2k-detect-artifact.test.mjs`: passed.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `node scripts/docs.mjs verify`: `Quartz SHA verified: ab346fa66a895e12d63a308e70ce330ba795822a`.
- `git diff --check`: passed.

Implementation commit: `bb6b907d` (`fix: complete Z2K Detect rollback transaction`). The prior fix-round-1 commit remains `5a604265` (`fix: publish Z2K Detect through Core transaction`).

### Scope rulings

Pre-existing legacy scanner production imports remain deferred to planned Tasks 8/10/11/14. This round adds no scanner fallback, parallel RPC, second Detect updater, second database, router deployment, browser acceptance, or package-E2E claim. No unrelated failures were fixed or reclassified.
