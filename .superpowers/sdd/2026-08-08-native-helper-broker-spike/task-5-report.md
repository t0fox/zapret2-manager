# Task 5 Report: Production z2m-helperd

## Status

**PASS.** Production `z2m-helperd` is implemented, host-tested, target-built,
packaged, and committed through review round 5. Under the governing boundary,
local UID 0 is trusted and malicious-root pathname races are out of scope. The
broker creates its socket as exact `0600`, removes only verified stale sockets
under the post-identity-verified singleton lock, removes its recorded inode on
normal shutdown, and supports clean restart or crash/procd-style respawn. The
implementation remains limited to Task 5. No procd, ucode adapter, gate
replacement, or M4 work was added.

## Production Commit

`b62636d03ada8980b6d0c6e0613783268e316e3f` - `feat(core): add fixed native helper broker`

## Exact Summary

- Added focused production files under `zapret2-manager/src/z2m-helperd/`.
- `transport.c` implements the strict 20-byte `z2m-helper-transport-v1`
  request frame, dynamic validated request IDs, 1-30000 ms deadlines, exact
  fields, binary bodies, one-frame EOF, fixed bounds, and framed responses.
- `supervise.c` uses only fixed `execve()` argv/environment, close-on-exec setup
  evidence, concurrent bounded pipe pumping, one monotonic deadline, TERM/grace/
  KILL, subreaper collection, and no positive-PID signaling after reap.
- `z2m-helperd.c` verifies fixed runtime ancestry without symlink traversal,
  takes and verifies the no-follow singleton lock, and enforces UID 0 peers. A
  verified singleton lock plus root-owned mode-0700 runtime directory and
  root-owned exact-mode-0600 socket permit stale and owned socket cleanup;
  unsafe type, symlink, wrong-owner, and wrong-mode objects are untouched and
  fail closed. The broker accepts serially and propagates shutdown into active
  supervision.
- `zapret2-manager/Makefile` target-builds the three production C sources with
  strict C11 flags and installs only `/usr/libexec/zapret2-manager/z2m-helperd`.
- Added package closure and host broker security/contract coverage. Production
  package compilation contains no `Z2M_TESTING` or path/helper substitution.

## TDD And Debugging Evidence

- Initial closure RED: missing `z2m-helperd.c` and missing `Build/Prepare` source
  staging.
- First runtime RED identified protocol half-close misclassification:
  `POLLRDHUP` from required request EOF was treated as full client disconnect.
  It was removed from the full-disconnect condition.
- Bounds RED identified a lost timeout cause after reap and deadline-length wait
  after silent child completion. Terminal causes are now latched and poll wakeups
  are capped so reap checks remain prompt.
- Review found and fixed descriptor-relative runtime traversal, malformed status
  record fail-closed classification, active-child shutdown propagation, and
  adopted-descendant exhaustion.

## Verification

- Focused broker plus package gate: **43 tests, 43 pass, 0 fail, 0 skipped**.
- Shared non-M3 host gate: **58 tests, 58 pass, 0 fail, 0 skipped**.
- Root-required unaffected bootstrap/helper gate: **96 tests, 96 pass, 0 fail,
  0 skipped**.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`.
- Strict OpenWrt target production build: PASS; output is AArch64 musl ELF.
- `git diff --check`: PASS.
- Contract coverage includes fixed closure, strict frames, singleton lock, safe
  and unsafe stale objects, peer rejection, setup/exec evidence, timeout/reap,
  4 MiB request, 6 MiB response, cap plus one, bounded/drained stderr, incomplete
  disconnect, daemon shutdown, identity-safe cleanup, serial operation, and
  descriptor stability over 100 requests.

## Review

The requested independent Codex CLI review could not run because the installed
Windows-global CLI lacks the WSL optional package `@openai/codex-linux-x64`.
The exact permanent error was recorded during execution. A manual security and
requirements audit was completed instead; its findings are listed above and were
fixed before the final gates.

## Concerns And Blockers

- No Task 5 blocker remains.

## Review Fix: Exact Socket Mode

### Status

**PASS.** The two remaining Important findings are closed within Task 5. Socket
and lock exact-mode checks now include special permission bits, and the current
`Exact Summary` states the accepted trusted-UID-0 lifecycle. No Task 6, adapter,
gate replacement, M4, spike, or historical-round changes were made.

### RED

Command:

```sh
/home/kirill/.local/bin/node --test \
  --test-name-pattern="rejects a stale socket with" \
  tests/native/core/native-helper-broker.test.mjs
