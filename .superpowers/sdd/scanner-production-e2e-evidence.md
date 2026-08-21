# Production Scanner evidence — 2026-08-21

## Scope and authority

The production path remains:

`scanner RPC -> scanner-cli-entry -> scanner-cli -> scanner-worker -> scanner-planner`.

`scanner-orchestrator.uc` was not wired or used. Strategy remains the persistent writer; Scanner uses transient ownership only.

## Bootstrap root cause and repair

The failing target invariant was the bootstrap state-root policy:

| Field | Expected | Actual before repair |
|---|---|---|
| `/etc/zapret2-manager/state` uid | `0` | `0` |
| gid | `0` | `1` |
| mode | `0700` | `0750` |

The exact production error was:

`z2m-root-bootstrap: policy verification failed for /etc/zapret2-manager/state: Operation not permitted`

This was stale/incompatible root metadata. The bootstrap code correctly fails closed and does not repair an unsafe existing root. No null generation, hardcoded generation, or verification bypass was introduced.

The root metadata was repaired in place with inode/content preserved. Bootstrap then passed and the canonical status writer produced:

`generation: 0`, `revision: 23`, selected identity `z2k_all_in_one`, production runtime present, verification gate accepted.

Final router `status_fast` evidence: `generation=0`, `serviceState=running`, one production `nfqws2`, runtime contract true.

## Quick planner timing

The old path parsed/materialized the full approximately 12.5 MB catalog before filtering. The production path now opens the canonical compact strategy index, selects bounded descriptors, and materializes only selected candidates with authority fields preserved.

| Run | planning | candidate lookup | compile |
|---|---:|---:|---:|
| before | 27,782 ms | 11,707 ms | 14,974 ms |
| compact index | 16,094 ms | 124 ms | 14,862 ms |
| current live runtime environment | 10,590 ms | 127 ms | 9,274 ms |
| router E2E-29 | 10,757 ms | 125 ms | 9,504 ms |

E2E-29 also recorded `candidatesCompiled=25`, `candidatesEligible=30`, `candidatesShortlisted=20`, `compileAttempts=30`, and monotonic `stateWriteMs=558`.

## Scanner lifecycle evidence

Successful native lifecycle observations from router E2E runs include:

- production RPC accepted Scanner start;
- `PREPARED -> TABLE_CREATED -> RULES_READY -> PROCESS_BOUND -> ACTIVE` journal transitions;
- temporary queue `301` with Scanner-owned `nfqws2` and helper;
- real probe execution for each activated candidate;
- `CLEANING -> CLEANED` journal transitions;
- owned table/process/queue removal and session-directory removal;
- config/runtime restoration verified;
- production queue `300` and production `nfqws2` preserved.

E2E-25 completed through the RPC launcher with structured `EOWNERSHIP` activation failure and verified session cleanup. E2E-29 completed seven real candidate cycles and retained verified `CLEANED` evidence before the state-publication failure described below. E2E-32 reached the same seven-cycle boundary after the latest worker compile fix.

No-success target behavior was observed as `best=null`; the router baseline reports TCP refusal for `example.com`, so no successful candidate is claimed from this target. The result contract preserves infrastructure evidence rather than fabricating success.

## Remaining blocker — durable volatile state publication

On E2E-29 and E2E-32, after the seventh candidate result, `scanner_state_save` returned:

`EIO: Scanner record could not be atomically published`

The resulting worker record remained at `status=running`, `progress=7`, while the worker exited. E2E-29 captured the exact secondary implementation defect in `checkpoint()`:

`Type error: left-hand side is not a function`

caused by `let failure = null; failure();` after publication failure. The production worker now records the original structured checkpoint error in `lifecycle.checkpointFailure` before entering existing fail-closed recovery; the target worker compiles after redeploy. The native helper accepts a standalone atomic revision write (`committed=true`), so the repeated EIO is not a root-policy failure and still requires isolation of the concurrent publication condition.

This is intentionally not marked complete: no timeout was increased, no retry loop was added, and no stale `running` record was presented as a successful terminal result.

## Failure and cleanup contract

Observed structured classes include `EINPUT`, `EDEPENDENCY`, `EPREFLIGHT`, `ETAMPERED`, `EJOURNAL`, `EOWNERSHIP`, `EIO`, and `ESTALE`. No observed Scanner failure returned UBUS `Unknown error`. Cleanup evidence includes ownership, process, NFQUEUE, firewall, hostlist, temporary-file, lock-release, restore, and session-directory fields.

Final router audit after the runs:

- `/proc/net/netfilter/nfnetlink_queue`: only queue `300`;
- nftables: only production `inet fw4` and `inet zapret2` tables;
- only production `nfqws2` and `z2m-helperd` processes;
- no active Scanner worker, session directory, request temp, or temporary NFQUEUE ownership;
- DNS `example.com`: PASS;
- HTTPS `example.com`: `http_code=200`.

Retained `*.recovery.evidence` files are diagnostic evidence, not active ownership. Existing unrelated diagnostic ownership-lock artifacts were not removed.

## RPC responsiveness

During planning, parallel RPC probes returned structured responses. Measured samples were:

- `status_fast`: 257–1,227 ms;
- `events_tail`: 173–1,256 ms.

The Scanner worker is detached from the serial rpcd request process group using `setsid`; the source contract test passes.

## Tests

Passing in the Windows workspace without target ucode:

- `scanner-planner-runtime-contract.test.mjs`: 4/4;
- `scanner-start-order.test.mjs`: 2/2;
- final combined selected static run: 6/6.

Tests that execute `/opt/ucode/bin/ucode` cannot run in this Windows environment because that target binary is absent. Router ucode compile smoke for the deployed worker passes. Full native target testing remains outside the local Windows environment boundary.

## Completion decision

Not complete yet. Bootstrap identity, compact Quick planning, real transient NFQUEUE/probe/cleanup lifecycle, fail-closed behavior, and final production ownership preservation are evidenced. The remaining required work is to eliminate or durably reconcile the repeated `atomic_write_json_revision` EIO at the seventh candidate so every RPC-started Scanner reaches a durable terminal record.
