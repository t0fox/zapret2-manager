# Z2K Recovery Design

Date: 2026-09-08

Status: approved design, implementation not started

Reviewed baseline: `main` at `9a4f0feeacbfd9d107385ffeffb5007b4bfadb39` (`merge: recover coherent Detect lifecycle`)

## 1. Purpose

The previous Z2K coherent-core integration established useful backend foundations, but the resulting product became harder to use and retained duplicated Scanner/runtime concepts. This recovery is not a feature expansion. Its purpose is to preserve the sound lifecycle work, remove obsolete or duplicated layers, repair the broken product contracts, and make the Manager smaller, clearer, and verifiable on a real router and in a real browser.

The guiding outcome is:

- one Z2K Core lifecycle;
- one scanning/detection authority: upstream `z2k-detect`;
- one user-facing Z2K Core representation in Components;
- Z2K resources managed by Core rather than independently;
- browser-visible state that matches backend truth;
- fewer production paths and fewer compatibility shims than the current baseline.

This design deliberately prefers subtraction over further abstraction.

## 2. Recovery principles

### 2.1 Feature freeze

Until this recovery reaches its acceptance gate, changes in scope must be one of:

- fix;
- simplify;
- remove;
- verify.

The recovery must not introduce a new product subsystem, a new lifecycle owner, a new Scanner concept, a new page, or another parallel compatibility layer.

### 2.2 Preserve proven backend foundations

The recovery keeps the parts that already move the system toward a coherent Z2K lifecycle:

- end-to-end support for both historical `r-*` and current `p-*` releases;
- coherent candidate identity across release, exact source commit, manifest, runtime membership, compiler inputs, compiled catalog, Detect artifact, and compatibility identity;
- receipt-v3 installed authority;
- exact architecture-specific `z2k-detect` artifact bound to the same Z2K release identity;
- atomic/LKG update and rollback structure;
- Z2K Strategy source managed by Z2K Core rather than a separate refresh owner;
- current upstream Lua membership rather than stale `z2k-detectors.lua` ownership;
- autocircular semantic-pool identity and targeted learned-state invalidation.

These are recovery inputs, not targets for replacement.

### 2.3 Remove duplicate authorities

No subsystem may keep an alternative semantic implementation merely because it is currently unwired. If upstream `z2k-detect` is the scanner/detection authority, old native Scanner probing logic must be removed once call-graph evidence proves no required production consumer remains.

Likewise, Components must not expose one compact Z2K card plus a second large Z2K management dashboard. Resources must not expose an independent Z2K update lifecycle. Browser presentation must not become a second source of truth over backend runtime state.

### 2.4 Product proof outranks static proof

Node/VM tests, syntax checks, schema tests, and unit tests remain necessary, but they are not sufficient for user-visible work.

Any task that changes Components, Resources, Scanner, update progress, RPC wiring, or browser state is not VERIFIED until the real LuCI page has been loaded against the deployed current build and the relevant state transition has been observed.

## 3. Current review findings that this design addresses

The recovery is based on a code review of the current `main`, not on implementation reports alone.

### 3.1 Good foundations to retain

`z2k-coherent-candidate.uc` now computes a semantic compatibility identity from exact release/source/runtime/compiler/catalog/Detect evidence and rejects mixed revisions. `z2k-autocircular-identity.uc` adds Manager-side semantic pool identity without changing the upstream TSV format. `z2k-detect.uc` now builds command-specific upstream argv rather than a generic scanner command shape.

### 3.2 Broken discovery RPC boundary

The current LuCI API sends `dnsSource`, and the backend handler can read `req.args`, but the rpcd method registrations for discovery enable/disable/restart do not declare the expected `dnsSource` argument. The recovery treats this as a product-level P0 regression and requires an actual ubus/browser proof, not only a method-name test.

### 3.3 Old Scanner was only partially retired

The UCode planner/worker/probe implementation was removed, but native `scanner_probe` logic and its legacy profile/probe protocol remain in the core helper and protocol surface. That leaves two Scanner generations in production code even though only Detect should own scanning semantics.

### 3.4 Scanner UI still models the retired Scanner

