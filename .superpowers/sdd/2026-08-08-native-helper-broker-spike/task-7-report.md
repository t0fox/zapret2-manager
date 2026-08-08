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

## Fix Round 1

### Status

**PASS.** Review findings were fixed in a separate Task 7-only round. Task 8 and
M4 remain untouched. Mutation operations now return structured uncertainty for
every unverifiable result after request delivery or proven helper start, while
broker-unavailable and valid `not_started` spawn/setup outcomes remain ordinary
dependency failures.

### Root Causes

- Uncertainty was applied only to socket/framing failures before response-header
  validation. Once a syntactically valid `child_exited` frame was parsed,
  malformed helper semantics incorrectly became `EINTERNAL`, even for mutations.
- The adapter's transport matrix was copied from the spike rather than the actual
  production serializer. Production omits `signal` from `transport_failure` and
  emits `status_protocol` and `daemon_shutdown` reasons.
- Helper success accepted any object and the duplicate scanner tracked only the
  outer object, allowing malformed operation data and nested duplicate-key
  collapse.

### RED Evidence

The new adapter cases were written and run before production changes:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
```

Result: **22 tests, 18 pass, 4 fail**. The failures were the intended review
reproductions:

- mutation empty/malformed/trailing/partial/wrong helper results returned
  `EINTERNAL` rather than structured uncertainty;
- production `daemon_shutdown` was rejected because the adapter required a
  non-serialized signal;
- malformed operation success data was accepted;
- escaped-equivalent nested duplicate keys survived JSON collapse.

### Implementation

- Mutation uncertainty now includes bounded safe evidence under `details`, keeps
  `commitState: unknown`, `automaticRetry: false`, and
  `recovery: reread_reconcile`, and never retries.
- Empty, malformed, trailing, partial, wrong-ID/version/envelope/exit, signaled,
  and operation-data-invalid `child_exited` results are uncertain for mutations
  after proven start. Read-only operations retain `EINTERNAL` classification.
- Valid helper `ECOMMITUNKNOWN` remains a distinct helper semantic `EAPPLY`
  result without transport `commitState`.
- The broker matrix now matches production `transport.c` and `supervise.c`:
  `status_protocol`, `daemon_shutdown`, `client_disconnect`, `stdout_limit`, and
  `supervision_failure` are accepted; production `transport_failure` does not
  require signal metadata. Both real `not_started` forms are accepted.
- Exact closed success schemas, primitive types, bounds, enums, canonical base64,
  digest syntax, and additional-property rejection are enforced for all five
  operations.
- A recursive pre-decode scanner rejects decoded duplicate keys in every object,
  including `data`, `error`, `details`, and objects nested in arrays.
- Evidence covers stale socket `ECONNREFUSED`, post-read reset, malformed and
  oversized framing, wrong transport identity, timeout, production status and
  shutdown frames, mutation helper contradictions, and one-request/no-retry
  behavior.

### GREEN Verification

Focused host adapter:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
# 22 tests, 22 pass, 0 fail, 0 skipped
```

Exact-target AArch64 ucode/socket runtime with production-compatible frames:

```sh
env HOME=/home/kirill PROOT_NO_SECCOMP=1 \
  LD_LIBRARY_PATH=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/lib/x86_64-linux-gnu \
  UCODE_BIN=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/bin/proot \
  'UCODE_ARGS_PIPE=-q|/home/kirill/z2m-work/qemu-user-local/root/usr/bin/qemu-aarch64|-R|/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek|-w|/home/kirill/z2m-work/native-state-foundation|/usr/bin/ucode' \
  'UCODE_MODULE_PATH=/usr/lib/ucode/*.so' \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
# 22 tests, 22 pass, 0 fail, 0 skipped
```

Focused adapter plus package closure:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  tests/native/core/native-helper.test.mjs tests/native/package-helper.test.mjs
# 50 tests, 50 pass, 0 fail, 0 skipped
```

Production broker regressions:

```sh
env TMPDIR=/tmp \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail, 0 skipped
```

Root and elevated lifecycle gates:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 97 tests, 97 pass, 0 fail, 0 skipped

env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
# 40 tests, 40 pass, 0 fail, 0 skipped
```

