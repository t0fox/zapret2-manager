# Native Foundation Filesystem Helper Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans task by task, and follow test-driven development.

**Goal:** Unblock Foundation Task 3 with a fixed-operation native filesystem
helper while preserving a narrow, reviewable privilege boundary.

**Architecture:** A short-lived target-native C executable consumes one bounded
JSON request on stdin and emits one bounded JSON response plus newline on
stdout, redacted diagnostics on stderr, and a stable exit category. Thin ucode
adapters later map this internal `protocolVersion` envelope to the frozen native
backend RPC envelope. There is no daemon, socket, service, or broker in the
approved implementation.

**Protocol source of truth:**
`zapret2-manager/src/z2m-core-helper/protocol-v1.json`.

## Global Constraints

- Follow the protocol manifest and companion design exactly; prose cannot add
  roots, operations, fields, or capabilities.
- No shell execution, generic command runner, caller-selected executable,
  absolute path, generic filesystem primitive, or unsafe pathname fallback.
- Traverse with `openat2` or a safe descriptor walk; fail capability if neither
  is available.
- Every implementation change starts with a failing executable test.
- Mutations later use only operation-scoped internal `flock`; no fake lease.
- SDK and router-only evidence remains explicitly classified.
- Do not modify unrelated worktree changes.

## Milestone 1: Protocol, Parser, Root/Path Validation, Stat And Read

**Files:**

- Create `zapret2-manager/src/z2m-core-helper/protocol-v1.json`.
- Create parser/root/path/read C files only after this documentation task.
- Create `tests/native/core/fs-helper-protocol.test.mjs` now; later add real C
  behavior tests.

**Scope:** Implement strict one-request framing and schema parsing, fixed root
descriptors/policy, canonical relative path validation, `stat_regular`, and
`read_regular`. Read uses canonical base64 and is limited to 4 MiB subject to
the selected root. `secrets` permits stat metadata only, not read or hash.

All reserved operations parse their complete future schemas and return
`EUNSUPPORTED` before side effects: `atomic_write`, `atomic_write_json`,
`mkdir_private`, `sha256_regular`, `rename_owned`, `unlink_owned`,
`lock_acquire`, `lock_release`, and `lock_status`.

- [x] Add a manifest contract test and observe RED against the absent manifest
  and superseded documents.
- [x] Define the closed protocol manifest and align design/plan documentation.
- [ ] Add failing strict parser tests: invalid UTF-8, duplicate keys, unknown
  keys, trailing data, integer typing, embedded NUL, request bounds, and every
  reserved operation returning `EUNSUPPORTED`.
- [ ] Implement the minimal short-lived parser and exactly one complete response.
- [ ] Add failing root/path/stat/read tests: root security, traversal variants,
  symlink/magic-link/mount refusal, FIFO/socket/directory refusal without
  blocking, exact/oversize reads, canonical base64, and secret non-disclosure.
- [ ] Implement root descriptors, `openat2` plus descriptor-walk fallback,
  descriptor `fstat`, and bounded read. Do not implement SHA or mutation.
- [ ] Run focused, sanitizer, baseline/result/native regression, SDK, and router
  gates at their applicable evidence levels.

## Milestone 2: Operation-Scoped Mutations And SHA

Implement `atomic_write`, `atomic_write_json`, `mkdir_private`, and
`sha256_regular` only after failing behavior tests. Mutations acquire an internal
`flock` for one invocation, use same-directory candidates, checked writes,
owner-before-mode, file fsync, rename, and root-policy directory fsync. Emit
`ECOMMITUNKNOWN` after uncertain post-rename durability. Never use staging as an
atomic source into persistent roots. SHA remains denied for `secrets`.

- [ ] Test schema, bounds, modes/UID/GID, create policy, object refusal,
  ordering, short writes, cleanup, concurrency, crash points, and idempotency.
- [ ] Implement only the tested closed operations and rerun all regressions.

## Milestone 3: Manager-Owned Rename And Delete

Design durable manager ownership evidence before implementation. Operations
remain same-root and token-bound. `rename_owned` and `unlink_owned` must not
become generic editors and remain `EUNSUPPORTED` until ownership tests prove
foreign files cannot be moved or removed.

- [ ] Review and approve the ownership evidence lifecycle and crash recovery.
- [ ] Test stale/wrong/replayed token, replacement, missing object, directory
  durability, concurrent mutation, and uncertainty before implementation.

## Milestone 4: Lock Decision Gate

`lock_acquire`, `lock_release`, and `lock_status` are broker-only reserved
operations and return `EUNSUPPORTED`. Operation-scoped mutation locking is the
default. Do not build persistent metadata leases or claim authority after the
short-lived helper exits.

- [ ] Gather evidence that cross-invocation retained locks are truly required.
- [ ] If proven, write and approve a separate retained-broker threat/design
  review before changing status or implementing any lock operation.

## Milestone 5: Ucode Adapters And Packaging

Add thin adapters that invoke only the fixed helper path, write one request,
read one response, verify `protocolVersion`/request identity/exit consistency,
and map to the backend `schemaVersion`/`generation` envelope. Never fall back to
shell filesystem code. Package a target-specific executable; no procd service
is installed for the short-lived helper.

- [ ] Add real-ucode tests for every public mapping and unavailable/malformed/
  incomplete helper response.
- [ ] Add package tests for target compilation, dependencies, binary path/mode,
  and absence of service/socket/shell fallback.
- [ ] Run SDK compilation or record `SDK_REQUIRED`; run router ownership,
  overlay, reboot, and power-loss acceptance or record `ROUTER_REQUIRED`.

## Completion Gate

Run focused protocol/helper tests, `tests/native/baseline.test.mjs`,
`tests/native/core/result.test.mjs`, all native regressions, and
`git diff --check`. Foundation Task 3 is complete only when implementation and
applicable external gates have evidence; this protocol-only milestone does not
claim C behavior or router acceptance.
