# Native Foundation Filesystem Helper Design

## Status

Approved design for unblocking Task 3 of
`docs/superpowers/plans/2026-08-06-native-backend-foundation.md`.

The target ucode capability audit is recorded in
`.superpowers/sdd/2026-08-06-native-backend-foundation/task-3-report.md`.
The audited runtime cannot provide descriptor-safe traversal, descriptor
metadata mutation, file and directory `fsync`, race-safe rename, or SHA-256.
The existing shell-based `core/fs.uc` and `core/lock.uc` scaffolds therefore
cannot satisfy Task 3 and must not ship.

## Goal

Provide the exact Task 3 ucode APIs through a narrowly scoped native helper
without adding a generic command runner, arbitrary filesystem access, or
pathname-check races.

## Architecture

Add one target-native C executable:

```text
/usr/libexec/zapret2-manager/z2m-core-helper
```

It runs as a root-owned procd service and listens on a mode `0600`
`SOCK_SEQPACKET` Unix socket. It accepts only UID 0 peers verified with
`SO_PEERCRED`. The daemon retains lock file descriptors across independent
rpcd calls and performs filesystem mutations while validating the same live
lease in one process.

The helper has a closed operation set:

```text
fs.read
fs.atomic_write
fs.mkdir_private
fs.sha256
lock.acquire
lock.renew
lock.release
lock.inspect
```

It has no `system()`, `popen()`, `exec*()`, shell syntax, generic rename,
generic unlink, plugin loading, or caller-selected executable.

`core/fs.uc` and `core/lock.uc` remain the public adapters. Their exported
interfaces remain:

```text
read_regular(path, max_bytes)
atomic_write(path, content, opts)
atomic_json(path, value, opts)
mkdir_private(path)
sha256_file(path)
acquire(name, timeout_ms, owner)
renew(lease)
release(lease)
```

## Request Boundary

Requests use schema version 1 and a closed JSON shape. Unknown keys, duplicate
keys, trailing input, embedded NUL, invalid integer types, and payloads above
4 MiB are rejected.

Filesystem requests select an allowlisted root ID and a relative path. They
never contain an arbitrary absolute path. Initial roots are:

| Root ID | Production path |
|---|---|
| `state` | `/etc/zapret2-manager/state` |
| `snapshots` | `/etc/zapret2-manager/snapshots` |
| `secrets` | `/etc/zapret2-manager/secrets` |
| `runtime` | `/tmp/zapret2-manager/runtime` |
| `jobs` | `/tmp/zapret2-manager/jobs` |
| `leases` | `/tmp/zapret2-manager/leases` |
| `logs` | `/tmp/zapret2-manager/logs` |
| `staging` | `/tmp/zapret2-manager/staging` |

Paths must be relative and canonical. Empty components, `.`, `..`, repeated
slashes, leading/trailing slashes, NUL, oversized components, and oversized
paths are rejected.

The daemon opens each root as a directory descriptor and verifies root owner,
mode, and type. Production roots are root-owned, mode `0700`, and not
symlinks. An insecure root prevents readiness.

## Filesystem Semantics

