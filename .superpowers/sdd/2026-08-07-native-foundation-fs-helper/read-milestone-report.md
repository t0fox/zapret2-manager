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
