# Avatar-Compatible Strategy Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an OpenWrt-native Avatar-compatible Strategy Scanner that plans server-owned Strategy candidates, executes them transiently, records baseline/probe evidence, ranks results, and hands the selected Strategy to the existing Preview → Validate → Apply pipeline.

**Architecture:** Scanner is a separate pure-domain and worker subsystem. It consumes the existing Strategy Catalog, Strategy compiler, native preflight, runtime/firewall ownership, helper, lock, and Apply reconciliation primitives. A transient Scanner session owns only bounded candidate execution and candidate artifacts; the original pre-scan runtime/firewall snapshot is restored once during terminal cleanup. Permanent Strategy mutation remains exclusively in the existing Strategy domain.

**Tech Stack:** ucode, rpcd/ubus, existing native helper and flock/state primitives, fw4/nftables ownership adapters, LuCI JavaScript, Node’s built-in `node:test`, and the existing Linux `scripts/test/native.sh` gate.

## Global Constraints

- Work on the current `main`; do not create a branch, worktree, PR, merge, or remote push.
- Implement against the approved spec at `359ce10b4b3b3830fe5cabd73036e69dbdbfc78b`.
- Scanner is separate from Orchestra and must not use Orchestra candidate IDs as Strategy identity.
- The existing Strategy Catalog, Strategy model/compiler/state, Preview, Validate, and transactional Apply remain authoritative.
- Existing Strategy Preview → Validate → Apply is the only permanent Apply path; no second Apply engine is allowed.
- Generated candidates canonicalize only on identical normalized compiled token streams and identical dependency closures; otherwise Save as Strategy is required before permanent Apply.
- Unknown syntactically bounded `dpi_type` values are accepted, perform no DPI filtering, leave the candidate list unchanged, and never enter compiler/runtime arguments.
- Known `dns_fake`, `ip_block`, and `full_block` skip-types retain pinned Avatar semantics.
- Persistent config and active Strategy identity remain unchanged throughout scanning.
- Candidate cleanup removes only that candidate’s owned process, firewall/NFQUEUE rules, temporary files, hostlist, and other owned artifacts before the next candidate.
- The original pre-scan runtime/firewall state is restored once during terminal cleanup.
- Verified cancellation publishes `cancelled` with `recovery.state = verified`.
- Unproven cancellation restoration publishes `error` with `recovery.state = uncertain`.
- `cancelled` plus `recovery.state = uncertain` is forbidden.
- Uncertain shared runtime state blocks permanent Strategy Apply until reconciliation succeeds.
- No raw shell command, arbitrary executable, `nft flush ruleset`, full firewall reset, browser-composed nfqws2 command, or direct Scanner write path to `/opt/zapret2/config`.
- DNS changes are zero and Telegram changes are zero.
- Physical-router mutation, deployment, live Scanner run, and Strategy Apply are not performed.
- No global LuCI redesign.
- No Python/Bottle runtime.
- The canonical native gate is `scripts/test/native.sh`; it already invokes `scripts/test/native-root.sh`, so the root suite is not run separately when the canonical gate runs.
- Pinned probe semantics are exact: TCP TLS/body, UDP STUN only, IPv4/IPv6 baseline behavior, Avatar timeout/classification rules, and no invented QUIC/HTTP3 Scanner probe.

## File Map

