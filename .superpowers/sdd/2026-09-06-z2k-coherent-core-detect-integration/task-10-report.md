# Task 10 report: fixed native-helper Detect operations

Status: IMPLEMENTED; router deployment, browser acceptance, merge and push were not run.

## Scope

Added the five typed operations `z2k_detect_probe`, `z2k_detect_classify`,
`z2k_detect_quic`, `z2k_detect_voice`, and `z2k_detect_tcp16`. The native
boundary accepts only typed host/port/repeats/timeout fields (plus `hello` for
classify), always uses the fixed `/usr/libexec/zapret2-manager/z2k-detect`
identity, and constructs argv in native memory before `execve`. Executable,
argv, command, env, cwd, unknown fields, invalid host/port, embedded NUL/newline,
and oversized timeout/repeats are rejected.

The one-shot runner bounds stdout/stderr to 65536 bytes, applies a monotonic
wall deadline, creates a process group, kills the group on timeout/overflow,
reaps the child, and returns `exitCode`, `stdout`, `stderr`, and `timedOut`.
The existing helperd broker remains the outer fixed-child/concurrency and
transport supervision boundary; no shell command is introduced.

## TDD evidence

RED was observed before implementation from the new focused test: the new
operation was not recognized and the helper returned `ESCHEMA` instead of the
typed result. The required classify argv behavior therefore failed before the
production dispatch/runner existed.

GREEN:

```text
node --test tests/native/z2k-detect-helper.test.mjs
3 passed, 0 failed
```

Focused coverage includes exact classify argv:

```text
/usr/libexec/zapret2-manager/z2k-detect classify example.com:443 -hello modern -repeats 3 -timeout 6s -json
```

and protocol rejection plus timeout/process-group cleanup.

## Verification

- `tests/native/core/fs-helper-protocol.test.mjs`, `scanner-probe-native.test.mjs`, and `native-helper-broker.test.mjs`: `71 passed, 0 failed`.
- Broad bounded `tests/native/*.test.mjs` run: `112 passed, 16 failed`; the failures are existing baseline failures in package/avatar/package-helper, service-start, Lua manifest, knowledge/static expectations, and the WSL linked-worktree Git-pointer boundary. No Task 10 focused test failed.
- UCode import/syntax check for `z2k-detect.uc`: passed with `/opt/ucode/bin/ucode`.
- `node --check tests/native/z2k-detect-helper.test.mjs`: passed.
- `node scripts/validate-knowledge.mjs`: `Knowledge validation passed.`
- `git diff --check`: passed.

## Commit and boundaries

Commit: `8b750521` (implementation and focused report).

Not run: router deployment, live Detect execution on OpenWrt, browser/RPC
acceptance, package-E2E, merge, push. Unrelated Scanner work was preserved.

## Fix-round 1 — independent-review corrections

Status: IMPLEMENTED. This round is scoped to the reviewed Task 10 findings;
router deployment, browser acceptance, live Detect execution, merge and push
remain intentionally out of scope.

### Corrections

- Added the canonical production reachability seam: `z2k-detect.uc` owns the
  five typed adapter calls, `core/native-helper.uc` owns the fixed broker
  transport, and the canonical rpcd object plus ACL register all five
  `z2k_detect_*` methods. No legacy `scanner_*` fallback is used by them.
- Added all five implemented operations and their request/result contracts to
  `protocol-v1.json`, keeping native `protocol.c` validation and dispatch
  closed to the same operation set.
- Added strict DNS, IPv4 and IPv6 validation at native and adapter boundaries.
  Empty/colon/malformed IPv6 values, invalid labels and numeric dotted values,
  embedded NUL/control characters, and invalid ports are rejected. IPv6
  endpoints are constructed as `[address]:port`.
- The adapter rejects unknown fields, including `executable`, `argv`,
  `command`, `env`, and `cwd`, before the native seam. The native child always
  uses `/usr/libexec/zapret2-manager/z2k-detect`, fixed environment, typed
  `execve()` argv, and no shell boundary.
- Bounded output overflow is reported as `outputTruncated: true` with
  `timedOut: false`; wall-clock expiry remains `timedOut: true`. Both streams
  remain capped at 65536 bytes. The fixed child group is established from both
  sides of `fork()`, killed and reaped on timeout/overflow, and the existing
  helperd broker remains the outer singleton, serial-concurrency and
  process-group supervision boundary. The inner typed runner is required to
  capture Detect stdout and stderr separately; it accepts no caller controls.

### TDD evidence

RED was captured before the fix-round implementation with:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 17 tests, 11 passed, 4 failed, 2 skipped. The expected regressions
were missing IPv6 endpoint brackets, the timeout fixture not being reported as
timed out, overflow being mislabeled as timeout, and absent production
Detect-RPC registration.

