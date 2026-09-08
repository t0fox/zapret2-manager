# Z2K recovery Task 1 baseline

Captured 2026-09-08 in `G:\zapret2-manager\.worktrees\z2k-recovery-v2` before production edits.

## Git truth

| Field | Value |
| --- | --- |
| Branch | `codex/z2k-recovery-v2` |
| HEAD / execution SHA | `4387345bc50d684214e8b5b97edc7c40acb7629f` |
| `origin/main` / reviewed baseline | `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39` |
| Worktree status | clean before Task 1 evidence edits; branch tracks `origin/docs/z2k-recovery-design` |
| Worktree location | `G:/zapret2-manager/.worktrees/z2k-recovery-v2` |

`git diff --name-status 9a4f0feeacbfd9d107385ffeffb5007b4bfadb39..HEAD` reports only:

```text
A docs/superpowers/plans/2026-09-08-z2k-recovery.md
A docs/superpowers/specs/2026-09-08-z2k-recovery-design.md
```

Drift classification: both files are approved recovery plan/spec drift and are ordinary engineering context, not production drift. No overlapping production path was changed relative to the reviewed baseline.

## Focused baseline tests

Exact command from the brief:

```text
node --test tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-discovery-service.test.mjs tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs tests/ui/system-components-details-presentation.test.mjs tests/product/z2m-resources-model.test.mjs
```

Host Windows run used `UCODE_BIN=/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`, but `/opt/ucode/bin/ucode` is not available on Windows. Result: **145 tests, 91 pass, 20 fail, 34 skipped**, exit 1. The native failures report `null !== 0` from the compile precondition; the remaining failures are the pre-existing Scanner/Resources/Components assertions listed in that run output. This is classified **HOST_UNAVAILABLE/BASELINE_RED**, not a product PASS.

Canonical WSL rerun used:

```text
wsl.exe bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v2 && export UCODE_BIN=\${UCODE_BIN:-/opt/ucode/bin/ucode} && export LD_LIBRARY_PATH=\${LD_LIBRARY_PATH:-/opt/ucode/lib} && node --test <the exact file list above>"
```

Result: **145 tests, 98 pass, 13 fail, 34 skipped**, exit 1. The WSL-native compile gates ran; the exact native failure was `enforces operation-specific native Detect result schemas for every operation` (`tests/native/z2k-detect-helper.test.mjs:126`, `true !== false`). The other 12 failures are existing Resources/Components/Scanner presentation and action-contract assertions, including `z2m-resources-model.test.mjs` and `system-components-details-presentation.test.mjs`. This is classified **BASELINE_RED**, with no production edits made to cause it.

## Router read-only evidence

Command:

```text
ssh.exe -o BatchMode=yes -o ConnectTimeout=5 root@192.168.1.1 'ubus -S call zapret2-manager status_fast'
```

It succeeded with `{"ok":true,"schema":"status-fast.v1","serviceState":"running"}`; reported `nfqws2` PID `3812`, NFQUEUE `300`, registered queue owner, and `strategyStatus.id=z2k:z2k_all_in_one`. No router mutation, restart, install, or traffic test was performed.

## APK baseline evidence

Exact CI evidence is available from run `34233470570`:

```text
gh run view 34233470570 --repo t0fox/zapret2-manager --json status,conclusion,headBranch,headSha,workflowName,url
{"conclusion":"success","headBranch":"docs/z2k-recovery-design","headSha":"4387345bc50d684214e8b5b97edc7c40acb7629f","status":"completed","workflowName":"OpenWrt full APK build","url":"https://github.com/t0fox/zapret2-manager/actions/runs/34233470570"}
gh api repos/t0fox/zapret2-manager/actions/runs/34233470570/artifacts --jq '.artifacts[] | {name,size_in_bytes,expired,archive_download_url}'
{"name":"z2m-full-apk-4387345bc50d684214e8b5b97edc7c40acb7629f","size_in_bytes":2640675,"expired":false}
```

| Field | Value |
| --- | --- |
| CI run | `34233470570` (https://github.com/t0fox/zapret2-manager/actions/runs/34233470570) |
| Artifact | `z2m-full-apk-4387345bc50d684214e8b5b97edc7c40acb7629f` |
| Manifest gitCommit | `4387345bc50d684214e8b5b97edc7c40acb7629f` |
| APK | `zapret2-manager-full-0.1.0-r156.apk` |
| APK bytes | `2645317` |
| APK SHA-256 | `5018e250f4fd1ddeec6e1ca5ad6a262d5d2ae2922e89fd3f869f51fcc81c3f69` |
| Baseline native helper bytes | `81915` |
| Baseline native helper SHA-256 | `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76` |
| Manifest gitRef | `refs/heads/docs/z2k-recovery-design` |

The artifact was obtained from CI with `gh run download 34233470570 --repo t0fox/zapret2-manager --name z2m-full-apk-4387345bc50d684214e8b5b97edc7c40acb7629f`. The downloaded manifest and `SHA256SUMS` match the exact execution SHA and APK hash above. CI extracted the helper at `81915` bytes with SHA-256 `8e7b79a06e5bf39f67af0fa6c878b104ae761843a295f0abb14970723c189b76`. No local `scripts/release/build-apk.sh` invocation occurred; the user CI-only ruling remains binding.

## Source and file-count baseline

| Path / measure | Bytes / count |
| --- | ---: |
| `zapret2-manager/src/z2m-core-helper/scanner.c` | 58634 |
| `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js` | 34441 |
| `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js` | 142143 |
| `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js` | 51088 |
| `find zapret2-manager/files luci-app-zapret2-manager/files -type f | sort | wc -l` | 469 |
