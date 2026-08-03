# Backend Core Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close audit findings A–V and connect every backend subsystem through shared safe execution, filesystem, locking, transaction, runtime, event, and job primitives.

**Architecture:** Introduce small ucode core modules, then migrate each existing vertical slice onto them. Preserve public behavior where safe, remove unsafe install RPC, split read/write/secret ACL, persist recovery state, and make long diagnostics asynchronous jobs.

**Tech Stack:** OpenWrt 25.12, ucode, rpcd/ubus, procd, ash, UCI, nftables, Node-based contract tests, shell target gates.

## Global Constraints

- The manager must not duplicate upstream zapret2 DPI-bypass logic.
- No user-controlled value may be interpolated into a shell command.
- Successful rollback must survive reboot and must not depend only on `/tmp`.
- Every mutation must use one global apply lock and an atomic persistent snapshot.
- Every external command must have bounded output, captured exit status, and a timeout policy.
- Read ACL must contain no mutating or secret-reveal method.
- Existing safe public RPC names remain stable.

---

### Task 1: Add backend-core regression harness

**Files:**
- Create: `tests/backend-core-contract.test.mjs`
- Modify: `tools/run-all-tests.sh`

**Produces:** Audit-tagged failing tests for A–V and a gate that reports skipped target-only checks explicitly.

- [ ] Add source-contract tests proving the current vulnerable patterns exist: domain shell concatenation, predictable `time()` temp files, read ACL mutation, tmpfs-only recovery, sourced health env, hardcoded job fingerprint, direct state write, and synchronous DNS sleeps.
- [ ] Run `tools/run-all-tests.sh`; record the expected RED tests.
- [ ] Add the new test file to the canonical runner without weakening crash/no-TAP handling.
- [ ] Commit: `test: codify backend audit regressions`.

### Task 2: Implement shared result, filesystem, lock, and execution primitives

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/lib/errors.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/lib/fs.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/lib/lock.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/lib/exec.uc`
- Test: `tests/backend-core-contract.test.mjs`

**Produces:** `ok(data)`, `fail(code,message,details)`, `secure_tmp(prefix)`, `atomic_write(path,data,mode)`, `with_lock(name,fn)`, and `run_bounded(argv,opts)`.

- [ ] Add failing tests for unique temp names, mode 0600, symlink refusal, atomic replacement, lock contention, exit-status capture, stderr capture, output cap, and timeout result.
- [ ] Implement the minimum helpers using `mktemp`, `flock`, temp+rename, bounded reads, and canonical error objects.
- [ ] Run focused tests, then the full suite.
- [ ] Commit: `feat: add safe backend core primitives`.

### Task 3: Replace RPC shell interpolation and unify wrappers

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify relevant CLI entrypoints to accept request-file paths or stdin.
- Test: `tests/backend-core-contract.test.mjs`

**Consumes:** Task 2 helpers.

- [ ] Add failing tests using domains and JSON payloads containing `;`, `$()`, backticks, quotes, newlines, and spaces.
- [ ] Replace `lists_action('check ' + domain)` with a request file consumed by `lists-cli.uc`.
- [ ] Replace every `time()` request filename with `secure_tmp()` and guaranteed cleanup.
- [ ] Route all CLI calls through one bounded wrapper; stop suppressing stderr and stop returning raw unbounded output.
- [ ] Run focused and full tests.
- [ ] Commit: `fix: remove rpc shell interpolation`.

### Task 4: Introduce declarative RPC manifest and ACL split

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/rpc-manifest.uc`
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Modify frontend calls only where privilege class changes.

**Produces:** One manifest containing method name, params, handler, access class, and mutation flag.

- [ ] Add failing test comparing manifest methods, rpcd signature, and ACL methods exactly.
- [ ] Move rollback/restore and secret reveal out of read ACL.
- [ ] Remove `proxy_quick_install` from handler, signature, ACL, and UI; package installation remains feed-only.
- [ ] Add missing ACL/signature entries for valid orchestra methods or remove dead wrappers.
- [ ] Run ACL/signature tests and full suite.
- [ ] Commit: `fix: derive rpc contract and enforce privilege split`.

### Task 5: Make config rendering shell-safe

**Files:**
- Modify renderer in proxy/config and any shell-config writer.
- Create shared shell-quoting helper or structured writer.
- Test: `tests/backend-core-contract.test.mjs`

- [ ] Add failing round-trip tests for quotes, dollar signs, command substitutions, backslashes, whitespace, and newlines.
- [ ] Render shell assignments with a single canonical escaping function.
- [ ] Run `sh -n` on candidate files before atomic install.
- [ ] Reject values that cannot be represented safely by the target config contract.
- [ ] Run focused and full tests.
- [ ] Commit: `fix: safely serialize shell configuration`.