### New backend modules

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc` — pure request, state, target-reference, and bounded status/result-shape logic.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc` — pure pinned target profiles and mode-specific host selection.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc` — catalog/user Strategy candidate selection, generated candidates, exact canonicalization, ordering, deduplication, and catalog/compiler binding.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc` — pure baseline/probe classification, pinned error priority, latency, and ranking score calculations.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc` — fixed bounded network probe adapters; no user-selected command or executable.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc` — Scanner session ownership, candidate activation/cleanup, and the adapter boundary to existing runtime/firewall primitives.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc` — volatile scan records, atomic checkpoints, active-worker record, control flags, and bounded result persistence under `/tmp/zapret2-manager`.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc` — sequential worker loop, phase transitions, baseline, candidate execution, probe invocation, progress, and cancellation checks.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc` — stale-worker recovery, terminal cleanup, one-time pre-scan restoration, uncertainty publication, and Strategy Apply guard integration.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc` — result/report normalization, score ordering, best reference, and generated Save-as-Strategy payload validation.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc` — bounded CLI entry points used by rpcd for start/status/results/stop/resume/save-generated.

### Existing backend files to modify

- `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc` — expose only typed transient runtime/firewall ownership primitives used by Scanner; preserve the existing permanent writer and CAS behavior.
- `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc` — expose the existing compiler/preflight/verification substrate to the transient adapter without creating a permanent Apply path.
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc` — add thin Scanner ubus methods and bounded JSON-string temp-file transport.
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json` — add explicit Scanner read/write ACL methods.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js` — mount the Scanner panel inside the existing Strategy experience.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js` — add the typed Scanner RPC declarations and expose them through the existing API object.
- `docs/architecture/avatar-parity.md` — final evidence-only parity update in Task 11; no unrelated documentation changes.

### New tests and fixtures

- `tests/fixtures/avatar-strategy-scanner/targets.json`
- `tests/fixtures/avatar-strategy-scanner/candidates.json`
- `tests/fixtures/avatar-strategy-scanner/probes.json`
- `tests/fixtures/avatar-strategy-scanner/recovery.json`
- `tests/product/avatar-strategy-scanner-characterization.test.mjs`
- `tests/product/avatar-strategy-scanner-model.test.mjs`
- `tests/product/avatar-strategy-scanner-planner.test.mjs`
- `tests/product/avatar-strategy-scanner-probes.test.mjs`
- `tests/product/avatar-strategy-scanner-transient.test.mjs`
- `tests/product/avatar-strategy-scanner-worker.test.mjs`
- `tests/product/avatar-strategy-scanner-results.test.mjs`
- `tests/product/avatar-strategy-scanner-rpc.test.mjs`
- `tests/product/avatar-strategy-scanner-ui.test.mjs`
- `tests/product/avatar-strategy-scanner-integration.test.mjs`
- `tests/native/avatar-strategy-scanner-package.test.mjs`
- `tests/native/avatar-strategy-scanner-runtime.test.mjs`

### Existing tests to extend

- `tests/product/avatar-strategy-integration.test.mjs` — Strategy identity and Apply guard handoff.
- `tests/product/avatar-strategy-rpc.test.mjs` — canonical ubus signature/ACL conventions.
- `tests/product/avatar-strategy-ui.test.mjs` — existing Strategy page lifecycle conventions.
- `tests/native/avatar-strategy-package.test.mjs` — package inventory and mode checks.

## Shared interfaces

The following names and shapes are fixed for all tasks. Later tasks consume
earlier task interfaces exactly; renaming requires updating this plan and every
affected test before implementation continues.

### Request and state

```text
scanner_request_validate(input)
  → { ok: true, value: ScannerRequest }
  → { ok: false, error: { code, message, path } }

ScannerRequest = {
  target: string,
  protocol: 'tcp' | 'udp',
  mode: 'quick' | 'standard' | 'full',
  resume: boolean,
  dpi_type: string | null
}

scanner_state_transition(state, event)
  → { ok: true, state: ScannerState }
  → { ok: false, error: { code, message } }

scanner_state_create(request, plan)
  → ScannerRecord

scanner_status_view(record)
  → bounded public status object
```

### Candidate plan

```text
scanner_plan_build(request, catalogSnapshot, userStrategies)
  → { ok: true, plan: ScannerPlan }
  → { ok: false, error: { code, message, details } }

ScannerCandidate = {
  scannerId: string,
  identityKind: 'catalog' | 'user' | 'canonicalized' | 'generated',
  strategyId: string | null,
  strategyRevision: integer | null,
  source: string,
  sourcePath: string | null,
  protocol: 'tcp' | 'udp',
  compiledTokens: array<string>,
  compiledDigest: string,
  dependencyClosure: object,
  dependencyDigest: string,
  ordinal: integer,
  complexity: array<integer>,
  recommended: boolean,
  fullPreset: boolean,
  saveRequired: boolean
}

scanner_candidate_canonicalize(candidate, existingStrategies)
  → { kind: 'existing', strategyId, revision, candidate }
  → { kind: 'ephemeral', candidate }
```

### Probe and result interfaces

```text
scanner_baseline_classify(rawBaseline)
  → BaselineEvidence

scanner_tcp_classify(rawProbe)
  → TestEvidence

scanner_udp_classify(rawProbe)
  → TestEvidence

scanner_candidate_verdict(baseline, tests)
  → { verdict, reason, success, evidence }

scanner_score(result)
  → number | null

scanner_rank_results(results)
  → array<ScannerResult>
```

The fixed adapter boundary is:

```text
scanner_probe_adapter_baseline(profile, deadline)
scanner_probe_adapter_tcp(candidate, target, addressFamily, deadline)
scanner_probe_adapter_udp(candidate, target, deadline)
```

Each adapter returns typed bounded observations. It never accepts an executable,
shell string, raw nfqws2 arguments, or arbitrary path from the request.

### Transient and recovery interfaces

```text
scanner_session_begin(request, plan)
  → { ok: true, session: ScannerSession }

scanner_candidate_activate(session, candidate)
  → { ok: true, attempt: CandidateAttempt }

scanner_candidate_cleanup(attempt)
  → { ok: true, cleanup: CleanupEvidence }
  → { ok: false, error: InfrastructureError }

scanner_session_restore(session, terminalReason)
  → { ok: true, recovery: { state: 'verified', ... } }
  → { ok: false, recovery: { state: 'uncertain', ... } }

