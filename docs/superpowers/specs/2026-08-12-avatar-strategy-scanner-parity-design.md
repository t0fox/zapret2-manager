# Avatar-Compatible Strategy Scanner Parity Design

**Date:** 2026-08-12
**Status:** approved design; implementation is intentionally gated on written-spec review
**Scope:** the next zapret2-manager product slice after the native Strategy backend

## 1. Purpose and product invariant

This slice makes the following flow canonical:

```text
Strategy Catalog
    ↓
Scanner candidate planning
    ↓
temporary verified candidate execution
    ↓
baseline + network probes
    ↓
working / failed evidence
    ↓
ranking / best Strategy
    ↓
existing Strategy Preview / Validate / Apply
```

Scanner is a separate product domain from Orchestra. It is not an Orchestra
rewrite, a second Apply engine, or a second Strategy model/catalog. The existing
Strategy model, catalog, compiler, state, Preview, Validate, transactional Apply,
active Strategy identity, drift/status, RPC/ACL, LuCI flow, profile compiler,
native preflight, transaction machinery, runtime verification, and helper/lock
substrate remain authoritative.

Scanner owns planning, transient execution, probes, evidence, ranking, and the
handoff reference. The existing Strategy pipeline remains the only permanent
mutation path.

## 2. Source evidence and parity baseline

### 2.1 Manager source of truth

The canonical manager source is `main` at:

```text
681fb45bc87b0dad590e86b86b1459eb45438c08
```

Relevant existing boundaries inspected include:

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc`
- `strategy-catalog.uc`
- `strategy-compiler.uc`
- `strategy-state.uc`
- `strategy-status.uc`
- `profiles.uc`, `profiles-draft.uc`, `profiles-apply.uc`
- `native-preflight.uc`
- `core/native-helper.uc`, `core/state-store.uc`
- `jobs.uc` and the Orchestra worker/control/evidence modules
- canonical `zapret2-manager` rpcd ucode, ACL, and Strategy LuCI modules
- `scripts/test/native.sh` and `scripts/test/native-root.sh`

The current native gate is Linux-only and `scripts/test/native.sh` already
invokes the root-required subset through `scripts/test/native-root.sh`; the root
suite must not be run a second time when that gate is used.

### 2.2 Avatar pinned source chain

The behavioral baseline is:

```text
avatarDD/zapret-gui
f9dd3ea47a2239514f396a843b475c92c33f0b4c
```

The audit followed the required order:

1. `AGENTS.md`;
2. `.claude/skills/nfqws2-strategies/SKILL.md`, read in full;
3. `CoderManual.md`;
4. `docs/upstream.json`;
5. relevant `core/` implementation and imports;
6. API implementation;
7. frontend implementation;
8. scanner-related tests;
9. upstream zapret2 material referenced by the skill where exact nfqws2
   semantics were needed.

The pinned upstream record identifies bol-van/zapret2 `v1.0.4`, verified
2026-08-03. The pinned scanner evidence came primarily from:

- `core/strategy_scanner.py`
- `core/scan_targets.py`
- `core/strategy_generator.py`
- `core/catalog_loader.py`
- `core/strategy_builder.py`
- `core/nfqws_manager.py`
- `core/firewall.py`
- `core/models.py`
- `core/config_manager.py`
- `core/testers/tls_tester.py`
- `core/testers/body_tester.py`
- `core/testers/stun_tester.py`
- `api/scan.py`
- `web/js/pages/scan.js`
- `web/js/pages/strategy_scan_hub.js`
- scanner, generator, target, firewall, nfqws, and tester tests.

### 2.3 Pinned lifecycle and API facts

The pinned public request is:

```json
{
  "target": "youtube.com",
  "protocol": "tcp|udp",
  "mode": "quick|standard|full",
  "resume": true,
  "dpi_type": "optional"
}
```

Pinned lifecycle facts:

- states are idle, running, completed, cancelled, and error;
- a declared paused state is not entered and there is no pause API;
- concurrent start is rejected;
- stop sets cancellation and the current probe may finish before the next
  candidate is skipped;
- resume is an index-based continuation from a separate resume JSON record;
- status exposes progress, total, phase, current strategy, counts, success
  rate, elapsed time, and baseline-by-address-family information;
- results expose working results and a report after terminal/cancelled/error
  retrieval;
- the pinned generated endpoint is read-only and returns generated candidates;
- pinned apply addresses successful results by array index and reconstructs a
  catalog entry.

The native contract deliberately improves the safety of request binding,
resume validation, bounded transport, restoration proof, and generated-result
handoff without changing the successful Scanner product semantics.

## 3. Post-pin Avatar deltas

Avatar `main` was inspected after the pinned audit at:

```text
5d61cf209d427133d945762f20c120cabefb938b
```

The relevant post-pin changes are recorded separately from the pinned contract:

### 3.1 External nfqws2 adoption

Commit `6dd6d52` adds external/autostart nfqws2 detection, PID recovery,
probe-process exclusion, throttling, and restoration fallback to configured
active Strategy arguments. This is useful adjacent behavior, but manager process
identity, runtime ownership, and reconciliation remain defined by the native
manager contract. It is not a reason to make Avatar’s process manager
authoritative.

### 3.2 Catalog-update removal

Commit `15a5149` removes Avatar catalog-update API/UI code and extracts catalog
merge logic. This is unrelated to Scanner execution and is not ported.

### 3.3 Unchanged Scanner contract

The post-pin audit found no changes to the pinned Scanner API/UI, probe logic,
candidate ordering/generation, DPI filtering, ranking, or cleanup contract.

## 4. Approaches considered

### 4.1 Extend Orchestra

Rejected. Orchestra has useful process identity, worker control, cleanup, bounded
evidence, and stale-worker patterns. Its candidate corpus, targets, protocols,
ranking, and apply semantics are service-specific, however. Making it the
Scanner owner would make Orchestra authoritative for Strategy and would reuse
old product semantics merely because code exists.

### 4.2 Native Scanner over Strategy primitives

Selected. A separate pure Scanner domain and native worker use the Strategy
catalog/compiler and existing runtime/firewall/transaction owners. A transient
runtime mode may be added to the existing substrate, but Scanner does not gain a
permanent config writer or Apply engine.

### 4.3 Avatar sidecar or Python port

Rejected. The implementation is OpenWrt-native: ucode, rpcd/ubus, the current
worker mechanism, nftables/fw4, the existing native helper, and current state,
lock, and transaction primitives. No Python/Bottle runtime is introduced.

## 5. Architecture and ownership

```text
Strategy catalog + user Strategies
             ↓
      Scanner Planner
             ↓  CandidatePlan
  transient Strategy executor
             ↓
       Probe adapters
             ↓  typed Evidence
       ranking/reporting
             ↓
 BestStrategyReference → existing Strategy domain
