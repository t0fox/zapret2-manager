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

Commit: `d8412a10` (`fix: close Task 10 Detect reachability and supervision`).
