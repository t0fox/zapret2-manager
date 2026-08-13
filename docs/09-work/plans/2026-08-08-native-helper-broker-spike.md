---
id: plan-native-helper-broker-spike
title: "Native Helper Broker Spike Implementation Plan"
type: plan
status: planned
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [plan, native, helper, broker]
---
# Native Helper Broker Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove on the exact AArch64 OpenWrt target that a project-local AF_UNIX broker can provide bounded helper transport, exact setup/exec failure evidence, monotonic timeout termination, and guaranteed child reaping; only after that proof, make the broker and typed adapter production M3.

**Architecture:** The spike uses an exact-target ucode socket client and minimal native C server fixture at the fixed future socket location. The native side owns `fork/exec`, pipes, deadline, termination, and `waitpid`; ucode performs only bounded AF_UNIX framing and helper-envelope validation. Production package, procd, and `core/native-helper.uc` changes are conditional on the complete spike becoming green.

**Tech Stack:** AArch64 OpenWrt musl toolchain; C11 Linux APIs (`AF_UNIX`, `poll`, `pipe2`, `fork`, `execve`, `clock_gettime`, `kill`, `waitpid`, `SO_PEERCRED`); exact target ucode commit `85922056ef7abeace3cca3ab28bc1ac2d88e31b1`; `ucode-mod-socket`; Node.js 22 `node:test` harness; procd.

## Global Constraints

- Do not patch, vendor, or replace system ucode.
- Do not start M4, canonical JSON, state-store, status integration, DNS, Telegram, WARP, routing, or UI work.
- Preserve all M1/M2 commits and behavior unless a proven broker integration defect requires a narrow fix.
- Production code must never accept executable, argv, environment, shell command, working directory, socket path, uid/gid, signal, or arbitrary filesystem operation from the caller.
- The only production child executable is `/usr/libexec/zapret2-manager/z2m-core-helper`.
- The only production socket is `/tmp/zapret2-manager/runtime/z2m-helperd.sock`.
- Bootstrap remains the sole creator/verifier of the `runtime` base root; broker verifies but does not repair it.
- Socket and lock objects are root-owned, restrictive, no-follow, and fail closed on unsafe stale objects. Local UID 0 is trusted; malicious-root pathname races are out of scope.
- Use a close-on-exec status pipe to distinguish setup/exec success and failure; never infer these from exit 127, exit 255, `-1`, or missing stdout.
- One absolute `CLOCK_MONOTONIC` deadline governs each request.
- Timeout must perform SIGTERM, bounded grace, SIGKILL if needed, and `waitpid`; do not return timeout before proven reap.
- Request body maximum is 4,194,304 bytes; helper stdout maximum is 6,291,456 bytes with one-byte overflow detection; retained stderr maximum is 4,096 bytes while excess is still drained.
- Frozen `z2m-core-helper` protocol and `ECOMMITUNKNOWN` semantics do not change.
- Transport uncertainty and helper semantic errors remain distinct.
- Add `+ucode-mod-socket` only after exact-target socket API proof.
- Production implementation begins only after every exact-target spike requirement passes without skips.
- Use TDD, systematic debugging, `-std=c11 -Wall -Wextra -Werror`, `git diff --check`, and a separate review gate per task.

---

## File Structure

### Spike files

- `tests/native/core/z2m-helperd-spike.c`: exact-target AF_UNIX and child-supervision fixture; never installed.
- `tests/native/core/native-helper-broker-spike.uc`: exact-target ucode socket client using framed binary transport.
- `tests/native/core/native-helper-broker-spike.test.mjs`: builds target fixture, starts it under the AArch64 target environment, drives all socket and process cases, and checks child state.
- `tests/native/core/native-helper-broker-child.c`: fixed test child with structured success/failure, malformed output, setup hooks, sleep, TERM-ignore, descendant, and PID evidence modes.
- `tests/native/core/native-helper-broker-exact-target-evidence.txt`: reconstructable command, clean input commit, source/binary/module hashes, raw TAP, and target metadata.