Traversal uses `openat2()` with `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, and
`RESOLVE_NO_MAGICLINKS` when available. The fallback walks every component
with descriptor-relative `openat()` and `O_NOFOLLOW`; it never concatenates an
absolute path. Mount crossing is rejected.

Reads and hashing open the final component with `O_NOFOLLOW`, verify the same
descriptor using `fstat()`, and require a regular file. `O_NONBLOCK` prevents
a FIFO from blocking before type verification. Over-size reads fail rather
than return truncated content.

Atomic writes:

1. Resolve and retain the parent directory descriptor.
2. Verify the destination is absent or a regular file, never a symlink, FIFO,
   socket, directory, or device.
3. Create a same-directory temporary file with `O_CREAT|O_EXCL|O_NOFOLLOW`.
4. Write all bytes with checked short-write handling.
5. Apply owner with `fchown()`, then mode with `fchmod()`.
6. `fsync()` the temporary file.
7. Build and `fsync()` requested rolling backups from verified descriptors.
8. Commit with descriptor-relative `renameat()` or
   `renameat2(RENAME_NOREPLACE)` when creation must remain exclusive.
9. `fsync()` the parent directory.
10. Remove uncommitted temporary files on every pre-rename failure.

Backups are `<name>.bak.1` through `<name>.bak.3`. The old destination remains
active until the candidate and backup are durable. A crash can leave fewer
backup generations, but never a partial active file.

SHA-256 is a small embedded streaming implementation with NIST vectors and
randomized cross-checks against Node `crypto`. The helper does not invoke
`sha256sum` or require OpenSSL.

## Lock Semantics

Lock files are:

```text
/tmp/zapret2-manager/locks/<sha256(name)>.lock
```

The daemon opens the lock inode safely, verifies regular type, root ownership,
mode `0600`, and one hard link, then retains an exclusive `flock()` descriptor.
The visible metadata is diagnostic; authority is the daemon's live lease
table plus retained descriptor.

A lease contains:

```json
{
  "name": "state/routing",
  "owner": "routing",
  "token": "lk-<64 lowercase hex>",
  "instance": "<32 lowercase hex>",
  "helperPid": 123,
  "helperStartTime": "4567",
  "acquiredAt": "RFC3339",
  "leaseMs": 30000,
  "expiresMonotonicMs": 987654321
}
```

Timeout and expiry use `CLOCK_MONOTONIC`. Wall-clock time is diagnostic only.
Token and daemon instance are generated with `getrandom()`. Release and renew
require exact name, owner, token, and daemon instance. Wrong identity returns
`EOWNERSHIP`; a released or expired token returns `ENOLEASE`; double release
fails. Daemon restart changes instance identity and automatically releases
kernel locks. PID/start time are evidence, never sole authority.

An in-flight helper mutation pins its validated lease until that operation
returns. Multi-step transactions renew before half of the lease duration and
must revalidate persisted generation after reacquisition.

## Error Model

Responses use a versioned JSON envelope and bounded messages. Failures report
the operation stage, retryability, and mutation certainty.

Pre-rename failure:

```json
{
  "ok": false,
  "error": {
    "code": "EIO",
    "stage": "file-fsync",
    "committed": false,
    "durability": "unchanged",
    "retryable": false
  }
}
```

Parent-directory fsync failure after rename:

```json
{
  "ok": false,
  "error": {
    "code": "ECOMMITUNKNOWN",
    "stage": "directory-fsync",
    "committed": true,
    "durability": "unknown",
    "retryable": false
  }
}
```

Callers must reread and compare digest after `ECOMMITUNKNOWN`; blind retry is
forbidden.

## Threat Boundary

The design is race-safe against unprivileged processes and all manager
writers. Managed roots are root-owned `0700`, and all canonical manager writes
must use this daemon. Linux does not offer conditional replace-by-previous-
inode for a hostile root process; concurrent malicious root modification is
outside this package's enforceable boundary and must not be described as
solved by pathname checks or pidfd.

## Packaging

The helper remains in the `zapret2-manager` package. The package becomes
target-specific by removing `PKGARCH:=all`. It compiles with `$(TARGET_CC)` and
links `libjson-c`. A dedicated `/etc/init.d/z2m-core-helper` procd service is
installed and started before canonical mutation RPC becomes available.

The backend reports `EDEPENDENCY` when the helper is unavailable. It never
falls back to shell-based filesystem or lock code.

## Verification

WSL tests compile and execute the production C sources against sandbox roots.
A test-only compile flag permits `--root-prefix`; production builds reject it.
Tests cover:

- symlinks in final and parent components;
- FIFO/socket/directory refusal without blocking;
- bounded reads;
- traversal and destination replacement races;
- short writes and temporary cleanup;
- `fchown` before `fchmod`;
- file fsync before rename and directory fsync after rename;
- post-rename commit uncertainty;
- three rolling backups;
- mode/owner preservation and `allow_create`;
- SHA-256 vectors and randomized cross-checks;
- lock contention, timeout, renewal, expiry, wrong identity, double release,
  daemon restart, PID reuse evidence, and client-process churn;
- ucode adapters invoking only the fixed helper protocol.

OpenWrt SDK compilation is `SDK_REQUIRED`. Overlay durability, package
permissions, procd ordering, reboot, and power-loss checks are
`ROUTER_REQUIRED`. WSL tests do not substitute for those gates.

## Migration

The unsafe untracked `core/fs.uc` and `core/lock.uc` scaffolds are replaced
only after the helper behavior is green. `core/lock-run.uc` is removed only
after all references are gone. Existing legacy code is not migrated or deleted
as part of Task 3.
