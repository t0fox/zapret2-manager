# Task 5 Report: High-Risk Transient Strategy Execution

## Status

COMPLETE

Implemented the bounded transient Scanner session and its product/native runtime
tests. The implementation is intentionally fail-closed where the current
checkout has no existing server-owned firewall/process activation adapter: test
evidence is accepted only through the existing server-test boundary; production
activation, stabilization, and cleanup return infrastructure errors rather than
inventing a second Apply or firewall engine.

## Files Changed

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`
- `tests/product/avatar-strategy-scanner-transient.test.mjs`
- `tests/native/avatar-strategy-scanner-runtime.test.mjs`

No DNS, Telegram, TG, router, LuCI, frontend, RPC, or Orchestra files changed.

## Implementation

- Added `scanner_session_begin`, `scanner_candidate_activate`, and
  `scanner_candidate_cleanup`, plus `scanner_session_run` as the bounded
  coordinator.
- Acquires the existing config transaction lock and captures one complete
  pre-scan snapshot containing config bytes/hash, Strategy selection identity,
  runtime observation, and owned firewall/NFQUEUE reference.
- Accepts only bounded Scanner candidates with protocol, compiled token/candidate
  identity, compiled digest, and dependency digest. Production compile/preflight
  delegates to the existing Profile/native preflight path and rejects missing
  dependencies or incomplete native admission.
- Enforces complete process identity tuple matching, Scanner ownership namespace,
  owned `zapret2` firewall evidence, NFQUEUE registration, and queue owner PID
  matching the activated process.
- Stabilization is bounded to three attempts. Candidate evidence remains a
  candidate failure after bounded retry; adapter/runtime failures remain
  infrastructure failures.
- Cleanup requires verified removal of only owned process, firewall, NFQUEUE,
  hostlist, and temporary-file artifacts. Cleanup failure stops progression.
- Candidates are cleaned to a controlled neutral state between attempts; the
  original runtime is not restored between candidates and no persistent Strategy
  selection/favorites/config state is changed.
- No Scanner config writer, direct `/opt/zapret2/config` write, nft flush, raw
  shell command, caller executable, caller argv, or user raw argument path was
  added.

## TDD Evidence

The required RED command was run before `scanner-transient.uc` existed:

```text
node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
```

Result: native identity tests passed; all five transient product tests failed on
the absent module/entry points, as expected.

After implementation, the focused GREEN command passed:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
```

Result: 7 passed, 0 failed.

Coverage includes one lock/one snapshot, preservation and neutral state,
server-side preflight/dependency refusal, exact process identity and NFQUEUE
ownership, bounded stabilization/retry, candidate-vs-infrastructure failure,
cleanup-stop behavior, owned-only cleanup, and forbidden operation rejection.

## Verification

