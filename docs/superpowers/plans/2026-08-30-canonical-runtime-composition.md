---
id: z2m-canonical-runtime-composition
title: "Canonical Runtime Composition and Resource Ownership"
type: plan
status: planned
authority: approved-plan
updated: 2026-08-30
publish: false
tags: [z2k, asset-registry, runtime-composition, lifecycle, strategy, scanner]
---

# Canonical Runtime Composition and Resource Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split Z2K runtime inventories with one content-bound resolver and complete the installed/candidate lifecycle transaction without allowing stale Registry, package, process, or Strategy evidence to authorize mutation.

**Architecture:** Add one pure UCode `runtime-composition.uc` resolver with `resolveInstalled()` and `resolveCandidate(preparedTarget)` lifecycle inputs, plus a bounded CLI for shell consumers. Keep Asset Registry as the only byte/metadata writer, split candidate bundle commit from v2 receipt finalization, and record durable pending-activation evidence before the first irreversible Registry commit. Migrate native preflight, runtime synchronization, scanner, install proof, and Strategy Apply to the resolver while preserving the existing update-source and profile-apply owners.

**Tech Stack:** OpenWrt UCode, POSIX/BusyBox shell, `asset-registry.uc`, existing `update-source.uc`, nfqws2 native dry-run/intercept checks, Node.js `node:test`, and real LuCI/ubus router acceptance.

**Spec:** `docs/superpowers/specs/2026-08-30-canonical-runtime-composition-design.md`

## Global Constraints

- Use one content-bound runtime composition snapshot; do not interpret “all current Registry rows” as a selected closure.
- `resolveInstalled()` consumes confirmed installed authority; `resolveCandidate(preparedTarget)` consumes a FRESH prepared target and does not require an installed receipt.
- Every resolver result exposes `observedRegistryRevision`, `compositionStatus`, `lifecycleIdentity`, and `receiptIdentity` when applicable. `installedAuthorityRevision` is the revision bound into the confirmed installed receipt and is deliberately distinct from the Registry revision observed during this read/CAS.
- Separate expected-closure resolution from `verifyMaterialized`, `verifyActivationProcess`, and `verifyInstalledProcess`.
- Every canonical entry has explicit `kind`/`type`; `runtimeAssets[]`, `luaInit[]`, `dependencyIndex`, and `scannerOverlay[]` remain distinct. The common entry schema does not require lifecycle-only `version`/`sourceCommit` on `package-static` entries; lifecycle-managed provenance fields are required only for lifecycle-managed entries.
- `runtimeAssets[]` is the full selected runtime inventory; only ordered Lua entries enter `luaInit[]`; blobs, lists, and ipsets never enter `luaInit[]`.
- The existing same-version operation is `reinstall`; V1 migration reuses that path and never creates a separate migration updater.
- A candidate prepared at `baseRegistryRevision=N` is rejected for an unrelated pre-commit revision change, but its own successful commit to `committedAssetRevision=N+1` is expected and does not stale the candidate.
- `asset_registry_apply_bundle()` commits candidate assets only; `finalizeActivation()` is the only installed-authority promotion boundary.
- Durable pending-activation evidence must exist before the first irreversible candidate Registry commit; `/tmp` `resource-update-worker` job state alone is insufficient.
- `asset-activation-receipt.v1` may expose only `V1_VERIFIED_MEMBERSHIP`; it must not invent runtime order, role, or historical classification from mutable package metadata.
- V1 reconciliation uses authoritative FRESH resolution of the same version/sourceCommit, exact membership comparison, and normal same-release `reinstall` transaction.
- Activation proof requires a process created for this activation; steady-state proof accepts a later PID/starttime when current closure/config/runtime/readiness match.
- `strategies_validate` is diagnostic only; `strategies_apply` performs its own server-side resolve, native preflight, and final CAS before `profiles_apply_candidate()`.
- Scanner overlay is diagnostic-only and never becomes production Registry membership or production `--lua-init` input.
- BROWSE is cache/LKG presentation, REFRESH is explicit checking, and FRESH is the only mutation/prepare authority.
- Global Update Source remains the sole authority for Z2K metadata and BROWSE/REFRESH/FRESH resolution. Preserve the existing immutable SHA-bound mutation asset fetch unless a concrete audit proves that fetch defective; this plan forbids only new metadata/direct-fetch bypasses.
- Candidate materialization has one explicit boundary: `runtime-composition-cli --consumer=candidate-materialize` consumes a prepared target through `resolveCandidate()`; `--consumer=installed-materialize` consumes `resolveInstalled()`; `--consumer=postflight` verifies evidence only and is never an implicit candidate API. Shell consumers may not enumerate local files, maintain a fallback list, or silently switch consumers.
- Materialization follows ownership: `package-static` entries come from verified package sources, lifecycle-managed entries come from Registry-selected sources, and removals come only from the candidate declaration. Not every `runtimeAssets[]` entry is Registry-owned.
- Package synchronization never resurrects a lifecycle-managed Z2K asset when installed authority is unknown.
- Preserve Strategy, autocircular, Engine, Scanner, and unrelated Resource owners; do not create a second updater, Registry, CHECK_STATE, or resource store.
- No APK, deployment, router mutation, or implementation push is part of this planning step.

## File Map

### Create

- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc` — sole pure resolver and expected/runtime/process verification contracts.
- `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-cli.uc` — bounded JSON adapter with explicit `candidate-materialize`, `installed-materialize`, `scanner`, `install-proof`, and verification-only `postflight` consumers.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-lifecycle-recovery.uc` — boot/recovery entry point for durable pending activation evidence.
- `tests/product/z2k-runtime-composition.test.mjs` — RED/green resolver, closure, explicit kind/type, and verification behavior.
- `tests/product/z2k-lifecycle-transaction.test.mjs` — RED/green commit/finalize/CAS/durable-recovery behavior.
- `tests/product/z2k-v1-reconciliation.test.mjs` — RED/green legacy receipt capability and same-release FRESH migration behavior.

### Modify

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc` — v1 compatibility state and v2 installed authority validation; no guessed composition.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc` — retain catalog/detail presentation and FRESH target identity resolution while delegating canonical lifecycle membership to the resolver.
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc` — expose the existing Update Source-backed FRESH manifest/target inputs without adding a parallel resolver or transport.
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc` — separate candidate bundle commit from receipt finalization and return exact committed revision.
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc` — candidate prepare/apply orchestration, durable phase journal, Update Source candidate fetches, postflight, recovery, and CHECK_STATE reconciliation.
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc` — mirror lifecycle phases for asynchronous UI status while treating `/tmp` job state as non-authoritative.
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc` — invoke the installed resolver-backed materialization boundary.
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh` — remove static Lua arrays/existence fallback and materialize the bounded resolver output.
- `zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc` — consume resolver `runtimeAssets[]`/`luaInit[]`, then prove the exact native command with exact closure.
- `zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json` — keep static engine capability evidence separate from dynamic Z2K Lua membership.
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc` — provide resolver-owned live runtime context and server-side Strategy Apply snapshot checks.
- `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc` — enforce the Strategy Apply preflight/final installed-snapshot CAS without trusting client snapshot IDs.
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` — accept resolver-produced scanner inputs/overlay without making the overlay production state.
- `zapret2-manager/files/etc/init.d/zapret2-manager` — run bounded pending-activation recovery before starting manager-owned daemons.
- `tests/product/z2k-installed-release-authority.test.mjs` — replace historical-classification capability assumptions with explicit V1 limits and v2 promotion assertions.
- `tests/product/z2k-final-lifecycle-ownership.test.mjs` — assert resolver ownership, two-phase Registry promotion, and no direct Z2K fetch bypass.
- `tests/product/z2k-target-lifecycle-contract.test.mjs` — assert candidate identity, base/committed revisions, and resolver-bound prepare/apply.
- `tests/product/z2k-update-transaction.test.mjs` — assert transaction ordering, target fetch authority, and no receipt before postflight.
- `tests/product/z2k-materialization.test.mjs` — extend shell materialization and process/config evidence coverage.
- `tests/product/z2k-runtime-target-luaopt.test.mjs` — replace static load-chain expectations with ordered resolver output.
- `tests/product/z2k-runtime-postflight-size.test.mjs` — assert runtime bytes and explicit entry metadata verification.
- `tests/product/z2k-runtime-readiness.test.mjs` — assert activation and later steady-state process proof separately.
- `tests/product/z2k-post-mutation-check-state.test.mjs` — preserve pure local CHECK_STATE replanning after successful mutation.
- `tests/product/z2k-async-lifecycle.test.mjs` — assert durable journal linkage and asynchronous phase projection.
- `tests/product/z2k-candidate-compatibility.test.mjs` — preserve pure candidate compatibility gate behavior.
- `tests/product/z2k-canonical-plan-contract.test.mjs` — preserve canonical plan/check token and no-live-status-fetch behavior.

## Implementation Tasks

### Task 0: Capture baseline and lock the implementation boundary

**Files:**
- Read only: the File Map above and `docs/superpowers/specs/2026-08-30-canonical-runtime-composition-design.md`.
- Test baseline: the existing `tests/product/z2k-*.test.mjs` files listed below.

**Interfaces:**
- Consumes: `main` at `IMPLEMENTATION_BASE_SHA=f9f2c399`, with the approved design recorded at `SPEC_SHA=2ae23ee4`. A later docs-only plan-review descendant is valid; do not require HEAD to equal `SPEC_SHA`.
- Produces: a recorded baseline report; no source changes.

- [ ] **Step 1: Confirm checkout and source baseline**

Run:

```text
git status --short --branch
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
git diff --check
git worktree list
```

Expected: the working tree is clean on `main` at or after `IMPLEMENTATION_BASE_SHA=f9f2c399`, and `git diff --check` is empty. Record the actual HEAD; do not require HEAD to equal `SPEC_SHA=2ae23ee4`. If unrelated user changes appear, preserve them and stop before overlapping files.

- [ ] **Step 2: Run the focused baseline suite**

Run on the configured UCode-capable environment:

```text
node --test --test-concurrency=1 \
  tests/product/z2k-final-lifecycle-ownership.test.mjs \
  tests/product/z2k-installed-release-authority.test.mjs \
  tests/product/z2k-target-lifecycle-contract.test.mjs \
  tests/product/z2k-update-transaction.test.mjs \
  tests/product/z2k-materialization.test.mjs \
  tests/product/z2k-runtime-target-luaopt.test.mjs \
  tests/product/z2k-runtime-postflight-size.test.mjs \
  tests/product/z2k-runtime-readiness.test.mjs \
  tests/product/z2k-post-mutation-check-state.test.mjs \
  tests/product/z2k-async-lifecycle.test.mjs
```

