# Task 3 Report: Monotonic Timeout, Termination, And Reaping

## Status

**PASS.** The exact AArch64 OpenWrt musl proof ran under real WSL UID 0 and passed all 28 cases. A 30-second child with a 100 ms deadline returns after bounded TERM/grace/KILL supervision, and the direct child plus process-group descendant are absent from both signal lookup and `/proc` before the result is emitted.

## Scope

Implemented only spike timeout and process supervision in the three Task 3 fixture/test files. No transport-v1 framing, production broker, adapter, procd integration, or M4 work was added.

## TDD Evidence

The first cooperative timeout test was added before supervision existed. Its exact RED result was:

```text
FAIL terminates and reaps a cooperative 30-second child after one 100 ms deadline
expected outcome: timeout
actual outcome: started
tests 1, pass 0, fail 1
```

The concurrent stdin/stdout/stderr test was also observed RED before its fixture and pump behavior existed:

```text
FAIL pumps child stdin, stdout, and stderr concurrently
expected childExit: 0
actual childExit: 2
tests 1, pass 0, fail 1
```

An initial stderr-excess run retained only 1,586 bytes. Root-cause investigation showed the one-byte AArch64/QEMU fixture writes had not produced 4,096 bytes before the 100 ms deadline. The fixture was changed to bulk writes so the case tests broker draining rather than emulation syscall throughput. The focused case then passed with 4,096 bytes retained and 16,384 drained.

## Implementation

- One `CLOCK_MONOTONIC` absolute request deadline is represented as `timespec`; comparisons retain separate seconds and nanoseconds.
- Every `poll()` timeout is recomputed from the same absolute deadline. Injected repeated `EINTR` and repeated stdout readiness cannot reset it.
- stdin, stdout, stderr, and close-on-exec status pipes are pumped together with nonblocking descriptors and partial-write/read loops.
- stdout retains at most cap plus one byte (4,097 in the spike), then initiates bounded termination.
- stderr retains at most 4,096 bytes while all 16,384 test bytes are drained.
- At deadline, the dedicated process group receives `SIGTERM`; after a fixed 100 ms grace, a still-existing group receives `SIGKILL`.
- `waitid(..., WNOWAIT)` observes direct-child completion without losing mandatory `waitpid()` evidence. `waitpid()` retries `EINTR` and must return the direct child PID before any result.
- The spike acts as a child subreaper so an orphaned group descendant is adopted and reaped. Adopted descendants are reaped before process-group absence is accepted.
- Tests verify `kill(pid, 0)` yields `ESRCH` and `/proc/<pid>/stat` is absent for direct children and the forked descendant.

## Exact AArch64 UID0 Proof

Identity:

```text
real harness UID: 0
target: AArch64 OpenWrt musl through PRoot/QEMU
ucode SHA256: 647cb596577867470c16c6b58617b7ccd9b1bbe8f40c1fed6b29974df7b48833
socket.so SHA256: ccaff63617ed3136c6461dadbf3328cd3a0cba118fbc98578108024291541ca0
broker fixture SHA256: 9a2690dfb384cfb08323e4a0ef54fa14a2ff7aaec58bdd6be3241beaae8a97de
```

Command shape:

```sh
wsl.exe -d Ubuntu -u root -- bash -c '
  cd /home/kirill/z2m-work/native-state-foundation
  HOME=/home/kirill
  LD_LIBRARY_PATH=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/lib/x86_64-linux-gnu
  PROOT_NO_SECCOMP=1
  STAGING_DIR=/home/kirill/z2m-sdk-clean/staging_dir
  UCODE_BIN=/home/kirill/z2m-work/qemu-user-local/proot-root/usr/bin/proot
  UCODE_ARGS="-q /home/kirill/z2m-work/qemu-user-local/root/usr/bin/qemu-aarch64 -R /home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek -w /home/kirill/z2m-work/native-state-foundation /usr/bin/ucode"
  TARGET_SOCKET_MODULE=/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/root-mediatek/usr/lib/ucode/socket.so
  TARGET_CC=/home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc
  timeout 120s /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test --test-reporter=spec tests/native/core/native-helper-broker-spike.test.mjs
'
```

Exact result:

```text
tests 28
pass 28
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 15877.56241
```

Task 3 cases:

```text
PASS terminates and reaps a cooperative 30-second child after one 100 ms deadline
PASS kills and reaps a TERM-ignoring 30-second child after bounded grace
PASS terminates the dedicated process group including a forked descendant
PASS repeated EINTR and pipe wakeups do not extend the absolute deadline
PASS stops retaining child stdout at cap plus one byte
PASS retains 4096 stderr bytes while draining all excess
PASS pumps child stdin, stdout, and stderr concurrently
```

## Strict Builds And Regressions