Focused Apply/compiler/transient/native aggregate:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
```

Result: 59 passed, 0 failed.

Static checks:

- `node --check tests/product/avatar-strategy-scanner-transient.test.mjs`: pass.
- `node --check tests/native/avatar-strategy-scanner-runtime.test.mjs`: pass.
- `git diff --check`: pass.
- Changed-file audit: exactly the five brief-listed files changed.
- Direct native process-identity probe compiled and passed using `cc`.

The broader Scanner aggregate was attempted. Its failures are inherited from
Tasks 2/3: the available WSL ucode build reports null-indexing failures in the
unchanged `scanner-targets.uc:136` and scanner-model harness tests. No Task 5
assertion failed.

The canonical `scripts/test/native.sh` gate was attempted but did not produce a
usable completion result in this Windows checkout/WSL environment. The gate
requires the Linux native build/test environment and its configured writable
native temp/toolchain path. This is not attributed to Task 5.

## Runtime Limitations

- ROUTER_E2E: NOT RUN. Physical-router mutation/deployment approval was not
  provided.
- Native production engine/NFQUEUE/firewall activation was not run because the
  host does not provide `/opt/zapret2/nfq2/nfqws2` or a live router firewall.
- Existing repository code exposes read-only runtime/NFQUEUE observation and
  targeted cleanup in other workers, but no approved reusable transient
  activation primitive for this Scanner boundary. The production transient
  seams therefore fail closed until that server-owned native adapter is wired;
  the implementation does not create a competing firewall/apply authority.

## Concerns

- A Linux/OpenWrt follow-up is required to execute the real server-owned
  activation/stabilization/cleanup seams against the installed nfqws2 and
  firewall, then run the canonical native gate and router E2E.
- The WSL ucode null-indexing incompatibility in unchanged Task 2/3 Scanner
  target/model code remains documented and unrelated.

## Fix Round 2

### Status

PASS WITH DOCUMENTED HOST LIMITATIONS. The Task 5 runtime/transient boundary now
fails closed across activation, stabilization, cleanup, lock release, firewall
ownership, compiled-token staging, and session-directory removal. Task 7 terminal
restore remains deferred and is not claimed here.

### Fixes

- Any runtime resource creation records rollback state. Activation failures return
  cleanup evidence after process termination, exact chain ownership verification,
  NFQUEUE observation, and transient artifact removal.
- Stabilization and identity failures execute the same owned candidate cleanup
  before returning. Coordinator cleanup evidence is retained on all error paths;
  lock release is attempted only after cleanup.
- Firewall ownership is bound to `session`, candidate, and generation markers,
  with an exact chain-output digest captured at creation. Cleanup refuses deletion
  when the marker, queue rule, or exact rule-set digest does not match.
- Lock metadata is a session-bound descriptor containing PID, procfs starttime,
  and a nonce. Release requires the matching session and nonce and refuses
  tampered metadata.
- The candidate token stream is computed once. Compile/preflight output must
  match the exact candidate string, token stream, and digest before argv staging;
  only the verified output is staged.
- Successful completion treats lock-release failure as an explicit infrastructure
  error and runs session cleanup/recovery evidence instead of returning success.
- Session directory removal is a separate verified operation performed only after
  cleanup and lock release; uncertain or non-empty directories are preserved.

### TDD And Verification

- Initial round-2 RED focused run: **13 pass, 5 fail**. Failures were the new
  cleanup-evidence, exact compile binding, release-failure, and runtime ownership
  contract assertions.
- Focused GREEN command:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
  ```

  Result: **21 passed, 0 failed**.
