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