Strict builds and diff check:

```sh
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -ljson-c -o /tmp/z2m-helperd-task7-fix1-host
# PASS: x86-64 ELF

STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  /home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  -I/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/include \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -L/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/lib \
  -ljson-c -o /tmp/z2m-helperd-task7-fix1-aarch64
# PASS: AArch64 musl ELF

git diff --check
# PASS
```

### Concerns And Honest Boundary

- Fixed-socket adapter and broker suites must run sequentially. One invalid
  parallel verification caused socket/singleton interference and left two
  test-only descendants after the shell killed Node at its host timeout; those
  exact temporary test PIDs were terminated before clean sequential reruns.
- An actual production AArch64 broker-plus-helper end-to-end test was attempted
  but not claimed. Standalone helper target compilation outside the OpenWrt
  package build could not reproduce package `TARGET_CPPFLAGS`: adding the target
  include root caused musl/Linux `statx` redefinitions, while omitting it could
  not find json-c. The temporary attempted test was removed. Exact-target Task 7
  evidence therefore proves the adapter and exact socket runtime against frames
  matching production serialization; complete production target end-to-end
  integration remains Task 8.

## Fix Round 2

### Status

**PASS.** Four Important review findings are closed within Task 7. Task 8 and M4
remain untouched. Helper details and JSON parsing are bounded before decode,
broker outcomes match production serialization without accepting synthetic
`unknown`, and send-side uncertainty now carries deterministic branch evidence.

### RED Evidence

Tests were added before production changes and run with:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
```

Result: **26 tests, 22 pass, 4 fail** after correcting one test-fixture include.
The intended failures proved:

- compact 4097-byte helper `details` was accepted;
- valid nested input did not have deterministic scanner limits and the one-over
  budget was not classified as mutation uncertainty;
- impossible production `startState:unknown` was accepted;
- deterministic backpressure lacked bytes-sent, wait, short-write, poll-event,
  and stage evidence.

The first send-fixture run failed at fixture compilation because `<sys/stat.h>`
was missing, then at host `E2BIG` because a 521,028-byte payload was embedded in
`ucode -e`. Those test defects were fixed before capturing the intended send RED:
the harness now uses a temporary ucode source file for large invocations.

### Implementation

- Enforces the helper protocol's compact serialized `error.details` limit at
  exactly 4096 UTF-8 bytes from the original wire span before JSON collapse.
  Exact ASCII and nested non-ASCII vectors pass; 4097, non-object details, and
  invalid UTF-8 fail closed. Read-only operations return `EINTERNAL`; mutations
  after proven start return structured uncertainty with no retry.
- Adds strict pre-decode parser budgets: depth 16, containers 1024, members 1024,
  total nodes 65536, decoded key bytes 4096, and total work bounded by helper
  stdout. Depth 15/16 and payload-node 65531/65532 vectors account for envelope
  nodes and prove exact/one-over behavior without unbounded recursion.
- Removes broker `startState:unknown`. Production outcome validation now permits
  only `not_started` or `started` combinations emitted by `supervise.c` and
  serialized by `transport.c`. `supervision_failure` separately permits partial
  reap/EOF evidence; completed status, disconnect, limit, and shutdown outcomes
  retain their exact lifecycle requirements.
- Adds a native fixed-path AF_UNIX fixture with `SO_RCVBUF=4096`, 150 ms no-read
  backpressure, partial receive evidence, and reset. A maximum request proves
  positive bytes sent, send wait/EAGAIN, poll HUP/error stage, and no retry.
- Adds a test-only `shutdown()` preload shim. Host tests build a host shared
  object; exact-target tests build AArch64 and pass it through QEMU guest
  environment. This deterministically proves the shutdown-failure uncertainty
  branch without any production seam or new transport primitive.
- Uncertainty evidence remains bounded scalars only: stage, bytes sent, send wait
  count, short-write count, and numeric poll revents. Request/helper content is
  never reflected.

### GREEN Verification

Focused host adapter and package closure:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  tests/native/core/native-helper.test.mjs tests/native/package-helper.test.mjs
# 54 tests, 54 pass, 0 fail, 0 skipped
```