```

Result: **4 tests, 0 pass, 4 fail**. Setuid `04600`, setgid `02600`, sticky
`01600`, and combined `07600` stale sockets each failed at `broker startup must
fail`: the broker accepted the special-bit socket, replaced its inode, and
remained running.

### GREEN

Command:

```sh
/home/kirill/.local/bin/node --test \
  --test-name-pattern="removes a verified stale socket|rejects a stale socket with" \
  tests/native/core/native-helper-broker.test.mjs
```

Result: **5 tests, 5 pass, 0 fail**. All four special-bit stale sockets are
rejected with path, device, inode, and full mode unchanged. The positive trusted
root-owned exact-`0600` stale-socket crash/restart cleanup regression also
passes.

### Verification Commands And Results

```sh
/home/kirill/.local/bin/node --test --test-concurrency=1 \
  tests/native/core/native-helper-broker.test.mjs \
  tests/native/package-helper.test.mjs
# 68 tests, 68 pass, 0 fail, 0 skipped

wsl.exe -u root --cd /home/kirill/z2m-work/native-state-foundation \
  /home/kirill/z2m-work/native-state-foundation/scripts/test/native-root.sh \
  /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
# 96 tests, 96 pass, 0 fail, 0 skipped

wsl.exe -u root --cd /home/kirill/z2m-work/native-state-foundation \
  env TMPDIR=/tmp /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node \
  --test tests/native/core/native-helper-broker.test.mjs
# 42 tests, 42 pass, 0 fail, 0 skipped

cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c -ljson-c \
  -o /tmp/z2m-helperd-host-review-fix
# PASS: ELF 64-bit LSB pie executable, x86-64

/home/kirill/z2m-sdk-clean/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin/aarch64-openwrt-linux-musl-gcc \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  -I/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/include \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -L/home/kirill/z2m-sdk-clean/staging_dir/target-aarch64_cortex-a53_musl/usr/lib \
  -ljson-c -o /tmp/z2m-helperd-aarch64-review-fix
# PASS: ELF 64-bit LSB executable, ARM aarch64,
# interpreter /lib/ld-musl-aarch64.so.1

git diff --check
# PASS
```

The OpenWrt compiler wrapper emitted its existing `STAGING_DIR not defined`
warning but exited successfully and produced the verified AArch64 musl binary.
The root suites used WSL's real-root launcher because passwordless `sudo` timed
out in this session.

## Re-Review Fix Round 4

### Status

**PASS WITH MANUAL RESTART RECOVERY.** Four Important findings were reproduced
and addressed within Task 5. No procd, adapter, M3 gate replacement, or M4 work
was added. The historical rounds in this report are retained as point-in-time
records; where they describe automatic stale or shutdown cleanup, round 4
supersedes that policy.

Implementation and regression evidence are committed in
`f70b45ad9ac6ba10f32552a20a68a43b07f6bcad` (`fix(core): remove unsafe broker
pathname cleanup`).

### Root Cause And Policy

The shutdown device/inode check followed by `unlinkat()` was still a pathname
check-then-act race. A replacement could arrive after the check, so the broker
could not honestly claim atomic ownership-safe unlink. The startup connect probe
also could block against an unrelated full-backlog listener and did not prove
ownership.

The minimal defensible policy removes both operations. Startup rejects every
pre-existing fixed socket pathname immediately without probing or mutation.
Shutdown closes the listener but never unlinks the pathname. Consequently every
restart, clean or unclean, requires trusted operator removal after confirming
the singleton lock has no owner, or reboot. The root:root mode-0700 runtime
directory excludes unprivileged replacement; the design does not claim safety
against malicious root or an atomic pathname unlink primitive Linux lacks.

### RED Evidence

```text
FAIL shutdown never unlinks the socket inode created by this daemon (ENOENT)
FAIL replacement between bind and socket recording is never unlinked (missing test stop seam)
FAIL real process identity gates reject stale conflicts and signal only the matching child (missing real-process audit API)
```

The crafted full-backlog test passed against the previous implementation only
because the held replacement lock caused rejection before its connect probe.
Round 4 removes the probe entirely and statically verifies that startup has no
`connect()` path, making lock ownership and pathname policy independent of
listener behavior.

### Fixes And Tests

- Removed socket-path `connect()` probing and all broker socket-path `unlinkat()`
  calls. Every pre-existing object is non-mutating fail-closed.
- Added clean-shutdown and replacement-shutdown tests proving the owned inode or
  unrelated replacement remains at the fixed path.
- Added a bind/record stop seam and replacement test proving startup failure
  never deletes the replacement in that window.
- Added a crafted nonaccepting listener test with an absolute host timeout. The
  broker exits in under 500 ms and preserves device/inode without probing.
- Replaced the synthetic PID registry test with a compiled audit that forks a
  real child, reads its actual `/proc/<pid>/stat` starttime through production
  logic, verifies an unreaped same-PID/different-starttime conflict returns
  `EEXIST`, proves the wrong identity sends no signal, proves the correct
  identity sends `SIGTERM`, and reaps the child with exact signal status.
- Updated the approved design and this report's current top summary. Earlier
  round sections remain explicitly historical.

### Verification

- Focused broker plus package gate: **63 tests, 63 pass, 0 fail, 0 skipped**.
- Shared non-M3 host gate: **78 tests, 78 pass, 0 fail, 0 skipped**.
- Root-required unaffected bootstrap/helper gate: **96 tests, 96 pass, 0 fail,
  0 skipped**.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`.