The final focused native/helper/adapter run was:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 44 passed, 0 failed. The Detect helper subset itself was 5 passed,
including exact classify argv, strict rejection, IPv6 formatting, bounded
timeout/process-group cleanup with a descendant marker, and separate output
truncation metadata.

The final bounded Task 10/native/helper/artifact aggregate was:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs tests/native/core/native-helper.test.mjs tests/native/core/scanner-probe-native.test.mjs tests/native/core/native-helper-broker.test.mjs tests/native/package-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-artifact.test.mjs'
```

Result: 170 tests, 167 passed, 3 failed. The three failures are existing
`package-helper.test.mjs` baseline/environment failures (bootstrap failure
fixture, managed-root traversal expectation, and Task 4 source-hash lookup
through the Windows linked-worktree Git pointer). All Task 10 helper,
protocol, broker, adapter/RPC and artifact tests passed; the relevant package
helper closed-surface test also passed.

The bounded broad native command was:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && timeout 180s node --test tests/native/*.test.mjs 2>&1 | tail -50'
```

Result: 130 tests, 114 passed, 16 failed. The failures remain the previously
observed unrelated avatar/package-helper/service/Lua/knowledge/static and
linked-worktree baseline failures; no Task 10 test failed in that run.

### Additional checks and boundaries

- Node syntax checks passed for the changed native/product tests.
- `protocol-v1.json` parsed successfully with Node.
- `node scripts/validate-knowledge.mjs` passed with `Knowledge validation passed.`
- `git diff --check` passed.
- The focused helper compiled with the available WSL `cc` and `pkg-config`
  `json-c` toolchain. No Windows C compiler or router toolchain was claimed.
- UCode module import/seam tests passed with `/opt/ucode/bin/ucode` and its
  WSL library path. Full router rpcd execution, OpenWrt helper installation,
  browser acceptance and live network Detect results were not run.

Commit: `3e6e2edaaff03df6b47a0938fe88fbf5e3bfd480` (`fix: close Task 10 Detect reachability and supervision`; corrected from the stale short reference `d8412a10`).

## Fix-round 2 — bounded Detect output validation

Status: IMPLEMENTED. This round closes the reviewed output-validation gap;
router deployment, browser acceptance, live Detect execution, merge and push
remain intentionally out of scope.

### Corrections

- Added `core/detect-result.uc` as the shared canonical typed Detect result
  validator. Both `core/native-helper.uc` and `z2k-detect.uc` use it; no
  second public adapter or native-helper authority was introduced.
- The native C boundary parses normal Detect stdout with json-c, requires one
  bounded top-level JSON object, rejects malformed/trailing/non-object/NUL
  output with `ESCHEMA`, and leaves timeout/output overflow as distinct typed
  metadata. The helper maps Detect schema failures to `EDETECT_SCHEMA`.
- The shared validator rejects unknown outer result metadata, oversized
  stdout, invalid/non-object operation output, wrong required field types and
  missing operation-required fields. Safe additive fields inside the existing
  operation result payloads remain tolerated as specified. A complete
  malformed result can never return `ok: true` through the adapter/RPC seam.
- `z2k-detect.uc` preserves bounded `stderr` only as normalized failure
  diagnostics (4096 bytes), maps `timedOut` to `EDETECT_TIMEOUT`, and maps
  `outputTruncated` to `EDETECT_FAILED` without changing the native metadata.

### TDD evidence

RED was captured before this fix-round implementation with:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 180s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 49 tests, 45 passed, 4 failed. The failures were malformed Detect
stdout being accepted at the native/helper and adapter seams, plus timeout
and bounded-output metadata not being normalized distinctly.

GREEN focused rerun:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 180s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 49 tests, 49 passed, 0 failed. Coverage includes all five typed
operations with malformed, truncated, non-object, wrong-type, missing,
unknown-metadata and valid fixtures; exact argv; strict host/port rejection;
and timeout/output-overflow metadata preservation and normalization.

### Verification

Final bounded aggregate:

```text
wsl.exe -e bash -lc 'set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs tests/native/core/native-helper.test.mjs tests/native/core/scanner-probe-native.test.mjs tests/native/core/native-helper-broker.test.mjs tests/native/package-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-artifact.test.mjs'
```

Result: 175 tests, 172 passed, 3 failed. The three failures remain unrelated
baseline/environment failures: `package and service lifecycle fail closed when
bootstrap fails`, `native bootstrap solely owns managed roots and recursive
parent traversal`, and `Task 4 source hashes bind the recorded executed input
commit blobs`. The latter is the Windows linked-worktree Git-pointer boundary;
all Task 10 native/helper/broker/adapter/RPC/artifact tests passed.

- `node --check` passed for all changed `.mjs` tests.
- `protocol-v1.json` parsed successfully; all five `z2k_detect_*` operations
  remain present in the canonical manifest and native registry.