The current Scanner UI preserves generic fields such as one Detect-action selector, protocol selection, and `quick/standard/full` depth concepts. Those are Manager-side abstractions inherited from the old Scanner rather than the natural command model of upstream `z2k-detect`.

### 3.5 Components exposes duplicate Z2K product surfaces

The page has a compact Z2K Core card and an additional large `УПРАВЛЕНИЕ РЕСУРСАМИ` section exposing snapshot, dependency graph, runtime-bundle, compiler-input, registry, and provenance details as normal product UI. This is technically useful evidence presented at the wrong level and makes the page look like an internal diagnostics console.

### 3.6 Test coverage is too implementation-shaped

Several UI tests assert the presence of implementation concepts rather than user outcomes. For example, Scanner tests require `Действие Detect`, which freezes the generic selector rather than proving that each upstream Detect operation has the correct product form and RPC contract.

The recovery replaces such assertions with behavior-oriented acceptance.

## 4. Target ownership model

The target system has these authorities:

```text
Z2K Core lifecycle authority
  -> exact release/source/manifest identity
  -> runtime assets and consumed data
  -> official strategy compiler inputs
  -> compiled official strategy catalog
  -> exact architecture-specific z2k-detect
  -> receipt-v3 + compatibility identity
  -> autocircular pool semantic identity

z2k-detect authority
  -> probe
  -> classify
  -> quic
  -> voice
  -> tcp16
  -> run / automatic discovery

Manager product authority
  -> LuCI presentation
  -> RPC permission and typed request boundary
  -> Core install/update/reinstall/repair/downgrade orchestration
  -> procd ownership of long-running Detect discovery
  -> persistence and rollback
  -> product error translation
```

There is no second DPI classifier and no second strategy-scanning engine.

## 5. Z2K Core lifecycle contract

A Z2K Core version is one coherent bundle. The conceptual identity is:

```text
Z2K Core release
  = release family/version
  + exact sourceCommit
  + manifest seq/hash
  + current consumed runtime Lua/assets/lists
  + compiler inputs
  + compiled official strategies
  + architecture-specific z2k-detect
  + compatibilityIdentity
```

The lifecycle must support install, upgrade, reinstall, repair, and downgrade through one transaction model.

A candidate may activate only after all required members are staged and verified against the same release identity. Detect absence, hash mismatch, unsupported architecture, compiler/runtime mismatch, incomplete dependency closure, failed native preflight, or identity disagreement must fail closed before activation whenever possible.

If failure occurs after mutation begins, rollback restores the previous LKG owners. The UI must report rollback outcome separately from the initiating error rather than collapsing both into a generic failure.

Z2K strategies are not independently refreshable. Resources may display their state and provenance, but mutation belongs to Core.

## 6. Scanner product redesign

The existing Scanner page remains the product entry point, but it becomes a thin frontend for upstream Detect rather than a generic Manager scanning framework.

### 6.1 Primary operations

The page exposes five explicit operations:

- `Проверка сайта` -> `z2k-detect probe`;
- `Анализ DPI` -> `z2k-detect classify`;
- `QUIC` -> `z2k-detect quic`;
- `Discord Voice` -> `z2k-detect voice`;
- `TCP16` -> `z2k-detect tcp16`.

There is no generic `Действие Detect` select control and no global TCP/UDP selector.

### 6.2 Command-specific forms

Each operation renders only the fields in the current Manager-to-Detect adapter contract:

- `probe`: `domain`, `timeoutMs`;
- `classify`: `host`, `port`, `hello`, `repeats`, `timeoutMs`;
- `quic`: `domain`, `port`, `repeats`, `timeoutMs`;
- `voice`: `repeats`, `timeoutMs`;
- `tcp16`: `timeoutMs`.

The UI may apply bounded defaults, but it must not fabricate shared generic Scanner fields. In particular, `voice` has no domain field and `tcp16` has no host/port fields.

Less common upstream options are outside this recovery unless they already exist in the supported adapter contract. Adding them later requires a separate design rather than expanding this recovery opportunistically.

`voice` explains that a live Discord voice call must exist and invokes the live-call diagnostic directly. `EDETECT_NO_ACTIVE_VOICE` is rendered as a specific next-step state rather than a generic failure.

### 6.3 Results