- Strict OpenWrt AArch64 musl production build: PASS; output verified as AArch64
  musl ELF.
- `git diff --check`: PASS.

### Concerns

- Automatic service restart is deliberately unavailable under this Task 5
  policy, including after clean shutdown. Task 6 must not enable respawn until a
  separately proven publication/cleanup design exists or operational cleanup is
  explicitly accepted.
- PID identity remains Linux procfs PID+starttime because pidfd availability on
  the exact OpenWrt target is not assumed. The real-process test validates the
  identity boundary, not impractical forced PID-number reuse.
- The intentionally-red direct `uloop.process` M3 probes remain untouched and
  excluded from the shared unaffected gate, as required until Task 8.
- Production exact-target execution through the future ucode adapter/procd
  lifecycle remains Tasks 6-8. Task 5 proves strict target compilation and host
  broker contracts; it does not claim those later integrations.
- Codex review availability remains an environment concern only: reinstall the
  CLI with its Linux optional dependency before requesting that independent
  review under WSL.

## Re-Review Fix Round 5

### Status

**PASS.** The human threat-model decision supersedes round 4's malicious-root
pathname-race policy: local UID 0 is trusted. Historical round labels and
evidence above remain point-in-time records. The current implementation defends
against unprivileged users, unsafe objects, stale state, malformed IPC, and
process faults/crashes, and permits future procd respawn without implementing
procd in this round.

Implementation and regression evidence are committed in
`b5bb13c4cce0f7520ac307155f8c1b7d73bba7d6` (`fix(core): restore trusted-root
broker lifecycle`).

### Root Cause And Fixes

- Round 4 removed all pathname cleanup because it treated malicious root as an
  attacker. That exceeded the approved boundary and made every normal or crash
  restart require manual intervention.
- Socket creation now applies umask `0177` before `bind()`, producing exact mode
  `0600` with no pathname chmod after bind. Type, UID, GID, and mode are verified
  immediately, then device/inode are recorded.
- Startup cleanup runs only after the singleton lock's post-flock identity check
  beneath verified root:root mode-0700 runtime ancestry. It unlinks only a
  no-follow socket with root:root ownership and exact mode `0600`. Symlinks,
  files, FIFOs, wrong-owner sockets, and wrong-mode sockets remain untouched and
  fail closed. The held lock is the liveness authority, so no blocking connect
  probe is needed.
- Normal shutdown checks socket type, owner, mode, and the stored device/inode
  before unlink. A replacement pathname remains untouched.
- The registry lifecycle audit marks the old PID/starttime identity reaped,
  accepts the same numeric PID with a new starttime as a distinct identity,
  rejects the same transition while unreaped, and retains real `/proc` starttime
  validation before signaling.
- The amendment design, implementation plan, and report top summary now share
  the trusted-root boundary and clean/crash respawn behavior.

### Safety Boundary

This is safe against unprivileged users because pathname mutation occurs only
under verified root-owned mode-0700 ancestry while the verified singleton lock
is held. It is not claimed safe against malicious root racing pathnames; such a
root actor is explicitly out of scope.