- Final Task 5 aggregate:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
  ```

  Result: **73 passed, 0 failed**.
- `node --check` passed for both changed JavaScript test files.
- `sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` passed.
- `git diff --check` passed before final aggregate verification.

### Concerns

- Real OpenWrt nfqws2, nftables, NFQUEUE, and production ucode activation were
  not available on this Windows/WSL host; the native lifecycle uses fixed shims.
- The broader Scanner target/model aggregate retains the pre-existing WSL ucode
  null-indexing failures documented above.
- No permanent config or Strategy mutation, nft flush, raw caller command/exec/
  argv/path input, or Task 7 restoration claim was added.

## Fix Round 3

### Status

PASS WITH DOCUMENTED HOST LIMITATIONS. Critical/Important Task 5 ownership,
cleanup, activation, lock, compiler-binding, and coordinator findings were
addressed. Task 7 terminal restoration remains deferred and is not claimed.

### Fixes

- Added a private per-session ownership journal with session, candidate,
  generation, nonce, owner, and resource-created transitions. Journal and
  cleanup evidence files are private, atomic, regular files; failed cleanup
  retains the ownership/evidence state and publishes recovery evidence.
- Cleanup now deletes ownership metadata only after process, exact firewall,
  NFQUEUE, and temporary-resource removal are each verified. Repeating cleanup
  after a verified removal is idempotent; missing or ambiguous ownership still
  fails closed.
- Firewall deletion is serialized by a private ownership lock and performs an
  immediate marker, queue, and exact chain-digest recheck immediately before the
  fixed `nft delete chain`; no flush operation exists. The marker includes the
  session/candidate/generation and random lock nonce.
- Candidate argv staging uses private atomic temp files plus rename, rejects
  symlinks, and writes a session/candidate/generation/nonce sidecar. The runtime
  recomputes the argv digest before and immediately before launch. Compiler
  preflight now requires compiler-owned token output and exact digest equality.
- Coordinator paths clone candidates instead of mutating caller objects, retain
  cleanup/recovery evidence on activation, snapshot, candidate cleanup, lock
  release, and session-removal failures, and invoke session recovery before
  returning an error.
- Lock descriptors use cryptographic random bytes from `/dev/urandom`, private
  atomic creation, and release rereads/verifies session, nonce, PID, and
  procfs starttime under the ownership lock before signaling. Tampered
  descriptor behavior is covered by a native shim test.
- Explicitly added `scanner-runtime-adapter.sh` to Task 5 plan/package/test
  coverage. No unrelated package implementation was changed.
- Corrected the misleading lock-release test to require recovery evidence rather
  than asserting its absence.

### TDD And Verification

- RED additions covered caller-object mutation, snapshot cleanup evidence,
  compiler token omission, lock-release recovery, descriptor tampering, repeat
  cleanup, journal/atomic metadata, and prelaunch argv/firewall invariants.
- Focused GREEN command:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/native/avatar-strategy-scanner-runtime.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs
  ```

  Result: **26 passed, 0 failed**.
- Task 5 aggregate including Apply/compiler/package:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs tests/native/avatar-strategy-package.test.mjs
  ```

  Result: **91 passed, 1 pre-existing host-mode failure**. The failure is the
  unchanged pinned catalog mode check (`advanced/discord_voice_zapret2_advanced.txt`:
  expected `0644`, Windows-mounted checkout reports `0777`); no catalog file is
  changed by this round.
- `node --check` passed for both changed JavaScript test files.
- `sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` passed under WSL.
- `git diff --check` passed.
- The scanner-wide aggregate was attempted but exceeded the 120-second host
  timeout after running unrelated suites; known pre-existing WSL ucode
  null-indexing failures remain outside Task 5.

### Concerns

- Real OpenWrt nftables, NFQUEUE, nfqws2, and production ucode activation were
  not run on this Windows/WSL host. Physical-router E2E remains intentionally
  unrun.
- Task 7 still owns terminal restoration/reconciliation. This report claims
  only transient-session cleanup/recovery evidence and does not claim permanent
  config or Strategy restoration.

```text
ROUTER_E2E: NOT RUN
REASON: explicit physical-router mutation/deployment approval was not provided
```

## Feasibility Recheck: Atomic Firewall Ownership Delete

### Status

BLOCKED: Task 5 production lifecycle remains incomplete. The production helper
now fails closed with `EUNSUPPORTED` before opening runtime files, taking a lock,
invoking nft, or deleting anything. The existing compare/delete behavior remains
compiled only inside `Z2M_SCANNER_HELPER_TEST` so the mutation and race tests
continue to exercise the safety boundary without turning the unsupported
production path into a claim.

### Exact Proof

The requested alternatives were checked against the Linux nftables UAPI, kernel
implementation, nft documentation, libnftnl sources, OpenWrt package metadata,
and this checkout:

- `NFT_MSG_GETGEN` is registered by the kernel as an `NFNL_CB_RCU` read callback.
  `nf_tables_getgen()` returns `NFTA_GEN_ID`; the request does not carry a
  compare value and does not reserve that generation for a later mutation.
- `NFT_MSG_DELCHAIN` is registered separately as an `NFNL_CB_BATCH` mutation.
  `nf_tables_delchain()` resolves the chain by name or `NFTA_CHAIN_HANDLE` and
  queues deletion. The delete policy has no generation-id or userdata/digest
  precondition. A handle identifies the currently resolved object; it is not an
  ownership or compare token.
- Netfilter batch begin/end makes the submitted nft mutation set commit as one
  transaction. It cannot place a kernel read result, userspace digest comparison,
  and conditional delete into one transaction. libnftnl exposes batch framing,
  chain handles, and generation-object formatting, but no conditional-delete
  operation.
- nft's `owner` table flag would exclude other netlink processes from the table,
  but `zapret2` is an existing fw4/upstream table and this helper does not own
  it. Enabling ownership would itself mutate unrelated authority and is not a
  safe Task 5 change.
- The repository's writer inventory disproves a manager-wide lock contract:
  `blockcheck-run.sh` and `orchestra-candidate-run.sh` issue targeted nft deletes
  without `firewall.lock`; `dns-global.uc`, `status-collector.uc`, and
  `watchdog.uc` also invoke nft outside that lock. Changing those writers is
  explicitly outside this task and would still not make unrelated external
  writers cooperate.

Primary sources checked:

- Linux UAPI `nf_tables.h`: `NFT_MSG_GETGEN`, `NFTA_GEN_ID`,
  `NFTA_CHAIN_HANDLE`, and `NFT_MSG_DELCHAIN`:
  `https://raw.githubusercontent.com/torvalds/linux/master/include/uapi/linux/netfilter/nf_tables.h`