Results are normalized for readability but preserve canonical Detect evidence and error codes. The Manager must not reinterpret a Detect failure as a result from the retired Scanner or silently fall back to another engine.

If raw JSON is already available as technical evidence it may remain under an explicit details affordance; this recovery does not add a new raw-output feature.

### 6.4 Automatic discovery

Automatic discovery is a separate compact status/control block using Detect `run` under procd ownership.

It shows:

- enabled/disabled;
- actual validated process state;
- DNS source (`auto`, `agh`, `dnsmasq`, or `pkt`);
- discovered-domain count and last modification time where available;
- a concise canonical error and retry/control action.

The browser RPC contract and rpcd method signatures must agree exactly on `dnsSource`.

## 7. Complete retirement of the old Scanner

The recovery must prove and then remove the legacy native Scanner path, including obsolete production protocol and helper surface where no remaining consumer exists.

The removal candidate set includes:

- `scanner_probe` operation from the native protocol;
- `z2m_scanner_probe` implementation;
- legacy profile/probe validation used only by that operation;
- old TLS/body/STUN scanner execution code;
- old `quick/standard/full` scanner semantics;
- scanner-specific cancellation state that is unused outside the retired path;
- protocol-v1 schema entries and native-helper response handling used only by `scanner_probe`;
- obsolete package/build/test references that exist only to preserve that operation.

Removal is conditional on an explicit call-graph/package proof. Required shared primitives must stay if used by non-Scanner features.

The success criterion is stronger than "unwired": a production code search must show no old Scanner semantic authority remaining.

## 8. Components redesign

Components shows exactly one Z2K Core product card.

### 8.1 Default healthy state

The compact card presents only user-relevant facts, for example:

```text
Z2K Core                                  Работает
p-82.x

Стратегии          официальные стратегии
Z2K Detect         Работает · arm64
Runtime            6 Lua · blobs · lists
Автообнаружение    Включено/Выключено
Совместимость      Синхронизировано

[Подробнее]
```

Exact counts and architecture are rendered from canonical runtime data. Exact wording may follow existing Manager vocabulary, but the information hierarchy is fixed: status first, actionable facts second, technical evidence hidden by default.

### 8.2 Update state

When an update is available, the same card shows installed and available versions plus the single appropriate lifecycle action. It does not render a second management card below it.

### 8.3 Broken or incoherent state

The card must distinguish at least:

- missing/not installed;
- degraded/incoherent;
- broken/repair required;
- update available;
- operation in progress;
- rollback/recovery result.

No UI path may claim `Работает` when canonical runtime/Detect coherence is missing.

### 8.4 Technical details

The current detailed evidence is not discarded. Runtime bundle digest, compatibility identity, source commit, manifest information, dependency closure, compiler inputs, Registry/provenance, and release compare evidence may live under `Подробнее -> Технические детали`.

They are diagnostic evidence, not the primary product hierarchy.

The separate normal-flow `УПРАВЛЕНИЕ РЕСУРСАМИ` Z2K section is removed.

## 9. Resources redesign

Resources remains the inventory/provenance page, not a second lifecycle controller.

Z2K displays a compact managed state such as:

```text
Z2K
p-82.x
официальные стратегии
Управляется Z2K Core
```

There is no independent Z2K refresh/update button, and `Обновить все` does not mutate the Z2K Core-managed source outside the Core transaction.

Avatar remains independently refreshable because it is a separate source and owner.

Registry internals may be inspectable where useful, but they must not be promoted into a parallel user workflow.

## 10. RPC and error-boundary requirements

Every browser-facing Detect method must have a single typed contract shared by:

- LuCI declaration;
- rpcd method args;
- ucode input normalization;
- native helper invocation;
- result schema;
- UI error normalization.

Static presence of a method name is not sufficient coverage.

For each method, tests must prove valid input succeeds through the boundary and invalid/extra input fails with the expected typed error.

Canonical Detect errors remain stable, including at least:

- `EZ2K_NOT_INSTALLED`;
- `EZ2K_INCOHERENT`;
- `EDETECT_UNAVAILABLE`;
- `EDETECT_INCOMPATIBLE`;
- `EDETECT_TIMEOUT`;
- `EDETECT_FAILED`;
- `EDETECT_SCHEMA`;
- `EDETECT_NO_TARGET`;
- `EDETECT_NO_ACTIVE_VOICE`.