Expected: record exact pass/skip/fail counts and environment variables (`UCODE_BIN`, `UCODE_LIBRARY_PATH`, `UCODE_MODULE_PATH`). A host-only skip is not router evidence.

- [ ] **Step 3: Commit the baseline report separately**

Do not commit generated logs or production changes. Keep the command output in the implementation review notes so every later regression can be compared with the same baseline.

### Task 1: Write RED tests for canonical resolver inputs and closure semantics

**Files:**
- Create: `tests/product/z2k-runtime-composition.test.mjs`
- Create: `tests/product/z2k-v1-reconciliation.test.mjs`
- Modify: `tests/product/z2k-installed-release-authority.test.mjs`
- Modify: `tests/product/z2k-target-lifecycle-contract.test.mjs`

**Interfaces:**
- Consumes: the planned exports `resolveInstalled`, `resolveCandidate`, `verifyMaterialized`, `verifyActivationProcess`, and `verifyInstalledProcess` from `runtime-composition.uc`.
- Produces: failing behavior tests that define the resolver contract before implementation.

- [ ] **Step 1: Add the v2 installed closure RED test**

Build a temporary Registry/classification fixture with one confirmed v2 receipt and entries for one Lua asset, one blob, one list/ipset asset, and a static package baseline. Assert that `resolveInstalled()` returns one deterministic `snapshotId`, one `compositionSnapshotId`, full `runtimeAssets[]`, only Lua entries in ordered `luaInit[]`, and explicit `kind`/`type` on every entry. Assert that `blob`, `list`, and `ipset` entries are absent from `luaInit[]`.

- [ ] **Step 2: Add authority and candidate RED tests**

Cover these exact cases:

```text
v2 receipt + matching Registry                  -> complete installed closure
missing/incomplete/mismatched/extra authority   -> FAIL CLOSED, no package fallback
prepared target with no installed receipt       -> resolveCandidate succeeds
candidate at Registry revision N, current N+1   -> ESTALE before commit
candidate own commit N -> N+1                    -> accepted, not ESTALE
reordered/content-changed entry                 -> snapshot identity changes
```

The candidate assertions must verify `targetVersion`, `targetCommit`, `manifestSha256`, `classificationSha256`, assets/removals, `planToken`, `baseRegistryRevision`, and membership digest are content-bound.

- [ ] **Step 3: Add V1 capability and migration RED tests**

Create `tests/product/z2k-v1-reconciliation.test.mjs` in this task. Assert that a valid v1 receipt yields `V1_VERIFIED_MEMBERSHIP` with `reconciliationRequired=true`, cannot invent runtime order or `luaInit[]` from mutable package classification, and can proceed only through same-release FRESH reconciliation. Add exact-version/sourceCommit mismatch, membership/path/SHA/size/removal mismatch, and successful same-release `reinstall` handoff cases; the latter remains RED until the Task 4 transaction slice exists.

- [ ] **Step 4: Add resolution-versus-verification RED tests**

Assert that a missing runtime file still produces the expected candidate closure and that `verifyMaterialized()` fails with the missing content identity. Assert that authority/receipt/target inconsistency fails during resolution instead of being reported as a runtime-file failure.

- [ ] **Step 5: Run only the new tests and record RED**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-v1-reconciliation.test.mjs
```

Expected: fail because the new resolver/migration exports and behavior do not yet exist. Do not weaken assertions to make the baseline pass.

### Task 2: Implement the pure canonical resolver and CLI

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-cli.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `tests/product/z2k-runtime-composition.test.mjs`

**Interfaces:**
- Consumes: Asset Registry listing, v2 receipt or bounded v1 state, trusted static package baseline, and prepared candidate input.
- Produces: the following exact UCode interface:

```text
resolveInstalled() -> { ok, lifecycleState, compositionStatus,
  lifecycleIdentity, receiptIdentity, snapshotId, compositionSnapshotId,
  installedAuthorityRevision, observedRegistryRevision, runtimeAssets[],
  luaInit[], dependencyIndex, scannerOverlay[], membershipDigest }

resolveCandidate(preparedTarget) -> { ok, lifecycleState: "candidate",
  compositionStatus, lifecycleIdentity, receiptIdentity: null,
  snapshotId, compositionSnapshotId, baseRegistryRevision,
  observedRegistryRevision, runtimeAssets[], luaInit[], dependencyIndex,
  scannerOverlay[], membershipDigest }