Exact-target AArch64 ucode/socket runtime:

```sh
env HOME=/home/kirill PROOT_NO_SECCOMP=1 \
  STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  LD_LIBRARY_PATH=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/lib/x86_64-linux-gnu \
  UCODE_BIN=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/bin/proot \
  'UCODE_ARGS_PIPE=-q|/home/kirill/z2m-work/qemu-user-local/root/usr/bin/qemu-aarch64|-R|/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek|-w|/home/kirill/z2m-work/native-state-foundation|/usr/bin/ucode' \
  'UCODE_MODULE_PATH=/usr/lib/ucode/*.so' \
  TARGET_CC=/home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
# 26 tests, 26 pass, 0 fail, 0 skipped
```

Production broker regressions:

```sh
env TMPDIR=/tmp \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail, 0 skipped
```

Root and elevated lifecycle gates:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 97 tests, 97 pass, 0 fail, 0 skipped

env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
# 40 tests, 40 pass, 0 fail, 0 skipped
```

Strict builds and diff check:

```sh
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -ljson-c -o /tmp/z2m-helperd-task7-fix2-host
# PASS: x86-64 ELF

STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  /home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  -I/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/include \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -L/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/lib \
  -ljson-c -o /tmp/z2m-helperd-task7-fix2-aarch64
# PASS: AArch64 musl ELF

git diff --check
# PASS
```

### Concerns

- High-node exact-target scanner vectors take about 38 seconds under QEMU; the
  Node host guard is 20 seconds per high-node invocation while adapter transport
  deadlines remain unchanged. The complete exact-target suite took about 60
  seconds.
- One broker regression invocation started with a transient test-runtime
  socket/lock cascade and its shell guard expired after all subtests printed.
  Process inspection showed no surviving broker process; the clean sequential
  rerun with a larger host guard passed 42/42. No production file was changed.
- Shutdown failure is syscall-injected only in tests using preload, with separate
  host and AArch64 artifacts. Production has no environment, path, or test seam.

## Fix Round 3

### Status

**PASS.** Task 7 now follows the frozen helper response contract without invented
node/container/member limits, accepts protocol depth 64, validates large responses
with a separately measured post-receive bound, matches production broker outcome
serialization, and proves each send failure branch independently. Task 8 and M4
remain untouched.

### RED Evidence

The four new review tests were added before production changes and run with:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib \
  UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  --test-name-pattern="protocol depth|4 MiB read|production outcome table|send backpressure" \
  tests/native/core/native-helper.test.mjs
```

Result: **4 tests, 0 pass, 4 fail**. The failures proved:

- valid protocol-depth-64 helper details were rejected by the invented depth-16
  adapter limit;
- a valid 4 MiB decoded `read_regular` response exceeded a 20-second host guard;
- production `spawn_failure/fork` serialization was rejected because the adapter
  incorrectly required EOF evidence;
- send-side assertions did not distinguish kernel short-send, poll HUP/ERR,
  direct zero-send, and shutdown branches.

Independent diagnosis also proved pinned ucode's built-in `json()` rejects a
whole response at depth 64 (`nesting too deep`), despite helper protocol v1
allowing that depth. This required lexical validation plus safe details elision,
not a weakened protocol limit.

### Implementation

- Replaced the per-value recursive scanner and invented response node/container/
  member limits with an iterative explicit stack capped only at protocol depth
  64. Depth 64 passes; depth 65 fails before JSON collapse.