### Conditional production files after spike GREEN

- `zapret2-manager/src/z2m-helperd/z2m-helperd.c`: secure socket lifecycle, framing, serial accept loop, and child supervision.
- `zapret2-manager/src/z2m-helperd/transport.c`: bounded frame decode/encode and strict transport header validation.
- `zapret2-manager/src/z2m-helperd/supervise.c`: fixed fork/exec, status pipe, poll pump, timeout escalation, and reap.
- `zapret2-manager/src/z2m-helperd/helperd.h`: fixed limits, outcome structures, and internal interfaces.
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`: typed AF_UNIX adapter.
- `tests/native/core/native-helper-broker.test.mjs`: host/native broker contract tests.
- `tests/native/core/native-helper.test.mjs`: typed adapter and helper-envelope tests.

### Existing files modified conditionally

- `zapret2-manager/Makefile`: add socket dependency only after proof; compile/install daemon after full spike GREEN.
- `zapret2-manager/files/etc/init.d/zapret2-manager`: named `helperd` and `watchdog` procd instances after bootstrap.
- `tests/native/package-helper.test.mjs`: package closure and no-generic-exec assertions.
- `scripts/test/native.sh`: replace intentional-red direct-process M3 probe only after broker M3 is fully green.

---

### Task 1: Exact-Target ucode-mod-socket API Proof

**Files:**
- Create: `tests/native/core/z2m-helperd-spike.c`
- Create: `tests/native/core/native-helper-broker-spike.uc`
- Create: `tests/native/core/native-helper-broker-spike.test.mjs`

**Interfaces:**
- Consumes: exact target `/usr/lib/ucode/socket.so`, AArch64 target compiler/root, `clock(true)`.
- Produces: proven `AF_UNIX` connect/send/recv/poll/peercred/disconnect API and reusable spike framing helpers.

- [ ] **Step 1: Write target environment and module identity RED tests**

Require explicit exact-target variables, as the existing M3 probe does. Assert that:

```text
socket.so is AArch64
ucode source commit is 85922056ef7abeace3cca3ab28bc1ac2d88e31b1
import * as socket from 'socket' succeeds
AF_UNIX, SOCK_STREAM, POLLIN, POLLOUT, POLLERR, POLLHUP are present
```

Do not skip when the exact target is unavailable; fail with a clear precondition.

- [ ] **Step 2: Run RED module test**

Run with the existing PRoot/QEMU target command recorded in
`native-helper-transport-exact-target-evidence.txt`.

Expected: FAIL because the broker spike files do not exist.

- [ ] **Step 3: Implement minimal fixed AF_UNIX C fixture**

The fixture accepts only compile-time test paths. It must:

```c
socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
bind(...);
listen(...);
accept4(..., SOCK_CLOEXEC);
getsockopt(client, SOL_SOCKET, SO_PEERCRED, ...);
```

Use a target-test root under `TMPDIR`, exact socket mode `0600`, and cleanup only when recorded socket inode/type still match. Implement fixture modes for echo, delayed reply, immediate close, partial response, and peer credential report.

- [ ] **Step 4: Implement the ucode socket client primitives**

Use object-form path connection:

```ucode
let sock = socket.connect(
  { path: socket_path }, null,
  { family: socket.AF_UNIX, socktype: socket.SOCK_STREAM },
  connect_timeout_ms
);
```

Implement partial `send`, bounded `recv`, `shutdown(SHUT_WR)`, explicit close,
and `socket.poll()` loops. Derive one absolute deadline from `clock(true)` and
recompute remaining milliseconds after every wakeup/EINTR.

- [ ] **Step 5: Add exact socket behavior cases**

Assert:

- binary and embedded-NUL send/recv;
- partial writes and backpressure;
- `POLLIN|POLLHUP` drain then EOF;
- delayed reply respects absolute deadline;
- immediate server disconnect is distinguished from empty valid response;
- response cap stops at limit plus one;
- peer credentials report expected root UID/PID;
- non-root peer is rejected by the C fixture;
- 100 connect/close cycles do not grow descriptors.

- [ ] **Step 6: Run exact-target socket proof**

Run the focused Node test through PRoot/QEMU. Expected: every socket API case
PASS with no skips. If any required behavior cannot be achieved, write exact
raw evidence, mark the plan BLOCKED, and do not continue to Task 2.

- [ ] **Step 7: Commit socket proof and dependency only after PASS**

After exact-target PASS, add `+ucode-mod-socket` to `zapret2-manager/Makefile`
and its package regression assertion. Commit:

```bash
git add tests/native/core/z2m-helperd-spike.c \
  tests/native/core/native-helper-broker-spike.uc \
  tests/native/core/native-helper-broker-spike.test.mjs \
  tests/native/package-helper.test.mjs zapret2-manager/Makefile
