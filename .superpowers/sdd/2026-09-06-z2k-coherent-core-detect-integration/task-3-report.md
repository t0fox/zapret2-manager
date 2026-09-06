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

## Fix round 1: independent-review findings

Status: `DONE_WITH_CONCERNS` for the Task 3 host/native boundary. The review
findings are addressed in the scoped implementation below. Router, browser,
package-E2E, and Detect service acceptance remain unrun and are not claimed.

### Files changed in this fix round

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- `tests/product/z2k-coherent-candidate.test.mjs`
- This report, appended with this fix-round evidence.

`z2k-compat.uc` and `z2k-dependency-closure.uc` remain part of the already
committed Task 3 implementation; they were not changed in this fix round.
No files outside the Task 3 boundary were changed.

### Findings and rulings

1. Required membership is now proven only from canonical runtime membership or
   dependency-closure membership. `presentLists` cannot suppress a missing
   canonical member. The test `missing required release member rejects
   candidate` removes the member while retaining `presentLists` and asserts
   `EMISSING_MEMBER`.

2. Runtime member provenance is checked when supplied. Member and nested
   provenance `sourceCommit`/`commit` and `release`/`version` values must match
   the candidate source commit/release. A regression covers both a foreign
   commit and a foreign `p-*` release and asserts `ECOMPATIBILITY`. Closure
   top-level provenance is checked as well.

3. `resolveCandidate()` now has an explicit narrow compatibility path for the
   existing ordering/CAS callers whose target does not yet contain a complete
   `candidateInput`. Such results are marked `coherenceStatus: 'unverified'`,
   contain no coherent candidate or compatibility identity, and never claim a
   successful coherent candidate. A complete `candidateInput` is still built
   and passed through the canonical identity gate; incomplete Detect/closure
   data fails closed.

4. When `dependencyClosure` is supplied, it must be available, complete, have
   zero missing members, and expose canonical runtime membership. Its membership
   must agree with any separately supplied runtime membership. This boundary
   does not own Task 5 staging.

5. `z2k_candidate_identity_gate()` is now a production caller in
   `resolveCandidate()` after the sole candidate builder. The test statically
   verifies the call and the executable runtime-composition suite exercises the
   existing resolver seam. No second candidate identity implementation was
   added.

6. Runtime bundle digests are no longer trusted blindly. The builder computes
   the canonical membership digest, validates a supplied digest when no closure
   digest is available, and rejects disagreement between supplied and closure
   digests. The regression `supplied runtime bundle digest must match canonical
   membership evidence` asserts `ECOMPATIBILITY`.

Semantic membership rows remain sorted and exclude staging paths, timestamps,
and Registry revision observations. Member provenance is included for
coherence validation/identity stability; Task 5 staging remains outside this
task.

### Fix-round TDD evidence

RED:

- Candidate regression command:
  `wsl.exe -e sh -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/product/z2k-coherent-candidate.test.mjs'`
  exited `1` against the pre-fix boundary. The new executable regressions did
  not pass, and the static production-caller assertion reported that
  `runtime-composition.uc` did not call `z2k_candidate_identity_gate()`.
- Runtime-composition regression command with the same WSL environment exited
  `1` before the compatibility-path fix: six existing resolver tests failed.
  The failures included `EDETECT_UNAVAILABLE`, undefined candidate identities,
  and the test-15 undefined-membership/map error caused by unconditional
  candidate construction.

GREEN/focused results:

- Candidate suite: the WSL command above, after the fix, exited `0`; `8`
  passed, `0` failed, `0` skipped.
- Runtime-composition suite:
  `node --test tests/product/z2k-runtime-composition.test.mjs` exited `1`
  with `23` passed, `1` failed, `1` todo, `0` skipped. All Task 3 resolver
  regressions pass. The sole failure is the pre-existing static expectation in
  `tests/product/z2k-runtime-composition.test.mjs:112` for
  `/target\.runtimeBundleDigest = target\.dependencyClosure/` in
  `resource-update.uc`; `resource-update.uc` is outside this task's allowed
  scope and was not modified.