### Verification

- Focused broker plus package gate: **64 tests, 64 pass, 0 fail, 0 skipped**.
- Shared non-M3 host gate: **79 tests, 79 pass, 0 fail, 0 skipped**.
- Root-required bootstrap/helper gate: **96 tests, 96 pass, 0 fail, 0 skipped**.
- Elevated focused broker cases: all **38 broker tests pass**, including
  wrong-owner socket preservation. The combined elevated package run had one
  unrelated Git `safe.directory` refusal because root does not own the worktree;
  the same package suite passed in the focused and shared owner runs.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`; x86-64 ELF.
- Strict OpenWrt target production build: PASS with the AArch64 musl toolchain;
  AArch64 ELF with `/lib/ld-musl-aarch64.so.1`.
- `git diff --check`: PASS.

### Concerns

- The trusted-root boundary is deliberate: malicious root can still race
  pathnames and is not defended against.
- Actual kernel PID-number reuse is not forced; the registry transition is
  tested directly, while real-process tests prove signal-time `/proc` starttime
  validation.
- Procd is not implemented yet. This round proves lifecycle compatibility with
  future respawn only. Adapter, gate replacement, and M4 remain untouched.
- Independent Codex review remains unavailable because the Windows-global CLI
  cannot load the WSL optional package `@openai/codex-linux-x64`; reinstalling
  `@openai/codex@latest` inside Linux is required. Manual diff review and all
  executable gates completed.

## Reviewer Findings Follow-Up

### Status

**PASS.** All five reviewer findings were reproduced with RED host contracts,
fixed within the existing Task 5 production boundary, and committed as
`63a6d1be774628a7c60e194766408abaaacaae59` (`fix(core): harden helper broker
lifecycle`). No procd, ucode adapter, gate replacement, or M4 work was added.

### RED Evidence

The first focused run failed all eight initial reviewer regression cases:

```text
FAIL deadline remains active after the leader exits while a descendant survives
FAIL shutdown escalates TERM-ignoring descendants after leader reap without hanging serial broker
FAIL EOF descriptors are removed from poll and silent-child poll count stays bounded
FAIL fatal poll error terminates and reaps before transport failure response
FAIL partial request stall expires and cannot wedge the next serial client
FAIL non-reading response client expires and cannot wedge the next serial client
FAIL lock pathname replacement after open cannot create dual singleton ownership
FAIL stale socket replacement immediately before removal is never unlinked
```

An additional adopted-child case used `setsid()` to leave the leader process
group and failed RED because the escaped child remained live after the broker's
bounded cleanup.

### Fixes

- Timeout, shutdown, overflow, disconnect, and fatal-poll termination stay active
  until the leader is reaped, all adopted children are exhausted, and all child
  pipes reach EOF. TERM-ignoring groups and adopted children receive SIGKILL
  after monotonic grace. Cleanup itself has a fixed absolute bound.
- The subreaper signals waitable adopted direct children discovered from
  `/proc/self/task/<pid>/children`; these PIDs remain identity-safe until
  `waitpid()` reaps them. Positive leader-PID fallback remains forbidden after
  leader reap.
- Status/stdout/stderr descriptors are closed and removed from the poll set on
  EOF or complete status record exactly once. A silent 300 ms helper verifies a
  bounded poll count below 100 rather than level-triggered spinning.
- Fatal non-EINTR `poll()` errors latch `supervision_failure`, initiate bounded
  TERM/KILL cleanup, drain/reap, and can never fall through to `child_exited`.
  Start state remains `not_started` or `started` only when status-pipe evidence
  proves it.
- Client sockets are nonblocking. Request receive and response send use partial
  I/O loops under absolute `CLOCK_MONOTONIC` deadlines. A partial-frame stall and
  a non-reading 6 MiB response client both expire without wedging the next serial
  connection.
- The verified runtime directory fd remains open for daemon lifetime. Lock open,
  pathname identity verification, socket inspection, stale quarantine/removal,
  socket verification, and cleanup use descriptor-relative operations.
- Lock inode identity is checked between the opened fd and current pathname
  before `flock()`. Stale sockets are atomically renamed to a private quarantine
  name, revalidated by inode/type/owner/mode, then removed. Replacement races
  leave the replacement untouched and cannot create dual singleton ownership.

### Follow-Up Verification

- Focused production broker plus package gate: **52 tests, 52 pass, 0 fail,
  0 skipped**.
- Shared non-M3 host gate: **67 tests, 67 pass, 0 fail, 0 skipped**.
- Root-required unaffected bootstrap/helper gate: **96 tests, 96 pass, 0 fail,
  0 skipped**.
- Package closure alone: **26 tests, 26 pass, 0 fail, 0 skipped**.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`.
- Strict OpenWrt target production build: PASS; AArch64 musl ELF.
- Static closure scan: no generic exec, shell, TCP, environment capability, or
  production test seam found.