scanner_terminal_reconcile(record, terminalReason)
  → { terminalState: 'completed'|'cancelled'|'error', recovery }
```

### RPC and UI interfaces

The canonical ubus object is `zapret2-manager` with these methods:

```text
scanner_start       { edit: string } → bounded start response
scanner_status      {}                → bounded status response
scanner_results     { edit: string } → bounded/paginated report response
scanner_stop        { edit: string } → cancellation-accepted response
scanner_resume      { edit: string } → resumed-start response
scanner_save_generated { edit: string } → existing Strategy create response
```

`scanner_save_generated` creates a normal user Strategy only. It never applies
runtime state. The UI module exports `load(ctx)`, `render(ctx)`, `mount(ctx)`,
`unmount()`, and uses stable server-owned Scanner/Strategy references.

---

### Task 1: Scanner characterization and parity fixtures

**Files:**
- Create: `tests/fixtures/avatar-strategy-scanner/targets.json`
- Create: `tests/fixtures/avatar-strategy-scanner/candidates.json`
- Create: `tests/fixtures/avatar-strategy-scanner/probes.json`
- Create: `tests/fixtures/avatar-strategy-scanner/recovery.json`
- Create: `tests/product/avatar-strategy-scanner-characterization.test.mjs`

**Interfaces:**
- Consumes: pinned Avatar evidence from `f9dd3ea47a2239514f396a843b475c92c33f0b4c` and manager Strategy catalog fixtures.
- Produces: JSON fixture schemas used by Tasks 2–8 and test helper `runUcodeExpression(module, expression, env)` matching the existing Strategy integration harness.

- [ ] **Step 1: Write failing characterization assertions.** Add `tests/product/avatar-strategy-scanner-characterization.test.mjs` that loads the four fixture paths and asserts the fixture schema and provenance fields. Do not import implementation modules yet.

- [ ] **Step 2: Run the focused RED command.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-characterization.test.mjs
  ```

  Expected: FAIL because the four fixture files do not yet exist.

- [ ] **Step 3: Record source provenance and fixture data.** Add fixture metadata containing the pinned Avatar commit, manager HEAD used for planning, probe constants, and the exact deviation classes. Encode quick/standard/full candidates, known and unknown DPI cases, target profiles, baseline/probe observations, score cases, and cancellation recovery cases. Keep fixtures bounded and deterministic.

- [ ] **Step 4: Run the fixture GREEN command.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-characterization.test.mjs
  ```

  Expected: PASS for fixture schema, provenance, and bounded-content checks.

- [ ] **Step 5: Commit.**

  ```sh
  git add tests/fixtures/avatar-strategy-scanner tests/product/avatar-strategy-scanner-characterization.test.mjs
  git commit -m "test: characterize Avatar Strategy Scanner contract"
  ```

### Task 2: Pure Scanner domain and target profiles

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc`
- Create: `tests/product/avatar-strategy-scanner-model.test.mjs`
- Create: `tests/product/avatar-strategy-scanner-integration.test.mjs`

**Interfaces:**
- Consumes: Task 1 fixtures; no I/O modules.
- Produces: `scanner_request_validate`, `scanner_state_transition`, `scanner_state_create`, `scanner_status_view`, `scanner_target_profile`, and `scanner_target_hosts`.

- [ ] **Step 1: Add RED assertions.** Assert strict hostname normalization/rejection, bounded unknown `dpi_type` acceptance, known skip-type preservation, the public state transition graph, forbidden terminal `cancelled + uncertain`, and target profile host selection for quick/standard/full.

- [ ] **Step 2: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-model.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: FAIL with missing `scanner-model.uc`/`scanner-targets.uc` exports.

- [ ] **Step 3: Implement pure validation and transitions.** Keep the modules free of filesystem, process, firewall, network, shell, RPC, and frontend imports. Validate target labels/length, protocol, mode, resume boolean, and bounded DPI text. Map unknown bounded DPI text to no filtering. Return structured errors with stable codes and paths.

- [ ] **Step 4: Implement target profiles.** Encode the pinned known profiles, generic fallback, primary/alternate host lists, TCP/UDP ports, L7 payload, body URL, and temporary hostlist names. Make host selection deterministic and mode-specific.

- [ ] **Step 5: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-model.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: PASS, including unknown DPI no-filter and cancellation state legality.

- [ ] **Step 6: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc tests/product/avatar-strategy-scanner-model.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  git commit -m "feat: add pure Scanner domain and targets"
  ```

### Task 3: Strategy Catalog candidate planner

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc`
- Create: `tests/product/avatar-strategy-scanner-planner.test.mjs`
- Modify: `tests/product/avatar-strategy-catalog.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`