git commit -m "test(core): prove exact-target AF_UNIX transport"
```

---

### Task 2: Close-On-Exec Setup And Exec Evidence

**Files:**
- Create: `tests/native/core/native-helper-broker-child.c`
- Modify: `tests/native/core/z2m-helperd-spike.c`
- Modify: `tests/native/core/native-helper-broker-spike.test.mjs`

**Interfaces:**
- Consumes: exact-target AF_UNIX proof.
- Produces: exact `spawn_failure`, `setup_failure`, and successful-exec evidence without exit-code heuristics.

- [ ] **Step 1: Write RED setup/exec cases**

Assert separate outcomes for:

```text
missing fixed child -> spawn_failure, stage exec, ENOENT, not_started
injected stdin dup2 failure -> setup_failure, stage stdin_dup2, not_started
injected stdout dup2 failure -> setup_failure, stage stdout_dup2, not_started
injected stderr dup2 failure -> setup_failure, stage stderr_dup2, not_started
successful exec -> status-pipe EOF, started
```

Explicitly assert that child exit 127/255 and missing stdout are not used as
the classification source.

- [ ] **Step 2: Implement fixed binary child fixture**

Compile a target child with modes selected only by spike compile-time/test
configuration. It emits structured success/failure, malformed stdout, sleeps,
ignores TERM, forks a descendant, and reports PID/PPID/process group when asked.

- [ ] **Step 3: Implement the exec-status pipe**

Use:

```c
pipe2(exec_status, O_CLOEXEC | O_NONBLOCK);
pid = fork();
```

In the child, run `setpgid`, checked `dup2`, checked close setup, and fixed
`execve`. On setup/exec error, write one record no larger than `PIPE_BUF`:

```c
struct setup_error { uint8_t version; uint8_t stage; int32_t error; };
```

then `_exit(126)`. On successful exec, kernel close-on-exec produces EOF.
Parent classification comes only from a complete record or EOF.

- [ ] **Step 4: Run exact-target setup/exec proof**

Expected: all setup, missing executable, successful exec, and ordinary child
exit cases PASS. If not, stop with evidence and do not implement timeout logic
on an ambiguous start-state foundation.

- [ ] **Step 5: Commit exact lifecycle evidence**

```bash
git add tests/native/core/native-helper-broker-child.c \
  tests/native/core/z2m-helperd-spike.c \
  tests/native/core/native-helper-broker-spike.test.mjs
