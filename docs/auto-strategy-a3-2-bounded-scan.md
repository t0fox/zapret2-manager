# A3.2 — bounded scan and sanctioned cancellation

## Result

The scan admission path now creates an immutable deadline contract and hard
service bounds (`maxCandidates <= 8`, `maxAttempts <= 48`).  The worker checks
the monotonic deadline before candidates and attempts, caps each probe timeout
to the remaining run time, and uses one idempotent finalizer for stop, timeout,
and infrastructure terminal paths.  Child termination is controller-owned and
validates PID/starttime before TERM, then bounded KILL.

## Root causes fixed

* The old 600-second value was only carried as a wall-clock/UI value.  The
  worker had no serialized immutable `deadlineMonoSec`, did not cap an active
  probe to remaining time, and waited for child completion without a bounded
  deadline finalizer.
* Orchestra Stop was registered in the rpcd signature without an `edit`
  argument.  A canonical request containing `runId` was rejected by ubus as
  `Invalid argument` before the backend, which surfaced as the old
  `invalid-run-response` path.
* Auto reconciliation dereferenced `lastGood.record` when no last-good
  existed.  That null access masked the shared cancellation envelope as
  `EINTERNAL`; the optional record is now checked before reading fields.

Both Orchestra and Auto Strategy call the same `orchestra_run_stop()` contract
with `runId`, `generation`, `expectedRevision`, and `requestId`.  Responses are
explicitly `stopping`, `stopped`, `already-finished`, `stale-run`, `conflict`,
or a bounded error.

## Target evidence (router, no reboot)

* Old run `or-6a6f92af-c683` was reconciled by the controller after r127/r130:
  active run cleared, stale worker lock classified, no manual deletion or
  kill, and applied hash remained
  `75fa2ee28b278b9814d11b8dd22b8957c90e20bcf53bedf0cbce0a442c52f97f`.
* Stop acceptance `or-6a6f9c2a-49e2`: 2 trusted candidates, 6 planned
  attempts.  One canonical stop request returned `status: stopping`; the
  final status was `stopped`, `completedCount: 2/6`, `candidatePid: null`,
  cleanup `completed`, and the active lock was absent.  No later attempts were
  started.
* Timeout acceptance `or-6a6f9c56-c49e`: configured total timeout 20 s;
  terminal `timed-out` was observed after the bounded cleanup grace, with
  `candidatePid: null`, cleanup completed, and no active lock.
* Complete bounded scan `or-6a6f9c84-dc34`: 2 candidates / 6 planned
  attempts.  It terminated in `infrastructure-error` (`EPROBEDEPENDENCY`,
  probe marker rc 65) after 2 completed attempts.  This is an honest
  `NO_WINNER`; no ranking winner or apply was forced.
* Before and after these runs, nfqws2 PIDs remained `2116` and `17025`,
  NFQUEUE 300 ownership remained with the existing nfqws2 instance, uhttpd was
  not restarted, and the applied configuration hash was unchanged.  No reboot,
  manual kill, firewall restart, or uhttpd restart was performed.

## Verification

Focused A3.2/controller tests: **14/14 green**.  Full repository gate via
`tools/run-all-tests.sh`: **1087 green, 0 red, 0 skipped** (72 backend files,
4 UI files, 8 strategy files, 10 shell gates).

Signed target packages are release **r130**, architecture
`aarch64_cortex-a53`; the three APK SHA-256 values are recorded in
`artifacts/auto-strategy-a3-2-manifest.json`.

Verdict: **PARTIAL** — bounded deadline, sanctioned Stop, timeout cleanup, and
complete bounded termination pass; no trusted winner was available, so Apply
and last-good creation were correctly not attempted.