verifyMaterialized(snapshot, evidence) -> { ok, ... }
verifyActivationProcess(candidate, activationEvidence) -> { ok, ... }
verifyInstalledProcess(installedSnapshot, processEvidence) -> { ok, ... }
```

- [ ] **Step 1: Implement normalized entry validation**

Require every selected entry to carry the common fields `id`, `type`, `kind`, `role`, `sourcePath`, `runtimeTarget`, `contentSha256`, and `byteSize`, plus `runtimeOrder` where its role requires ordering. Require `version`, `sourceCommit`, `manifestSha256`, and `classificationSha256` only for lifecycle-managed entries; package-static entries must not be assigned guessed lifecycle identity. Reject unknown owner/role/runtime target, invalid digest/size, duplicate IDs, unsafe paths, and noncanonical order. Keep `runtimeAssets[]` as the complete selected inventory.

- [ ] **Step 2: Implement ordered subsets without a provider map**

Derive `luaInit[]` only from entries whose validated type is Lua and whose validated role is `lua-init`; preserve `runtimeOrder`. Build `dependencyIndex` from explicit asset references and `scannerOverlay[]` as a separate non-production list. Do not scan package directories to append files and do not maintain a hand-copied Lua function/provider list.

- [ ] **Step 3: Implement `resolveInstalled()`**

Accept only a self-consistent v2 receipt whose normalized `z2kMembership[]` exactly matches current Z2K Registry membership/provenance/content. Combine it with the independently verified static package baseline to compute `compositionSnapshotId`. A valid v1 receipt returns `V1_VERIFIED_MEMBERSHIP`, `compositionStatus: incomplete`, and recorded legacy membership only; it never fabricates canonical order or classification.

- [ ] **Step 4: Implement `resolveCandidate(preparedTarget)`**

Validate the FRESH prepared target without requiring an installed receipt. Bind target identity, manifest/classification digests, membership/removals, `planToken`, base revision, and generated closure into the candidate snapshot. Keep candidate closure valid across its own expected Registry revision transition; invalidate it only for unrelated changes before commit.

- [ ] **Step 5: Implement the three verification functions**

`verifyMaterialized()` checks runtime target ownership, file existence, SHA, byte size, generated invocation/config evidence, and absence of removals. `verifyActivationProcess()` requires activation-specific process creation/restart evidence, candidate config hash, exact argv Lua order, runtime hashes, and queue readiness. `verifyInstalledProcess()` allows a later PID/starttime after restart/reboot but requires the same installed closure/config/runtime/readiness.

- [ ] **Step 6: Implement the explicit CLI/runtime-sync boundary**

Make `runtime-composition-cli.uc` accept only `candidate-materialize`, `installed-materialize`, `scanner`, `install-proof`, and verification-only `postflight`. `candidate-materialize` requires an explicit prepared-target payload and calls `resolveCandidate(preparedTarget)` before an installed receipt exists; `installed-materialize` calls `resolveInstalled()`; `postflight` accepts a snapshot plus evidence and only verifies it. Reject unknown consumer, oversized output, invalid lifecycle state, and scanner overlay requested as production `luaInit`. Add CLI tests proving the candidate and installed routes are distinct, that postflight never resolves a candidate, and that no shell fallback/list is consulted.

- [ ] **Step 7: Run the resolver suite green**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-runtime-composition.test.mjs
```

Expected: all resolver, kind/type, expected-closure, and process-proof tests pass without network or Registry mutation.

- [ ] **Step 8: Commit the pure resolver slice**

```text
git add zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-cli.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc tests/product/z2k-runtime-composition.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs
git commit -m "feat: add canonical runtime composition resolver"
```

### Task 3: Define Registry receipt contract and RED matrix (no standalone transaction commit)

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `tests/product/z2k-v1-reconciliation.test.mjs`
- Modify: `tests/product/z2k-installed-release-authority.test.mjs`
- Modify: `tests/product/z2k-final-lifecycle-ownership.test.mjs`

**Interfaces:**
- Consumes: candidate snapshot and exact Registry membership from Task 2.
- Produces: RED contracts for asset_registry_apply_bundle returning committedAssetRevision without an installed receipt and asset_registry_finalize_activation appending the v2 receipt atomically. Task 3 does not land a production Registry split; Task 4 implements this contract together with its coordinator and durable journal.

Task 3 and Task 4 are one coherent transaction slice. Task 3 may create or amend the RED tests below, but it must not commit a partially wired asset_registry_apply_bundle/finalizeActivation split. Task 4 carries the Registry implementation, coordinator wiring, durable pending evidence, recovery, and V1 migration into one implementation commit; no compatibility seam is needed.

- [ ] **Step 1: Write RED assertions for two-phase promotion**

Assert that bundle commit changes candidate Registry membership but does not append v1/v2 installed receipt. Assert that finalization requires the exact committed revision, candidate snapshot identity, membership digest, content identities, and activation evidence. Assert that an unrelated Registry change between commit and finalization returns `ESTALE` and does not append an installed receipt.

- [ ] **Step 2: Specify the v2 receipt serialization for the Task 4 slice**

Define the RED fixture and serialization contract for immutable target version/commit, manifest/classification digests, membership digest, normalized Z2K-only z2kMembership[], committed/final Registry revision evidence, and historical activation process evidence. Keep static package baseline outside the Z2K receipt. The production serialization and atomic write are implemented only in Task 4 after durable journal/coordinator wiring is ready.

- [ ] **Step 3: Specify explicit V1 state**

For a valid v1 receipt whose recorded membership matches Registry, return `V1_VERIFIED_MEMBERSHIP` with trusted version/sourceCommit/path/SHA/size and `reconciliationRequired=true`. Allowed before reconciliation: read-only status/inspection, raw recorded path/SHA/size verification, and safe observation of an already active service. Block materialization, new activation/restart requiring composition, native preflight, Strategy Apply, Z2K update/rollback, package synchronization that would activate Z2K bytes, and canonical process proof with `RECONCILIATION_REQUIRED`.

- [ ] **Step 4: Prove mutable classification cannot invent V1 composition**

Use a fixture where current package classification gives a different order/role than the v1 evidence. Assert that no canonical `runtimeOrder`, `luaInit[]`, or historical classification is emitted and that the result remains `V1_VERIFIED_MEMBERSHIP`/`RECONCILIATION_REQUIRED`.

