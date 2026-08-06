# Native Filesystem Helper Read Milestone Report

## Status

`LOCAL_VERIFIED`

The first C filesystem-helper milestone is implemented in the isolated
`feat/native-fs-helper` worktree. OpenWrt toolchain/package integration was out
of scope, so target evidence remains `SDK_REQUIRED`. Router ownership, overlay,
reboot, and power-loss evidence remains `ROUTER_REQUIRED`.

## Files

- `tests/native/core/build-fs-helper.sh`: strict C11/json-c Linux build harness.
- `tests/native/core/fs-helper.test.mjs`: executable parser, policy, traversal,
  object-type, read-boundary, mount, race, and test-build separation tests.
- `zapret2-manager/src/z2m-core-helper/helper.h`: internal bounded interfaces.
- `main.c`: one-request lifecycle and closed operation dispatch.
- `protocol.c`: bounded input, UTF-8/duplicate/trailing checks, closed schemas.
- `errors.c`: bounded complete envelopes, diagnostics, and exit categories.
- `roots.c`: compiled root table, secure ancestor/root descriptor opening, and
  test-only prefix substitution under `Z2M_TESTING`.
- `paths.c`: canonical relative path and depth validation.
- `files.c`: `openat2` traversal, descriptor fallback, regular stat/read.
- `base64.c`: canonical padded base64 encoding.

## RED

`node --test tests/native/core/fs-helper.test.mjs` failed all 12 initial tests
because the harness could not compile absent `main.c`, `protocol.c`, `errors.c`,
`roots.c`, `paths.c`, `files.c`, and `base64.c`. A later focused reserved-schema
test failed with exit 3 `EUNSUPPORTED` instead of exit 2 `ESCHEMA`, proving the
future schemas were not yet validated before unsupported dispatch.

## GREEN

- Focused helper and protocol: 23 tests passed, 0 failed.
- Combined protocol/helper/baseline/result/ratings: 31 tests passed, 0 failed.
- Full native glob: 31 tests passed, 0 failed.
- Normal production build: clean under `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE`.
- Mount escape: WSL mount was available; forced descriptor fallback returned
  `EXDEV` for a mounted descendant.
- Race: 100 symlink/replacement iterations never returned outside-root bytes.
- Read shim: test-only injected EINTR and 3-byte reads completed exact content.

## Sanitizers

- ASan was run as a separately compiled test binary with leak detection. The
  first run found a parsed-document leak on schema failure; cleanup was fixed.
  The fresh rerun emitted no AddressSanitizer or LeakSanitizer diagnostics.
- UBSan was run as a separately compiled test binary with halt-on-error. The
  fresh run emitted no runtime-error diagnostics.

## Gates

- Protocol contract: pass.
- Native baseline and core result: pass.
- Ratings helper target compile: pass.
- Ucode compile-gate self-test: pass, 9 cases.
- Full shipped-ucode compile gate: pass.
- Full `tests/native/**/*.test.mjs`: pass.
- `git diff --check`: pass.
- Shell/process API review: no `system`, `popen`, `exec*`, spawn, or fork APIs.
- Scope review: no mutation, SHA, lock, daemon/socket, adapter, package Makefile,
  or compile-gate changes; reserved operation names appear only in closed schema
  validation and unsupported dispatch.

## Commits

- `5f04b68 feat(helper): add safe descriptor reads`
- Evidence report commit: the commit containing this report.

## External Evidence

- `LOCAL_VERIFIED`: Linux/WSL executable behavior and repository gates above.
- `SDK_REQUIRED`: OpenWrt SDK compilation and package linkage were not in scope.
- `ROUTER_REQUIRED`: target root ownership, overlay, reboot, and power behavior
  require router hardware/integration testing.

## Round 1 Hardening

### RED

Against `10347f7`, the focused helper/protocol run had 9 failures: escaped NUL
identity truncation, unbounded scanner limits, insecure descendant reads,
single-write response handling, non-canonical reserved base64, missing allocation
fault handling, `st_dev` mount identity, unknown-error fallback, and the absent
`ECAPABILITY` manifest contract.

### Fixes

- All decoded request strings used as identities or enums require json-c length
  equality with `strlen`; escaped NUL is rejected and validated IDs echo exactly.
- Duplicate pre-scan is bounded to 64 levels and 1024 object keys before descent.
- Descriptor fallback compares `STATX_MNT_ID` for every opened component and
  returns `ECAPABILITY` when mount identity cannot be established.
- Intermediate directories require root UID/GID and mode `0700`; final regular
  files require root UID/GID and mode `0600` before stat or read succeeds.
