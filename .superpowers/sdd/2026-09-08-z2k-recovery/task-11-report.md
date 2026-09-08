# Task 11 — native Detect extraction and legacy Scanner removal

Status: IMPLEMENTATION_COMPLETE_PENDING_CI_RUNTIME

## Implementation

- Created `zapret2-manager/src/z2m-core-helper/detect.c` with only the five typed Detect operations, fixed executable path, bounded supervision, output limits, and canonical result validation.
- Removed `zapret2-manager/src/z2m-core-helper/scanner.c`; no legacy profile/TLS/body/STUN execution was moved.
- Removed `scanner_probe` from the native protocol manifest, C validation/dispatch, helper ABI, and UCode adapter export.
- Updated both package Makefiles and native contract tests to compile and assert `detect.c`.

## Verification

- `wsl.exe ... node --test tests/native/z2k-detect-helper.test.mjs`: **8 passed, 0 failed**; the helper compiled with `-std=c11 -Wall -Wextra -Werror`.
- Focused package/adapter gate (`package target-builds`, `package prepares`, `native helper adapter`) plus `native-helper.test.mjs`: **4 passed, 0 failed**.
- Combined protocol/closure/unwired/upstream/native command: **57 passed, 3 failed**. The three failures are existing package-helper environment/worktree checks unrelated to this task: bootstrap reload ordering, managed-root scanner fixture, and `git show` from the WSL worktree path. All Task 11 closure and protocol tests passed.
- Production grep excluding tests/docs finds no `scanner_probe`, `z2m_scanner_probe`, or `scanner.c` reference. Runtime blacklist entries containing `scanner` are unrelated domains.
- `git diff --check` passed.

## Boundary

Router absence of the old RPC/protocol is not claimed yet because the router still has the previously installed native binary. The remaining runtime proof must use a CI-produced package; APK build remains CI-only. No local APK build, router package install, merge, push, branch deletion, or worktree deletion was performed.
