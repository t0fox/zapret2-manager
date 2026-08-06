# Native Foundation Filesystem Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock Foundation Task 3 with a fixed-operation native filesystem helper and retained-descriptor lock broker while preserving the planned ucode API.

**Architecture:** A target-native C daemon performs descriptor-safe filesystem operations and retains lock descriptors across rpcd calls. Thin ucode adapters map approved paths and canonical results to a closed JSON protocol. No shell or generic process execution is added.

**Tech Stack:** C11, Linux `openat2`/`openat`, Unix `SOCK_SEQPACKET`, `flock`, procd, libjson-c, ucode, Node.js tests, OpenWrt package make.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md` exactly.
- No `system`, `popen`, `exec*`, shell command, generic command runner, arbitrary absolute path, or generic filesystem operation.
- Production requests use only allowlisted root IDs and canonical relative paths.
- Every production change starts with a failing executable test against the real C or ucode artifact.
- WSL proves Linux behavior only; package compilation is `SDK_REQUIRED`, and overlay/reboot/power-loss acceptance is `ROUTER_REQUIRED`.
- Do not modify or include unrelated dirty worktree paths.

---

### Task 1: Protocol, Root Policy, and Test Harness

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/protocol.h`
- Create: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Create: `zapret2-manager/src/z2m-core-helper/roots.h`
- Create: `zapret2-manager/src/z2m-core-helper/roots.c`
- Create: `zapret2-manager/src/z2m-core-helper/main.c`
- Create: `tests/native/helper/build-helper.sh`
- Create: `tests/native/helper/helper-fixture.mjs`
- Create: `tests/native/core/fs-helper.test.mjs`

**Interfaces:**
- Produces strict schema-1 request parsing, response serialization, test daemon startup, and root/path validation.
- Accepts only the operations and roots listed in the approved design.

- [ ] Write executable tests for unknown/duplicate keys, trailing JSON, payload bounds, absolute/traversal paths, unknown roots, insecure roots, production rejection of `--root-prefix`, and socket peer permissions.
- [ ] Run `node --test tests/native/core/fs-helper.test.mjs`; confirm RED because the helper is absent.
- [ ] Implement the minimal closed parser, root descriptor table, socket server, client mode, and test-only root prefix.
- [ ] Compile with `-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE` and run the tests GREEN.
- [ ] Run ASan/UBSan when available and commit `feat(core): add native helper protocol`.

---

### Task 2: Descriptor-Safe Read and SHA-256

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/fs_ops.h`
- Create: `zapret2-manager/src/z2m-core-helper/fs_ops.c`
- Create: `zapret2-manager/src/z2m-core-helper/sha256.h`
- Create: `zapret2-manager/src/z2m-core-helper/sha256.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `tests/native/core/fs-helper.test.mjs`

**Interfaces:**
- Produces `fs.read` and `fs.sha256` over one verified regular-file descriptor.
- Returns `ENOENT`, `ENOTREG`, `ESYMLINK`, `ETOOBIG`, or bounded `EIO` evidence.

- [ ] Add failing tests for final/parent symlinks, FIFO non-blocking refusal, directory/socket refusal, exact and over-size reads, mount crossing, NIST SHA-256 vectors, and randomized Node crypto comparison.
- [ ] Run the focused suite and preserve RED.
- [ ] Implement `openat2` traversal with descriptor-walk fallback, `fstat` regular-file proof, bounded streaming read, and embedded streaming SHA-256.
- [ ] Run focused tests, sanitizer tests, and protocol regressions GREEN.
- [ ] Commit `feat(core): add descriptor-safe native reads`.

---