- Reserved `atomic_write.content` requires canonical padded base64 within the
  4 MiB decoded bound before returning `EUNSUPPORTED`.
- Stdin retries `EINTR`; stdout uses bounded write-all with `EINTR` and short
  write handling, and exits 74 after an unrecoverable partial response.
- Checked json-c response constructors and test-only allocation faults fail
  closed; unknown internal codes normalize to `EINTERNAL` exit 70.

### Evidence

- Focused helper/protocol: 32 passed, 0 failed.
- Full native glob after round-1 fixes: 40 passed, 0 failed.
- Real tmpfs mount crossing: `EXDEV`.
- Real same-device bind mount crossing: `EXDEV` via changed mount ID.
- Forced unavailable mount ID: `ECAPABILITY` exit 3.
- Test-only stdin/stdout EINTR, short-write, partial-write, allocation, and mount
  identity faults exercised only in the `Z2M_TESTING` binary.
- ASan allocation-fault sweep across injected failure points 1 through 16: no
  AddressSanitizer or LeakSanitizer diagnostics.
- Separate final ASan and UBSan builds emitted no sanitizer diagnostics; normal
  `-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE` build passed.
- Ratings compile, compile-gate self-test, full compile gate, scope API scan, and
  `git diff --check` passed.

## Round 2 Hardening

### RED

Against `4567908`, five targeted checks failed: no bounded hash-probe evidence
for 1024 adversarial common-prefix keys, missing `response_encode` in the
`EINTERNAL` stage contract, absent machine-readable atomic-write effective
decoded limit, successful fallback in a forced no-statx build, and runtime
stage mismatch for the injected unknown-error path.

### Fixes

- Duplicate detection now uses 2048 deterministic FNV-1a hash buckets with
  exact length plus `memcmp` collision checks. Global limits remain 64 nesting
  levels and 1024 keys, with an additional deterministic 8192 chain-probe cap.
- `EINTERNAL.allowedStages` now includes the emitted `response_encode` stage,
  with protocol and runtime consistency assertions.
- Mount identity uses guarded `syscall(SYS_statx, ...)`; builds without
  `SYS_statx`/`STATX_MNT_ID`, or with `Z2M_NO_STATX`, compile and fail closed as
  `ECAPABILITY`.
- Reserved `atomic_write` records and enforces
  `effectiveMaxDecodedInputBytes: 3139000`; an independent worst-case JSON/base64
  request assertion proves the encoded request remains within 4 MiB.

### Evidence

- Focused helper/protocol: 35 passed, 0 failed.
- Full native glob: 43 passed, 0 failed.
- Adversarial unique and duplicate-at-end key sets stayed below 4096 measured
  hash-chain probes, without wall-clock assertions.
- Normal and forced no-statx warning-clean builds passed.
- Separate ASan and UBSan builds emitted no sanitizer diagnostics.
- Ratings target compile, compile-gate self-test, full compile gate, scope API
  scan, and `git diff --check` passed.

## Round 3 Hardening

### RED

Against `a8f7f7f`, focused tests showed three resource/policy failures: 1100 empty
objects were not stopped by a global container budget and each object eagerly
allocated a 2048-bucket table; escaped-NUL object keys reached truncated
`strlen`/`strdup` semantics; and unsafe path characters reached filesystem
resolution instead of `EPATH`. A separate reserved atomic-write test proved its
path was not yet constrained by the path policy used in the wire calculation.

### Fixes

- Hash buckets are allocated lazily on the first key, never for empty objects.
- A global 1024-container budget joins the existing 64-depth, 1024-key, and
  8192-probe limits. Test-only counters report containers, bucket allocations,
  and probes deterministically.
- Decoded object keys retain their json-c byte length; embedded NUL keys are
  rejected as `ESCHEMA` before hashing/copying at every nesting level.
- Canonical path components now allow only `[A-Za-z0-9._-]+`, while retaining
  slash, depth, component, `.`, and `..` rules. Reserved `atomic_write.path`
  uses the same validator before `EUNSUPPORTED`.
- The manifest records the safe component pattern and escaped-NUL-key rejection;
  the wire proof now uses the true longest allowed 4095-byte path, which has no
  JSON expansion.

### Evidence

- Focused helper/protocol: 37 passed, 0 failed.
- Full native glob: 45 passed, 0 failed.
- The 1100-empty-object test stopped at exactly 1024 containers with zero bucket
  allocations; escaped-NUL keys were rejected top-level and nested.
- Normal and no-statx warning-clean builds passed.
- Separate ASan and UBSan builds emitted no sanitizer diagnostics.
- Ratings target compile, compile-gate self-test, full compile gate, scope API
  scan, and `git diff --check` passed.