git commit -m "test(core): prove exact helper spawn evidence"
```

---

### Task 3: Monotonic Timeout, Termination, And Reaping

**Files:**
- Modify: `tests/native/core/z2m-helperd-spike.c`
- Modify: `tests/native/core/native-helper-broker-child.c`
- Modify: `tests/native/core/native-helper-broker-spike.test.mjs`

**Interfaces:**
- Consumes: proven child start state and process group.
- Produces: bounded `timeout` only after TERM/KILL escalation and proven reap.

- [ ] **Step 1: Write RED timeout and process-state cases**

Use a child that sleeps 30 seconds and a request deadline of 100 ms. Assert:

- elapsed time is below the specified 100 ms plus bounded grace and scheduling tolerance;
- SIGTERM is sent at deadline;
- cooperative child exits during grace;
- TERM-ignoring child receives SIGKILL after grace;
- direct child is reaped before response;
- `kill(pid, 0)` returns ESRCH after response;
- `/proc/<pid>/stat` is absent, not zombie;
- a forked descendant in the dedicated process group is also gone;
- repeated EINTR does not extend the absolute deadline.

- [ ] **Step 2: Implement one monotonic deadline and grace**

Create timespec helpers that compare `(sec,nsec)` without flattening into a
precision-losing floating number. Every `poll()` timeout is derived from the
same absolute deadline. After deadline:

```text
kill(-pgid, SIGTERM)
poll/drain until fixed grace deadline
kill(-pgid, SIGKILL) if any child remains
waitpid(pid, ..., 0) with EINTR retry
```

Do not emit timeout until `waitpid` returns the child PID.

- [ ] **Step 3: Pump all pipes concurrently**

While waiting, perform partial nonblocking writes to child stdin and reads from
stdout/stderr/status. Retain at most 4096 stderr bytes but drain all excess.
Read at most stdout limit plus one and terminate on overflow.

- [ ] **Step 4: Run exact timeout proof**

Expected: 30-second child case completes within bounded deadline+grace, child
and descendant are absent, and all wait status metadata is exact. This is the
load-bearing test that the previous `uloop.process` path failed.

- [ ] **Step 5: Commit supervision proof**

```bash
git add tests/native/core/z2m-helperd-spike.c \
  tests/native/core/native-helper-broker-child.c \
  tests/native/core/native-helper-broker-spike.test.mjs
git commit -m "test(core): prove bounded helper termination and reap"
```

---

### Task 4: Transport-v1 Framing And Original Eight Cases

**Files:**
- Modify: `tests/native/core/z2m-helperd-spike.c`
- Modify: `tests/native/core/native-helper-broker-spike.uc`
- Modify: `tests/native/core/native-helper-broker-spike.test.mjs`
- Create: `tests/native/core/native-helper-broker-exact-target-evidence.txt`

**Interfaces:**
- Consumes: proven socket and supervision primitives.
- Produces: complete spike implementation of `z2m-helper-transport-v1` and reconstructable exact-target evidence.

- [ ] **Step 1: Write RED strict frame tests**

Implement tests for the 20-byte prelude, exact magic, frame type, zero flags
and reserved bytes, big-endian lengths, strict header object, exact request ID,
one request/response and EOF. Reject short, trailing, oversized, duplicate-key,
unknown-field, and malformed header cases.

- [ ] **Step 2: Implement request and response framing**

Request header fields are exactly:

```json
{"protocol":"z2m-helper-transport-v1","requestId":"probe:1","timeoutMs":100}
```

Response outcomes are exactly:

```text
child_exited timeout spawn_failure setup_failure transport_failure
```

Response body is raw stdout followed by retained stderr, split by strict header
lengths. Do not parse helper stdout in the C fixture.

- [ ] **Step 3: Repeat and extend the original transport cases**

Required exact-target cases:

- normal request/response;
- helper structured failure;
- malformed helper stdout preserved as bytes;
- fixed helper missing/exec failure;
- injected setup failure;
- 4 MiB request;
- 6 MiB response;
- cap plus one response failure;
- bounded/drained stderr;
- timeout and reap;
- child signal metadata;
- client disconnect before exec and after exec;
- response truncation;
- no descriptor growth across 100 requests.

- [ ] **Step 4: Capture reconstructable exact-target evidence**

Run from a clean input commit and record:

- clean `git status --porcelain`;
- executed input commit;
- source hashes for C server, ucode client, Node harness, and child fixture;
- compiled AArch64 binary hashes;
- ucode/socket module/package hashes and architecture;
- exact invocation and environment paths;
- raw TAP output and exit code;
- timestamp.

Add static package tests that recompute tracked source hashes and bind the raw
TAP to compiled binary markers.

- [ ] **Step 5: Apply the spike gate**

If any required case fails, commit evidence as a clearly blocked spike, leave
M3 blocked, and do not continue to Task 5. If all pass, mark the spike GREEN and
continue.

- [ ] **Step 6: Commit complete spike evidence**

```bash
git add tests/native/core/native-helper-broker-* \
  tests/native/core/z2m-helperd-spike.c tests/native/package-helper.test.mjs