### Task 3: Atomic Write, Durability, and Backups

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/fs_ops.c`
- Create: `tests/native/helper/syscall-shim.c`
- Modify: `tests/native/helper/build-helper.sh`
- Modify: `tests/native/core/fs-helper.test.mjs`

**Interfaces:**
- Produces `fs.atomic_write` and `fs.mkdir_private` with Task 3 options and mutation-certainty responses.

- [ ] Add failing real-kernel tests for symlink/FIFO refusal, `allowCreate`, mode/owner preservation, three rolling backups, cleanup, and race attempts.
- [ ] Add failing instrumented tests proving `fchown -> fchmod -> fsync(file) -> rename -> fsync(directory)` and each pre/post-rename failure result.
- [ ] Implement checked writes, same-directory exclusive temp files, descriptor ownership/mode, durable backup rotation, atomic commit, parent sync, and cleanup.
- [ ] Run focused, race-loop, sanitizer, and protocol regression suites GREEN.
- [ ] Commit `feat(core): add durable native atomic writes`.

---

### Task 4: Retained-Descriptor Lock Broker

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/lock_broker.h`
- Create: `zapret2-manager/src/z2m-core-helper/lock_broker.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Create: `tests/native/core/lock-helper.test.mjs`

**Interfaces:**
- Produces `lock.acquire`, `lock.renew`, `lock.release`, and `lock.inspect`.
- Lock names hash to `/tmp/zapret2-manager/locks/<sha256(name)>.lock`.

- [ ] Add failing tests for same-name contention, different-name concurrency, monotonic timeout, client exit, renew, expiry, wrong owner/token/instance, double release, daemon crash/restart, stale metadata, PID reuse evidence, in-flight mutation pinning, and waiter fairness.
- [ ] Run focused tests and preserve RED.
- [ ] Implement retained `flock` descriptors, `getrandom` identities, daemon instance, FIFO waiter queue, monotonic expiry, exact release/renew identity, and operation pinning.
- [ ] Run focused, sanitizer, and filesystem regression suites GREEN.
- [ ] Commit `feat(core): add native lock broker`.

---

### Task 5: Ucode Filesystem and Lock Adapters

**Files:**
- Replace: `zapret2-manager/files/usr/libexec/zapret2-manager/core/fs.uc`
- Replace: `zapret2-manager/files/usr/libexec/zapret2-manager/core/lock.uc`
- Delete after reference check: `zapret2-manager/files/usr/libexec/zapret2-manager/core/lock-run.uc`
- Create: `tests/native/core/fs.test.mjs`
- Modify: `tests/native/foundation.test.mjs`

**Interfaces:**
- Produces the original Foundation Task 3 ucode interfaces unchanged.
- Maps only approved legacy absolute paths to helper root/path pairs.

- [ ] Add failing real-ucode tests for every public API, option, error mapping, lease lifecycle, and helper-unavailable fail-closed behavior.
- [ ] Prove the old source assertions cannot detect an unsafe implementation, then replace them with behavioral coverage.
- [ ] Implement thin request creation, fixed helper invocation, response parsing, canonical envelopes, and JSON serialization.
- [ ] Verify no `popen`, shell command, `system`, `eval`, `sh -c`, or fallback path remains; remove `lock-run.uc` only after grep proves no references.
- [ ] Run helper, ucode, compile, and native regression suites GREEN and commit `feat(core): add atomic files and identity locks`.

---

### Task 6: Package and procd Integration

**Files:**
- Modify: `zapret2-manager/Makefile`
- Create: `zapret2-manager/files/etc/init.d/z2m-core-helper`
- Modify: `tests/packaging.test.mjs`
- Create: `tests/native/core/helper-service.test.mjs`

**Interfaces:**
- Builds and installs the target helper and starts it before canonical mutation RPC is enabled.

- [ ] Add failing package tests for target-specific build, compiler flags, libjson-c dependency, binary path/mode, service path/mode, socket policy, and absence of shell fallback.
- [ ] Implement OpenWrt `Build/Prepare`, `Build/Compile`, install, dependency, and procd service wiring; remove `PKGARCH:=all`.
- [ ] Run local package-shape and service tests GREEN.
- [ ] Run OpenWrt package compilation when SDK is available; otherwise record `SDK_REQUIRED` without claiming package success.
- [ ] Commit `build(core): package native safety helper`.

---

### Task 7: Task 3 Integration and Router Acceptance

**Files:**
- Modify: `tests/native/core/fs.test.mjs`
- Modify: `docs/superpowers/plans/2026-08-06-native-backend-foundation.md`
- Create: `docs/acceptance/native-core-fs-helper.md`

**Interfaces:**
- Produces reviewed evidence that the original Foundation Task 3 contract is satisfied.

- [ ] Run all helper, ucode, native, compile, and repository gates and preserve exact output.
- [ ] Verify package compilation on every supported architecture (`SDK_REQUIRED`).
- [ ] Verify overlay durability, permissions, helper/rpcd restart, lock expiry, reboot, and power-loss before/after rename (`ROUTER_REQUIRED`).
- [ ] Mark Foundation Task 3 complete only when local gates pass and external gates are explicitly classified.
- [ ] Commit `test(core): gate native filesystem safety`.
