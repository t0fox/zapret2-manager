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