- The lexical pass compares decoded key identities recursively and retains the
  exact compact 4096-byte `details` wire-span bound. Validated details are never
  exposed to callers and are replaced with `{}` before the shallower built-in
  decoder, allowing protocol-valid deep details safely. The bound applies only
  to helper `error.details`; an unrelated `data.details` field is not size-gated.
- String bodies use bulk quote searches. Receive chunks are accumulated and
  joined once instead of repeated growing-string concatenation. Large strings
  are replaced with empty placeholders before JSON materialization; only the
  validated `read_regular.data.content` slice is restored afterward.
- Removed the 65,536-node adversary. Worst-case byte-pattern coverage now uses a
  valid 4 MiB decoded base64 response and a 5 MiB unknown string, both within the
  frozen 6 MiB helper stdout cap.
- Base64 canonicality and decoded length use syntax plus constant-time length
  arithmetic instead of decode/re-encode/decode work.
- Encoded production outcomes directly from `supervise.c` and `transport.c`:
  fork has no child/EOF; exec/setup and status protocol have reaped EOF evidence;
  disconnect/shutdown/stdout-limit require started complete supervision;
  supervision failure alone permits actual partial or complete states.
- Test preload now interposes the `sendto()` and `sendmsg()` symbols imported by
  `ucode-mod-socket`. Tests independently assert real kernel short-send,
  `sendWaits > 0`, numeric `POLLERR|POLLHUP` revents `28`, direct zero-send with
  `bytesSent:0` and `stage:send`, and shutdown failure.

### Performance Boundary

The socket deadline governs connect/send/receive and ends after EOF. Ucode has no
preemption, so helper parsing and schema validation use a separate measured bound;
the implementation does not claim the transport deadline covers post-processing.

- Host threshold: **2.5 seconds**.
- Exact-target QEMU tolerance: **30 seconds**.
- Host full-test durations: valid 4 MiB response **0.67 s**, 5 MiB rejection
  **0.09 s**.
- Exact-target full-test durations: valid 4 MiB response **21.64 s**, 5 MiB
  rejection **23.98 s**. These include conservative residual client drain plus
  post-processing from the peer's write-completion callback.

### GREEN Verification

Focused host adapter and package closure:

```sh
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 \
  tests/native/core/native-helper.test.mjs tests/native/package-helper.test.mjs
# 58 tests, 58 pass, 0 fail, 0 skipped
```

Exact-target AArch64 ucode/socket runtime:

```sh
env HOME=/home/kirill PROOT_NO_SECCOMP=1 \
  STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  LD_LIBRARY_PATH=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/lib/x86_64-linux-gnu \
  UCODE_BIN=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/bin/proot \
  'UCODE_ARGS_PIPE=-q|/home/kirill/z2m-work/qemu-user-local/root/usr/bin/qemu-aarch64|-R|/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek|-w|/home/kirill/z2m-work/native-state-foundation|/usr/bin/ucode' \
  'UCODE_MODULE_PATH=/usr/lib/ucode/*.so' \
  TARGET_CC=/home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
# 29 tests, 29 pass, 0 fail, 0 skipped
# total duration 83.42 s

# Final targeted exact-target details-scope regression:
# 1 test, 1 pass, 0 fail, 0 skipped
```

Production broker, root, and lifecycle regressions:

```sh
env TMPDIR=/tmp \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail, 0 skipped

env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 97 tests, 97 pass, 0 fail, 0 skipped

env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory \
  GIT_CONFIG_VALUE_0=/home/kirill/z2m-work/native-state-foundation \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
# 40 tests, 40 pass, 0 fail, 0 skipped
```

Strict builds and diff check:

```sh
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -ljson-c -o /tmp/z2m-helperd-task7-fix3-host
# PASS: x86-64 ELF

STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir \
  /home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  -I/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/include \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -L/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/lib \
  -ljson-c -o /tmp/z2m-helperd-task7-fix3-aarch64
# PASS: AArch64 musl ELF

git diff --check
# PASS
```

### Concerns

