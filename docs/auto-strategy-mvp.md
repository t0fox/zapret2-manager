# Auto Strategy MVP

## Baseline

- Baseline commit: `89f46fb3db7b272d9fa6c1d3b54182d76e8dd7a5`.
- Gate baseline: 887 green, 39 known red; the exact IDs are versioned in
  `docs/test-baseline.json`.  Each milestone must have no additional red IDs.

## Reusable execution path

1. `orchestra_run_start()` validates a service manifest, snapshots the corpus,
   persists an id-scoped run in `/tmp/zapret2-manager/orchestra/`, and spawns
   `orchestra-worker.uc`.  Its active-lock contains both worker PID and
   `/proc/<pid>/stat` start time.
2. The worker calls the upstream candidate adapter
   (`orchestra-candidate-run.sh`) only after `orchestra-probe-preflight.sh`.
   Attempts are bounded by run deadline, per-attempt timeout, candidate corpus,
   and stop control.
3. `orchestra-evidence.uc` gives attempts machine-derived evidence IDs and
   requires two independent positive IDs before `winner_record()` can confirm a
   candidate.  Service runs already require every manifest target to have a
   confirmed winner.
4. Existing `orchestra_preview_best` / `orchestra_apply_best` route the winner
   to `profiles_apply_candidate()` in `profiles-apply.uc`; that path provides
   preview, snapshot, sanctioned write, service restart, runtime verification,
   and rollback.  `orchestra_restore_previous` is available for recovery.

## Current boundaries and missing automatic control

- The runner, ranking, confirmation, manual apply/restore controls and LuCI
  Orchestra page already exist, but all runs and applies are manual.
- Run artifacts and locks are temporary under `/tmp`; profile apply has its own
  persistent manager state/snapshots.  No persistent auto-mode state or
  last-good strategy record presently survives reboot.
- `watchdog.uc` is the existing lifecycle hook; it must host delayed health
  triggers instead of a new daemon.  Existing health and service-manifest
  probes distinguish missing WAN/DNS/probe tooling from target evidence.

## Target state machine and state

`disabled -> waiting-network -> healthy -> degraded -> scanning -> applying ->
verifying -> healthy`; infrastructure faults and no-winner outcomes enter
`cooldown`; unrecoverable apply/rollback faults enter `failed`.  The persistent
record is manager-owned, atomically renamed, regular-file checked, and stores
schema, revision, enabled flag, selected service IDs, phase, consecutive
strategy failures, active run identity, last-good candidate/profile/evidence,
timestamps, cooldown and bounded error detail.

Persistent paths will live beneath `/etc/zapret2-manager/`; temporary locks,
run records and logs remain beneath `/tmp/zapret2-manager/`.  The controller
will never treat a single curl as proof: a scan is permitted only after three
strategy-class health failures, and a winner needs required targets, two
positive evidence IDs, current run/generation evidence, and a better baseline.

## Atomic milestones

1. M0: baseline manifest and audit.
2. M1: persistent controller state.
3. M2: health checks, watchdog/manual triggers, lock and cooldown.
4. M3: bounded orchestration and deterministic winner/no-winner selection.
5. M4: sanctioned apply, verification, rollback and last-good commit.
6. M5: boot/recovery path.
7. M6: compatible RPC controls.
8. M7: minimal LuCI block.
9. M8: lifecycle regressions, package build, and router acceptance protocol.

## Router acceptance

On a router, back up APPLIED hashes, install signed APKs, reload rpcd once and
re-login.  Enable Auto mode for packaged service manifests; verify the
healthy-last-good fast path; induce three strategy failures; verify exactly one
bounded scan, confirmed winner, nfqws2/NFQUEUE runtime and LAN target evidence;
reboot and verify last-good restore without a scan; then test cooldown, Stop,
and Restore last-good.  All router actions remain **[VERIFY:ROUTER]** until
explicitly authorized.