Both target sources compile with `-std=c11 -Wall -Wextra -Werror`: PASS.

Package policy regression:

```text
tests 23
pass 23
fail 0
skipped 0
duration_ms 103.653116
```

`git diff --check`: PASS.

## Artifact Hashes

```text
11bc8f8cf8d49f1632a1909d49c02a0e4e220a4f663c92185723caf6cd3033bd  tests/native/core/z2m-helperd-spike.c
69a58fe01fd721c9a804157884a898832a62c5158c2d42e460ea16dc5dcf8144  tests/native/core/native-helper-broker-child.c
2b59e3d58e87f32165370cf9926c2d144369700027c955e865daeec79fee47ed  tests/native/core/native-helper-broker-spike.test.mjs
```

## Concerns

- This is intentionally spike-only synchronous supervision, not the production broker architecture.
- `PR_SET_CHILD_SUBREAPER` is used to prove descendant reaping in the standalone spike. A production service must define its daemon-wide child ownership policy before adopting this mechanism.
- Timing bounds include QEMU/PRoot scheduling tolerance; correctness is anchored by the monotonic deadline, exact signal metadata, mandatory reap, ESRCH, and `/proc` absence rather than a narrow wall-clock assertion alone.
- No blocker remains.

## Commit

```text
2f705a725dbeb19f04bd2e78ac05aaae9c8ff577  test(core): prove bounded helper termination and reap
```

## Review Resolution: Bounded Pump, Setup Race, And Exact Reap Evidence

### Status

**PASS.** All six reviewer findings were reproduced or confirmed from control flow and resolved within the Task 3 spike. The exact UID0 AArch64 proof now passes 30/30 cases.

### Root Causes

- stdout, stderr, and status drains looped until `EAGAIN`; a continuously writable pipe could keep the broker inside one drain and delay both deadline checks and escalation.
- timeout signaling used only `kill(-pid, signal)`. Before the child completed `setpgid(0, 0)`, that process group did not exist and `ESRCH` was accepted without signaling the direct child.
- descendant `waitpid` results were discarded, so the report proved PID absence but not which adopted PID the broker reaped or whether a final `ECHILD` was observed.
- TERM and KILL times were inferred only from total elapsed time.
- injected poll interruptions consumed no time, so a broken implementation that restarted a relative timeout could still pass.
- final descendant cleanup used blocking `waitpid`, which had no supervision bound if an adopted child remained alive.

### RED Evidence

The adversarial tests were added before implementation changes. Focused exact-target RED result:

```text
FAIL continuous stderr flood cannot starve deadline or bounded escalation
  expected outcome: timeout
  actual outcome: started

FAIL delayed setpgid cannot escape direct-child timeout signaling
  expected groupReadyAtTerm: false
  actual: undefined

tests 2, pass 0, fail 2
```

Timing, exact descendant reap, and final adopted-child exhaustion assertions were also absent from the prior result shape and therefore failed before the new evidence was implemented.

### Implementation

- Each status/stdout/stderr drain performs at most eight 1,024-byte reads per poll iteration. Control always returns to monotonic deadline and escalation checks even under a perpetual writer.
- The child records `process_group_ready` in the existing shared setup guard immediately after successful `setpgid` and before later setup/exec work.
- TERM/KILL use the group only after that explicit readiness evidence. If the group is not ready or a ready-group signal races with `ESRCH`, the broker signals the direct PID instead.
- Signal timestamps are captured from `CLOCK_MONOTONIC` and reported relative to the original start: `termAtMs` and nullable `killAtMs`.
- Three injected poll interruptions each consume 30 ms. The EINTR case therefore spends 90 ms interrupted and still sends TERM against the original 100 ms deadline while also observing repeated pipe wakeups.
- All child collection uses bounded `waitpid(-1, ..., WNOHANG)` batches. Exact direct and descendant PIDs are retained; final `ECHILD` sets `adoptedChildrenExhausted`.
- Cleanup has a fixed deadline after escalation. Failure to prove direct/descendant reap and `ECHILD` becomes `supervision_failure`; no blocking descendant wait remains.

### Exact AArch64 UID0 Proof

```text
SOCKET_MODULE_SHA256=ccaff63617ed3136c6461dadbf3328cd3a0cba118fbc98578108024291541ca0
BROKER_FIXTURE_SHA256=bd2d06590e221d8bc1910f22bb9c32c88e6bb0bdcd6bfadff9457417649f9f49
tests 30
pass 30
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 16417.588935
```

New and strengthened cases:

```text
PASS continuous stderr flood cannot starve deadline or bounded escalation
PASS delayed setpgid cannot escape direct-child timeout signaling
PASS terminates the dedicated process group including a forked descendant
PASS repeated EINTR and pipe wakeups do not extend the absolute deadline
PASS cooperative and TERM-ignoring cases expose bounded monotonic signal times
```

