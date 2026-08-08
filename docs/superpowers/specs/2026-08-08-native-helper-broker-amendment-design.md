# Native Helper Broker Amendment Design

Date: 2026-08-08
Status: approved for exact-target spike
Branch baseline: `native-state-foundation`

## Context

The original M3 design attempted direct helper supervision through patched
OpenWrt `uloop.process()`. Exact AArch64 target evidence proved that interface
cannot satisfy the approved mutation transport contract:

- a 100 ms timeout did not terminate and reap a 30-second child;
- pre-exec setup callback failure was discarded before execution continued.

The evidence is preserved in
`tests/native/core/native-helper-transport-exact-target-evidence.txt`. M3
remains blocked. This amendment replaces only the transport mechanism. It does
not change the frozen `z2m-core-helper` protocol, authorize M4, or weaken
uncertain-mutation semantics.

## Architecture

```text
core/native-helper.uc
        |
        | AF_UNIX
        v
z2m-helperd
        |
        | fixed fork/exec
        v
z2m-core-helper
```

`z2m-helperd` is a fixed-purpose transport and process supervisor. It is not a
backend, state store, generic execution service, or filesystem implementation.
It treats helper request and response content as opaque bounded bytes.

The broker is serial in v1: it accepts and completes one request at a time.
This minimizes process-lifecycle and shutdown races. The helper's existing
per-root locking remains the filesystem concurrency authority.

## Exact-Target Gate

Production implementation is forbidden until an exact AArch64 target spike
proves the socket and supervision primitives.

The exact target is the same OpenWrt ucode build used by the blocked direct
transport evidence: commit `85922056ef7abeace3cca3ab28bc1ac2d88e31b1`, with
the staged target modules and AArch64 musl toolchain.

The spike first proves `ucode-mod-socket` behavior:

- module import and package identity;
- AF_UNIX stream connect;
- partial send and receive;
- `socket.poll()` under one absolute monotonic deadline;
- `SO_PEERCRED` through `peercred()` or equivalent target API;
- request and response bounds;
- EOF, disconnect, reset, and local close behavior.

Only after those primitives pass does the spike exercise native child
supervision and repeat the required transport cases. `+ucode-mod-socket` is
added to production package dependencies only after exact-target socket proof.

## Fixed Paths

```text
daemon  /usr/libexec/zapret2-manager/z2m-helperd
helper  /usr/libexec/zapret2-manager/z2m-core-helper
socket  /tmp/zapret2-manager/runtime/z2m-helperd.sock
lock    /tmp/zapret2-manager/runtime/z2m-helperd.lock
```

The wire contract has no executable, argv, environment, working-directory,
socket-path, uid/gid, signal, or arbitrary timeout capability. Production
paths are compile-time constants. Test builds may substitute the root and
helper only behind `Z2M_TESTING`.

## Socket Security

The socket lives under the existing `runtime` managed root. Bootstrap remains
the only owner of base-root creation. The broker independently verifies the
already-created path before binding:

- `/tmp` is a root-owned directory with exact mode `01777`;
- `/tmp/zapret2-manager` is root:root mode `0700`;
- `runtime` is root:root mode `0700`;
- no traversed component is a symlink;
- descriptor and pathname identities remain consistent.

The broker opens a root-owned regular lock file at the fixed lock path using
`O_NOFOLLOW`, verifies mode `0600`, and obtains `flock(LOCK_EX|LOCK_NB)` before
examining the socket pathname.

An existing socket pathname is never removed automatically at startup. While
holding the singleton lock, the broker may connect-probe a verified root-owned
socket only to distinguish a live daemon from a stale object; both outcomes
fail startup and leave the pathname untouched. Symlinks, regular files, FIFOs,
devices, wrong-owner sockets, and unverifiable objects also fail closed and
remain untouched. A stale socket requires explicit operator removal after
confirming no daemon is live, or disappears naturally when `/tmp` is recreated
at reboot. This avoids claiming pathname identity guarantees Linux unlink does
not provide.

The bound socket has exact mode `0600`. After bind, the broker records and
verifies its device/inode. Shutdown removes the pathname only when type,
ownership, and recorded identity still match.

Every accepted connection is checked with kernel AF_UNIX peer credentials.
V1 requires peer UID 0. Failure to obtain credentials or a non-root peer is
rejected before request content is trusted. No TCP or abstract namespace
listener is permitted.

## Process Supervision

For every accepted request the broker creates child stdin, stdout, stderr, and
exec-status pipes. The status pipe uses `O_CLOEXEC`.

```text
parent creates pipe2(O_CLOEXEC)
-> fork
-> child establishes a dedicated process group and fixed descriptors
-> setup failure writes one fixed {stage, errno} record and _exit()
-> execve(fixed helper, fixed argv, sanitized environment)
-> successful exec closes status pipe automatically
-> parent distinguishes setup/exec success and failure exactly
```

The child branch after `fork()` uses only async-signal-safe syscalls. It does
not allocate, serialize JSON, use stdio, log, resolve `PATH`, or invoke a shell.

The parent pumps client input, child stdin, child stdout, child stderr, and the
exec-status pipe concurrently with `poll()`. It handles partial I/O and
`EINTR`, ignores `SIGPIPE`, and treats `EPIPE` explicitly.

Fixed limits:

| Resource | Limit |
|---|---:|
| helper request body | 4,194,304 bytes |
| helper stdout | 6,291,456 bytes |
| overflow observation | one byte beyond stdout limit |
| retained helper stderr | 4,096 bytes |
| transport request header | 1,024 bytes |
| transport response header | 2,048 bytes |
| request ID | 128 ASCII bytes |
| deadline | 1 through 30,000 ms |