- QEMU is substantially slower than host/native hardware for multi-megabyte
  ucode string handling. The explicit 30-second validation tolerance is measured
  separately and does not alter operation or transport deadlines.
- Deep `details` are lexically validated, duplicate-checked, size-bounded, then
  elided before built-in JSON decode because pinned ucode rejects protocol-valid
  depth 64. Details remain undisclosed as required by the adapter mapping.

## Fix Round 4

### Status

**PASS.** The helper response path now uses a strict linear lexical parser with
an explicit depth-64 stack, path-selective handling, and no generic string
elision. The accepted broker response matrix exactly excludes suppressed
`client_disconnect` serialization. Task 8 and M4 remain untouched.

### RED And Root Cause

New tests were written before production changes. The first focused RED returned
`EDEPENDENCY` for a malformed trailing-comma helper failure instead of rejecting
it as `EINTERNAL`. Inspection confirmed that round 3's scanner accepted trailing
commas, did not validate escapes in value strings, selected `details` and
`content` by arbitrary key name, elided every string over 4096 bytes, and created
large suffix strings in whitespace, quote, and number scans. Exact-target RED
also measured the dense 100k-key object path at 50.7 seconds under QEMU.

### Implementation

- Strictly recognizes the complete JSON grammar before decode, including string
  escapes, Unicode surrogate pairs, numbers, delimiters, trailing input, and
  recursive decoded duplicate keys. Trailing commas are rejected.
- Tracks structural paths. Only `error.details` is replaced, after independent
  object grammar, duplicate, UTF-8, depth, and exact 4096-byte wire-span checks.
  Only read `data.content` is replaced, after independent JSON-string escape,
  UTF-8, canonical-base64, and decoded-length checks. `error.message` and
  arbitrary strings are never elided.
- Uses monotonic offsets, indexed byte access, fixed-size bulk string searches,
  and an explicit stack. Numeric array runs use bounded bulk matching. Invalid
  operation data is lexically validated but never passed to built-in semantic
  JSON materialization.
- Removed `client_disconnect` from accepted transport reasons. Existing real
  EOF/reset/disconnect tests continue to prove read and mutation behavior,
  including no retry and mutation `commitState: unknown` after delivery.
- Preserved depth 64, recursive escaped-equivalent duplicate detection, exact
  operation schemas, and prior uncertainty classifications.

### Performance And Verification

Focused host adapter after final changes:

```sh
env TMPDIR=/tmp LD_LIBRARY_PATH=/opt/ucode/lib UCODE_BIN=/opt/ucode/bin/ucode \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/core/native-helper.test.mjs
# 33 tests, 33 pass, 0 fail; 5.94 s total
# 4 MiB valid read: 0.98 s; 5 MiB unknown string: 0.12 s
```

Fresh exact-target AArch64 run:

```sh
# same pinned proot/qemu/target environment as round 3
node --test tests/native/core/native-helper.test.mjs
# 33 tests, 33 pass, 0 fail; 55.92 s total
# 4 MiB valid read: 14.31 s; dense performance group: 9.30 s
```

The dense group covers 100k and 500k numeric values with separate host/QEMU
thresholds, plus a 10k-key object to retain duplicate-set performance coverage.
This distinguishes the prior approximately 4-second/53-second value-density
behavior without setting a false target for 100k interpreted key insertions.

Other gates:

```sh
node --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail

scripts/test/native-root.sh node
# 97 tests, 97 pass, 0 fail

node --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
# 40 tests, 40 pass, 0 fail

# strict -std=c11 -Wall -Wextra -Werror host and AArch64 broker builds: PASS
# host artifact: x86-64 ELF; target artifact: AArch64 musl ELF
```

### Concerns

- Pinned ucode's built-in decoder still cannot accept protocol depth 64, so the
  two explicitly validated paths are replaced only after the complete lexical
  pass. The rest of the envelope is decoded unchanged.
- Exact-target QEMU remains materially slower than native execution. Performance
  thresholds are therefore explicit and separate from transport deadlines.