git commit -m "test(core): prove native helper broker transport"
```

---

### Task 5: Production z2m-helperd

**Conditional:** Execute only after Task 4 exact-target PASS.

**Files:**
- Create: `zapret2-manager/src/z2m-helperd/helperd.h`
- Create: `zapret2-manager/src/z2m-helperd/z2m-helperd.c`
- Create: `zapret2-manager/src/z2m-helperd/transport.c`
- Create: `zapret2-manager/src/z2m-helperd/supervise.c`
- Create: `tests/native/core/native-helper-broker.test.mjs`
- Modify: `zapret2-manager/Makefile`
- Modify: `tests/native/package-helper.test.mjs`

**Interfaces:**
- Consumes: spike-proven framing and supervision logic.
- Produces: `/usr/libexec/zapret2-manager/z2m-helperd` at fixed paths with no test seams in production.

- [ ] **Step 1: Write RED production closure/security tests**

Assert strict source list/build flags, fixed helper/socket/lock paths, no
`execvp`, `execlp`, `system`, `popen`, shell, TCP, caller argv/env/path fields,
or `Z2M_TESTING` in production compilation.

- [ ] **Step 2: Port spike code by responsibility**

Move only proven code into focused files. `transport.c` owns frame validation;
`supervise.c` owns fixed child lifecycle; `z2m-helperd.c` owns secure runtime
verification, singleton lock, socket lifecycle, peer UID 0, serial accept, and
shutdown cleanup.

- [ ] **Step 3: Add host/native broker contract tests**

Compile with test-only path/helper substitution and rerun framing, stale-object,
peer, timeout, setup/exec, bounds, disconnect, cleanup, and descriptor tests.
Prove exact-0600 creation without post-bind chmod, verified stale cleanup and
normal/crash restart, stored-inode shutdown cleanup, and that unsafe stale
objects remain untouched. Prove PID/starttime registry reuse only after the old
identity is marked reaped and signal-time starttime validation remains mandatory.

- [ ] **Step 4: Add package build and install**

Compile with target C11 strict flags and install only the daemon binary at the
fixed libexec path. Keep source and transport development files out of the
package payload.

- [ ] **Step 5: Verify and commit production broker**

Run broker tests, package tests, strict production compile, shared non-M3 gate,
and `git diff --check`.

```bash
git add zapret2-manager/src/z2m-helperd zapret2-manager/Makefile \
  tests/native/core/native-helper-broker.test.mjs tests/native/package-helper.test.mjs
git commit -m "feat(core): add fixed native helper broker"
```

---

### Task 6: procd Broker Lifecycle

**Conditional:** Execute only after Task 5 GREEN.

**Files:**
- Modify: `zapret2-manager/files/etc/init.d/zapret2-manager`
- Modify: `tests/native/bootstrap.test.mjs`
- Modify: `tests/native/package-helper.test.mjs`

**Interfaces:**
- Consumes: installed fixed broker and managed-root bootstrap.
- Produces: named `helperd` and `watchdog` instances after fail-closed bootstrap.

- [ ] **Step 1: Write RED lifecycle ordering tests**

Assert bootstrap is the first action; `helperd` named instance is declared
before `watchdog`; both have independent respawn policy; helperd command is the
fixed daemon; shutdown has bounded `term_timeout`; declaration order is not
treated as a readiness acknowledgment.

- [ ] **Step 2: Update init script**

After `"$BOOTSTRAP" all || return $?`, declare named `helperd`, then named
`watchdog`. Keep `check()` bootstrap behavior and do not launch broker through
shell command construction.

- [ ] **Step 3: Verify lifecycle and commit**

```bash
node --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
git diff --check
git add zapret2-manager/files/etc/init.d/zapret2-manager \
  tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