```

The planned modules are separate from Orchestra and are split by pure logic and
I/O. Exact filenames are finalized in the implementation plan, but the
boundaries are:

- pure request/target/state/result model;
- catalog-backed candidate planner;
- generated candidate generator adapter;
- baseline and fixed probe classification;
- transient runtime/firewall executor;
- scanner worker, control, checkpoint, and reconciliation;
- report/ranking and Strategy handoff;
- thin rpcd/ubus and LuCI adapters.

### 5.1 Non-authoritative Orchestra reuse

Scanner may reuse these low-level patterns if their contracts match:

- PID plus process-start-time identity;
- worker heartbeat/control and stale-worker discovery;
- exact-owned cleanup;
- bounded logs and timeouts;
- typed evidence and fail-closed verdicts;
- catalog revision/digest and candidate provenance;
- temporary-file RPC transport.

Scanner must not reuse Orchestra’s candidate IDs as Strategy identity, service
targets, service ranking, apply operations, `/var/lib` operation journal, or
blockcheck-specific command adapters.

## 6. Pure Scanner product domain

The pure layer has no filesystem, process, firewall, network, shell, RPC, or
frontend imports. It owns:

- request validation and canonicalization;
- target profile lookup;
- state transition legality;
- candidate set construction and deterministic ordering;
- normalized deduplication;
- generated candidate identity;
- exact canonicalization to existing Strategy identity;
- baseline/evidence normalization;
- error classification and ranking.

### 6.1 Request validation

The validated request contains:

- target hostname;
- protocol `tcp` or `udp`;
- mode `quick`, `standard`, or `full`;
- optional resume request;
- optional DPI type hint/filter.

The backend accepts only a strict hostname/domain. It lowercases the name and
removes one terminal dot. URLs, credentials, paths, ports, arbitrary shell
syntax, and IPv4/IPv6 literals are rejected. Label and total-length bounds are
enforced. The browser cannot add alternate hosts, ports, payloads, commands, or
executables.

The DPI value is a syntactically bounded hint. Known skip-types such as
`dns_fake`, `ip_block`, and `full_block` retain their pinned explicit filtering
semantics. Unknown but syntactically bounded `dpi_type` values are accepted and
result in no DPI filtering, matching pinned Avatar behavior: the candidate list
remains unchanged. Unknown values are never passed into Strategy compiler or
runtime arguments.

### 6.2 Target profiles

Target profiles are server-owned and cover the pinned known profiles, including
their primary host, alternate test hosts, temporary hostlist domains, TCP/UDP
ports, L7 payload, and body-probe URL. Unknown valid domains use the pinned
generic TLS/QUIC profile.

Temporary hostlists are unique to the scan, owned by its scan ID, created only
under the approved temporary root, and removed during candidate cleanup or
terminal recovery. The public request cannot select an arbitrary hostlist path.

## 7. Candidate planning

The planner reads the existing Strategy Catalog and user Strategies through
server-owned APIs. It binds the plan to a catalog digest/revision and compiler
revision. Every candidate contains source, provenance, protocol, normalized
compiled token-stream digest, dependency closure, and deterministic ordinal.

### 7.1 Pinned modes and ordering

The planner preserves the pinned mode behavior:

- quick prepends the first 10 full presets, then fills from the quick set;
- standard prepends the first 20 full presets, then fills from the standard set;
- full uses the complete protocol set;
- generated candidates are appended for standard/full only when server
  configuration enables generation;
- DPI filtering occurs after generated candidates are added;
- an unknown but syntactically bounded `dpi_type` leaves the candidate list
  unchanged and performs no DPI filtering;
- full-preset priority precedes recommended priority, then complexity, source
  filename, and section ID;
- duplicate normalized candidates are removed deterministically.

Full-preset detection follows the pinned semantic markers for new/filter/hostlist
and top-level blob behavior rather than a client label. Catalog entries are
parsed with quote-aware Avatar tokenization. WinDivert-only lines remain catalog
metadata filtering, not runtime input.

### 7.2 Generated candidates

Generated candidates use the pinned generation grids, protocol restrictions,
complexity ordering, and normalized argument deduplication. Their default IDs
are Scanner-owned and are never accepted as Strategy IDs.

For each generated candidate, the backend compiles it through the same Strategy
compiler used for persisted Strategies. It may map to an existing catalog/user
Strategy only when semantic identity proves:

1. identical normalized compiled token stream; and
2. identical required dependency closure.

The comparison never uses display name, candidate ID, raw client arguments, or
approximate similarity. If no exact existing Strategy is found, the candidate
remains ephemeral. It can be transiently tested and ranked, but permanent Apply
is refused until the user explicitly saves it as a normal Strategy through the
existing Strategy create path.

## 8. Baseline and exact probe semantics

### 8.1 Baseline

Baseline runs before candidate testing while no transient candidate is active.
The original pre-scan runtime/firewall snapshot is captured once before this
phase.

For TCP, target reachability is measured independently over IPv4 and IPv6.
Skipped, DNS, no-route, and host-unreachable families remain unavailable/unknown
rather than false failures. `baseline_open` is true if any available family is
open.

For UDP, the pinned Scanner uses STUN and records its pinned IPv4-oriented
baseline semantics. No QUIC baseline is invented.

If every available baseline path is open, candidate success is forcibly cleared
and the result is classified `BASELINE_OPEN`.

### 8.2 TCP probes

TCP candidate testing preserves the pinned probe set:

1. TLS/HTTP request probe with the pinned bounded read behavior;
2. HTTPS body probe using the pinned Range request and body classification;
3. per-host and per-address-family evidence.

Quick tests the primary host. Standard adds one profile alternate. Full tests up
to four profile hosts.

Body classification preserves the pinned block page, fake HTTP 400, DPI cutoff,
timeout, reset, short-body, and successful-body distinctions. The nominal body
minimum is 65,536 bytes, while the pinned 204/205/304 status exception remains
valid. Candidate success requires the pinned successful body aggregation rule,
not merely a successful TCP handshake.

### 8.3 UDP probes

UDP uses the pinned STUN probe only. The Scanner does not add a QUIC/HTTP3 tester
because the pinned Scanner path does not use one. STUN DNS resolution, bounded
retries, response parsing, latency, and timeout classification are server-owned.

### 8.4 Timing and classification

The pinned timing semantics are preserved:

- TLS timeout: 6 seconds;
- body timeout: 8 seconds;
- STUN timeout: 4 seconds;
- configured stabilization delay, with Avatar’s default configuration of 2
  seconds;
- inter-candidate delay: 0.3 seconds;
- at most three total candidate startup attempts after immediate crash.

The implementation may enforce stricter outer worker deadlines, but it must not
silently turn a probe timeout into a successful or infrastructure result.

Failure classes distinguish target failure, candidate invalidity, timeout,
candidate process crash, probe dependency failure, firewall/runtime failure,
cleanup failure, restoration failure, cancellation, and indeterminate evidence.
Infrastructure outcomes are excluded from normal Strategy ranking.

## 9. Transient Strategy execution

### 9.1 Session snapshot and ownership

Before baseline, the Scanner acquires the shared mutation-capable runtime lock
and captures one pre-scan restoration snapshot/reference containing:

- applied config digest and exact restoration reference;
- active Strategy identity and revision;
- verified runtime process identity: PID, start time, executable, argv digest,
  owner, and generation;
- exact firewall/NFQUEUE ownership and runtime generation;
- Scanner temporary-file/hostlist ownership;
- reconciliation metadata.

Persistent config and active Strategy identity remain unchanged for the entire
scan. Scanner does not mutate favorites, user Strategies, persistent Strategy
state, active identity, or permanent Apply state during probes.

### 9.2 Candidate session lifecycle

The Scanner owns one bounded transient scanner session. For each candidate it:

1. verifies the candidate’s catalog/compiler/dependency bindings;
2. compiles it server-side;
3. runs authoritative native preflight;
4. installs the candidate through the existing runtime owner’s transient mode;
5. installs only exact-owned firewall/NFQUEUE rules;
6. starts and verifies the candidate process using the native identity contract;
7. waits the bounded stabilization interval;
8. retries immediate candidate crashes within the pinned bound;
9. runs the fixed baseline-appropriate probes;
10. records typed evidence and latency;
11. removes and verifies only this candidate’s process, firewall/NFQUEUE rules,
    temporary files, hostlist, and other owned artifacts;
12. leaves the session in its controlled neutral/transient state before the next
    candidate.

The complete pre-scan runtime/firewall state is **not** restored after every
candidate. Between candidates the Scanner may remain in the bounded controlled
session. The per-candidate invariant is complete removal and verification of
that candidate’s owned artifacts, not reinstallation of the original runtime.

The Scanner never runs `nft flush ruleset`, resets an entire firewall merely to
test one Strategy, executes arbitrary user-selected binaries, receives a raw
shell command, or writes `/opt/zapret2/config` through a Scanner-specific path.
Any transient runtime transaction is implemented by the existing runtime and
transaction owner, with Scanner supplying only typed compiled input.

### 9.3 Terminal restoration

On completed, cancelled, error, or worker-recovery paths, terminal cleanup:

1. stops the owned transient scanner session;
2. removes any remaining owned candidate/session artifacts;
3. restores the single pre-scan runtime/firewall snapshot/reference through the
   existing runtime/transaction owner;
4. independently verifies persistent config, active Strategy identity, runtime
   process identity, firewall/NFQUEUE ownership, and temporary artifact removal;
5. publishes a terminal state only after restoration/reconciliation is proven.

If final restoration cannot be proven, the result is terminal `error` with an
explicit `recovery.state = uncertain`. The Scanner must not claim successful
restoration merely because its worker exited. The shared Strategy Apply gate
blocks permanent Apply until reconciliation succeeds. This rule also applies to
cancellation: uncertain final restoration is never published as `cancelled`.

## 10. Worker, state machine, concurrency, cancellation, and resume

### 10.1 State machine

Public Scanner states are:

```text
idle → running → completed
              ↘ cancelled
              ↘ error