- Update transaction suite:
  `node --test tests/product/z2k-update-transaction.test.mjs` exited `0`; `9/9`
  passed.
- Candidate compatibility plus runtime summary:
  `node --test tests/product/z2k-candidate-compatibility.test.mjs tests/product/z2k-runtime-summary.test.mjs`
  exited `0`; `8/8` passed.
- `node --check tests/product/z2k-coherent-candidate.test.mjs; git diff --check`
  exited `0`.
- WSL ucode import checks for `z2k-coherent-candidate.uc`, `z2k-compat.uc`,
  `z2k-dependency-closure.uc`, and `runtime-composition.uc` all exited `0`
  and printed `:ok` for each module.

### Required-suite and validator status

- The runtime-composition focused suite is not fully green only because of the
  pre-existing `resource-update.uc` static mismatch recorded above. This is not
  claimed as a Task 3 failure or repaired outside scope.
- The dependency-closure baseline mismatch remains unchanged: its existing
  test reports actual `{blobs: 4, runtime: 0, builtins: 0}` versus expected
  `{blobs: 3, runtime: 1, builtins: 1}`. Task 3 does not own closure
  classification logic.
- The repository-wide recursive test run retains unrelated baseline failures
  (Quartz/public artifacts, package/postinst fixtures, Scanner/runtime/status/
  native-root checks, and Windows `process.getuid` incompatibility); it was
  bounded and not used as a Task 3 success gate. The invalid literal command
  `node --test tests` still fails immediately with `MODULE_NOT_FOUND` because
  `tests` is a directory entry, not a Node test file.
- `node scripts/validate-knowledge.mjs` exited `0`: `Knowledge validation
  passed.`
- `node scripts/docs.mjs verify` exited `0`: `Quartz SHA verified:
  ab346fa66a895e12d63a308e70ce330ba795822a8`.
- The post-append `git diff --check` exited `0`.
- The post-append `node --check tests/product/z2k-coherent-candidate.test.mjs`
  exited `0`.

### Commit and final scope boundary

Fix-round implementation commit hash: `a584cfcd`.

The report append is committed separately as a documentation-only follow-up so
the implementation hash above remains exact. The final report commit hash is
recorded in the final clean-worktree verification.

The Task 5 Detect staging boundary remains preserved: this change validates
Detect identity and coherent membership only; it does not stage, execute,
publish, or supervise Detect. No synthetic/fake success path was introduced.
No router/browser acceptance is claimed.

### Final bounded rerun after interruption

No matching worktree `node`/`wsl`/`ucode` test or validator process remained
when checked after the interrupted command.

The final bounded WSL commands used `timeout 30s` and the configured ucode
runtime (`UCODE_BIN=/opt/ucode/bin/ucode`, `LD_LIBRARY_PATH=/opt/ucode/lib`):

- `node --test tests/product/z2k-coherent-candidate.test.mjs` exited `0`:
  `8` passed, `0` failed, `0` skipped, `0` todo.
- `node --test tests/product/z2k-runtime-composition.test.mjs` exited `1`:
  `23` passed, `1` failed, `1` skipped, `1` todo. The exact failure is
  subtest 2 at `tests/product/z2k-runtime-composition.test.mjs:112`: the
  existing regex `/target\.runtimeBundleDigest = target\.dependencyClosure/`
  does not match `resource-update.uc`. All Task 3 candidate/resolver
  subtests passed. The command completed in about `1.93s`, well inside the
  30-second bound.

The WSL launcher emitted its environment warning about `networkingMode Nat` /
`networkingMode VirtioProxy`; it did not prevent either test from running.

The interrupted validator batch did not leave a running process. Earlier
post-report validator results remain: `node scripts/validate-knowledge.mjs`
exit `0` (`Knowledge validation passed`), `node scripts/docs.mjs verify` exit
`0` (`Quartz SHA verified: ab346fa66a895e12d63a308e70ce330ba795822a8`),
`node --check tests/product/z2k-coherent-candidate.test.mjs` exit `0`, and
`git diff --check` exit `0`.
