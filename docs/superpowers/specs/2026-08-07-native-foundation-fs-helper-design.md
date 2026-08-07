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
`generation`; the calling state layer supplies the current backend generation.
The later ucode adapter maps helper results into the frozen RPC envelope in
`docs/contracts/native-backend-v1.md`; the helper never assigns generation.

## Threat Model

The host kernel, host root/UID 0, the installed helper binary, and the compiled
root policy are trusted. A malicious UID 0 or `CAP_SYS_ADMIN` adversary is out of
scope: this short-lived root helper does not claim to resist an actor that can
replace the helper, alter mounts or namespaces, inspect `/proc`, or arbitrarily
mutate managed roots.

Unprivileged pathname attacks, malformed or hostile helper input, symlink and
magic-link substitution, path and mount escape, object-type substitution,
stale preconditions, accidental namespace collisions, and concurrent
cooperating helper writers are in scope. Descriptor-relative traversal,
root-level mutation locking, and inode/metadata/CAS checks provide pathname
safety, serialization, and detection within that boundary. Concurrent
privileged mutation outside the helper contract may be detected, but is not an
adversary the helper claims to defeat.

Once `requestId` passes schema validation, every response echoes it byte for
byte. Failures before request-ID validation, including malformed input, use
JSON `null`; success always requires a validated ID. Missing or mismatched IDs
in helper output are adapter integrity failures, never accepted responses.

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

Every root policy requires `objectType: directory` and `noFollowRoot: true`.
The helper alone opens each fixed absolute base with
`O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`, then verifies type, UID, GID, and mode on
the descriptor. Every ancestor must be a root-owned directory and not a
symlink. The sole writable-ancestor exception is root-owned sticky `/tmp`;
`/tmp/zapret2-manager` itself must be root-owned mode `0700`. Any insecure
ancestor/root is `EROOT`; if safe root opening is unavailable, capability fails.

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
schema and explicitly returns a complete `EUNSUPPORTED` failure at exit 3
before operation dispatch with no side effects. Milestone 1 does not implement
SHA, writes, mkdir, rename, unlink, lock behavior, a daemon, socket, or broker.

## Future Mutation And Lock Semantics

Future mutations use an operation-scoped internal `flock` held only for that
invocation. This serializes helper writers without pretending a short-lived
process can provide a persistent lease. Persistent atomic writes use a
same-directory candidate, checked writes, `fchown` then `fchmod`, file `fsync`,
descriptor-relative rename, and parent-directory `fsync`. A post-rename fsync
failure is `ECOMMITUNKNOWN`; callers reread before retrying. Tmpfs operations
require visibility but not a false persistence claim.

`sha256_regular` uses a shared operation-scoped lock on the validated root
directory. Cooperating helper mutations use the exclusive form of the same
per-root lock. This provides a stable hashing window against cooperating helper
writers. Host root is trusted; privileged non-cooperating writers are outside
the snapshot guarantee. Descriptor metadata revalidation remains best-effort
detection of external mutation and is not an unconditional filesystem snapshot
guarantee.

`mkdir_private` publishes a verified same-parent candidate with
`RENAME_NOREPLACE`. If the final name already exists, the helper first proves
candidate cleanup, then verifies the existing directory by descriptor. A policy
match with `existOk:true` is idempotent success; mismatch or `existOk:false` is a
clean failure. Ambiguous cleanup or any failure after publication is
`ECOMMITUNKNOWN`; the helper never deletes or recreates the existing final target.

Broker-only `lock_acquire`, `lock_release`, and `lock_status` return
`EUNSUPPORTED` unless evidence later proves that a retained broker is necessary.
Any broker would require a separate reviewed design. There is no fake lease,
renewal, or persisted lock authority in this helper.

## Errors And Exits

Failures contain stable code, bounded human message, retryability, committed
state, durability, and stage. The manifest freezes each code's allowed exits,
stages, and mutation certainty; `EPATH` and `EUNSUPPORTED` are always
`committed:false` with `durability:unchanged`. Callers branch only on code.
Messages/details and stderr
must redact paths and content. Stable exits are: 0 success; 2 malformed,
schema, framing, or request-size failure; 3 denied operation/root/path/policy;
4 filesystem/object failure with a complete response; 5 lock contention or
timeout; 6 commit uncertainty; 70 internal failure; 74 incomplete response.

`ECLEANUPUNKNOWN` is a pre-publication cleanup uncertainty: the intended final
target definitely was not published, so `committed:false` and
`durability:unchanged` describe that target, but a helper-owned candidate may
remain because cleanup absence was not proven. It is distinct from `ECONFLICT`
(precondition mismatch) and `ECOMMITUNKNOWN` (publication or committed
durability is uncertain).

For mutation-capable operations, exit 74 or an incomplete/missing helper response
after invocation is never safe-to-retry evidence. Transport truth takes
precedence when a complete structured response cannot be delivered. The adapter
must preserve possible commit uncertainty, reread actual state, and reconcile it
before deciding whether retry, conflict, or recovered success is appropriate.

The manifest defines stable codes including malformed/schema/size, denied root
and path, unsupported operation, object/type/link/device failures, lock and
ownership failures, commit uncertainty, internal failure, and incomplete
response. Reserved operations fail before side effects.

## Helper To RPC Mapping

The calling state layer supplies `generation`; the adapter must never derive it
from helper output. A valid helper success maps `data` to RPC `data`. A valid
helper failure maps through the manifest's closed `canonicalCodeByHelperCode`
table and preserves helper code, retryability, committed state, durability, and
stage in bounded RPC `error.details`.

Caller arguments rejected before helper invocation map to `EINPUT`. Helper
absence or transport failure and missing/incomplete output map to `EDEPENDENCY`.
Malformed output, protocol-version mismatch, and missing or mismatched
`requestId` after request validation map to `EINTERNAL`. No malformed helper
output is trusted as a helper-declared error, and no adapter path reports
success when transport or identity validation failed.

## Verification And Packaging

Protocol tests parse the manifest and enforce exact sets, policy fields,
schemas, status, limits, ownership, crash/idempotency text, envelopes, exits,
errors, and absence of generic or absolute capability. Later Linux tests will
compile production C and exercise actual descriptors, races, object types, and
base64 boundaries. OpenWrt SDK compilation is `SDK_REQUIRED`; package modes,
overlay durability, reboot, and power-loss behavior are `ROUTER_REQUIRED`.