**Interfaces:**
- Consumes: Task 2 `ScannerRequest`, `scanner_target_profile`, existing `strategy_catalog_load`, `catalog_entry_to_strategy`, `strategy_user_list`, and `strategy_candidate`/dependency outputs.
- Produces: `scanner_plan_build(request, catalogSnapshot, userStrategies)`, `scanner_candidate_canonicalize(candidate, existingStrategies)`, and immutable `ScannerPlan`/`ScannerCandidate` values.

- [ ] **Step 1: Add RED planner tests.** Assert quick first-10/full-preset behavior, standard first-20/full-preset behavior, full protocol catalog behavior, generated append order, post-generation DPI ordering, recommended/complexity/source/section tie-breakers, normalized deduplication, protocol filtering, provenance, and catalog/compiler digest binding.

- [ ] **Step 2: Add RED identity-boundary tests.** Assert generated candidates map only when normalized compiled tokens and dependency closure are identical. Assert display-name match, candidate-ID match, approximate token similarity, and client-provided raw args cannot map or apply.

- [ ] **Step 3: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: FAIL because `scanner-planner.uc` is absent.

- [ ] **Step 4: Implement catalog-backed planning.** Read only server-owned catalog/user Strategy records. Preserve Avatar quote-aware tokenization and full-preset detection. Build generated candidates only for standard/full when the server policy enables them. Apply the known DPI filter after generation; for unknown bounded DPI return the unchanged candidate list.

- [ ] **Step 5: Implement exact generated canonicalization.** Compile generated and persisted candidates through the existing Strategy compiler. Compare the normalized compiled token stream and complete required dependency closure. Return an existing Strategy identity only for exact equality; otherwise return `identityKind = generated`, `strategyId = null`, and `saveRequired = true`.

- [ ] **Step 6: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: PASS with pinned ordering and the approved generated identity rule.

- [ ] **Step 7: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  git commit -m "feat: plan Scanner candidates from Strategy Catalog"
  ```

### Task 4: Baseline and exact probe engine

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc`
- Create: `tests/product/avatar-strategy-scanner-probes.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`

**Interfaces:**
- Consumes: Task 2 target profiles and Task 3 `ScannerCandidate` values.
- Produces: `scanner_baseline_classify`, `scanner_tcp_classify`, `scanner_udp_classify`, `scanner_candidate_verdict`, `scanner_score`, and fixed adapter functions `scanner_probe_adapter_baseline`, `scanner_probe_adapter_tcp`, `scanner_probe_adapter_udp`.

- [ ] **Step 1: Add RED probe tests.** Cover TCP IPv4/IPv6 baseline, skipped families, `baseline_open`, baseline-open suppression, quick/standard/full host counts, TLS read bounds, body Range/block-page/fake-400/cutoff/timeout/reset/short-body behavior, 204/205/304 body exception, STUN-only UDP, pinned timeouts, latency, score formulas, and failure-priority classification.

- [ ] **Step 2: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-probes.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: FAIL with missing probe modules and exports.

- [ ] **Step 3: Implement pure classification.** Implement typed raw-observation normalization, pinned error precedence, body aggregation, baseline AF selection, `BASELINE_OPEN`, TCP/UDP score formulas, and deterministic verdicts. Keep infrastructure failure separate from candidate failure.

- [ ] **Step 4: Implement fixed bounded adapters.** Use only existing packaged/native networking primitives and fixed server-owned arguments. Bound target, host, address family, payload, read size, timeout, retry, output, and deadline. Reject any request field that attempts to select a command, executable, raw argument, or path.

- [ ] **Step 5: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-probes.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: PASS for all pinned probe fixtures, with no QUIC/HTTP3 Scanner probe.

- [ ] **Step 6: Run Checkpoint A.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-model.test.mjs tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  git diff --check
  scripts/test/native.sh
  ```

  Expected: focused tests, diff check, and the canonical native gate PASS on the Linux native environment. `native.sh` owns the root subset and no separate root command is run.

- [ ] **Step 7: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc tests/product/avatar-strategy-scanner-probes.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  git commit -m "feat: add Scanner baseline and probe engine"
  ```

### Task 5: High-risk transient Strategy execution

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`
- Create: `tests/product/avatar-strategy-scanner-transient.test.mjs`
- Create: `tests/native/avatar-strategy-scanner-runtime.test.mjs`

**Interfaces:**
- Consumes: Task 3 `ScannerCandidate`, Task 4 probe/runtime dependency contracts, existing `apply.uc` writer/CAS, `profiles-apply.uc` compiler/preflight/verification, native helper, process identity, and firewall ownership primitives.
- Produces: `scanner_session_begin`, `scanner_candidate_activate`, `scanner_candidate_cleanup`, and typed `ScannerSession`, `CandidateAttempt`, `CleanupEvidence` values.

- [ ] **Step 1: Add RED invariant tests.** Assert one session lock, one pre-scan snapshot, unchanged config/active Strategy identity, server-side compile/preflight binding, process identity verification, exact owned firewall/NFQUEUE setup, bounded stabilization/retry, candidate-only cleanup, and no direct Scanner config writer/raw command.

- [ ] **Step 2: Add RED failure tests.** Assert candidate crash is distinct from infrastructure failure, unavailable dependency refuses activation, process identity mismatch refuses ownership, cleanup failure stops progression, and no full firewall flush occurs.

- [ ] **Step 3: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
  ```

  Expected: FAIL because transient Scanner ownership functions and test hooks are absent.

