# Task 1 completion review — Z2K recovery

Date: 2026-09-08
Reviewed range: `70e816ac10620341c2ca29c398eb90e0834cad06..36b79899f920f4649a0a6e7741d4df2cc218280`
Scope: final evidence only; no product, router, branch, merge, push, or deletion actions.

## Verdicts

- SPEC COMPLIANCE: PASS — Task 1 evidence gates are complete and the ledger state `VERIFIED` is justified for the baseline/evidence task. This is not product, router, browser, or full-recovery acceptance.
- CODE QUALITY: PASS — the completion diff is narrow, docs-only, internally consistent, and resolves the prior exact-SHA evidence blocker without relabeling unrelated artifacts.
- Overall: ACCEPTED for Task 1 completion evidence.

## Evidence verification

### CI execution identity

Live read-only verification of run `34233470570` returned:

- status `completed`, conclusion `success`;
- workflow `OpenWrt full APK build`;
- head branch `docs/z2k-recovery-design`;
- head SHA `4387345bc50d684214e8b5b97edc7c40acb7629f`.

The SHA is a valid Git commit and is the captured baseline/execution SHA recorded in `baseline.md`, `size-baseline.json`, `ledger.md`, and `task-1-report.md`. The CI artifact API returned the non-expired artifact `z2m-full-apk-4387345bc50d684214e8b5b97edc7c40acb7629f`. Therefore the prior exact-execution-SHA blocker is resolved.

### Artifact manifest, hashes, and bytes

The four evidence files agree on the artifact identity and fields:

- APK: `zapret2-manager-full-0.1.0-r156.apk`
- APK bytes: `2645317`
- APK SHA-256: `5018e250f4fd1ddeec6e1ca5ad6a262d5d2ae2922e89fd3f869f51fcc81c3f69`
- manifest commit: `4387345bc50d684214e8b5b97edc7c40acb7629f`
- manifest ref: `refs/heads/docs/z2k-recovery-design`
- native helper: `usr/libexec/zapret2-manager/z2m-core-helper`
- helper bytes: `81915`
- helper SHA-256: `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76`

The CI artifact archive size `2640675` is distinct from the extracted APK payload size `2645317`; it is not presented as the APK byte count. The artifact name embeds the same execution SHA, and the manifest commit/hash/helper values match across the report and JSON baseline.

### Baseline and scope

- WSL focused baseline balances to `145 = 98 pass + 13 fail + 34 skipped`, exit 1.
- Windows host baseline balances to `145 = 91 pass + 20 fail + 34 skipped`, exit 1; unavailable Windows UCode is explicitly classified as host-unavailable, not product PASS.
- Source byte counts and package file count are repeated consistently: `58634`, `34441`, `142143`, `51088`, and `469`.
- The reviewed range changes only `baseline.md`, `ledger.md`, `size-baseline.json`, and `task-1-report.md` under the recovery evidence directory.
- The report explicitly records that `scripts/release/build-apk.sh` was not run locally. No local APK build is implied.
- Router evidence is one read-only `status_fast` probe. The documents explicitly state no install, restart, traffic test, or other router mutation. Nothing in the completion diff implies product or router mutation.
- `ledger.md` uses the literal state `VERIFIED` for Task 1 and keeps Tasks 2–17 `TODO`; this is consistent with Task 1 being an evidence-capture task, not with claiming the recovery is complete.

## Findings

### P0

None.

### P1

None.

### P2

None. Prior review P2 findings about commit-role wording and the captured-SHA/current-HEAD distinction are addressed in the supplied history; the final completion diff does not reintroduce them.

### P3

None.

## Explicit boundaries

The focused baseline remains red and no router/browser acceptance is claimed. `VERIFIED` applies only to Task 1's recorded baseline, drift, size, read-only router observation, and exact execution-SHA CI artifact evidence. Later implementation and acceptance tasks remain unverified as shown by the ledger.
