# Task 17 implementation report

Date: 2026-09-09

## RED

Command:

```text
node --test tests/product/z2k-detect-rpc-boundary.test.mjs
```

Expected failure observed before the production change: **4 tests, 3 pass,
1 fail**. The new `Detect RPC strips rpcd transport session metadata before
forwarding` test returned the existing `EINPUT` / `Detect request fields are
invalid.` result for a real `req.args` containing the exact operation fields
plus `ubus_rpc_session`.

## Implementation

- Commit: `cd970b40` (`fix(rpcd): ignore transport session in Detect input`)
- Added the focused regression for all five typed Detect operations.
- `z2k_detect_rpc_input()` now copies `req.args` while removing only the
  rpcd transport-only `ubus_rpc_session` key, then applies the existing exact
  field-count and field-name boundary. All other unknown, unsafe, missing, and
  wrongly typed input remains subject to the existing downstream validation.

## GREEN and verification

- `node --test tests/product/z2k-detect-rpc-boundary.test.mjs` — **4 pass, 0
  fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-detect-rpc.test.mjs"` — **15 pass, 0 fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/native/z2k-detect-helper.test.mjs"` — **8 pass, 0 fail, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-recovery-v3 && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib LD_LIBRARY_PATH=/opt/ucode/lib node --test --test-concurrency=1 tests/product/z2k-detect-rpc.test.mjs tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs"` — **62 total, 61 pass, 1 fail, 0 skipped**. The one failure is the pre-existing
  `native-helper.test.mjs` TCP16 malformed-output assertion (`not-json`,
  `true !== false`), outside the Task 17 files and unchanged by this fix.
- `node --check tests/product/z2k-detect-rpc-boundary.test.mjs` — pass.
- `LD_LIBRARY_PATH=/opt/ucode/lib /opt/ucode/bin/ucode -c -s -o /tmp/task17-zapret2-manager.uc zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` — blocked by the source checkout's uninstalled absolute `/usr/libexec` imports/exports; no package/router staging was performed.
- `node scripts/validate-knowledge.mjs` — `Knowledge validation passed.`
- `git diff --check` — pass.

## Concerns

No router/live evidence was collected, per task scope; controller-owned live
proof is still needed. The existing native TCP16 baseline failure and the
uninstalled UCode module import boundary remain separate concerns.