- [ ] **Step 4: Extend existing runtime substrate.** Add typed transient entry points to `apply.uc`/`profiles-apply.uc` that reuse existing locks, compiler, native preflight, runtime verification, firewall ownership, and CAS/reconciliation primitives. The new entry points must not update Strategy identity, favorites, user Strategy files, or permanent Apply state.

- [ ] **Step 5: Implement the Scanner session.** Capture the pre-scan config/identity/runtime/firewall reference once. Activate one compiled candidate at a time. After each candidate remove and verify only its owned process, rules, NFQUEUE state, hostlist, temporary files, and other owned artifacts. Leave the session in a controlled neutral/transient state for the next candidate; do not restore the original runtime after every candidate.

- [ ] **Step 6: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
  ```

  Expected: PASS for all transient ownership and preservation invariants.

- [ ] **Step 7: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc tests/product/avatar-strategy-scanner-transient.test.mjs tests/native/avatar-strategy-scanner-runtime.test.mjs
  git commit -m "feat: add bounded transient Scanner execution"
  ```

### Task 6: Scanner worker, volatile state, control, and resume

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- Create: `tests/product/avatar-strategy-scanner-worker.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–5 request, plan, probe, transient-session, and cleanup interfaces.
- Produces: `scanner_state_create`, `scanner_state_load`, `scanner_state_save`, `scanner_control_request`, `scanner_worker_run`, and CLI subcommands `start`, `status`, `results`, `stop`, `resume`, `save-generated`.

- [ ] **Step 1: Add RED worker tests.** Cover idle/running/completed/cancelled/error states, one active scan, worker PID/start-time identity, sequential candidate progress, current phase/current candidate, bounded result persistence, cancellation acceptance, and exact resume identity checks.

- [ ] **Step 2: Add RED state-storage tests.** Assert atomic volatile records under `/tmp/zapret2-manager`, bounded checkpoint cadence, no M5 manager-state writes, no per-probe flash churn, stale checkpoint rejection, and bounded result/status payloads.

- [ ] **Step 3: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: FAIL with missing state/worker/CLI modules.

- [ ] **Step 4: Implement state and control.** Use id-scoped active/record/control files, atomic writes, bounded events, PID plus start-time identity, request/catalog/compiler/plan digests, cursor checkpoints, and bounded evidence. Do not add Scanner fields to M5 manager-state.

- [ ] **Step 5: Implement the worker loop.** Validate request, build the plan, open the transient session, run baseline once, execute candidates sequentially, call fixed probes, persist bounded progress/results, honor stop before the next candidate and during bounded probes, and route every terminal path through reconciliation from Task 7.

- [ ] **Step 6: Implement CLI dispatch.** Accept only fixed subcommand names and private bounded request files. Return schema-versioned JSON; never interpolate request values into shell commands.

- [ ] **Step 7: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  ```

  Expected: PASS for normal sequential lifecycle, control, checkpoint, and resume admission.

- [ ] **Step 8: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
  git commit -m "feat: add native Scanner worker and resume state"
  ```

### Task 7: Crash, stop, terminal restoration, and reconciliation

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc`
- Modify: `tests/product/avatar-strategy-scanner-worker.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-transient.test.mjs`
- Modify: `tests/product/avatar-strategy-integration.test.mjs`

**Interfaces:**
- Consumes: Task 5 session snapshot/cleanup/restore primitives, Task 6 worker/control records, existing `strategy_apply_guard_status`, `strategy_apply_uncertain_record`, and `strategy_apply_reconcile`.
- Produces: `scanner_terminal_reconcile(record, terminalReason)` with the only legal terminal combinations: `completed|cancelled` + `recovery.state = verified`, or `error` + `recovery.state = uncertain` when final restoration is unproven.

- [ ] **Step 1: Add RED recovery tests.** Cover normal completion, verified cancellation, cancellation with cleanup failure, cancellation with restore failure, worker death, stale PID reuse, immediate nfqws2 crash, failed final cleanup, failed restore, uncertain Apply blocking, and successful reconciliation releasing the Apply gate.

- [ ] **Step 2: Add explicit forbidden-state assertions.** Assert that no code path publishes `cancelled` with `recovery.state = uncertain`; cancellation response is only request acceptance; terminal publication waits for final restoration/reconciliation.