- [ ] **Step 5: Validate the RED inputs for Task 4**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-v1-reconciliation.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs
```

Expected at this point: the new two-phase/V1 assertions remain RED or are explicitly marked pending Task 4; do not declare a green implementation and do not create a standalone Task 3 commit.

### Task 4: Implement candidate transaction, durable evidence, and same-release V1 migration

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-lifecycle-recovery.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc`
- Modify: `zapret2-manager/files/etc/init.d/zapret2-manager`
- Modify: `tests/product/z2k-lifecycle-transaction.test.mjs`
- Modify: `tests/product/z2k-v1-reconciliation.test.mjs`
- Modify: `tests/product/z2k-installed-release-authority.test.mjs`
- Modify: `tests/product/z2k-final-lifecycle-ownership.test.mjs`
- Modify: `tests/product/z2k-update-transaction.test.mjs`
- Modify: `tests/product/z2k-async-lifecycle.test.mjs`
- Modify: `tests/product/z2k-post-mutation-check-state.test.mjs`

**Interfaces:**
- Consumes: the Task 3 RED contracts, FRESH prepared target, `resolveCandidate()`, and existing Registry/CHECK_STATE/runtime-sync/rollback owners.
- Produces: the complete Registry two-phase implementation, coordinator finalize wiring, one normal candidate transaction, and `resource_center_recover_pending()` driven by durable evidence at `/etc/zapret2-manager/z2k-pending-activation.json`. This is the first and only production commit for the split commit/finalize boundary.

Task 3 and Task 4 are one coherent implementation slice. The Registry split, coordinator finalization, durable pending evidence, recovery, and V1 migration must become usable together. No intermediate commit may expose candidate bytes without recovery evidence or an installed receipt without postflight.

- [ ] **Step 1: Add RED tests for the durable journal boundary**

Assert that durable evidence exists before the first `asset_registry_apply_bundle()` call and contains candidate snapshot ID, base revision, prior authority/Registry/runtime rollback identity, target/plan identity, and phase. Assert that the `/tmp/z2m-resource-update/jobs/.../job.json` worker file alone is rejected as sufficient evidence. Assert that evidence is removed only after `FINALIZED` or verified `ROLLED_BACK`.

- [ ] **Step 2: Add RED tests for revision semantics**

Cover both exact cases:

```text
prepare at N -> unrelated Registry change -> pre-commit ESTALE, no bundle call
prepare at N -> own bundle commit returns N+1 -> capture N+1, continue, finalize at N+2
```

Assert that the generated candidate closure is not invalidated by its own expected N-to-N+1 transition and that finalization compares the committed membership exactly.

- [ ] **Step 3: Implement durable phase persistence**

Write the journal atomically with mode `0600` before the first irreversible candidate Registry commit. Use phases `PREPARED`, `COMMITTED`, `MATERIALIZED`, `PROCESS_VERIFIED`, `FINALIZED`, `ROLLING_BACK`, and `ROLLED_BACK`. Make recovery refuse ambiguous/missing evidence rather than infer state from target files. Keep the `/tmp` worker job as a progress mirror only.

- [ ] **Step 4: Rewire prepare/apply to the canonical candidate**

`resource_center_prepare_version()` must use the existing FRESH target path, build `resolveCandidate(preparedTarget)`, persist base Registry revision and ordered identity, and preserve existing planToken/check gates. Apply must re-resolve the prepared candidate, perform immediate pre-commit CAS against `observedRegistryRevision`, write durable evidence before the first irreversible Registry mutation, call `asset_registry_apply_bundle()`, capture `committedAssetRevision`, verify exact committed membership, materialize, call `verifyMaterialized()`, restart/reload, call `verifyActivationProcess()`, and call `asset_registry_finalize_activation()`. The Task 4 implementation must land the apply/finalize coordinator and Registry APIs together; no intermediate state may expose candidate bytes without recovery evidence or an installed receipt without postflight.

- [ ] **Step 5: Implement same-release V1 reconciliation through `reinstall`**

Read v1 version/sourceCommit/recorded membership/SHA, request authoritative FRESH resolution of that same release, require exact version/sourceCommit match, build from the trusted FRESH manifest/classification, and compare IDs, source paths, SHA, byte size, and removals/absence against v1 plus Registry. On exact proof, pass the target through the normal `reinstall` candidate transaction. Do not call a migration-specific updater and do not call current classification historical evidence. If proof fails, return `RECONCILIATION_REQUIRED`.

- [ ] **Step 6: Remove Z2K direct-fetch bypasses**

Keep Global Update Source as the sole Z2K metadata authority and do not add metadata/direct-fetch bypasses. Preserve the existing immutable SHA-bound mutation asset fetch and its validation unless a focused audit proves that existing fetch defective; do not replace it merely to make the new resolver own byte transport. Preserve existing non-Z2K source owners outside this lifecycle.

- [ ] **Step 7: Implement boot recovery entry point**

`z2k-lifecycle-recovery.uc recover` imports the coordinator recovery function. `init.d/zapret2-manager` calls it after bootstrap and before starting manager daemons. Recovery finalizes only exact committed evidence plus CAS; otherwise it rolls back only with exact previous identity and verified postflight, and reports a blocking recovery state when safe compensation is not provable.

- [ ] **Step 8: Preserve pure local post-mutation CHECK_STATE reconciliation**