The exact command identity is unchanged from the preceding proof: real WSL UID 0, target AArch64 OpenWrt musl under the pinned PRoot/QEMU invocation, target compiler, ucode, and isolated socket module.

### Strict Builds And Regressions

```text
z2m-helperd-spike.c: PASS (-std=c11 -Wall -Wextra -Werror)
native-helper-broker-child.c: PASS (-std=c11 -Wall -Wextra -Werror)
package policy: 23 tests, 23 pass, 0 fail, duration_ms 144.898575
git diff --check: PASS
```

Review-resolution artifact hashes:

```text
e7643122ff25e4972e96f3dc7365e14dd3299fe9977658a0a38c9717a60b46c9  tests/native/core/z2m-helperd-spike.c
f04733236f4a72465363123c90e85368e2991ee8018d928fc37cdadc93454bd5  tests/native/core/native-helper-broker-child.c
2d4bddc4846f85f922d1a04e9f0928b52998a3bb8f233993eedb4bbec69c6746  tests/native/core/native-helper-broker-spike.test.mjs
```

### Residual Concerns

- The explicit setup-ready flag and subreaper are spike evidence mechanisms, not a production broker protocol or daemon-wide child policy.
- QEMU tolerance remains explicit: TERM must be observed in `[80, 200)` ms, KILL in `[180, 350)` ms, and bounded completion under 600 ms for escalation cases.
- No framing, production broker, adapter, procd, or M4 work was added.
- No blocker remains.

## Review Resolution Round 2: Post-Reap PID Identity

### Status

**PASS.** Group `ESRCH` after direct-child reap no longer permits positive-PID fallback. The exact UID0 AArch64 proof passes 31/31 cases.

### Root Cause And RED Evidence

`signal_child()` previously treated group `ESRCH` as a reason to call `kill(pid, signal)` unconditionally. Once `waitpid()` had reaped the direct child, that positive PID was no longer identity-stable and could have been reused by an unrelated process. The helper also set `direct_sent=true` after direct `ESRCH`, although no signal was delivered.

The deterministic race case was added first. A direct child creates a TERM-ignoring descendant in its process group, reports the descendant PID, and exits. The broker reaps the direct child before KILL grace expires. Injection removes the descendant group at KILL but exposes group `ESRCH`, forcing the exact no-target branch. Initial RED result:

```text
FAIL group ESRCH after direct reap never falls back to reusable positive PID
  expected outcome: timeout
  actual outcome: started
tests 1, pass 0, fail 1
```

### Minimal Fix

- `signal_child()` now receives `child_reaped` identity state.
- Positive-PID fallback is allowed only while the direct child remains unreaped. Before reap, the PID remains reserved for that waitable child and cannot be reused.
- Group `ESRCH` after reap records `group*NoTarget` and returns without calling `kill(pid, ...)`.
- `direct*Attempted` records entry into the positive-PID syscall path.
- `direct*Sent` becomes true only when `kill(pid, signal)` returns success.
- Direct `ESRCH` is separately reported as `direct*NoTarget`; it is not successful-delivery evidence.

The race asserts:

```text
reapedBeforeKill=true
groupKillNoTarget=true
directKillAttempted=false
directKillSent=false
directKillNoTarget=false
directKillAttemptedAfterReap=false
descendantReapedPid=descendantPid
adoptedChildrenExhausted=true
```

### Exact AArch64 UID0 Proof

```text
SOCKET_MODULE_SHA256=ccaff63617ed3136c6461dadbf3328cd3a0cba118fbc98578108024291541ca0
BROKER_FIXTURE_SHA256=09b04f7a09d9eac97aeb250bf669da31b0e5f79bc2b05727dce0bfde49dba18b
tests 31
pass 31
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 17092.910076
```

Strict target builds passed with `-std=c11 -Wall -Wextra -Werror`. Package policy passed 23/23 in `147.807667 ms`. `git diff --check` passed.

Review-round-2 artifact hashes:

```text
080f430416ddb6901abe1dc490ef8b8eedcf153dde9c7aeebed9a32afbf9dba2  tests/native/core/z2m-helperd-spike.c
5b2e4e13cbebf1fbcd0844c0291b5f12fb72a81d26ab2b018ed824d23e921886  tests/native/core/native-helper-broker-child.c
372a78fa24c19ef24c544ced9ecb310e77555c76333278e525e5e202ffb212ee  tests/native/core/native-helper-broker-spike.test.mjs
```

### Concerns

- The deterministic `ESRCH` injection is spike test instrumentation; production signaling remains out of scope.
- The identity rule depends only on standard waitable-child semantics: a direct child PID is safe before reap and must never be targeted after reap.
- No framing, production broker, adapter, procd, or M4 work was added.
- No blocker remains.