- [ ] **Step 3: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/product/avatar-strategy-integration.test.mjs
  ```

  Expected: FAIL because terminal reconciliation and uncertainty propagation are absent.

- [ ] **Step 4: Implement one-time terminal reconciliation.** Stop the owned transient session, remove remaining owned artifacts, restore the single pre-scan runtime/firewall reference, verify config/identity/process/firewall/temporary artifacts, and only then publish `completed` or verified `cancelled`.

- [ ] **Step 5: Implement uncertain recovery.** On any unproven final restoration, publish `error` plus `recovery.state = uncertain`, preserve bounded evidence of the failure, call the existing Strategy Apply uncertainty guard, and block Apply until existing reconciliation proves the previous state.

- [ ] **Step 6: Implement stale-worker recovery.** Reconcile PID/start-time identity, mark dead workers as infrastructure failures, perform the same owned cleanup and final restoration path, and never rank worker failure as a bad Strategy.

- [ ] **Step 7: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/product/avatar-strategy-integration.test.mjs
  ```

  Expected: PASS, including the forbidden `cancelled + uncertain` assertion and Apply guard behavior.

- [ ] **Step 8: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/product/avatar-strategy-integration.test.mjs
  git commit -m "feat: reconcile Scanner cancellation and recovery"
  ```

### Task 8: Results, ranking, and Strategy handoff

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- Create: `tests/product/avatar-strategy-scanner-results.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`
- Modify: `tests/product/avatar-strategy-apply.test.mjs`

**Interfaces:**
- Consumes: Task 3 candidate identity, Task 4 verdict/score, Task 6 bounded records, and Task 7 recovery state.
- Produces: `scanner_rank_results`, `scanner_report_build`, `scanner_best_reference`, `scanner_save_generated_validate`, and a server-owned Save-as-Strategy request accepted by the existing Strategy create path only.

- [ ] **Step 1: Add RED result tests.** Assert working/failed/infrastructure separation, pinned TCP/UDP scoring, deterministic rank tie-breakers, baseline/report fields, per-test evidence, latency, tested/total, success rate, best existing Strategy identity, and ephemeral `saveRequired` output.

- [ ] **Step 2: Add RED handoff tests.** Assert an exact canonicalized generated candidate hands off with an existing Strategy ID, an unmatched generated candidate cannot Apply, Save creates a normal user Strategy request with a new ID/revision, and no Scanner Apply function exists.

- [ ] **Step 3: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-results.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-apply.test.mjs
  ```

  Expected: FAIL because result/ranking/handoff modules are absent.

- [ ] **Step 4: Implement result normalization and ranking.** Exclude infrastructure outcomes from Strategy ranking, retain failed evidence, apply pinned score formulas, and use deterministic order for equal scores. Bound every evidence/result/report field.

- [ ] **Step 5: Implement Strategy handoff.** Return existing Strategy references to the existing Preview/Validate/Apply UI. For unmatched generated candidates, validate only a server-owned Save payload containing compiled profiles, dependency closure, provenance, and expected catalog/compiler bindings. Delegate creation to the existing Strategy create transaction; do not start or apply runtime.

- [ ] **Step 6: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-results.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-apply.test.mjs
  ```

  Expected: PASS with stable ranking, evidence, and the single permanent Apply boundary.

- [ ] **Step 7: Run Checkpoint B.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-model.test.mjs tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs tests/product/avatar-strategy-scanner-transient.test.mjs tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-results.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-apply.test.mjs
  node --test tests/native/avatar-strategy-scanner-runtime.test.mjs tests/native/avatar-strategy-status.test.mjs tests/native/avatar-strategy-package.test.mjs
  scripts/test/native.sh
  git diff --check
  ```

  Expected: all focused Scanner/Strategy/native tests, the canonical native gate, and diff check PASS on Linux. Do not run `native-root.sh` separately.

- [ ] **Step 8: Commit.**

  ```sh
  git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc tests/product/avatar-strategy-scanner-results.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-apply.test.mjs
  git commit -m "feat: rank Scanner evidence and hand off Strategies"
  ```

### Task 9: rpcd/ubus methods and ACL

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Create: `tests/product/avatar-strategy-scanner-rpc.test.mjs`
- Modify: `tests/product/avatar-strategy-rpc.test.mjs`

**Interfaces:**
- Consumes: Task 6 `scanner-cli.uc` subcommands and Task 8 result/save responses.
- Produces: ubus methods `scanner_start`, `scanner_status`, `scanner_results`, `scanner_stop`, `scanner_resume`, and `scanner_save_generated` under the existing `zapret2-manager` object, with explicit ACL entries.

- [ ] **Step 1: Add RED RPC/ACL tests.** Assert exact method names/signature shape, read/write ACL membership, private bounded `edit` temp-file transport, no raw command/args fields, bounded response handling, and propagation of Scanner error/recovery states.