After successful postflight, run `z2k_upstream_plan(authoritative persisted manifest)` locally, update the persisted projection to `current` when updates are empty, clear `preparedTarget`, and never fetch upstream solely for this synchronization. If persisted authoritative evidence cannot be reused, write `unknown/check-required`, never stale `update-available`.

- [ ] **Step 9: Run transaction tests green**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-async-lifecycle.test.mjs tests/product/z2k-post-mutation-check-state.test.mjs
```

- [ ] **Step 10: Commit lifecycle transaction slice**

```text
git add zapret2-manager/files/usr/libexec/zapret2-manager/z2k-lifecycle-recovery.uc zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc zapret2-manager/files/etc/init.d/zapret2-manager tests/product/z2k-lifecycle-transaction.test.mjs tests/product/z2k-v1-reconciliation.test.mjs tests/product/z2k-installed-release-authority.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-async-lifecycle.test.mjs tests/product/z2k-post-mutation-check-state.test.mjs
git commit -m "feat: make Z2K activation recovery durable and two-phase"
```

### Task 5: Migrate runtime materialization and process proof

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `tests/product/z2k-materialization.test.mjs`
- Modify: `tests/product/z2k-runtime-target-luaopt.test.mjs`
- Modify: `tests/product/z2k-runtime-postflight-size.test.mjs`
- Modify: `tests/product/z2k-runtime-readiness.test.mjs`

**Interfaces:**
- Consumes: CLI `--consumer=candidate-materialize` for candidate closure, CLI `--consumer=installed-materialize` for installed closure, and CLI `--consumer=postflight` only for verification.
- Produces: materialized files, generated config/hash, activation evidence, and steady-state evidence tied to one snapshot.

- [ ] **Step 1: Add RED test for static-list removal**

Assert that the production sync helper has no hand-copied Lua array, no fixed append sequence, and no existence-based append fallback. The helper must invoke the bounded resolver CLI and reject an invalid snapshot instead of silently adding a package file.

- [ ] **Step 2: Implement resolver-driven materialization**

Validate `runtimeAssets[]` and route each entry by ownership: copy `package-static` entries only from verified package sources, lifecycle-managed entries only from Registry-selected source paths, and remove only candidate-declared removals. Generate the exact ordered `luaInit[]` input from the candidate CLI output. Record the candidate snapshot ID, membership digest, config hash, runtime hashes, and process-generation evidence. Never label the complete `runtimeAssets[]` array Registry-owned.

- [ ] **Step 3: Separate activation from steady-state process checks**

During activation, require a process created/restarted for this activation and reject an old PID even when argv paths/order match. During later `verifyInstalledProcess()`, accept a new PID/starttime after a service restart or reboot only when runtime hashes, config hash/composition, argv/order, and queue readiness match the same installed snapshot. A new PID with stale config/runtime must fail.

- [ ] **Step 4: Run materialization and proof tests green**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-materialization.test.mjs tests/product/z2k-runtime-target-luaopt.test.mjs tests/product/z2k-runtime-postflight-size.test.mjs tests/product/z2k-runtime-readiness.test.mjs
```

- [ ] **Step 5: Commit runtime proof slice**

```text
git add zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc tests/product/z2k-materialization.test.mjs tests/product/z2k-runtime-target-luaopt.test.mjs tests/product/z2k-runtime-postflight-size.test.mjs tests/product/z2k-runtime-readiness.test.mjs
git commit -m "feat: bind Z2K runtime materialization to canonical closure"
```

### Task 6: Migrate native preflight, Strategy Apply, and Scanner consumers

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc`
- Modify: `zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh`
- Modify: `tests/product/z2k-canonical-plan-contract.test.mjs`
- Modify: `tests/product/z2k-update-transaction.test.mjs`
- Modify: `tests/product/avatar-strategy-apply.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-integration.test.mjs`
- Modify: `tests/product/avatar-strategy-scanner-planner.test.mjs`
- Modify: `tests/product/scanner-planner-runtime-contract.test.mjs`

**Interfaces:**
- Consumes: `resolveInstalled()`, its explicit dependency index, and CLI scanner overlay.
- Produces: exact native command proof and Strategy Apply CAS that is server-owned.

- [ ] **Step 1: Add RED test for exact native closure**

Assert that native preflight no longer reads a static `RUNTIME_LUA_FILES` list. It must obtain ordered Lua from the resolver, resolve explicit blobs/lists/ipsets through `dependencyIndex`, and run the exact `--dry-run`/`--intercept=0` command with that closure. A removed provider or mismatched dependency must fail even if a package copy exists.

- [ ] **Step 2: Add RED Strategy Apply CAS test**

Arrange Strategy Validate against installed snapshot N, change Registry to N+1 before Apply, and assert `ESTALE` with `profiles_apply_candidate()` not called. Repeat with a stale client-supplied snapshot ID and assert that the server re-resolution, not the client value, decides the result.

- [ ] **Step 3: Implement server-owned Strategy snapshot sequence**

Keep `strategies_validate` diagnostic. In the Apply path, resolve the current installed snapshot, compile, run native preflight against that exact closure, re-resolve immediately before `profiles_apply_candidate()`, compare Registry/receipt/membership/content/order/snapshot/composition identities, and call the writer only after the compare succeeds. Preserve the existing profile writer, lock, rollback, and Strategy identity lifecycle.

- [ ] **Step 4: Implement scanner overlay boundary**

Make Scanner consume the same production `runtimeAssets[]`/`luaInit[]` plus resolver-produced overlay. Mark overlay entries non-production, exclude them from Registry membership and production `--lua-init`, and preserve existing transient Scanner ownership/cleanup protocol.

- [ ] **Step 5: Remove dynamic Lua list from preflight manifest**

Keep `native-preflight.json` limited to static engine capability/pinned evidence. Dynamic Z2K runtime membership comes only from the resolver snapshot; changing an existing Lua export does not require a manually synchronized provider map.

- [ ] **Step 6: Run consumer tests green**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-canonical-plan-contract.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/scanner-planner-runtime-contract.test.mjs
```

