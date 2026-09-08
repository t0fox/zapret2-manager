# Task 1 implementer report

Date: 2026-09-08
Worktree: `G:\zapret2-manager\.worktrees\z2k-recovery-v2`
Implementer: Codex only; no agents or reviewers spawned.

## Status

**PARTIAL / BLOCKED_EXACT_SHA_APK**. Ledger, baseline, and size baseline are captured. Exact execution-SHA APK evidence is blocked because `HEAD=4387345bc50d684214e8b5b97edc7c40acb7629f` is not published as a remote branch, while local `scripts/release/build-apk.sh` is prohibited. The available CI artifact is recorded without relabeling it: it targets reviewed baseline `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39`.

## Git truth and drift

- Branch: `codex/z2k-recovery-v2`
- HEAD: `4387345bc50d684214e8b5b97edc7c40acb7629f`
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

`d6ceee5c98635cdba25ce14bce40b9041fbf2ced` (`docs: record Z2K recovery baseline`).