- [ ] **Step 2: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-rpc.test.mjs tests/product/avatar-strategy-rpc.test.mjs
  ```

  Expected: FAIL because Scanner methods and ACL entries are absent.

- [ ] **Step 3: Implement thin RPC wrappers.** Follow the existing Strategy `strategy_edit_action` pattern: validate string payload size, create a private temp file, call only a fixed CLI subcommand, bound output, parse JSON, remove the temp file, and return the child response. Do not add business logic to rpcd.

- [ ] **Step 4: Add ACL entries.** Add Scanner status/results to read methods and start/stop/resume/save-generated to write methods. Do not alter DNS, Telegram, Orchestra, or unrelated ACL entries.

- [ ] **Step 5: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-rpc.test.mjs tests/product/avatar-strategy-rpc.test.mjs
  ```

  Expected: PASS with exact ubus signature and ACL reachability.

- [ ] **Step 6: Commit.**

  ```sh
  git add zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json tests/product/avatar-strategy-scanner-rpc.test.mjs tests/product/avatar-strategy-rpc.test.mjs
  git commit -m "feat: expose Scanner through ubus and ACL"
  ```

### Task 10: LuCI Strategy integration

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- Create: `tests/product/avatar-strategy-scanner-ui.test.mjs`
- Modify: `tests/product/avatar-strategy-ui.test.mjs`

**Interfaces:**
- Consumes: Task 9 ubus methods and Task 8 stable result/Strategy handoff references.
- Produces: `Scanner.load(ctx)`, `Scanner.render(ctx)`, `Scanner.mount(ctx)`, `Scanner.unmount()`, lifecycle-safe polling, and the existing Strategy Preview/Validate/Apply handoff.

- [ ] **Step 1: Add RED UI assertions.** Assert target/protocol/mode/resume/DPI controls, start/stop states, progress/current phase/current candidate, counts/elapsed/baseline, working/failed evidence, best reference, generated Save action, existing Strategy handoff, no raw command construction, and timer cleanup on unmount.

- [ ] **Step 2: Run RED.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-ui.test.mjs tests/product/avatar-strategy-ui.test.mjs
  ```

  Expected: FAIL because `z2m-scanner.js` and its Strategy-page integration are absent.

- [ ] **Step 3: Implement the Scanner view.** Reuse current Strategy page shell/components. Keep controls disabled while running, show cancellation as request accepted, render explicit `error/uncertain` recovery, and use server-owned IDs. Unknown bounded DPI is sent as a validated request value and never converted into command args.

- [ ] **Step 4: Implement lifecycle-safe polling.** Poll status at a bounded interval, fetch results only for terminal/cancelled/error states, cancel timers and ignore late responses in `unmount()`, and avoid fabricated progress or local result sorting.

- [ ] **Step 5: Implement handoff actions.** Existing Strategy references open the current Preview/Validate/Apply flow. Unmatched generated results call Save as Strategy and then refresh the authoritative Strategy list. No Scanner Apply button writes runtime.

- [ ] **Step 6: Run GREEN.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-ui.test.mjs tests/product/avatar-strategy-ui.test.mjs
  ```

  Expected: PASS with no global navigation or visual redesign changes.

- [ ] **Step 7: Commit.**

  ```sh
  git add luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js tests/product/avatar-strategy-scanner-ui.test.mjs tests/product/avatar-strategy-ui.test.mjs
  git commit -m "feat: integrate Scanner into Strategy LuCI"
  ```

### Task 11: Package, integration, parity closure, and final gates

**Files:**
- Create: `tests/native/avatar-strategy-scanner-package.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`
- Modify: `tests/native/avatar-strategy-package.test.mjs`
- Modify: `docs/architecture/avatar-parity.md`
- Modify: `README.md` only if the existing package/test documentation requires the shipped Scanner surface to be discoverable; otherwise no README change is made.

**Interfaces:**
- Consumes: all Task 1–10 Scanner modules, RPC/ACL, LuCI assets, package wildcard installation behavior, and the approved spec.
- Produces: package inventory evidence, integration evidence, final parity classification, and the complete whole-slice verification record.

- [ ] **Step 1: Add RED package/integration assertions.** Assert every new top-level ucode module is copied by the backend package, every Scanner LuCI asset is copied by the LuCI wildcard, ACL/RPC names are packaged, no DNS/Telegram files are changed, and Strategy Apply remains the only permanent Apply path.

- [ ] **Step 2: Run RED.**

  ```sh
  node --test tests/native/avatar-strategy-scanner-package.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/native/avatar-strategy-package.test.mjs
  ```

  Expected: FAIL until package/integration assertions and parity evidence are complete.

- [ ] **Step 3: Implement package evidence.** Extend package tests to inspect the existing Makefile wildcard rules and installed modes. Do not add a package dependency unless an existing fixed probe adapter proves it is required; do not alter DNS/TG package assets or physical-router behavior.