- [ ] **Step 7: Commit consumer migration slice**

```text
git add zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh tests/product/z2k-canonical-plan-contract.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/avatar-strategy-apply.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/scanner-planner-runtime-contract.test.mjs
git commit -m "feat: route Strategy and Scanner through runtime composition"
```

### Task 7: Close package-resurrection, direct-fetch, and cross-consumer regressions

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- Modify: `tests/product/z2k-runtime-guard.test.mjs`
- Modify: `tests/product/z2k-final-lifecycle-ownership.test.mjs`
- Modify: `tests/product/z2k-full-lifecycle-review.test.mjs`
- Modify: `tests/product/clean-install-contract.test.mjs`

**Interfaces:**
- Consumes: resolver installed/candidate states and package synchronizer result states.
- Produces: static-ready/dynamic-ready/blocked-unknown-authority outcomes with no lifecycle package fallback.

- [ ] **Step 1: Add RED resurrection tests**

With no confirmed Z2K receipt but package `z2k-detectors.lua` present, assert package synchronization cannot activate or report success for lifecycle Z2K. With a valid resolver snapshot, assert only selected entries materialize and removed entries remain absent.

- [ ] **Step 2: Add RED direct-fetch audit**

Run:

```text
rg -n "curl|wget|uclient-fetch" zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc
```

Expected after migration: resolver code has no transport; Z2K metadata resolution and any new metadata fetch appear only through `update-source.uc` requests, and no new direct metadata bypass exists outside that authority. The existing immutable SHA-bound mutation asset fetch remains present and is audited separately rather than removed by this plan. Keep generic non-Z2K behavior classified separately.

- [ ] **Step 3: Run ownership and clean-install tests green**

Run:

```text
node --test --test-concurrency=1 tests/product/z2k-runtime-guard.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/clean-install-contract.test.mjs
```

- [ ] **Step 4: Commit ownership/regression slice**

```text
git add zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc tests/product/z2k-runtime-guard.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/clean-install-contract.test.mjs
git commit -m "test: close Z2K ownership and package fallback regressions"
```

### Task 8: Run full focused verification and classify baseline differences

**Files:**
- No new production files.
- Verification: all `tests/product/z2k-*.test.mjs`, the consumer tests from Task 6, and relevant native shell suites.

**Interfaces:**
- Consumes: all implemented slices and the Task 0 baseline report.
- Produces: an evidence table separating green focused tests, environment skips, unrelated baseline failures, and unverified router behavior.

- [ ] **Step 1: Run all product tests serially**

Run:

```text
Get-ChildItem tests/product -Filter 'z2k-*.test.mjs' | Sort-Object Name | ForEach-Object { node --test --test-concurrency=1 $_.FullName }
```

On Linux CI, use the repository matrix runner so each file remains isolated and every result is recorded. Do not call a failure pre-existing without the Task 0 same-test baseline.

- [ ] **Step 2: Run native shell and UCode gates**

Run on Linux only:

```text
scripts/test/native.sh
```

If the environment lacks `/opt/ucode/bin/ucode`, record the exact skipped phase; do not replace it with `node --check` for `.uc` files.

- [ ] **Step 3: Perform source-level direct-fetch and authority audit**

Confirm that every Z2K source request identifies source key, origin, mode, TTL, max bytes, validator, and content identity; that only FRESH is accepted by prepare/apply; and that no resolver, package sync, Strategy, or Scanner path has a second list or second Registry/cache authority.

- [ ] **Step 4: Review the diff against the spec**

Check every spec section: lifecycle-neutral inputs, V1 migration, expected/verification split, explicit kinds, Registry revision semantics, durable evidence, process generations, Strategy CAS, Scanner overlay, package fallback, Global Update Source, and RED matrix A-S/Round 4. Any uncovered clause blocks the implementation verdict.

### Task 9: Real-router read-only and safe acceptance

**Files:**
- Evidence only; do not add router state to the repository.
- Use existing router-safe source deployment/ubus/LuCI acceptance tooling; do not build or deploy APKs in this task.

**Interfaces:**
- Consumes: implementation branch with all focused gates green and a clean router backup/evidence boundary.
- Produces: auditable router evidence, not a source-test substitute.

- [ ] **Step 1: Capture initial authority**

Record router identity, current Registry revision, v1/v2 receipt, version/sourceCommit, membership digest, runtime paths/SHA/size, nfqws2 PID/starttime/argv, active config hash, and queue 300 ownership.

- [ ] **Step 2: Verify expected closure and steady state**

Run the installed resolver and CLI consumers on-router. Prove that runtimeAssets/luaInit/dependencyIndex/scannerOverlay agree across materialization, native preflight, Strategy, Scanner, and process postflight. Verify that a normal service restart/new PID passes steady-state proof when hashes/config/order/readiness match.

