# Task 6 Report: Scanner Worker, Volatile State, Control, and Resume

## Status

COMPLETE WITH DOCUMENTED HOST LIMITATIONS

Task 6 adds the bounded Scanner worker lifecycle, volatile checkpoint/control
records, cancellation admission, heartbeat/stale-worker handling, safe resume
identity checks, and fixed CLI dispatch. Task 5 production firewall cleanup
remains fail-closed at `bcfb1f5`; this task does not bypass or claim activation.

## Files Changed

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`
- `tests/product/avatar-strategy-scanner-integration.test.mjs`

No M5 `manager-state.json` fields or permanent Strategy/config writes were
added. No DNS, TG, router, LuCI, frontend, RPC, or Orchestra files changed.

## Implementation

- Volatile records are stored under `/tmp/zapret2-manager/scanner` with private
  id-scoped record/control files and an active marker.
- Record publication uses private temp files plus atomic rename, bounded results
  and events, and revision CAS. Digests bind request, catalog, compiler, and
  candidate plan identity.
- Active worker ownership is bound to PID and procfs start-time. A live marker
  blocks a second scan; a dead or reused marker is stale and may be reclaimed.
- Worker phases persist heartbeat/current candidate/cursor progress and run
  candidates sequentially. It validates the request, consumes the server-owned
  plan, opens the Task 5 transient session, runs one baseline, activates and
  probes candidates, cleans each candidate, and terminates through verified
  Task 5 session cleanup plus explicit Task 7 reconciliation evidence.
- Stop control is revision-admitted and idempotent at the file boundary. The
  worker checks it before and after each bounded candidate probe and publishes
  verified `cancelled` only after cleanup evidence is verified.
- Resume requires running state, exact request/catalog/compiler/plan digests,
  matching worker PID/start-time, and a heartbeat no older than 120 seconds.
  Cursor progress prevents already completed candidates from being repeated.
- CLI accepts only fixed names: `start`, `status`, `results`, `stop`, `resume`,
  and `save-generated`. Requests are read from bounded private files. Raw
  commands, executable paths, argv, user arguments, and generated Strategy
  persistence are not accepted; `save-generated` fails closed by design.

## TDD And Verification

RED was run before the Task 6 modules existed:

```text
node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
```

## Fix Round 4

### Status

PASS WITH DOCUMENTED HOST LIMITATIONS. The four Important review findings are
addressed at the Task 6 executor/worker boundary. Task 5 remains fail-closed at
`EUNSUPPORTED`, Task 7 remains the terminal reconciliation owner, and no
Strategy/config/DNS/TG/router/LuCI/Orchestra behavior was changed.

### Fixes

- The executor now accepts only the adapter authority token and fixed descriptor
  schema. Canonical server-owned host identity, URL host/path, address family,
  TLS/body settings, Range, marker settings, read caps, timeout, retry, and
  deadline values are validated before execution. Caller commands, executables,
  raw args, paths, and arbitrary URLs are rejected.
- TCP baseline and body probes execute IPv4 and IPv6 independently from the
  server-owned descriptor. Skipped/unavailable families remain typed. Worker
  candidate probes use the baseline-selected available families instead of
  hardcoding IPv4.
- Every operation is wrapped by fixed `timeout` ownership with TERM/KILL grace,
  a per-operation timeout, an outer absolute deadline, and a fixed stdout cap
  before the blocking read. Body probes use one pinned retry; STUN sends a real
  STUN Binding request, retries twice within four seconds, validates Binding
  Success/cookie/transaction/XOR-MAPPED-ADDRESS, and returns typed timeout or
  infrastructure observations.
- HTTP parsing now handles interim responses, Content-Length, chunked framing,
  EOF, truncation, nominal 64KiB/body exceptions for 204/205/304, Range
  evidence, marker evidence, and measured throughput. Marker, failed Range,
  incomplete, and parser/transport uncertainty cannot become success in
  `scanner_tcp_classify`.

### TDD And Verification

Added production-shaped behavioral coverage for canonical URL/path and settings,
IPv6/family selection, HTTP interim/chunked/truncated bodies, marker and
throughput evidence, STUN response transaction/type parsing, fixed retries, and
executor authority/deadline rejection.

Focused verification under pinned WSL ucode:

```text
wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/c/Users/Kirill/zapret2-manager && UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs'
```

Result: **55 passed, 0 failed**.

`git diff --check` passed. The broader scanner integration attempt retained
three failures in unchanged `scanner-targets.uc:136` under this WSL ucode build;
the changed worker/probe tests passed. The canonical native gate could not link
its helper because the pre-existing WSL `TMPDIR` target was not writable.

### Concerns

- Real OpenWrt ncat/TLS/IPv6/STUN behavior and nfqws2/NFQUEUE/nftables activation
  were not run on this Windows/WSL host. Router E2E remains intentionally not
  run; Task 5 production cleanup is not bypassed.
- The fixed executor uses packaged `/usr/bin/ncat`, `/usr/bin/timeout`, and
  `/usr/bin/head`; package/runtime availability is still a deployment concern.
- Existing `scanner-targets.uc` WSL null-indexing failures remain outside this
  round and were not modified.

```text
ROUTER_E2E: NOT RUN
REASON: physical-router activation was not approved and Task 5 remains fail-closed
```

Expected missing-module failures were observed.

Focused GREEN and adjacent Task 5 verification:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs
```