Excess stderr is discarded while the pipe continues to be drained, preventing
diagnostic backpressure from blocking the helper.

## Deadline And Reaping

The broker derives one absolute deadline from `CLOCK_MONOTONIC`. Every poll or
grace timeout is recalculated from an absolute deadline; interruptions and
wakeups never reset elapsed time.

On timeout, client disconnect after helper start, response overflow, daemon
shutdown, or another abort requiring child termination:

```text
SIGTERM to child process group
-> short bounded monotonic grace
-> SIGKILL if still alive
-> drain child pipes to EOF
-> waitpid until the child is reaped
-> only then emit a terminal response
```

A terminal `timeout` outcome is valid only when reaping is proven. Failure to
kill or reap becomes `transport_failure` with the best proven start state. No
path returns to `accept()` while its child remains unreaped.

## Transport Protocol

The separate wire protocol is named `z2m-helper-transport-v1`. It does not
change or encapsulate new semantics into the frozen helper protocol.

Each direction carries exactly one binary-safe frame followed by EOF:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 8 | ASCII magic `Z2MHTV1\n` |
| 8 | 1 | frame type: request `0x01`, response `0x02` |
| 9 | 1 | flags, required zero |
| 10 | 2 | reserved, required zero |
| 12 | 4 | unsigned big-endian JSON header length |
| 16 | 4 | unsigned big-endian body length |

Short frames, excess data, nonzero flags/reserved fields, excessive lengths,
invalid strict JSON headers, duplicate keys, unknown properties, invalid
identity, and missing EOF are transport framing failures.

### Request

Exact header shape:

```json
{
  "protocol": "z2m-helper-transport-v1",
  "requestId": "state-write:1234:17",
  "timeoutMs": 30000
}
```

`requestId` matches `^[A-Za-z0-9._:-]{1,128}$`. `timeoutMs` is an integer from
1 through 30000 and is selected internally by typed adapter methods. The body
is the exact raw helper request sent to child stdin. The broker never parses,
rewrites, logs, or derives execution policy from it.

### Response

Closed outcomes:

```text
child_exited
timeout
spawn_failure
setup_failure
transport_failure
```

The strict response header includes:

- exact protocol and validated request ID;
- `startState`: `not_started`, `started`, or `unknown`;
- stdout and retained stderr lengths;
- stdout/stderr EOF and stderr truncation evidence;
- child reaped, exit/signal, and core metadata where a child existed;
- bounded failure stage, reason, and errno where applicable.

The response body is:

```text
raw helper stdout || retained helper stderr
```

The lengths in the header define the split. Stderr is diagnostic evidence only
and is never helper protocol input.

`spawn_failure` covers fork or fixed-helper `execve()` failure and proves the
helper did not start. `setup_failure` covers checked pre-exec descriptor/process
group setup and also proves non-start. `timeout` requires successful exec and
proven reap. `transport_failure` carries the strongest proven `startState` and
does not fabricate helper semantics.

## Adapter Boundary

After the spike and production broker are green, `core/native-helper.uc` uses
only the fixed AF_UNIX socket through `ucode-mod-socket`. Public exports remain
typed helper operations. A private transport function may share framing,
deadline, and response validation.

The adapter validates in this order:

1. typed caller arguments before socket use;
2. transport frame limits, strict header shape, protocol, and request ID;
3. transport outcome, start state, EOF, and reaped child evidence;
4. for `child_exited`, bounded helper stdout as exactly one JSON response;
5. helper `protocolVersion`, exact request ID, exclusive envelope, and fields;
6. helper exit category against child exit code and envelope semantics.

`child_exited` is not helper success by itself. Empty, malformed, trailing,
truncated, mismatched, signaled, or contradictory helper output is never
success.

Valid helper `ECOMMITUNKNOWN` remains a helper semantic failure with
`committed:true` and unknown durability. Transport loss after possible helper
start remains adapter transport uncertainty with `commitState:unknown`, no
automatic retry, and future reread/reconciliation. These categories are never
renamed or merged.

## Service Lifecycle

Only after exact-target spike success, package build installs `z2m-helperd` and
adds `+ucode-mod-socket`.

After successful managed-root bootstrap, the existing init script declares two
named procd instances in this order:

1. `helperd`
2. `watchdog`

Declaration order is not a readiness guarantee. Adapter connect failures during
startup are bounded dependency failures. The broker has its own respawn and
termination policy; a helper crash affects only the current request.

## M3 Verification

M3 becomes green only when the exact target passes all of these without skips:

- AF_UNIX import, connect, send, receive, poll, peer credentials, and EOF;
- exact binary/newline request and response;
- helper structured failure;
- malformed helper stdout;
- missing fixed helper as exact exec/spawn failure;
- injected setup failure through the close-on-exec status pipe;
- 4 MiB request and 6 MiB response;
- cap-plus-one output rejection;
- bounded retained and continuously drained stderr;
- 30-second child stopped by a 100 ms deadline plus bounded grace;
- no live, zombie, or orphan child after timeout;
- process-group descendant termination;
- client disconnect before and after successful exec;
- transport response truncation and malformed framing;
- exact request-ID correlation;
- no descriptor growth over at least 100 requests;
- static proof that production protocol and code accept no executable, argv,
  environment, shell, TCP listener, or arbitrary filesystem operation.

The previous intentional-red `uloop.process` probe is retained as historical
evidence until the broker gate is green, then replaced in the shared gate by
the broker contract test. M4 remains forbidden until M3 is fully green.

## Non-Goals

This amendment does not patch or vendor ucode, add concurrency, move filesystem
operations into the broker, create a generic exec service, persist state in the
daemon, redesign DNS/Telegram/WARP/routing/UI, implement `atomic_write_json`, or
start state-store/status migration work.