- `git diff --check`: PASS.

### Follow-Up Concerns

- No Task 5 blocker remains.
- Adopted-child signaling relies on Linux procfs, which is present on the OpenWrt
  target and already required by the process-state verification contract.
- Response-send timeout occurs after helper completion and reap; a client that
  does not read receives no fabricated success and the serial daemon proceeds.
- Tasks 6-8 and M4 remain untouched.

## Re-Review Fix Round 2

### Status

**PASS.** All five re-review findings were reproduced with deterministic RED
races and fixed in `4a8f9b3fdc14cba5fb7606f19554a34febca3ddf` (`fix(core): close
broker identity races`). Scope remains Task 5 only.

### RED Evidence

The initial round-2 focused run failed the new lock, stale cleanup, child
enumeration, post-reap group-signal, and outcome-precedence cases:

```text
FAIL singleton rejects lock replacement between precheck and flock while replacement lock is held
FAIL singleton rejects lock replacement between flock and postcheck while replacement lock is held
FAIL stale socket replacement immediately before removal is never unlinked
FAIL repeated child discovery consumes a list larger than 4096 bytes and preserves identity
FAIL post-reap cleanup never sends a negative process-group signal
FAIL incomplete cleanup overrides timeout with supervision failure
```

Follow-up RED coverage also proved a quarantine-name collision and a descendant
forked after TERM were not handled by one-shot selection/discovery.

### Fixes

- Singleton acquisition now verifies lock fd/path identity before `flock()` and
  again while holding the successful lock. Either mismatch explicitly unlocks,
  closes, clears the fd, and fails. Deterministic replacements in both race
  windows prove a second daemon can hold the replacement lock without the raced
  daemon disturbing it or becoming a second singleton owner.
- Stale cleanup is bounded to the verified root:root mode-0700 runtime directory
  while the singleton lock is held. Each attempt reserves a unique name with
  `O_CREAT|O_EXCL`, then uses Linux `renameat2(RENAME_NOREPLACE)` to a separate
  unique quarantine name. Collisions advance without modifying existing objects.
- The stale source is revalidated immediately before rename. Replacement before
  that check stays at the original pathname and causes fail-closed exit. The
  quarantined inode is revalidated before unlink. Any post-rename ambiguity
  modifies neither pathname because safe recovery is not provable.
- Adopted children use a bounded identity registry of exact PID plus Linux procfs
  starttime. Discovery reads repeated chunks up to 65,536 bytes and tracks at
  most 2,048 identities; overflow or procfs failure is supervision failure.
- Child discovery and identity-safe signaling repeat throughout TERM/KILL cleanup,
  including descendants forked after TERM and lists larger than 4,096 bytes.
  Signals are sent only when current `/proc/<pid>/stat` starttime matches the
  tracked waitable identity.
- Negative process-group signaling is permitted only before leader reap. After
  reap, cleanup uses tracked PID+starttime identities, preventing unrelated PGID
  signaling after group exhaustion.
- Incomplete reap, descendant exhaustion, or pipe EOF and cleanup expiry now have
  first outcome precedence. They force `transport_failure` with
  `supervision_failure` before timeout, disconnect, shutdown, overflow, or normal
  child-exit classification.

### Verification