- Linux kernel `nf_tables_api.c`: `nf_tables_getgen()`, callback types,
  `nft_chain_lookup_byhandle()`, and `nf_tables_delchain()`:
  `https://raw.githubusercontent.com/torvalds/linux/master/net/netfilter/nf_tables_api.c`
- nft man page: chain/rule deletion by name or handle and transaction input:
  `https://www.netfilter.org/projects/nftables/manpage.html`
- libnftnl batch and chain APIs/examples:
  `https://git.netfilter.org/libnftnl/tree/include/libnftnl`

### Remaining Safety Gaps

- The test-only compare/list/delete shim still has a userspace observation-to-
  mutation window by design. Its lock protects only cooperating test processes.
- Production Scanner activation and cleanup cannot be claimed until a kernel
  supported conditional operation or an approved all-writer ownership contract
  is introduced. The helper deliberately returns `EUNSUPPORTED` instead.
- Other targeted cleanup paths remain non-atomic and outside this task, notably
  PID-named blockcheck table cleanup and Orchestra table cleanup. They must not
  be treated as proof of Scanner chain ownership.

### Verification

- Added a production-mode behavioral test that compiles the helper without the
  test macro and proves the fixed request returns `EUNSUPPORTED` without any nft
  or runtime-root setup.
- Existing test-mode exact-owner deletion and mutation-retention tests remain
  unchanged and continue to cover the controlled shim only.

## Final Architecture Fix (Superseded by Feasibility Recheck)

### Status

SUPERSEDED. The dedicated helper is retained as a root-owned fixed boundary, but
the feasibility recheck above proves that its production compare-delete path
cannot be made atomic in this checkout. The current production behavior is
fail-closed `EUNSUPPORTED`; Task 5 is not complete.

### Native Boundary

- Added `z2m-scanner-firewall-helper.c`, packaged as
  `/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper`.
- The helper accepts one fixed JSON request with only session, candidate,
  generation, nonce, ownership token, marker, and expected chain digest. It does
  not accept an executable, path, command, raw argv, table, chain, queue, or nft
  path from callers.
- It fixes nft to `/usr/sbin/nft`, table `zapret2`, chain `z2m_scanner`, and
  queue `300`; serializes ownership with a root-owned lock; verifies the exact
  marker, queue occurrence, and chain digest; and issues only
  `nft delete chain inet zapret2 z2m_scanner` after the checks pass.