```

Internal phases include validating, planning, snapshotting, baselining,
executing, probing, ranking, cancelling, cleaning, restoring, reconciling, and
publishing. `recovery.state` distinguishes `verified`, `not_required`,
`failed`, and `uncertain`; `uncertain` is never collapsed into a normal error
message.

There is no pause state or pause API because the pinned Scanner does not have
actual pause/resume execution. Resume is a bounded continuation after
cancellation or worker interruption. A terminal `cancelled` state is valid only
with `recovery.state = verified`; if cancellation reaches terminal cleanup but
final restoration cannot be proven, the terminal state is `error` with
`recovery.state = uncertain` instead. `cancelled` plus `uncertain` is forbidden.

### 10.2 One active scan and worker identity

At most one mutation-capable Scanner session exists. Admission uses the shared
runtime lock and an id-scoped active record. The worker record includes scan ID,
PID, process start time, owner, heartbeat, and request/catalog identity.

Status and control calls reconcile stale worker records. A worker PID that is
reused with a different start time is not accepted as the Scanner worker. Worker
death is an infrastructure event, not a failed Strategy. Recovery attempts
owned cleanup and final restoration before publishing a terminal `error` with
explicit uncertain recovery when restoration cannot be proven.

### 10.3 Volatile state and checkpoints

The volatile scan record under `/tmp/zapret2-manager` contains:

- scan ID and request identity;
- status and phase;
- current candidate identity/ordinal;
- progress and elapsed time;
- baseline;
- working, failed, and infrastructure counts;
- bounded results/evidence/ranking;
- cancellation flag;
- worker identity;
- pre-scan restoration snapshot/reference;
- cleanup and reconciliation state.

Progress counters, current candidate, elapsed time, probe observations, and
polling state are not written to M5 manager-state and do not cause flash churn.

Resume checkpoints contain only what is necessary for continuation: request
identity, catalog/compiler/dependency digests, next candidate cursor, and bounded
result state. They are atomically written at bounded candidate/time checkpoints,
not for every probe. Resume requires exact identity match for target, protocol,
mode, DPI filter, catalog digest, compiler revision, and candidate plan.
Stale/mismatched checkpoints are rejected explicitly.

### 10.4 Cancellation

Stop creates an id-scoped cancellation request. The active bounded probe adapter
is interrupted safely where possible; otherwise its fixed timeout bounds the
wait. The worker checks cancellation before each candidate and during cleanup.
The response means cancellation was accepted, not that restoration is complete.
The terminal state contract is explicit:

- cancellation request + successful candidate/session cleanup + independently
  verified pre-scan runtime/firewall restoration → terminal `cancelled` with
  `recovery.state = verified`;
- cancellation request + final restoration not proven → terminal `error` with
  `recovery.state = uncertain`, with permanent Strategy Apply blocked until
  reconciliation succeeds.

The response does not mean cleanup or restoration is complete. `cancelled` plus
`recovery.state = uncertain` is forbidden.

## 11. Result, report, ranking, and Strategy handoff

Each candidate result records:

- candidate identity class and Strategy reference, if any;
- catalog/source/provenance and revisions;
- normalized compiled token-stream digest;
- dependency closure digest;
- protocol and target profile;
- working/failed/infrastructure verdict;
- failure class/reason;
- latency and throughput where measured;
- baseline and baseline-by-AF;
- per-host, per-AF, TLS, body, and STUN evidence;
- cleanup status;
- save-required/canonicalized metadata.

The report records working strategies, failed strategies, infrastructure events,
tested/total, success rate, baseline state, elapsed time, per-test evidence, and
the best Strategy reference.

Pinned score formulas remain server-owned:

```text
TCP = success_rate * (min(avg_kbps, 2048) / max(avg_latency_ms, 50)) * 1000
UDP = 1000 / max(stun_latency_ms, 50)
```

Successful candidates rank by score, then deterministic pinned tie-breakers.
Failed candidates retain deterministic plan order. Infrastructure outcomes are
not ranked as bad Strategies. The best reference is either:

- an existing catalog/user Strategy ID and revision; or
- an ephemeral generated result with `saveRequired = true`.

An ephemeral generated result cannot be permanently applied. Saving it invokes
the existing Strategy create path, produces a new user Strategy ID/revision,
and returns that identity for normal Preview → Validate → Apply. There is no
Scanner Apply path.

## 12. RPC, ACL, and transport contract

The canonical `zapret2-manager` ubus object gains thin Scanner methods:

- `scanner_start`;
- `scanner_status`;
- `scanner_results`;
- `scanner_stop`;
- `scanner_resume`;
- `scanner_save_generated`, if the LuCI flow needs a dedicated adapter rather
  than calling the existing Strategy create method directly.

Read and write ACL entries are explicit. The RPC layer performs parameter
extraction, bounded temporary-file transport, and response framing only. It
does not plan candidates, compile arguments, classify probes, or mutate runtime.

Mutation payloads use the existing JSON-string temporary-file convention. Input
content never travels through shell interpolation or a command-line argument.
Raw nfqws2 commands and raw arguments are absent from the public contract.

Status polling returns bounded metadata and current phase. Results retrieval is
bounded and may use offset/limit pagination while preserving server-defined
result order and stable candidate references. Evidence payload sizes and total
candidate/result counts have fixed server limits.

## 13. LuCI integration

Scanner is integrated into the existing Strategy experience with no global LuCI
redesign. The UI exposes:

- target/domain;
- TCP/UDP;
- quick/standard/full;
- optional resume;
- optional DPI hint/filter;
- start and stop;
- progress, phase, current candidate, working/failed counts, elapsed time;
- baseline indication;
- working and failed results;
- per-result evidence where appropriate;
- best Strategy;
- Save as Strategy for unmatched generated candidates;
- existing Preview/Validate/Apply handoff for an existing Strategy identity;
- explicit degraded/uncertain recovery state.

The frontend never constructs effective arguments or command lines. It never
fabricates state while polling. Poll timers and pending requests are cancelled
or ignored on page unmount/navigation. Result actions use stable server-owned
candidate/Strategy references, never positional indexes as permanent identity.

## 14. Security and safety invariants

The implementation must enforce all of the following:

- at most one mutation-capable Scanner session;
- bounded lock ownership and bounded worker/probe lifetimes;
- no raw shell command from API/user input;
- strict target validation and no arbitrary binary execution;
- no `nft flush ruleset` or full firewall reset for one candidate;
- no active Strategy identity, favorites, or permanent user state mutation;
- candidate bound to server-owned catalog/compiler/dependency digests;
- server-side Strategy compilation and authoritative preflight;
- verified runtime process identity;
- exact per-candidate cleanup before the next candidate;
- final session cleanup and pre-scan restoration on every terminal path;
- cancellation safe interruption;
- worker crash distinguishable from candidate failure;
- infrastructure failure excluded from Strategy ranking;
- cleanup/restore failure produces uncertain recovery;
- later permanent Apply blocked while shared runtime state is uncertain;
- generated candidate never becomes permanent by display name, candidate ID,
  client args, or approximate similarity.

## 15. Performance, resource, and package constraints

The Scanner is bounded by server-owned limits for target length, candidate
count, catalog/file size, result count, evidence/log bytes, host count,
concurrent probes, per-probe timeout, total scan deadline, worker heartbeat,
and RPC response size. Candidate probes remain sequential because the runtime
and firewall are mutation-capable and the pinned Scanner is sequential.

Package integration must install:

- pure Scanner and worker modules;
- fixed probe adapters and target data;
- RPC/ACL additions;
- LuCI Scanner assets;
- test fixtures and package manifests.

No package action overwrites the physical router’s authoritative DNS or
Telegram implementation. No package upgrade or deployment to the physical
router is part of this slice.

## 16. Testing strategy

Testing follows TDD for every behavior task: RED, minimal GREEN, adjacent edge
cases, focused review, and task commit.

### 16.1 Pure and characterization tests

Fixtures cover pinned target profiles, mode candidate order, full-preset and
recommended priority, complexity ordering, normalized deduplication, generated
candidate identity, exact canonicalization, DPI filtering, request validation,
state transitions, and result normalization.

### 16.2 Probe tests

Tests cover baseline IPv4/IPv6 semantics, baseline-open suppression, TLS/body
aggregation, body status exceptions, STUN-only UDP behavior, pinned timeout and
latency behavior, alternate-host selection, and failure-priority classification.

### 16.3 High-risk transient/recovery tests

Regression coverage is required for:

- persistent config preservation throughout a scan;
- active Strategy identity preservation;
- pre-scan snapshot capture once;
- candidate-owned process/firewall/temp-artifact cleanup between candidates;
- controlled neutral/transient state between candidates;
- one-time terminal restoration on completion, cancellation, error, and worker
  recovery;
- cancellation with verified restoration publishing only `cancelled`, and
  cancellation with unproven restoration publishing only `error` plus
  `recovery.state = uncertain`;
- immediate nfqws2 crash retry and candidate/infrastructure distinction;
- cancellation cleanup;
- stale worker detection;
- cleanup failure;
- restore failure and explicit uncertain state;
- Apply blocking and reconciliation release;
- generated candidate exact mapping, Save as Strategy, and raw-args rejection.
- unknown bounded `dpi_type` preserving the candidate list without compiler or
  runtime argument injection.

True revert/fix/regression proof is mandatory for these load-bearing cases. It
is not required for trivial static UI assertions.

### 16.4 RPC, UI, package, and native gates

Focused product tests cover Scanner RPC/ACL envelopes, bounded payloads, LuCI
poll lifecycle, result handoff, and package installation. Relevant native tests
cover ucode syntax/module loading, helper/lock/process identity, runtime
transaction integration, and root policy.

The canonical full gate is:

```text
scripts/test/native.sh
```

It already includes the root-required subset. The full gate runs at baseline,
Checkpoint A, Checkpoint B, and final closure, not after every low-risk task.

## 17. Planned implementation shape

The implementation plan targets approximately eleven reviewable tasks:

1. Scanner characterization and parity fixtures;
2. pure Scanner domain and state/result types;
3. Strategy Catalog candidate planner;
4. baseline and exact probe engine;
5. high-risk transient Strategy execution;
6. Scanner worker/job, control, and resume;
7. crash/stop/final restoration/reconciliation;
8. results, ranking, and Strategy handoff;
9. rpcd/ubus and ACL;
10. LuCI Strategy integration;
11. package, integration, parity closure, and final gates.

Each task gets a focused test command, a fresh task review, and a task commit.
Tasks 5 and 7 retain the full safety fix-loop budget. Implementation is not
parallelized across shared state.

## 18. Explicit deviations and out-of-scope work

### `OPENWRT_NATIVE`

Avatar’s Python singleton/background thread and Bottle routes become a native
ucode worker/job and rpcd/ubus surface. Fixed native probe/runtime adapters
replace Python process wrappers while preserving the observable Scanner flow.

### `SECURITY_HARDENING_EQUIVALENT_BEHAVIOR`

Native Scanner adds exact catalog/compiler/dependency binding, stricter target
validation, bounded transport, verified process identity, stale-worker
reconciliation, one-time final restoration proof, and Apply blocking while
uncertain. These harden the same product behavior rather than changing its
successful-result meaning.

### `EXPLICIT_USER_PRODUCT_CONSTRAINT`

Scanner is not Orchestra, does not create a second Strategy model/catalog or
permanent Apply engine, keeps generated unmatched candidates ephemeral, leaves
DNS and Telegram untouched, performs no global LuCI redesign, and performs no
physical-router mutation or deployment.

### `CONFLICT_REQUIRES_USER_DECISION`

None remains after approval of the exact generated-candidate canonicalization
rule:

- exact normalized compiled token stream plus exact dependency closure may map
  to an existing Strategy;
- otherwise the generated result is ephemeral and requires explicit Save as
  Strategy before permanent Apply.

## 19. Router-only acceptance

Host/CI work may finish without physical-router network acceptance. No install,
upgrade, package overwrite, service write, firewall mutation, live Scanner run,
Strategy Apply, or reboot is permitted on the physical router without explicit
approval.

The final report must state:

```text
ROUTER_E2E: NOT RUN
REASON: explicit physical-router mutation/deployment approval was not provided
```

## 20. Acceptance criteria

The slice is complete only when:

1. pinned candidate, target, baseline, probe, result, and UI behavior is
   characterized by evidence and covered by tests;
2. Scanner plans only server-owned catalog/Strategy candidates;
3. generated candidates obey exact canonicalization or explicit Save boundary;
4. persistent config and active Strategy identity remain unchanged throughout;
5. each candidate’s owned artifacts are removed and verified before the next;
6. the original pre-scan runtime/firewall state is restored once at terminal
   cleanup and terminal publication waits for proof;
7. uncertain recovery blocks permanent Apply until reconciliation, and
   `cancelled` is never published with `recovery.state = uncertain`;
8. existing Strategy Preview → Validate → Apply remains the only permanent
   Apply path;
9. RPC, ACL, LuCI, package, focused, Strategy regression, and native tests pass;
10. `git diff --check` and the canonical native gate pass;
11. DNS changes are zero, Telegram changes are zero, and router mutations are
    zero;
12. the final parity report distinguishes PARITY, PARTIAL, MISSING,
    DIVERGENT, INTENTIONAL_DEVIATION, and CONFLICT_REQUIRES_USER_DECISION from
    actual evidence.