- `node scripts/validate-knowledge.mjs` passed: `Knowledge validation passed.`
- PowerShell `git diff --check` and staged diff check passed. WSL Git-based
  diff/source-hash checks cannot resolve this Windows linked-worktree pointer.
- WSL `cc` plus `pkg-config json-c` compilation passed through the focused
  native Detect test (`-std=c11 -Wall -Wextra -Werror`); no Windows C compiler
  or router toolchain was claimed. UCode import/seam tests passed with
  `/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`.

### Commits and boundaries

- Implementation/tests: `f39fa957d26f4363b424ddd69e094819b05b7835`
  (`fix: validate Task 10 Detect JSON results`).
- Report: the separate final report commit recorded as the exact final HEAD in
  the handoff below.
- Not run: router/OpenWrt deployment, live network Detect, browser acceptance,
  merge, push, or deployment. Unrelated Scanner work was preserved.

## Fix-round 3 — native result schemas and boundary consistency

Status: IMPLEMENTED. This round addresses the final re-review findings only;
router deployment, browser acceptance, live Detect execution, merge and push
remain intentionally out of scope.

### Corrections

- `scanner.c` now parses and validates the existing operation-specific Detect
  result contract before emitting native `ok: true`: required fields and
  types are enforced for `probe`, `classify`, `quic`, `voice`, and `tcp16`.
  Unknown/incompatible or missing-field fixtures therefore fail at the
  native boundary with `ESCHEMA`; the ucode/RPC validator remains strict and
  unchanged as the typed adapter check. Timeout and bounded-output paths keep
  their incomplete stdout and metadata semantics.
- `core/detect-result.uc` raises the argv element bound to 320, covering the
  actual 253-character hostname plus endpoint suffix and fixed options while
  retaining fixed argv structure and control-character rejection. Maximum
  valid and overlong hostname tests cover native, helper and adapter seams.
- `core/native-helper.uc` now applies the same leading/trailing-colon guard
  as `z2k-detect.uc` for uncompressed IPv6 values.

### TDD evidence

RED was captured after adding the fix-round regressions and before the
implementation:

```text
wsl.exe -e bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 180s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 54 tests, 50 passed, 4 failed. The failures were native operation
specific fixture acceptance, native-helper max-length hostname rejection,
native-helper trailing-colon IPv6 acceptance, and adapter max-length
hostname rejection.

GREEN focused run:

```text
wsl.exe -e bash -lc 'set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 180s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/native-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs'
```

Result: 54 tests, 54 passed, 0 failed. The focused product RPC suite was
also run independently: 7 passed, 0 failed.

### Verification

Final bounded aggregate:

```text
wsl.exe -e bash -lc 'set -o pipefail; cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && export UCODE_BIN=/opt/ucode/bin/ucode LD_LIBRARY_PATH=/opt/ucode/lib && timeout 240s node --test tests/native/z2k-detect-helper.test.mjs tests/native/core/fs-helper-protocol.test.mjs tests/native/core/native-helper.test.mjs tests/native/core/scanner-probe-native.test.mjs tests/native/core/native-helper-broker.test.mjs tests/native/package-helper.test.mjs tests/product/z2k-detect-rpc.test.mjs tests/product/z2k-detect-artifact.test.mjs'
```

Result: 180 tests, 177 passed, 3 failed. The same unrelated baseline failures
remain: `package and service lifecycle fail closed when bootstrap fails`,
`native bootstrap solely owns managed roots and recursive parent traversal`,
and `Task 4 source hashes bind the recorded executed input commit blobs`.
The last is the Windows linked-worktree Git-pointer boundary; all Task 10
native C, helper, broker, adapter/RPC and artifact tests passed.

- Focused WSL compilation passed with `cc -std=c11 -Wall -Wextra -Werror`,
  `pkg-config json-c`, and the native Detect fixture for all five operations.
- `node --check` passed for all changed `.mjs` tests.
- `protocol-v1.json` parsed successfully; canonical operation registrations
  remain unchanged and include all five `z2k_detect_*` names.
- `node scripts/validate-knowledge.mjs` passed: `Knowledge validation passed.`
- PowerShell `git diff --check` and staged diff check passed. UCode imports and
  seams passed with `/opt/ucode/bin/ucode` and `LD_LIBRARY_PATH=/opt/ucode/lib`.

### Commits and boundaries

- Fix-round 3 implementation/tests: `74bd5984e57f338185034c7c314a4d0146bdcca1`
  (`fix: validate Detect results at native boundary`).
- Report: separate final report commit; exact hash is the final HEAD returned
  in the handoff below.
- Base before this round: `f4cb82d0be707866a2b556446961e16fcb562ba9`.
- Not run: router/OpenWrt deployment, live network Detect, browser acceptance,
  merge, push, or deployment. Unrelated Scanner work was preserved.
