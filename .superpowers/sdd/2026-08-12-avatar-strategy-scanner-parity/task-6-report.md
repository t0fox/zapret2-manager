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