git commit -m "fix(package): supervise native helper broker"
```

---

### Task 7: Typed AF_UNIX native-helper Adapter

**Conditional:** Execute only after Tasks 5-6 GREEN.

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- Create: `tests/native/core/ucode-test-harness.mjs`
- Create: `tests/native/core/native-helper.test.mjs`
- Modify: `tests/native/package-helper.test.mjs`

**Interfaces:**
- Consumes: fixed broker socket and transport-v1.
- Produces typed exports `stat_regular`, `read_regular`, `mkdir_private`, `sha256_regular`, and `atomic_write`; private transport function only.

- [ ] **Step 1: Write RED typed API tests**

Assert no public generic invoke and exact fixed helper requests for all five
implemented operations. Callers cannot select operation strings, executable,
argv, environment, socket path, shell, or timeout.

- [ ] **Step 2: Write RED transport validation tests**

Cover malformed/truncated frames, wrong request ID/protocol, trailing bytes,
all outcome schemas, child-not-reaped contradiction, EOF contradictions,
oversized lengths, socket disconnect, initial ENOENT/ECONNREFUSED, and peer
errors.

- [ ] **Step 3: Implement bounded AF_UNIX transport**

Use `ucode-mod-socket` only. Connect object-form fixed path, use partial
send/recv and `socket.poll()` under one `clock(true)` deadline, half-close after
request, validate one response then EOF, and close on every path.

- [ ] **Step 4: Validate helper semantic envelope independently**

For `child_exited`, parse exactly one helper stdout document and validate helper
protocol/version/request ID/envelope/error metadata/exit category. Preserve
helper `ECOMMITUNKNOWN`. Map damaged transport after possible start to separate
mutation `commitState: unknown`, no retry, reread reconciliation.

- [ ] **Step 5: Verify and commit adapter**

Run exact-target socket adapter tests, host fixtures, package tests, and diff
check.

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc \
  tests/native/core/ucode-test-harness.mjs tests/native/core/native-helper.test.mjs \
  tests/native/package-helper.test.mjs
git commit -m "feat(core): add brokered native helper adapter"
```

---

### Task 8: M3 Gate Replacement And Verification

**Conditional:** Execute only after Task 7 GREEN.

**Files:**
- Modify: `scripts/test/native.sh`
- Modify: `.github/workflows/native-gate.yml` only if exact-target broker gate requires a separate job.
- Modify: `tests/native/core/native-helper-transport-probe.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete broker and adapter tests.
- Produces: M3 GREEN gate; historical direct-uloop evidence retained but no longer intentional-red in the shared host gate.

- [ ] **Step 1: Separate historical evidence from executable gate**

Keep the old direct `uloop.process` artifact and source as evidence, but stop
executing its intentional-red test in the ordinary gate. Do not delete or mark
the original failed cases as passing.

- [ ] **Step 2: Make broker tests the M3 contract gate**

The local/CI source of truth must run host broker contracts. Add an exact-target
job/entrypoint when AArch64 target assets are available; it must run the full
broker socket and supervision cases without skips.

- [ ] **Step 3: Run final M3 verification**

Run:

```text
strict host C broker build
host broker contract tests
exact AArch64 broker spike/production tests
typed adapter tests
bootstrap/package tests
shared native gate
```

M3 is GREEN only if every required exact-target case passes and no child remains
alive/zombie/orphan after timeout/disconnect tests.

- [ ] **Step 4: Commit M3 gate**

```bash
git add scripts/test/native.sh .github/workflows/native-gate.yml README.md \
  tests/native/core/native-helper-transport-probe.test.mjs
git commit -m "test(native): gate brokered helper transport"
```

- [ ] **Step 5: Stop before M4**

Report M3 status and exact evidence. Do not begin `atomic_write_json` in this
plan even after M3 becomes green.