### Task 6: Add persistent recovery and atomic state store

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/lib/state.uc`
- Modify: `service.uc`, apply/profile/proxy transaction modules, package install scripts.
- Test: reboot-simulation and interrupted-write tests.

**Produces:** Recovery root `/etc/zapret2-manager/recovery` mode 0700 and atomic JSON/config state files mode 0600.

- [ ] Add failing tests showing `/tmp` loss prevents rollback and direct state writes can corrupt JSON.
- [ ] Persist last-good, previous, original options, applied hashes, and transaction metadata.
- [ ] Make missing/corrupt snapshots explicit errors; never report rollback success after guessed defaults.
- [ ] Make repeated pause/stop idempotent without overwriting original enabled state.
- [ ] Run focused and full tests.
- [ ] Commit: `fix: persist recovery state atomically`.

### Task 7: Implement one transaction pipeline and global apply lock

**Files:**
- Create: `lib/transaction.uc`
- Modify: profile apply, list apply, DNS apply, service passthrough, catalog apply, proxy apply, blockcheck apply.

**Produces:** `transact(kind, candidate, install, activate, verify, rollback)` under one apply lock.

- [ ] Add concurrency tests proving a second mutation fails with `EBUSY` rather than interleaving.
- [ ] Migrate snapshot → candidate → validate → atomic install → lifecycle → verify → persist baseline → rollback.
- [ ] Remove direct `cp -f` rollback paths and per-module weak fallback markers.
- [ ] Stop service start/restart from implicitly rewriting `NFQWS2_OPT`; preset writes require explicit preset application.
- [ ] Run full tests.
- [ ] Commit: `feat: unify backend mutations as transactions`.

### Task 8: Canonicalize runtime and watchdog observation

**Files:**
- Create: `lib/runtime.uc`
- Modify: `status.uc`, `watchdog.uc`, jobs recovery, hotplug script.

**Produces:** exact argv-based daemon detection, one nft family/table check, stable per-PID CPU sampling, exact `--new` token counting.

- [ ] Add tests for substring false positives, PID churn, exact argument matching, and nft family consistency.
- [ ] Replace `pidof`, `pgrep -x`, and full-cmdline substring variants.
- [ ] Separate restart retry backoff from event cooldown.
- [ ] Add status refresh lock to prevent cache stampede.
- [ ] Run full tests.
- [ ] Commit: `fix: unify runtime detection and watchdog accounting`.

### Task 9: Centralize bounded events

**Files:**
- Create: `lib/events.uc`
- Modify: watchdog, hotplug, service, jobs, maintenance diagnostics.

- [ ] Add concurrent writer and retention tests.
- [ ] Implement locked NDJSON append with maximum size, rotation, and maximum retained files.
- [ ] Replace read-modify-write and raw `>>` paths.
- [ ] Add debug-log retention/rotation.
- [ ] Run full tests.
- [ ] Commit: `fix: make event and debug logging bounded`.

### Task 10: Harden generic jobs and health matrix

**Files:**
- Modify: `jobs-cli.uc`, health runner, blockcheck runner, package install permissions.
- Create JSON request reader used by runners.

- [ ] Add tests for concurrent start/sequence allocation, atomic records, malformed-record quarantine, cleanup of all sidecars, deterministic latest-job selection, per-kind crash recovery, and spawn verification.
- [ ] Store `runnerFingerprint` per job kind; health uses `health-run.sh`, blockcheck uses its own runner.
- [ ] Replace sourced `.env` and `eval` with JSON request data and strict service-id validation.
- [ ] Create job directories mode 0700 and request/result files mode 0600.
- [ ] Verify child existence immediately after spawn and return failure when launch fails.
- [ ] Run full tests.
- [ ] Commit: `fix: harden generic jobs and health runner`.

### Task 11: Bound DNS apply and use UCI parsing

**Files:**
- Modify: DNS CLI/module and RPC/UI status flow.
- Add DNS verification job kind.

- [ ] Add tests for valid UCI formatting variants, tab-separated hosts, maximum command count, and immediate RPC return.
- [ ] Read dnsmasq configuration through UCI APIs.
- [ ] Parse hosts with generic whitespace.
- [ ] Make synchronous apply bounded; enqueue probes and return a job ID.
- [ ] Require optimistic revision rather than treating it as optional.
- [ ] Run full tests.
- [ ] Commit: `fix: make dns apply bounded and format-safe`.

### Task 12: Real ucode and router acceptance gates

**Files:**
- Modify: `tools/run-all-tests.sh`, CI workflow, `docs/acceptance.md`.
- Create target smoke cases for timeout, procd, nftables, UCI, symlink handling, and reboot recovery.

- [ ] Make CI execute ucode syntax/runtime tests when the binary is installed.
- [ ] Fail with a clear required-target gate when critical target-only checks have no evidence.
- [ ] Run the complete local suite and publish counts.
- [ ] Run router smoke and recovery drills; attach exact commands/results to acceptance docs.
- [ ] Commit: `test: enforce real backend acceptance gates`.

### Task 13: Final audit closure matrix

**Files:**
- Create: `docs/audit/backend-a-v-closure.md`
- Update: architecture/upstream mapping documentation as needed.

- [ ] Map every A–V item and minor finding to code commit, automated test, and router evidence.
- [ ] Mark any unverified router-only behavior explicitly; do not claim closure without evidence.
- [ ] Run the canonical suite one final time.
- [ ] Commit: `docs: record backend audit closure evidence`.
