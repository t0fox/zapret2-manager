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
2. M1: persistent controller state. **Implemented:** `auto-strategy.uc` owns
   schema-1 normalization, bounded service IDs, optimistic revision, atomic
   rename, and regular-file/symlink protections.  It is packaged but has no
   autonomous trigger yet.
3. M2: health checks, watchdog/manual triggers, lock and cooldown.
   **Implemented:** the procd-owned watchdog invokes the controller after its
   normal runtime checks.  The controller applies boot delay, 30-second health
   interval, WAN/DNS/nfqws2/NFQUEUE infrastructure classification, exponential
   backoff, 15-minute scan cooldown, and exactly-three strategy failures before
   requesting a scan.  It starts only the existing bounded health-matrix job.
4. M3: bounded orchestration and deterministic winner/no-winner selection.
   **Implemented:** a scan request delegates to one existing registry-backed
   service run with two attempts, 20-second probes and a 10-minute deadline.
   Existing orchestra ranking, evidence IDs, confirmation and cancellation stay
   authoritative.  A non-ready/infrastructure/terminal run preserves APPLIED
   and enters cooldown; only a ready evidenced run becomes a pending apply.
5. M4: sanctioned apply, verification, rollback and last-good commit.
   **Implemented:** Auto accepts only the immutable current service-run with a
   valid registry digest, every required target winner, and two positive
   evidence IDs per winner.  It calls `orchestra_preview_best()` then the
   existing `orchestra_apply_best()` service transaction, whose writer already
   snapshots, native-validates, restarts, verifies runtime/NFQUEUE ownership,
   probes required targets and rolls back on failure.  Auto repeats typed
   target verification before atomically writing
   `/etc/zapret2-manager/auto-strategy-last-good.json`.  Last-good contains
   bounded IDs/hashes/evidence and is committed only when the sanctioned
   runtime verification is `ok`; missing runtime proof requests rollback and
   enters cooldown.  PID start-time provenance remains **[VERIFY:ROUTER]**.
6. M5: boot/recovery path. **Implemented:** the existing procd watchdog loads
   the persistent controller and validates the bounded, root-owned,
   non-symlink last-good record before taking any automatic action.  It waits
   for the M2 boot delay and infrastructure gates, then starts a health check
   against the current APPLIED configuration; it never starts a scan directly
   from boot.  Matching current/last-good records remain untouched.  A healthy
   divergent APPLIED configuration is recorded as divergence and is likewise
   untouched; an unhealthy divergence follows the existing three-failure
   hysteresis.  Missing current state is failed closed and requires a manual
   sanctioned apply rather than a direct upstream write.

   Interrupted scans are rejected unless their existing Orchestra worker still
   proves matching PID/start-time identity; stale work enters cooldown without
   accepting a winner.  Interrupted apply/verification invokes the existing
   snapshot rollback path and blocks further scans until recovery records a
   result.  Boot state persists bounded infrastructure, applied/last-good,
   divergence, interrupted-operation and recovery fields atomically.  Live
   process identity, recovery markers, NFQUEUE ownership and rollback outcome
   remain **[VERIFY:ROUTER]**.
7. M6: compatible RPC controls. **Implemented:** the existing
   `zapret2-manager` rpcd object now exposes `orchestra_auto_status`,
   `orchestra_auto_enable`, `orchestra_auto_disable`,
   `orchestra_auto_run`, `orchestra_auto_stop`, and
   `orchestra_auto_restore`.  Complex write requests use the project's
   existing `{ edit: "<JSON>" }` transport and contain a bounded
   `expectedRevision`, `requestId`, and (where required) `serviceIds`.
   Status is read-only, bounded, redacted, and derives server-side operation
   capabilities.  Its ACL is read-only; the five mutations are write-only.

   Mutations use optimistic revision checks plus a bounded 16-entry persisted
   request ring.  A matching requestId is replayed without repeating its side
   effect, while reuse with a different payload is rejected.  Run now starts
   only the existing bounded Orchestra worker; stop requests its existing
   id-scoped cancellation.  Restore accepts only a fully verified last-good
   record and reuses Orchestra preview/apply, snapshot, runtime verification,
   target confirmation and rollback; it never writes upstream configuration
   directly.  Existing service apply is transactional and synchronous, so the
   response marks that fact rather than pretending a background job exists.
   rpcd request shape, live ACL enforcement, PID/NFQUEUE proof and rollback
   evidence remain **[VERIFY:ROUTER]**.
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
