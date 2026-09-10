# Watchdog Engine Gate — bounded production fix

Date: 2026-09-10  
Scope: false-critical watchdog and status behavior when the optional Zapret2 Engine is absent.

## Objective

Make the canonical no-Engine state explicit and non-critical across the watchdog,
fast status, full status collector, Dashboard and Monitoring. General manager
health checks must remain active. Installed-and-failing Engine behavior must keep
its recovery and event semantics.

## Root cause

`watchdog.uc` treated process, nftables and NFQUEUE absence as Engine failures
without first checking the canonical runtime contract. On a clean router this
also attempted `/etc/init.d/zapret2 start`, then persisted `process_gone`,
`rules_gone` and `queue_not_registered` critical events. `status-fast.uc`, the
full collector and the Monitoring model independently interpreted the same
missing runtime as an outage.

## Implementation

- `watchdog.uc` imports `engine-gate.uc`, gates only Engine-specific checks,
  returns `{ skipped: true, reason: "engine_missing" }`, never starts the
  optional Engine in that state, and continues RAM/overlay/log-rotation checks.
- Stale Engine-specific transient watchdog state is reset on confirmed absence;
  historical events are retained.
- `status-fast.uc` and `core/status-collector.uc` expose the canonical gate
  state and distinguish confirmed absence from an unreadable gate.
- `z2m-monitor-model.js` derives Engine/Firewall as `OFF` with an explicit
  not-installed reason instead of `ERROR`.
- No changes were made to `z2m-avatar-log.js`.

## TDD and verification

Tests were added first and observed RED before the production change:

- watchdog canonical gate/order tests failed before the gate existed;
- Monitoring missing-Engine test failed because Firewall was still derived as
  an error.

Focused GREEN run after implementation:

```text
54 tests, 50 pass, 0 fail, 4 skipped
```

The four skips are optional UCode runtime scenarios; the local machine has no
`/opt/ucode/bin/ucode`. Static tests and all available Node.js tests passed.
`git diff --check` passed.

## Router and browser evidence

The clean router had no Engine runtime contract. Direct source acceptance and
the package-installed acceptance both showed:

- `status_fast.serviceState = engine_missing`;
- `engine.installed = false`, `runtimeContract = false`;
- watchdog check `{ skipped: true, reason: "engine_missing" }`;
- watchdog process alive;
- watchdog state has no Engine alerts and NFQUEUE state is `unknown` with zero
  consecutive critical turns;
- event count stayed at 42 through more than two watchdog cycles; old false
  events remain intentionally as history;
- no new manager/rpcd/procd/nfqws2 runtime errors in `logread`.

Monitoring after browser hard reload shows `OFF` for `zapret2 engine`, `nfqws2`
and `Firewall / NFQUEUE 300`, each with `Движок zapret2 не установлен.`.
Dashboard shows `Zapret2 Engine Не установлен` and `Z2K Core Не установлен`.
Browser console error collection was empty.

The CI artifact `zapret2-manager-full-0.1.0-r163.apk` was built from
`9c34bc4847644ae6d8f6ebc49c1c969e1b5f9e48`, verified by CI and installed on the
router with matching SHA-256:

```text
ec0f11e9c81c9db1754a35e1750ef43a4af9593e5a7573e374f693ee16bde233
```

## Explicit boundary

An installed-Engine process/nftables failure was not injected on the clean
router because that would require installing an optional Engine without an
explicit request. The preservation path is covered by the UCode scenario tests
when a UCode runtime is available.

## Delivery

Runtime/product changes: commit `9c34bc4847644ae6d8f6ebc49c1c969e1b5f9e48`,
pushed directly to `origin/main`.