Unknown errors normalize to a bounded generic Detect failure without inventing legacy Scanner fallback semantics.

## 11. Update product workflow

Lifecycle verification is organized around complete user workflows rather than isolated functions.

The required operation matrix is:

- check current state;
- install;
- upgrade;
- reinstall;
- repair;
- downgrade;
- failure before commit;
- failure after activation with rollback;
- page reload during or after an operation;
- browser reopened after completion.

For every mutation the observable chain is:

```text
browser action
  -> typed RPC request
  -> accepted operation / operationId where asynchronous
  -> backend transaction
  -> durable receipt/runtime state
  -> operation result
  -> browser refresh from canonical state
```

The UI must never depend on an optimistic local state to decide the final result. After mutation it re-reads canonical Core state.

No successful operation may leave an endless spinner, stale selected release, contradictory installed/available version, or a hidden rollback failure.

## 12. Test and verification strategy

### 12.1 TDD for code changes

Every bugfix/removal starts with a failing test or a reproducible current failure. The test must describe the product contract, not merely match implementation strings.

### 12.2 Focused automated gates

The implementation plan will define exact suites, but coverage must include:

- release and coherent-candidate identity;
- receipt-v3 and rollback;
- current upstream runtime membership;
- Detect artifact selection/staging/activation;
- every Detect RPC input and result contract;
- discovery enable/disable/restart with `dnsSource` at the real rpcd signature layer;
- Scanner UI operation-specific forms;
- Components single-card states;
- Resources managed-source ownership;
- old Scanner production closure/removal;
- package/projection closure;
- update browser-state model.

### 12.3 Router gates

Router verification is required for production-runtime claims. At minimum it must prove:

- the intended package/build is actually installed;
- rpcd exposes the expected Detect methods and signatures;
- `z2k-detect` is the exact architecture-specific installed Core artifact;
- one-shot `probe` works on the router;
- `classify` and `quic` can execute through Manager RPC;
- `voice` produces the correct no-call result when no live call exists and is tested against a live call when user input is available;
- discovery enable/status/disable/restart work under procd and publish to the intended discovered-domain list;
- lifecycle state survives rpcd/service/browser reloads;
- old `scanner_probe` is absent after its removal task;
- Z2K Core and active traffic remain healthy after update/rollback acceptance.

### 12.4 Browser gates

For every user-visible task, real LuCI browser verification is part of the task definition.

The final browser matrix must cover at least:

- healthy Core;
- update available;
- in-progress mutation;
- failed mutation with rollback result;
- broken/incoherent Core;
- Scanner each operation;
- Scanner canonical errors;
- discovery enabled/running/disabled/error;
- Resources Z2K managed state;
- Avatar independent resource state;
- hard reload and revisit after mutation.

Screenshots or equivalent captured browser evidence must show the actual deployed build, not static mock HTML.

## 13. Size and complexity reduction

After functional recovery is stable, run a dedicated reduction pass. It is part of the recovery, not optional polish.

Capture before/after measurements for:

- APK size;
- installed package size where measurable;
- native helper binary size;
- production JS size;
- production UCode size;
- production file count.

Primary removal targets are:

- old native Scanner implementation/protocol;
- dead RPC methods;
- dead Scanner CSS and JS state;
- duplicate Z2K Components rendering;
- obsolete compatibility fallbacks no longer required after migration proof;
- test-only seams accidentally retained in production paths;
- duplicated lifecycle projection logic where one canonical projection can replace it safely.

The hard requirement is that recovery must not increase the final APK relative to the captured recovery baseline. The preferred outcome is a measurable decrease, especially in the native helper after old Scanner removal.

No deletion is justified solely by byte count if it weakens rollback, integrity, or diagnosability.

## 14. Migration and rollout shape

Implementation is performed as small verified slices rather than another long all-at-once branch.

The implementation plan must sequence work so that each slice leaves the current branch testable and understandable. The broad dependency order is:

1. establish recovery ledger and current baseline evidence;
2. repair the P0 RPC/product regressions;
3. lock typed Detect contracts with behavior tests;
4. migrate Scanner UI to command-specific upstream semantics;
5. simplify Components to one product card while preserving hidden technical evidence;
6. simplify Resources ownership presentation;
7. prove old native Scanner call graph is dead and remove it completely;
8. close lifecycle/browser state regressions across install/update/reinstall/repair/downgrade/rollback;
9. run reduction pass;
10. run full automated, router, and browser acceptance;
11. independent final code review;
12. only then decide merge.

This list is architectural ordering only. Exact files, commands, RED/GREEN tests, commit boundaries, and acceptance evidence belong in the implementation plan created after this spec is approved.

## 15. Execution discipline

The implementation plan must maintain a durable task ledger with only these effective states:

- `TODO`;
- `WORKING`;
- `VERIFIED`;
- `BLOCKED_USER`.

An engineering problem is never `BLOCKED_USER`. Failed tests, refactoring difficulty, uncertainty, missing implementation, broken build tooling, router regressions, and review findings remain `WORKING` until resolved.

A true user-only blocker must be recorded exactly as:

```text
REQUIRED_USER_INPUT: <specific input/action>
WHY_ONLY_USER_CAN_PROVIDE_IT: <why repository/router engineering cannot provide it>
[goal:blocked]
```

A task may move to `VERIFIED` only when all gates specified for that task have evidence. The agent must not advance to the next dependent task on the basis of a progress narrative alone.

Implementation commits should be narrow and attributable to one recovery slice. No automatic final merge is permitted. Final merge remains a separate decision after independent review and acceptance evidence.

## 16. Non-goals

This recovery does not:

- add new Z2K algorithms;
- reimplement `z2k-detect` in UCode/C;
- add a second strategy scanner or brute-force catalog engine;
- import the upstream Z2K webpanel;
- import Keenetic/NDM init ownership;
- run the upstream updater beside Manager lifecycle;
- make WARP, Telegram proxy, or other optional products part of Z2K Core;
- redesign the entire Manager visual system;
- expose internal Registry/runtime evidence as the normal workflow;
- broaden the project with unrelated refactoring.

## 17. Final acceptance criteria

The recovery is complete only when all of the following are true:

1. Components shows one Z2K Core product surface and no duplicate normal-flow management dashboard.
2. Resources shows Z2K as managed by Core and does not expose an independent Z2K mutation path.
3. Scanner exposes the five upstream Detect operations as command-specific product actions with no generic legacy Scanner depth/protocol model.
4. Discovery enable/disable/restart works through real rpcd/ubus/LuCI with the same `dnsSource` contract at every layer.
5. Old native `scanner_probe` semantics and their exclusive protocol/helper code are absent from production after call-graph proof.
6. Coherent Core lifecycle retains exact release/source/runtime/compiler/catalog/Detect identity and receipt-v3 authority.
7. Install, upgrade, reinstall, repair, downgrade, pre-commit failure, and post-activation rollback are verified as complete user workflows.
8. Browser hard reload/revisit always reconstructs the correct state from backend authority.
9. Real router acceptance proves installed Detect, one-shot operations, discovery service lifecycle, runtime health, and rollback behavior.
10. Discord Voice is verified against a live user call when that user-only prerequisite is supplied; lack of a call must produce the specific no-active-voice state rather than block unrelated recovery work.
11. The full repository harness is green in the canonical supported test environment. Environment or worktree setup failures must be fixed or reproduced in the canonical environment; they cannot be relabeled as a product PASS. No merge is allowed with a failing product suite.
12. Final package size does not exceed the captured recovery baseline, with a preferred measurable reduction.
13. Independent final code review finds no duplicate lifecycle/scanner authority, no known P0/P1 product regression, and no unverified user-visible claim.
14. Merge happens only after the user reviews the final evidence and explicitly chooses to merge.

## 18. Chosen recovery approach

The selected approach is selective recovery rather than full rollback or incremental patching over the current product surface.

We keep the coherent backend foundation, remove obsolete Scanner and duplicate UI layers, repair the real RPC/update/browser failures, and require live product evidence at each stage.

This is the shortest path to a smaller and more trustworthy Manager because it preserves the expensive parts that are structurally sound while refusing to preserve accidental complexity merely because it was already implemented.
