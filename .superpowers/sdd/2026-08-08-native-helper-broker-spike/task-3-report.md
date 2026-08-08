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

The implementation commit is recorded after this report is committed.
