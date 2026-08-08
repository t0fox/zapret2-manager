# Task 7 Report: Typed AF_UNIX Native-Helper Adapter

## Status

**PASS.** Task 7 implements only the typed broker adapter and its tests. Public
exports are exactly `stat_regular`, `read_regular`, `mkdir_private`,
`sha256_regular`, and `atomic_write`. The private transport uses the fixed
`/tmp/zapret2-manager/runtime/z2m-helperd.sock` through `ucode-mod-socket`; it
does not expose generic invocation, process, path, timeout, argv, environment,
shell, or readiness controls. Task 8 and M4 were not started.

## RED

Tests and the reusable real-socket harness were added before the production
adapter. The initial command was:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  tests/native/core/native-helper.test.mjs \
  tests/native/package-helper.test.mjs
```

Result: **41 tests, 26 pass, 15 fail**. All 14 adapter cases failed at the
intended missing-module boundary:
`Unable to resolve path for module .../core/native-helper.uc`. The package
closure test failed because the adapter did not exist. One additional package
evidence test hit Git's known root `safe.directory` protection; subsequent root
runs used only the process-local Git override and changed no Git configuration.

## Implementation

- Generates unique request IDs from monotonic time plus a process-local sequence
  and validates the frozen ASCII syntax before transport.
- Validates typed arguments before opening a socket and emits exact closed helper
  requests with fixed operation-specific deadlines and fixed mode/UID/GID fields.
- Implements the proven object-form AF_UNIX connect API, partial nonblocking
  send/recv, `socket.poll()` under one `clock(true)` deadline, request half-close,
  bounded response accumulation, exactly one frame followed by EOF, and closure
  on every connected path.
- Validates decoded duplicate keys, exact response fields, unsigned framing
  bounds, transport identity, all five broker outcomes, lifecycle/EOF/reap
  consistency, stage/reason enums, and exit/signal exclusivity.
- Independently validates exactly one helper JSON response, protocol version,
  request ID, exclusive success/failure envelopes, duplicate keys, error code,
  retry/commit/durability/stage metadata, and helper exit category.
- Keeps ordinary helper semantic failures, valid helper `ECOMMITUNKNOWN`, and
  uncertain mutation transport as three distinct results. Mutation transport
  uncertainty is `{ commitState: "unknown", automaticRetry: false,
  recovery: "reread_reconcile" }`; the adapter performs no retry or reconciliation.
- Adds no production test seam. `UCODE_ARGS_PIPE` exists only in the Node test
  harness to invoke the pinned target without shell-quoting ambiguity.

## GREEN And Verification

Focused host adapter and package closure, after the final change:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  tests/native/core/native-helper.test.mjs \
  tests/native/package-helper.test.mjs
# 44 tests, 44 pass, 0 fail, 0 skipped
```

Exact target AArch64 ucode runtime and syntax-by-import:

```sh
env HOME=/home/kirill PROOT_NO_SECCOMP=1 \
  LD_LIBRARY_PATH=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/lib/x86_64-linux-gnu \
  UCODE_BIN=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/bin/proot \
  'UCODE_ARGS_PIPE=-q|/home/kirill/z2m-work/qemu-user-local/root/usr/bin/qemu-aarch64|-R|/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek|-w|/home/kirill/z2m-work/native-state-foundation|/usr/bin/ucode' \
  'UCODE_MODULE_PATH=/usr/lib/ucode/*.so' \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
# 16 tests, 16 pass, 0 fail, 0 skipped
```

Production broker regressions:

```sh
env TMPDIR=/tmp \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail, 0 skipped
```

Root-required helper/bootstrap gate:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 97 tests, 97 pass, 0 fail, 0 skipped
```

Elevated lifecycle/package gate:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
# 39 tests, 39 pass, 0 fail, 0 skipped
```

Strict host and target broker builds:

```sh
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c -ljson-c \
  -o /tmp/z2m-helperd-task7-host
# PASS: ELF 64-bit LSB pie executable, x86-64

STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  /home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  -I/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/include \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -L/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/lib \
  -ljson-c -o /tmp/z2m-helperd-task7-aarch64
# PASS: ELF 64-bit LSB executable, ARM aarch64, musl
```

Final whitespace check:

```sh
git diff --check
# PASS
```

## Concerns

- Standalone `ucode -c native-helper.uc` is not a valid module syntax check for
  this ucode build: it reports that exports may appear only at module top level
  when compiling a module as a script and creates `uc.out`. The generated file
  was removed. Host and exact-target tests import the module normally and execute
  every public export, providing the applicable syntax/runtime evidence.
- The production adapter directory is named `core` and matches the repository's
  broad `core` ignore pattern. The required production file is therefore
  force-staged explicitly; no `.gitignore` policy was changed.
- Task 7 deliberately provides only structured future reread/reconciliation
  metadata for uncertain mutation transport. It does not implement reconciliation.
