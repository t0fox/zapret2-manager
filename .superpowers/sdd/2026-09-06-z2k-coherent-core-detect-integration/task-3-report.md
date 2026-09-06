# Task 3 report: one immutable coherent candidate

Status: DONE_WITH_CONCERNS (Task 3 host/native gates pass; router/browser acceptance was not run and is not claimed).

## Scope and files

Implemented only the Task 3 boundary and its direct integration:

- Created `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc`.
- Updated `z2k-compat.uc` with the candidate identity gate.
- Updated `z2k-dependency-closure.uc` to expose the canonical runtime membership.
- Updated `runtime-composition.uc` so `resolveCandidate()` consumes `z2k_candidate_build()` while composition remains the ordering/CAS owner.
- Added `tests/product/z2k-coherent-candidate.test.mjs`.

No Task 4+ Detect execution/service implementation was taken. The Task 5 Detect staging boundary remains external to this task; the candidate validates Detect identity and does not stage, execute, or synthesize Detect.

## Behavior delivered

`z2k_candidate_build(input)` returns the release/source/manifest/classification identity, runtime membership, Detect identity, compiler input digest, catalog digest, runtime bundle digest, and one semantic `compatibilityIdentity`. It rejects mixed member revisions with `ECOMPATIBILITY`, missing Detect with `EDETECT_UNAVAILABLE`, and missing required members with `EMISSING_MEMBER`.

Compatibility identity uses sorted semantic rows and excludes staging paths, timestamps, and Registry revision observations. Runtime composition continues to calculate its own ordering/CAS snapshot identities; it no longer chooses or reconstructs the coherent candidate identity.

## TDD evidence

RED:

- Command: `node --test tests/product/z2k-coherent-candidate.test.mjs`
- Outcome: exit 1; the first test failed because the new candidate module did not exist. Four ucode behavior tests were skipped because Windows had no native ucode path at that point.

GREEN:

- Command: `wsl.exe -e sh -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/product/z2k-coherent-candidate.test.mjs"`
- Outcome: 5 tests passed, 0 failed, 0 skipped.
- Command: same WSL environment with `node --test tests/product/z2k-coherent-candidate.test.mjs tests/product/z2k-candidate-compatibility.test.mjs tests/product/z2k-runtime-summary.test.mjs`
- Outcome: 13 tests passed, 0 failed, 0 skipped.

The required combined suite includes the Task 3 cases: mixed revisions, unavailable Detect, missing required member, and semantic identity stability across staging/timestamp/Registry-only changes.

## Focused gates

- `node --check tests/product/z2k-coherent-candidate.test.mjs`: passed.
- WSL ucode import checks for all four changed `.uc` modules: passed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed.
- `git diff --check`: passed.
- `git diff --find-renames --stat`: completed without whitespace/rename diagnostics.

## Required-suite status and pre-existing failures

- `node --test tests` is not a valid Node invocation in this repository and failed immediately with `MODULE_NOT_FOUND` for the `tests` directory entry.
- The corrected recursive command (`$files = rg --files tests | Where-Object { $_ -match '\\.test\\.mjs$' }; node --test @files`) was run with a bounded window. It produced many unrelated baseline failures (public Quartz artifact expectations, package/postinst fixtures, Scanner/runtime/status/native-root gates, and Windows `process.getuid` incompatibility) and was stopped with Ctrl-C after the bounded evidence window. It was not used as a Task 3 success gate.
- `z2k-dependency-closure.test.mjs` under WSL still reports its existing count mismatch (`actual blobs 4/runtime 0/builtins 0` versus expected `blobs 3/runtime 1/builtins 1`). Task 3 only adds the `runtimeMembership` projection field; it does not alter closure classification logic. This remains a pre-existing unrelated failure and was not repaired.

## Acceptance boundary and concerns

No router deployment, browser acceptance, Detect process/service acceptance, package E2E, or real `z2k-detect` command was run. Those remain unverified and belong to later integration/acceptance work. The local WSL ucode runtime was used only for host/native module and focused product tests.

Implementation commit hash: `9883e1ac`.