Result: **29 passed, 0 failed**.

Static checks:

- `node --check tests/product/avatar-strategy-scanner-worker.test.mjs`: pass.
- `node --check tests/product/avatar-strategy-scanner-integration.test.mjs`: pass.
- `wsl.exe ... sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh`: pass.
- `git diff --check`: pass.

The Task 6 integration command was also attempted:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
```

Task 6 tests passed. The three target-profile tests failed in unchanged
`scanner-targets.uc:136` with the known WSL ucode null-indexing error inherited
from Tasks 2/3.

## Concerns

- Real OpenWrt nfqws2/NFQUEUE/nftables activation was not run on this Windows/
  WSL host. Task 5 production firewall compare-delete remains fail-closed and
  is not bypassed or claimed by Task 6.
- Task 7 owns whole-runtime terminal reconciliation. Task 6 only consumes
  explicit verified reconciliation evidence and never restores Strategy/config.
- The existing scanner target/model WSL ucode null-indexing failures remain
  outside this task.

```text
ROUTER_E2E: NOT RUN
REASON: production router activation and Task 5 compare-delete remain intentionally fail-closed
```

## Latest Review Fix

- Terminal checkpoint publication failure now releases the claim from the captured identity even when no checkpoint record was published, persists bounded recovery evidence when possible, and permits a subsequent same-id claim.
- Baseline TCP and IPv6 descriptors carry the owned cancellation token into the native fixed-process executor.
- UDP candidate verdict persistence retains attempts, mapped family, bytes, exit/signal, timestamps, latency, throughput, and marker evidence.
- Baseline classification tests pass literal incomplete evidence directly and reject missing bytes, exit/signal, or timestamps as infrastructure dependency evidence.
- Protocol-v1 manifest now declares nested body and marker properties, alongside the closed TLS/IPv6/STUN/cancellation shapes enforced by the native validator.
- Task 5 remains fail-closed at `EUNSUPPORTED`; Task 7 remains the terminal reconciliation owner. No permanent config/Strategy/raw command/DNS/TG/router/LuCI/Orchestra behavior was added.

Focused/static/native verification for this review fix:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/native/core/fs-helper-protocol.test.mjs tests/native/core/scanner-probe-native.test.mjs tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs
Result: 88 passed, 0 failed.

wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs tests/native/avatar-strategy-firewall-helper.test.mjs
Result: 38 passed, 0 failed.

node --check tests/product/avatar-strategy-scanner-worker.test.mjs
node --check tests/product/avatar-strategy-scanner-probes.test.mjs
node --check tests/native/core/fs-helper-protocol.test.mjs
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- bash -lc 'sh -n zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh && python3 -m json.tool zapret2-manager/src/z2m-core-helper/protocol-v1.json >/dev/null'
git diff --check
Result: all passed.
```

## Fix Round 1

### Status

PASS WITH DOCUMENTED HOST LIMITATIONS. Critical/Important review findings for
CLI dispatch, production probe authority, worker cleanup/error handling, resume
identity, control idempotency, active ownership, and volatile file boundaries
are addressed. Task 5 production firewall activation remains fail-closed at
`EUNSUPPORTED`; Task 7 reconciliation remains authoritative.

### Fixes

- Fixed CLI `start` dispatch to pass the validated request rather than the
  undefined `checked.value`; imported CLI modules no longer include a shebang
  that breaks ucode module parsing, and responses carry `schemaVersion: 1`.
- Production ignores all injected seams, builds the server-owned plan, invokes
  fixed TCP/TLS-body or UDP/STUN adapters, and records missing observations as
  infrastructure evidence instead of synthetic success.
- Worker lifecycle exceptions publish `error/recovery=uncertain`, preserve
  cleanup evidence, and attempt active-marker release. Activation and cleanup
  uncertainty stops candidate progression.
- Resume rebuilds the plan from server authority, recomputes request/plan
  digests, validates cursor bounds/result identity/no duplicates, checks bounded
  probe deadlines and heartbeat updates, and does not trust caller plan/digest
  strings.
- State/control publication uses the native helper runtime root and digest CAS
  in production; stop is idempotent; active claims reject live PID/starttime
  ownership, require matching continuation identity, and reclaim stale markers
  only through verified ownership evidence.