- [ ] **Step 3: Verify stale process failure**

Use a safe test seam to present a new PID with stale config/runtime hash and prove `verifyInstalledProcess()` fails. Present matching paths/order with an old activation generation and prove `verifyActivationProcess()` fails.

- [ ] **Step 4: Verify Registry CAS and package boundary**

Prepare at revision N, introduce an unrelated Registry revision before commit, and prove `ESTALE` with no bundle mutation. Remove/withhold installed authority and prove package synchronization cannot resurrect a lifecycle Z2K asset.

- [ ] **Step 5: Verify V1 r-80.3 migration**

On the existing supported r-80.3 v1 router, run same-release FRESH reconciliation. Prove either exact membership/SHA comparison followed by normal `reinstall` and v2 promotion, or explicit `RECONCILIATION_REQUIRED`; never permanent unknown and never guessed Lua order.

- [ ] **Step 6: Verify post-mutation cross-consumer parity**

After a safe approved update/reinstall acceptance, without F5 or manual Check Updates, compare Components, Resources, Registry, CHECK_STATE, runtime closure, process config/generation, Strategy, and Scanner. Components and Resources must not disagree about the same Z2K source snapshot.

### Task 10: Final review, delivery gate, and report

**Files:**
- Documentation evidence only; no additional production scope.

- [ ] **Step 1: Run verification-before-completion checks**

Confirm `git diff --check`, focused tests, native results, direct-fetch audit, and router evidence. Confirm no APK was built/deployed and no unrelated files changed.

- [ ] **Step 2: Produce the final evidence report**

Include `BASE_SHA`, implementation commits, exact HEAD, changed files, resolver contract, V1 allowed/blocked matrix, Registry N/N+1/N+2 evidence, durable journal phases, activation versus steady-state PID proof, Strategy ESTALE proof, scanner overlay proof, package fallback proof, direct-fetch audit, focused/native counts, and router captures. Mark every unrun acceptance as `NOT_RUN`.

- [ ] **Step 3: Delivery remains a separate authorization gate**

Do not push or deploy from this plan-writing step. After production implementation, all required tests and router evidence pass, and delivery is explicitly authorized, verify the non-force main delivery with fetch/ancestry checks and prove local `HEAD == origin/main`.

## Plan Self-Review

- [x] Resolver authority is split into `resolveInstalled()` and `resolveCandidate(preparedTarget)` without creating two sources of truth.
- [x] Task 0 records `SPEC_SHA=2ae23ee4` separately from `IMPLEMENTATION_BASE_SHA=f9f2c399` and permits later docs-only descendants.
- [x] Resolver API exposes `observedRegistryRevision`, `compositionStatus`, lifecycle/receipt identity, and distinguishes observed Registry revision from installed authority revision for final CAS.
- [x] Expected closure, materialized verification, activation process proof, and installed steady-state proof are separate tasks and tests.
- [x] `runtimeAssets[]`, `luaInit[]`, `dependencyIndex`, and `scannerOverlay[]` are explicit and non-overlapping.
- [x] Common entry fields are separated from lifecycle-managed version/sourceCommit fields; package-static entries do not receive invented lifecycle identity.
- [x] Candidate materialization has an explicit CLI/runtime-sync boundary; postflight is verification-only and shell fallback/list paths are forbidden.
- [x] Materialization ownership routes package-static entries to verified package sources, lifecycle-managed entries to Registry-selected sources, and removals to candidate declarations.
- [x] Candidate base revision, own committed revision, and final installed authority revision have separate tests and implementation boundaries.
- [x] V1 migration uses same-release FRESH identity/membership proof and existing `reinstall`; current classification is never called historical authority.
- [x] V1 allowed/blocked operations and `RECONCILIATION_REQUIRED` are specified.
- [x] V2 receipt captures immutable manifest/classification identity and normalized Z2K membership; v1-to-v2 compatibility is covered.
- [x] V1 RED test creation and execution occur in Task 1 before later Task 3 amendments.
- [x] Registry split, coordinator finalize wiring, and durable journal are one Task 3/4 implementation slice with no broken intermediate transaction commit.
- [x] Durable pending evidence is created before candidate Registry mutation; `/tmp` worker state is explicitly non-authoritative.
- [x] Native preflight proves exact selected Lua/dependency closure and does not use a static provider map as correctness authority.
- [x] Strategy Apply has an independent server-side resolve/preflight/final CAS; stale client snapshot IDs cannot authorize mutation.
- [x] Scanner shares production closure and keeps overlay diagnostic-only.
- [x] Package synchronization cannot resurrect lifecycle Z2K bytes under unknown authority.
- [x] Existing Global Update Source remains the sole Z2K metadata authority; the existing immutable SHA-bound mutation fetch is preserved unless a focused audit proves a defect, and no new metadata/direct-fetch bypass is added.
- [x] The RED matrix covers candidate-without-receipt, missing runtime asset, non-Lua exclusion, unrelated/own Registry transitions, V1 migration, mutable classification drift, PID/generation split, and stale process evidence.
- [x] Direct-fetch audit, focused tests, native gates, and real-router acceptance are separate evidence classes.
- [x] No production code, deployment, APK, or implementation push is performed while writing this plan.

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-30-canonical-runtime-composition.md`. Production implementation is not started. Because the user requested no agents, the next execution must use `superpowers:executing-plans` inline, task-by-task, after this plan remains accepted.