- [ ] **Step 4: Run GREEN focused integration.**

  ```sh
  node --test tests/native/avatar-strategy-scanner-package.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/native/avatar-strategy-package.test.mjs tests/product/avatar-strategy-scanner-rpc.test.mjs tests/product/avatar-strategy-scanner-ui.test.mjs
  ```

  Expected: PASS with bounded full-list/result payload measurements and unchanged Strategy Apply ownership.

- [ ] **Step 5: Update parity evidence.** Update `docs/architecture/avatar-parity.md` only with behavior demonstrated by fixtures/tests. Classify each surface as `PARITY`, `PARTIAL`, `MISSING`, `DIVERGENT`, or `INTENTIONAL_DEVIATION`. Record no unsupported router claim and state `ROUTER_E2E: NOT RUN` because no router approval was provided.

- [ ] **Step 6: Run final focused suites.**

  ```sh
  node --test tests/product/avatar-strategy-scanner-*.test.mjs tests/product/avatar-strategy-*.test.mjs tests/native/avatar-strategy-scanner-*.test.mjs tests/native/avatar-strategy-*.test.mjs
  ```

  Expected: PASS with zero Scanner regressions and zero Strategy regressions.

- [ ] **Step 7: Run the canonical full gate once.**

  ```sh
  scripts/test/native.sh
  ```

  Expected: PASS on Linux with its embedded root suite; do not invoke `scripts/test/native-root.sh` separately.

- [ ] **Step 8: Run final static and scope checks.**

  ```sh
  git diff --check
  git diff --name-only 359ce10b4b3b3830fe5cabd73036e69dbdbfc78b..HEAD
  git status --short
  git log --oneline -12
  ```

  Expected: only approved Scanner files/docs are changed; DNS changes = 0, Telegram changes = 0, and no router mutation evidence exists.

- [ ] **Step 9: Perform final whole-slice review.** Use `superpowers:requesting-code-review` and `superpowers:verification-before-completion`. Critical findings must equal 0 and Important findings must equal 0. Reconcile every task report and final test command before claiming completion.

- [ ] **Step 10: Commit.**

  ```sh
  git add tests/native/avatar-strategy-scanner-package.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/native/avatar-strategy-package.test.mjs docs/architecture/avatar-parity.md
  git commit -m "test: close Avatar Strategy Scanner parity"
  ```

## Spec Coverage Table

| Approved spec requirement | Plan coverage |
| --- | --- |
| Pinned Avatar evidence and source provenance | Task 1 fixtures and Task 11 parity evidence |
| Post-pin deltas and deviation classes | Task 1 fixture metadata and Task 11 parity report |
| Separate Scanner product domain | Tasks 2, 6, 9; no Orchestra module ownership |
| Request/target validation | Task 2 |
| Quick/standard/full candidate planning | Task 3 |
| Full-preset/recommended/complexity ordering and deduplication | Task 3 |
| Generated candidates and exact canonicalization | Tasks 3 and 8 |
| Unknown bounded DPI no-filter behavior | Tasks 2, 3, 10, and 11 |
| Known DPI skip-types | Tasks 2, 3, and 11 |
| Target profiles and alternate hosts | Tasks 2 and 4 |
| IPv4/IPv6 baseline | Task 4 |
| TCP TLS/body semantics | Task 4 |
| UDP STUN-only semantics | Task 4 |
| Timeouts, latency, partial success, failure classes | Task 4 |
| Server-side compilation and preflight | Task 5 |
| Transient runtime/firewall ownership | Task 5 |
| Per-candidate owned-artifact cleanup | Task 5 |
| One-time terminal restoration | Task 7 |
| Cancellation verified/uncertain terminal contract | Tasks 2, 6, and 7 |
| Worker identity, crash recovery, stale worker | Tasks 6 and 7 |
| Volatile state, bounded checkpoints, resume | Task 6 |
| Uncertain shared runtime Apply block | Task 7 and Task 8 |
| Results, evidence, ranking, best Strategy | Task 8 |
| Existing Strategy Preview/Validate/Apply handoff | Task 8 and Task 10 |
| Thin RPC and ACL | Task 9 |
| LuCI Scanner controls and lifecycle cleanup | Task 10 |
| Package integration and payload bounds | Task 11 |
| DNS/TG/router exclusions | Global constraints, Task 11 scope checks |
| Focused/native/root verification | Checkpoints A/B and Task 11 |
| Approximately 11 SDD tasks | Tasks 1–11 |

## Review and commit policy

Every task ends with focused RED/GREEN evidence, `git diff --check`, a fresh
task review, and one task commit. Tasks 5 and 7 retain the full high-risk review
and fix-loop budget. Low-risk tasks do not run the full native suite. The broad
whole-slice review runs once in Task 11.

No physical-router command is part of any task. The final report must state:

```text
ROUTER_E2E: NOT RUN
REASON: explicit physical-router mutation/deployment approval was not provided
```