- In the historical test-only implementation, any mismatch, nft failure,
  post-delete ambiguity, or evidence-write failure returned failure and retained
  evidence. No nft flush operation exists.
- `scanner-runtime-adapter.sh` production cleanup invokes this fixed helper and
  therefore fails closed on `EUNSUPPORTED`; the compare/delete shim remains
  injectable only inside the existing explicit test boundary.

### Verification

- RED focused assertion was observed before implementation: the new production
  helper/vector contract failed because the helper did not yet exist.
- Native helper behavioral test passed under WSL: exact ownership deleted the
  chain; a mutated digest retained the chain and wrote ownership-mismatch
  evidence.
- Focused Task 5/package command: **49 passed, 1 unrelated host-mode failure**.
  The unrelated failure is the pinned catalog file permission check where the
  Windows-mounted checkout reports `0777` instead of `0644`.
- `node --check` passed for all changed JavaScript tests.
- WSL `sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` passed.
- `git diff --check` passed.

### Historical Production Limitation

The real OpenWrt target package build, live `/usr/sbin/nft`, nfqws2,
NFQUEUE, and physical-router E2E were not available in this Windows/WSL
checkout. The native helper compiled and ran behaviorally against a fixed nft
test binary, but that test-only sequence is not an atomic production primitive.
The feasibility recheck is the authoritative result and production mutation is
disabled fail-closed.

### Files Added/Changed

- `zapret2-manager/src/z2m-scanner-firewall-helper.c`
- `zapret2-manager/Makefile`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh`
- `tests/native/avatar-strategy-firewall-helper.test.mjs`
- `tests/native/avatar-strategy-scanner-runtime.test.mjs`
- `tests/native/avatar-strategy-package.test.mjs`
- `tests/native/core/native-helper-production-e2e.test.mjs`
- `tests/product/avatar-strategy-scanner-transient.test.mjs`
- `docs/superpowers/plans/2026-08-12-avatar-strategy-scanner-parity.md`

No callable Task 7 restore API, permanent config writer, Strategy mutation, raw
caller command/path/argv input, or nft flush was added.

## Fix Round 5

### Status

INCOMPLETE: production lifecycle remains blocked by the missing atomic firewall
ownership operation. Task 5 is not claimed complete. The runtime continues to
fail closed for production chain cleanup; the controlled compare-delete shim is
test-only. No `nft flush` or broad firewall reset was added.

### Fixes

- `profiles_transient_compile_preflight` now recomputes `dependencyDigest` from
  the canonical validated dependency closure and requires both candidate and
  compiler output to match it. Tests use the computed digest; a repeated
  arbitrary digest is rejected.
- Lock acquisition readiness is session/nonce/PID-bound. Failure paths reap only
  the newly started holder when all descriptor/readiness fields match, then remove
  only that holder's descriptor, PID, and readiness artifacts.
- `BASE`, `ROOT`, and session directories are checked for non-symlink directory
  type, ownership, and private mode on every adapter operation, including
  `session-cleanup`, before evidence writes.
- argv metadata is compared against one exact schema serialization, rejecting
  malformed, duplicate, or mismatched metadata instead of using field substring
  searches.
- Added a behavioral session-cleanup test that invokes the adapter and verifies
  recovery evidence persistence, tmpfs durability qualification, sidecar removal,
  `rmdir`, and release-before-cleanup ordering.
- Recovery evidence explicitly reports `durability=tmpfs_visible`; no durable
  claim is made without the native helper directory-fsync contract.

### Verification

Focused/native command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
```

Result: **35 passed, 0 failed**.

Static checks:

- WSL `sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh`: pass.
- `node --check tests/product/avatar-strategy-scanner-transient.test.mjs`: pass.
- `node --check tests/native/avatar-strategy-scanner-runtime.test.mjs`: pass.

### Remaining Concern

