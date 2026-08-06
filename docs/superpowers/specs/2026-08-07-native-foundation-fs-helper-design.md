# Native Foundation Filesystem Helper Design

## Status

Approved protocol-v1 design for unblocking Foundation Task 3. This document
supersedes the daemon, socket, and broker-first proposal. The machine-readable
source of truth is
`zapret2-manager/src/z2m-core-helper/protocol-v1.json`; prose must not widen it.

The target ucode audit found no descriptor-safe traversal, file/directory
`fsync`, race-safe rename, or SHA-256. Shell-backed filesystem and lock
scaffolds therefore remain forbidden.

## Architecture

`/usr/libexec/zapret2-manager/z2m-core-helper` is a fixed, short-lived helper.
Each invocation consumes one bounded JSON request from stdin and emits one
bounded JSON response plus one newline on stdout. Redacted diagnostics may go
to stderr; the process also returns a stable exit category. It has no daemon,
Unix socket, service lifecycle, generic command runner, arbitrary filesystem
primitive, plugin loading, or caller-selected executable.

The internal envelope uses integer `protocolVersion: 1`, a bounded `requestId`,
a closed operation name, and closed arguments. It deliberately has no backend
`generation`; the later ucode adapter maps helper results into the frozen RPC
envelope in `docs/contracts/native-backend-v1.md`.

Input is strict UTF-8. Invalid UTF-8, embedded NUL, duplicate JSON object keys,
unknown keys, invalid integer types, more than one JSON value, and non-whitespace
trailing data are rejected. Trailing JSON whitespace is accepted. Request wire
size is at most 4 MiB and response wire size is at most 6 MiB. A response that
cannot be completed is never presented as success.

## Closed Surface

The exact roots are `persistent_state`, `snapshots`, `registry`, `secrets`,
`runtime`, `jobs`, `locks`, and `staging`. The exact operations are:

```text
stat_regular read_regular atomic_write atomic_write_json mkdir_private
sha256_regular rename_owned unlink_owned lock_acquire lock_release lock_status
```

Filesystem operations accept a root ID and canonical relative path, never an
absolute path. The protocol has no generic rename, unlink, read, write, or
command capability. Same-root `rename_owned` and `unlink_owned` are reserved
for a manager-owned 256-bit token evidence model; they return `EUNSUPPORTED`
until that model is implemented. They must not become generic editors.

## Root Policy

| Root | Base | Storage | Max read | Depth | mkdir/delete | Directory fsync |
|---|---|---|---:|---:|---|---|
| `persistent_state` | `/etc/zapret2-manager/state` | persistent | 4 MiB | 16 | private/token | required |
| `snapshots` | `/etc/zapret2-manager/snapshots` | persistent | 4 MiB | 16 | private/token | required |
| `registry` | `/etc/zapret2-manager/registry` | persistent | 4 MiB | 16 | private/token | required |
| `secrets` | `/etc/zapret2-manager/secrets` | persistent | 0 | 8 | private/token | required |
| `runtime` | `/tmp/zapret2-manager/runtime` | tmpfs | 1 MiB | 12 | private/token | not required |
| `jobs` | `/tmp/zapret2-manager/jobs` | tmpfs | 4 MiB | 16 | private/token | not required |
| `locks` | `/tmp/zapret2-manager/locks` | tmpfs | 0 | 1 | denied/denied | not required |
| `staging` | `/tmp/zapret2-manager/staging` | tmpfs | 4 MiB | 12 | private/token | not required |

All roots are root-owned UID/GID 0 directories with mode `0700`; managed files
are `0600` and managed directories `0700`. Persistent roots survive reboot;
tmpfs roots are cleared on reboot. A 4 MiB first-milestone read ceiling keeps
base64 output below the 6 MiB response limit. Lower per-root limits constrain
high-churn runtime data. Depth 16 supports structured manager state without
allowing unbounded traversal; runtime/staging use 12, secrets 8, and locks 1.

`secrets` permits regular-file metadata but denies content read and hashing, so
`stat_regular` never contains payload bytes. `locks` permits only lock lifecycle
operations. `staging` is temporary workspace and is not an atomic rename source
into persistent roots; all cross-root rename is denied.

## Path Safety

Paths are non-empty canonical UTF-8 relative paths, at most 4096 bytes, 255
bytes per component, and 32 components globally before the lower root depth is
applied. Leading/trailing/repeated slash, `.`, `..`, NUL, symlink, magic-link,
and mount crossing are rejected.

Traversal first uses `openat2()` with `RESOLVE_BENEATH`,
`RESOLVE_NO_SYMLINKS`, and `RESOLVE_NO_MAGICLINKS`. The fallback walks from an
opened root descriptor with `openat()` and `O_NOFOLLOW`, validating every
descriptor. If neither route is safe on the target, the helper fails the
capability instead of using pathname checks or concatenated absolute paths.

## Milestone 1

Milestone 1 implements only strict framing/schema parsing, root validation,
path validation, `stat_regular`, and `read_regular`. The stat success data is
exactly regular type, size, mode, uid, gid, and mtime seconds/nanoseconds. Read
success data is exact byte length plus strict canonical base64 content; no
alternate alphabet, whitespace, or omitted padding is accepted. Reads fail
rather than truncate with `ETOOBIG` and are capped at 4 MiB of decoded content
subject to root policy. Base64 and envelope overhead remain under the separate
6 MiB response-wire cap.

Every other operation is present with its complete future request/success
schema and returns `EUNSUPPORTED`. Milestone 1 does not implement SHA, writes,
mkdir, rename, unlink, lock behavior, a daemon, socket, or broker.

## Future Mutation And Lock Semantics

Future mutations use an operation-scoped internal `flock` held only for that
invocation. This serializes helper writers without pretending a short-lived
process can provide a persistent lease. Persistent atomic writes use a
same-directory candidate, checked writes, `fchown` then `fchmod`, file `fsync`,
descriptor-relative rename, and parent-directory `fsync`. A post-rename fsync
failure is `ECOMMITUNKNOWN`; callers reread before retrying. Tmpfs operations
require visibility but not a false persistence claim.

Broker-only `lock_acquire`, `lock_release`, and `lock_status` return
`EUNSUPPORTED` unless evidence later proves that a retained broker is necessary.
Any broker would require a separate reviewed design. There is no fake lease,
renewal, or persisted lock authority in this helper.

## Errors And Exits

Failures contain stable code, bounded human message, retryability, committed
state, and durability; callers branch only on code. Messages/details and stderr
must redact paths and content. Stable exits are: 0 success; 2 malformed,
schema, framing, or request-size failure; 3 denied operation/root/path/policy;
4 filesystem/object failure with a complete response; 5 lock contention or
timeout; 6 commit uncertainty; 70 internal failure; 74 incomplete response.

The manifest defines stable codes including malformed/schema/size, denied root
and path, unsupported operation, object/type/link/device failures, lock and
ownership failures, commit uncertainty, internal failure, and incomplete
response. Reserved operations fail before side effects.

## Verification And Packaging

Protocol tests parse the manifest and enforce exact sets, policy fields,
schemas, status, limits, ownership, crash/idempotency text, envelopes, exits,
errors, and absence of generic or absolute capability. Later Linux tests will
compile production C and exercise actual descriptors, races, object types, and
base64 boundaries. OpenWrt SDK compilation is `SDK_REQUIRED`; package modes,
overlay durability, reboot, and power-loss behavior are `ROUTER_REQUIRED`.
