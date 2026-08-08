# Task 5 Report: Production z2m-helperd

## Status

**PASS.** Production `z2m-helperd` is implemented, host-tested, target-built,
packaged, and committed. The implementation is limited to Task 5. No procd,
ucode adapter, M3 gate replacement, or M4 work was added.

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
  takes the no-follow singleton lock before stale inspection, removes only a
  verified safe stale socket, enforces UID 0 peers, accepts serially, propagates
  shutdown into active supervision, and cleans only its recorded socket inode.
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
- The intentionally-red direct `uloop.process` M3 probes remain untouched and
  excluded from the shared unaffected gate, as required until Task 8.
- Production exact-target execution through the future ucode adapter/procd
  lifecycle remains Tasks 6-8. Task 5 proves strict target compilation and host
  broker contracts; it does not claim those later integrations.
- Codex review availability remains an environment concern only: reinstall the
  CLI with its Linux optional dependency before requesting that independent
  review under WSL.

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