The native helper contract currently marks `rename_owned`, `unlink_owned`, and
retained lock operations unsupported. It provides no operation that coordinates
all cooperating firewall writers and atomically compares the owned nft chain
before deletion. Production cleanup therefore remains fail-closed and Task 5
production lifecycle evidence remains incomplete pending that native operation.

## Fix Round 4

### Status

PASS WITH DOCUMENTED HOST LIMITATIONS. Round-3 Critical/Important findings were
closed with fail-closed behavior and executable regression evidence. Task 7
terminal restoration remains an explicit later boundary and is not exported or
claimed by Task 5.

### Fixes

- Cleanup now removes and verifies `.argv`, `.argv.digest`, `.argv.meta`, PID,
  start-time, log, hostlist, chain digest, and ownership metadata. Normal session
  cleanup writes checked recovery evidence, removes runtime sidecars, and verifies
  `rmdir` success.
- Production compile preflight requires a complete dependency closure: available,
  structurally compilable, no missing entries, unique available items, exact
  dependency digest, exact compiled token stream, and verified native status.
  Unavailable or structurally incomplete dependencies fail before activation.
- Recovery ordering is centralized in `release_then_session_cleanup`: owned
  candidate operations happen under the session lock, then lock ownership is
  verified and released, then the adapter session directory cleanup is called.
  Failed release retains a locked-state recovery record instead of calling an
  adapter cleanup that rejects a held lock.
- Removed the callable `scanner_session_restore`/`EDEFERRED` API. The source,
  plan, and report retain only the documented Task 7 boundary marker.
- Firewall cleanup uses an ownership lock and a controlled compare-delete test
  transaction. Since production `nft` cannot provide atomic compare-delete for
  this chain, production fails closed and retains ownership evidence rather than
  deleting from a stale digest. Mutation tests prove the chain is retained.
- Lock acquisition creates the descriptor and readiness marker inside the flock
  holder before success is reported. Release holds an ownership lock across
  descriptor identity/start-time/nonce checks and signaling, rechecks the PID
  start-time after termination, and fails closed on PID reuse or tampering.
- Journal and cleanup evidence writes are private atomic writes with sync and
  read-back verification. Journal failure is fatal before resource creation and
  prevents best-effort rollback from hiding missing evidence.
- Launch validates the `.argv.meta` session, candidate, generation, nonce, and
  compiled digest binding. Runtime roots and session directories reject symlinks,
  use private modes, and staged files use secure temporary writes plus rename.
- Added executable adapter evidence for metadata tamper, 64-byte nonce length,
  concurrent ownership mutation, no-delete behavior, sidecar deletion, and
  focused recovery-order/dependency-closure tests.

### TDD And Verification

- Focused/native command:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/native/avatar-strategy-scanner-runtime.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs
  ```

  Result: **29 passed, 0 failed**.
- Static checks passed: WSL `sh -n` for the runtime adapter, `node --check`
  for both changed test files, and `git diff --check`.
- Task 5 aggregate including Apply/compiler/package:

  ```text
  wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs tests/native/avatar-strategy-package.test.mjs
  ```

  Result: **94 passed, 1 pre-existing host-mode failure**. The failure is the
  unchanged pinned catalog mode check (`advanced/discord_voice_zapret2_advanced.txt`:
  expected `0644`, Windows-mounted checkout reports `0777`).
- No DNS/TG-ws/router/LuCI/Orchestra files changed. No nft flush, raw caller
  command/exec/argv/path input, permanent config write, Strategy mutation, or
  Task 7 restoration claim was added.

### Concerns

- Real OpenWrt nftables, NFQUEUE, nfqws2, and production activation were not
  available on this Windows/WSL host. Production firewall cleanup intentionally
  fails closed until an approved atomic compare-delete primitive exists.
- Physical-router E2E remains intentionally unrun.

```text
ROUTER_E2E: NOT RUN
REASON: explicit physical-router mutation/deployment approval was not provided
```