- Focused broker plus package gate: **60 tests, 60 pass, 0 fail, 0 skipped**.
- Shared non-M3 host gate: **75 tests, 75 pass, 0 fail, 0 skipped**.
- Root-required unaffected bootstrap/helper gate: **96 tests, 96 pass, 0 fail,
  0 skipped**.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`.
- Strict OpenWrt AArch64 musl production build: PASS.
- `git diff --check`: PASS.

### Concerns

- `renameat2(RENAME_NOREPLACE)` and procfs PID starttime are Linux-specific. The
  daemon and target contract are Linux/OpenWrt-specific; unsupported pathname
  primitives fail closed rather than using an unsafe fallback.
- Enumeration is deliberately bounded at 65,536 bytes and 2,048 tracked children.
  Exceeding either bound becomes supervision failure and cannot become a normal
  terminal outcome.
- No Task 5 blocker remains. Procd, adapter, M3 gate replacement, and M4 remain
  untouched.

## Re-Review Fix Round 3

### Status

**PASS.** The remaining stale-path, outcome-precedence, and PID-reuse findings
were reproduced RED and fixed in
`d517ffa650e636c8f9eb8641911db5d29a97c9fa` (`fix(core): fail closed on stale
broker sockets`). No procd, adapter, M3 gate replacement, or M4 work was added.

### Policy Decision

Linux does not provide an fd-based unlink operation that atomically guarantees
the pathname still names a previously inspected socket. Layering pathname
stat/rename/recheck steps cannot prove that an unrelated privileged replacement
will never be moved or deleted. Production therefore no longer automatically
renames or unlinks any socket pathname that exists at startup.

The stricter policy is compatible with the amendment's safety condition: stale
objects may be removed only when verified, but automatic removal is not required.
The approved design now states the concrete recovery behavior. Under the held
singleton lock, a verified root-owned socket is connect-probed only to classify
it as live or stale. Both classifications fail startup and leave the pathname
untouched. A stale path requires explicit operator removal after confirming no
daemon is live, or disappears naturally when `/tmp` is recreated on reboot.

### RED Evidence

```text
FAIL fails closed on a stale socket and leaves every pre-existing object untouched
FAIL fails singleton probe on a live socket without modifying it
FAIL discovery failure overrides simultaneous timeout after converged cleanup
FAIL identity registry accepts a reused PID only with new starttime after old reap
```

The stale test initially needed a bounded asynchronous host guard because the
old implementation successfully auto-cleaned and remained running, which itself
was the behavior under test.

### Fixes

- Removed all startup stale-socket rename, quarantine, restoration, and unlink
  logic. Startup performs no mutation when the fixed socket pathname exists.
- A root-owned mode-0600 socket is connect-probed while the post-verified
  singleton lock is held. Successful connect reports a live singleton;
  connection failure reports stale-path operator recovery. Both return failure
  and preserve the exact inode. Unsafe non-socket/wrong-metadata objects remain
  untouched and fail closed.
- Shutdown cleanup still unlinks only the socket created by the current daemon
  after device/inode/type/owner identity matches. This is distinct from startup
  stale cleanup and retains the prior identity-safe replacement test.
- Any `supervision_failed` flag now has first terminal-outcome precedence,
  alongside incomplete cleanup. A deterministic child-discovery failure at the
  same time as timeout converges cleanup and still returns
  `transport_failure/supervision_failure`, never `timeout`.
- Identity registry lookup now keys by PID and starttime. The same identity is
  deduplicated; a different starttime for an unreaped PID is a fail-closed
  conflict; after the old identity is reaped, the reused PID/new starttime is
  inserted as a distinct live identity and passes the same signal/reap lifecycle
  eligibility audit.
- Post-flock lock identity recheck and the no-negative-PGID-after-leader-reap
  rules remain unchanged.

### Verification

- Focused broker plus package gate: **60 tests, 60 pass, 0 fail, 0 skipped**.
- Shared non-M3 host gate: **75 tests, 75 pass, 0 fail, 0 skipped**.
- Root-required unaffected bootstrap/helper gate: **96 tests, 96 pass, 0 fail,
  0 skipped**.
- Strict host production build: PASS with `-std=c11 -Wall -Wextra -Werror
  -D_GNU_SOURCE` and `json-c`.
- Strict OpenWrt AArch64 musl production build: PASS.
- Static audit: no startup rename/unlink of the fixed socket; no generic exec,
  shell, TCP, environment capability, or package test seam.
- `git diff --check`: PASS.

### Concerns

- An unclean daemon crash leaves a stale socket and intentionally prevents
  automatic restart until an operator verifies no daemon is live and removes
  the path. Normal shutdown removes the daemon-created inode; reboot recreates
  tmpfs and clears it. Task 6 procd integration must surface this startup error
  rather than adding unsafe cleanup.
- PID identity remains Linux procfs PID+starttime because pidfd availability on
  the exact target is not assumed. Identity mismatch is fail-closed.
- No Task 5 blocker remains.
