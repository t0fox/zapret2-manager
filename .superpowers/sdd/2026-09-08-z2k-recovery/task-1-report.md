# Task 1 implementer report

Date: 2026-09-08
Worktree: `G:\zapret2-manager\.worktrees\z2k-recovery-v2`
Implementer: Codex only; no agents or reviewers spawned.

## Status

**PARTIAL / BLOCKED_EXACT_SHA_APK**. Ledger, baseline, and size baseline are captured. Exact execution-SHA APK evidence is blocked because captured baseline/execution SHA `4387345bc50d684214e8b5b97edc7c40acb7629f` is not published as a remote branch, while local `scripts/release/build-apk.sh` is prohibited. The available CI artifact is recorded without relabeling it: it targets reviewed baseline `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`.

## Git truth and drift

- Branch: `codex/z2k-recovery-v2`
- Captured baseline/execution SHA: `4387345bc50d684214e8b5b97edc7c40acb7629f`
- origin/main: `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`
- Drift from reviewed baseline: only approved plan/spec additions `docs/superpowers/plans/2026-09-08-z2k-recovery.md` and `docs/superpowers/specs/2026-09-08-z2k-recovery-design.md`; no production-path drift.

## Baseline evidence

- Focused WSL: **145 total, 98 pass, 13 fail, 34 skipped**, exit 1. The first native failure is `tests/native/z2k-detect-helper.test.mjs:126`, operation-specific Detect schema assertion (`true !== false`); remaining 12 failures are existing Resources/Components/Scanner contract assertions.
- Focused Windows host: **145 total, 91 pass, 20 fail, 34 skipped**, exit 1. Native compile preconditions report `null !== 0` because `/opt/ucode/bin/ucode` is unavailable on Windows; classified host unavailable, not product PASS.
- Router read-only: `ssh.exe -o BatchMode=yes -o ConnectTimeout=5 root@192.168.1.1 'ubus -S call zapret2-manager status_fast'` succeeded with `ok=true`, service running, nfqws2 PID 3812, NFQUEUE 300 registered, strategy `z2k:z2k_all_in_one`. No router mutation, restart, install, or traffic test.
- Source sizes: scanner.c 58634; z2m-scanner.js 34441; z2m-maintenance.js 142143; z2m-assets.js 51088; package file count 469.
- Existing CI APK: `zapret2-manager-full-0.1.0-r156.apk`, 2645317 bytes, SHA-256 `5018e250f4fd1ddeec6e1ca5ad6a262d5d2ae2922e89fd3f869f51fcc81c3f69`, manifest commit `9a4f0fee...`; extracted helper 81915 bytes, SHA-256 `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76`.
- CI dispatch attempt: `gh workflow run apk-build.yml --repo t0fox/zapret2-manager --ref codex/z2k-recovery-v2` -> HTTP 422, `No ref found for: codex/z2k-recovery-v2`.
- Local APK build: **not run**, by explicit user constraint.

## Files

- `.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md`
- `.superpowers/sdd/2026-09-08-z2k-recovery/baseline.md`
- `.superpowers/sdd/2026-09-08-z2k-recovery/size-baseline.json`
- `.superpowers/sdd/2026-09-08-z2k-recovery/task-1-report.md`

## Commit

Baseline-artifact commit: `d6ceee5c98635cdba25ce14bce40b9041fbf2ced` (`docs: record Z2K recovery baseline`).
Report-finalization/evidence commit: `7b2bed0d1f248ef36217147605282c239444015` (`docs: finalize Z2K recovery Task 1 report`).

## Fix round 1 — reviewer findings

Applied the two P2 documentation fixes from `reviews/review-task-1.md`:

- The two prior commits are now explicitly distinguished as the baseline-artifact commit (`d6ceee5c...`) and the report-finalization/evidence commit (`7b2bed0d...`).
- Every report occurrence of the captured baseline/execution SHA is labelled accordingly; it is not presented as the current documentation commit.

Covering checks, run after the fix and before the fix-round commit:

```text
$report='.superpowers/sdd/2026-09-08-z2k-recovery/task-1-report.md'; $shaLines=Select-String -Path $report -Pattern '[0-9a-f]{40}'; if($shaLines | Where-Object { $_.Line -notmatch 'captured baseline/execution SHA|baseline-artifact commit|report-finalization/evidence commit|reviewed baseline|manifest commit|origin/main' }){throw 'unlabelled SHA role'}; if((Select-String -Path $report -Pattern 'baseline-artifact commit').Count -ne 3){throw 'baseline commit role missing'}; if((Select-String -Path $report -Pattern 'report-finalization/evidence commit').Count -ne 3){throw 'report commit role missing'}; 'SHA role labels: PASS'
SHA role labels: PASS

$changed=@(git diff --name-only HEAD); if($changed | Where-Object { $_ -notlike '.superpowers/sdd/2026-09-08-z2k-recovery/*' }){throw 'product file changed'}; 'Product-file scope: PASS (docs-only)'
Product-file scope: PASS (docs-only)
```

```text
node scripts/validate-knowledge.mjs
Knowledge validation passed.
git diff --check
(no output; exit 0)
```

## Fix round 2 — scoped re-review finding

Applied the scoped finding from `reviews/review-task-1-fix1.md`: ledger line 84
now labels `4387345bc50d684214e8b5b97edc7c40acb7629f` as the captured
baseline/execution SHA, and records `b002c26a70d828d42d120c1ee95b92d015f9b947`
separately as the current documentation HEAD at fix-round-2 start.

Covering checks, run after the fix and before the fix-round-2 commit:

```text
$ledger='.superpowers/sdd/2026-09-08-z2k-recovery/ledger.md'; if(Select-String -Path $ledger -Pattern 'Execution `HEAD` is `4387345|Execution HEAD.*4387345'){throw 'stale current-HEAD label remains'}; if(-not (Select-String -Path $ledger -Pattern 'Captured baseline/execution SHA is `4387345')){throw 'captured SHA label missing'}; 'Ledger SHA role labels: PASS'
Ledger SHA role labels: PASS

git rev-parse HEAD
b002c26a70d828d42d120c1ee95b92d015f9b947

$changed=@(git diff --name-only HEAD); if($changed | Where-Object { $_ -notlike '.superpowers/sdd/2026-09-08-z2k-recovery/*' }){throw 'product file changed'}; 'Product-file scope: PASS (docs-only)'
Product-file scope: PASS (docs-only)

node scripts/validate-knowledge.mjs
Knowledge validation passed.
git diff --check
(no output; exit 0)
```