- CLI request files are restricted to root-owned private records in the fixed
  runtime request directory; volatile roots reject symlinks and insecure modes.

### TDD And Verification

The fix-round behavioral tests cover CLI start, adapter invocation/no fake
success, activation cleanup uncertainty, lifecycle exceptions, resume authority
and checkpoint integrity, same-id active claims, stop CAS/idempotency, and
schema/private request boundaries.

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs tests/native/avatar-strategy-firewall-helper.test.mjs
```

Result: **53 passed, 0 failed**.

The broader worker/transient/integration run had **3 inherited WSL ucode
failures** in unchanged `scanner-targets.uc:136` null indexing; all 40 changed
Task 6/Task 5 tests passed. `node --check` and `git diff --check` passed.

```text
ROUTER_E2E: NOT RUN
REASON: explicit physical-router mutation/deployment approval was not provided

## Fix Round 2

### Status

IMPLEMENTED WITH HOST LIMITATIONS. Round-2 review findings are addressed with
behavioral recovery, retained plan authority, fixed production probe execution,
and native revision-CAS publication. Task 5 production firewall activation
remains fail-closed at `EUNSUPPORTED`; Task 7 restore/reconciliation remains
outside this task.

### Fixes

- Worker exceptions now use one centralized recovery path. It retains candidate
  cleanup, session cleanup, lock release, and active-marker release evidence,
  releases the active marker, and records uncertain recovery after activation
  or checkpoint failures. Terminal cleanup failures retain the full evidence.
- Added `scanner_probe_executor.uc`: production consumes adapter descriptors
  through fixed `/usr/bin/curl` and `/usr/bin/ncat` bounded operations. No caller
  executable, command, raw arguments, or descriptor discard path exists;
  executor failures return typed dependency/infrastructure evidence.
- The worker builds plan authority once, stores an immutable `planAuthority`
  with digest and candidate list, resumes only from that retained plan, and
  validates ordinal, candidate ID, plan digest, verdict, evidence identity,
  score, cursor, and result relation.
- Added native `atomic_write_json_revision`, whose root lock covers revision
  precondition and atomic publish. Production scanner record saves, control
  updates, active claims, and active release use the revision-CAS operation;
  separate digest/load/write calls no longer claim atomicity.
- Terminal stop retries are idempotent and return existing terminal control and
  result. All CLI dispatch and request-file errors include `schemaVersion: 1`.
- Fixed runtime request/root validation remains private, fixed-root, ancestor
  no-symlink validation. No permanent Strategy/config writes, Task 7 restore,
  DNS/TG/router/LuCI/Orchestra behavior, or Task 5 `EUNSUPPORTED` bypass was
  added.

### TDD And Verification

Added behavioral coverage for exception-after-activation recovery, checkpoint
failure cleanup, fixed executor production-path behavior, retained-plan resume,
terminal stop retry, revision-CAS helper operation, result identity, and schema
versioning.

Focused verification:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/core/native-helper.test.mjs tests/native/core/atomic-write-json.test.mjs
```

Result: **76 passed, 0 failed**.

`git diff --check` passed. The helper test binary was built through the
repository `build-fs-helper.sh` path with `-Wall -Wextra -Werror`.

Broader scanner/runtime verification passed for Task 5 runtime/firewall and
the changed worker/native suites. The broader scanner integration command still
has the inherited WSL ucode null-indexing failures in `scanner-targets.uc:136`;
those failures are unchanged target-profile host limitations and are not caused
by this round's files.

```text
ROUTER_E2E: NOT RUN
REASON: Windows/WSL host has no production nfqws2/NFQUEUE/nftables runtime; physical-router mutation was not approved
```

## Final Review Fix Round (Task 6)

### Status

PASS. All three final review findings addressed:

- (1) scanner-probe-executor STUN now pins exactly two attempts on timeout/refusal/transport failure (unless deadline hard-stop); records exact attempts; preserves typed unavailable/timeout/error after both attempts; never returns first-attempt terminal prematurely. Regression test added.
- (2) Recovery publication metadata (durable/retryRequired/state/evidence) assigned before persist in recover(); on failure, claim released and durable fallback/uncertain record written. Persisted-record-after-failure test path covered.
- (3) Baseline native bytesReceived/exitCode/signal/timestamps preserved through normalization; assertion added.

No Task 5 bypass; Task 7 remains nonterminal reconciliation owner. No permanent Strategy/config/DNS/TG/router/LuCI/Orchestra behavior added.

### Verification

```text
node --check tests/native/core/scanner-probe-native.test.mjs
node --check tests/product/avatar-strategy-scanner-worker.test.mjs
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/native/core/scanner-probe-native.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs
git diff --check
```

All checks passed.

### Concerns

None beyond documented host limitations (WSL ucode null-indexing in scanner-targets, no physical router).

```text
COMMIT: non-amended, new commit after verification
```
```
