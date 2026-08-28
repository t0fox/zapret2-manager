# SDD ledger — plan: docs/superpowers/plans/2026-08-28-z2k-final-lifecycle-resource-ownership.md

## Setup

- Worktree: `G:/z2m-z2k-version-lifecycle`
- Branch: `codex/z2k-version-lifecycle`
- Baseline HEAD: `f0e04b0f4bb64680b8c5bb2767d825b7e18d7508`
- Baseline status: clean; `HEAD` is the expected branch tip.
- Main checkout `G:/zapret2-manager` is unrelated and contains an untracked object; it is preserved.

## Preflight plan consistency scan

| Scope | Producer/consumer or self-check | Finding |
|---|---|---|
| Task 1 | Asset Registry and Resources model/UI | Task 1 first reproduces `mutable=true` being treated as generic edit permission before Tasks 3-6 introduce the derived policy. Consistent. |
| Task 2 | `z2k-versions.uc` and `resource-update.uc` | Fresh mutation resolution supplies immutable commit/manifest identity; browse cache remains read-only. Consistent. |
| Task 3 | Registry projection consumed by Tasks 4-6 | One backend-derived management policy drives both enforcement and presentation; `mutable=true` remains internal lifecycle capability. Consistent. |
| Task 4 | Generic update/delete vs `apply_bundle` | Generic mutations reject only exact lifecycle bundle; canonical lifecycle writer remains allowed. Consistent. |
| Task 5 | Registry management projection -> Resources UI | UI consumes backend policy and does not infer ownership from asset names; duplicate creates a new user asset. Consistent. |
| Task 6 | `importPanel` -> generic update path | Existing lifecycle IDs are rejected in UI before update; backend remains security boundary. Consistent. |
| Task 7 | `resource-update.uc` prepare -> confirmation/apply | Removal/reference conflict is detected before prepared target persistence and confirmation. Consistent. |
| Task 8 | Registry mutations -> prepared-target fingerprint | Protected edit has no mutation and does not stale; unrelated user edit is outside fingerprint; real Z2K state change stales. Consistent. |
| Task 9 | Components/Registry/Resources/runtime | Successful lifecycle receipt is reported only after postflight SHA agreement. Consistent. |
| Task 10 | Fresh resolver -> GitHub REST | Request budget is one lightweight or two annotated calls; 403 is fail-closed with no fake prepare. Consistent. |
| Task 11 | Live Resources browser -> Tasks 12-13 | Read-only and negative RPC gates precede destructive live mutations. Consistent. |
| Task 12 | Components UI -> lifecycle transaction | Upgrade, downgrade, and reinstall share the approved prepare/confirm/apply lifecycle; downgrade removal conflict is selected-target-specific. Consistent. |
| Task 13 | Runtime/Strategy/autocircular -> every live operation | Snapshot is recorded before mutation and compared after each operation. Consistent. |
| Task 14 | Focused tests -> broad parity | Focused behavior gates precede broad baseline comparison; no pre-existing claim without identical command. Consistent. |
| Task 15 | All prior gates -> verdict | Adversarial questions map directly to Tasks 1-14 evidence. Consistent. |
| Task 16 | Evidence artifacts -> final report | Report fields are supplied by prior automated/live gates; no test-only READY claim. Consistent. |
| Task 17 | Final review/report -> commit and push | Delivery is after verification and user explicitly authorized push; no force-push. Consistent. |
| Shared file | `asset-registry.uc` Tasks 3,4,9 | Task 3 defines the canonical projection, Task 4 enforces it, Task 9 observes it. Later tasks consume earlier contract. No contradiction. |
| Shared file | `resource-update.uc` Tasks 2,7,8,12 | Fresh resolver supplies selected target; prepare conflict and fingerprint are pre-apply gates; live cycle consumes both. No contradiction. |
| Shared interface | Registry management fields -> JS model/UI/import | Backend is sole authority, frontend is presentation and UX guard; backend negative tests remain mandatory. No contradiction. |
| Shared interface | prepared target -> confirmation/apply/runtime | No target is persisted for unavailable/conflicting requests; valid target is immutable and snapshot-bound. No contradiction. |
| Global constraints | `mutable`, Registry writer, cache, user resources, Strategy state | All tasks preserve the stated boundaries. No contradiction. |

No preflight ruling required.

## Task ledger

- Task 1: complete — baseline ownership map and RED reproducer recorded in `task-1-report.md`.
- Tasks 2-10: complete — implementation and focused contract coverage are in the working tree.
- Task 11: complete — direct source-only deployment, cache-disabled browser Resources acceptance, and backend negative ownership proof passed.
- Tasks 12-13: live upgrade attempted through Components UI; apply failed at runtime mapping validation for removed `blob:4pda` and automatic Registry rollback succeeded. Downgrade and reinstall were stopped per the plan.
- Task 14: focused matrix passed; broad filtered matrix remains non-green on unrelated/pre-existing tests and is not claimed as a product GREEN gate.
- Task 15: complete — adversarial review recorded below and in `task-final-report.md`.
- Tasks 16-17: complete after recording the exact live blocker, post-rollback health, final report, and machine-readable evidence; final commit/push follows the acceptance outcome.

## Final evidence summary

- Focused lifecycle/resource matrix: 64/64 tests passed.
- JavaScript syntax checks: both changed frontend files passed `node --check`.
- Knowledge validator: passed.
- Router module import: changed `z2k-versions.uc`, `asset-registry.uc`, and `resource-update.uc` imported successfully on OpenWrt (`final-modules-loaded`).
- Router exact selected resolver: `r-80.3` resolved to commit `8f3787aa999dd00ffe76871c5f343a1c049973b1`; diagnostics were `requestCount=3`, `restRequestCount=2`, `resolution=selected-tag`, with 39 managed assets.
- Router Registry projection: 43 assets, all 43 `owner=z2k-core/mode=lifecycle`, 0 editable.
- Router generic mutation negative gate: update and delete of `lua:z2k-modern-core` both returned `EPOLICY` with `managedBy=z2k-core` and `bundleId=z2k-curated-lua`; no mutation was performed.
- Direct deployment: five candidate source files were backed up, staged, installed with `root:root 0644`, and verified by router and HTTP SHA; no APK/package installation was used.
- Browser Resources acceptance: after cache-disabled hard reload, 43 resources / 0 user resources were shown; lifecycle workspace had no `Редактор` tab or textbox and showed `Управляется Z2K Core` / `Lifecycle: только через Компоненты`.
- Runtime post-deploy: `nfqws2` PID 7943, queue 300 owner match, applied config and strategy identity remained stable; autocircular state remained present and changed only as live mutable state.
- Strategy/autocircular check: `strategy-rpc-regression` passed; `learned-autocircular-contract` had one existing layout assertion failure (`learned-table-9`) in an unchanged file, so the regression gate is not claimed green.

## Adversarial review

- No second registry/provider or alternate lifecycle writer was introduced; `asset_registry_apply_bundle` remains the canonical lifecycle writer.
- `mutable=true` remains an internal capability; public `management` projection is the sole Resources editability/deletability decision.
- Generic update/delete are policy-blocked before writes for the exact canonical Z2K bundle; user/imported assets retain workspace CRUD behavior.
- Selected-tag prepare resolves an exact immutable ref and annotated tag without constructing the full catalog; raw manifest fetch is counted separately from bounded REST calls.
- Removal/reference conflicts are returned before prepared-target persistence; apply rechecks the snapshot fingerprint and runtime postflight bytes.
- User edits outside the selected managed target do not stale the target; managed target state changes do.
- Package deployment is intentionally out of scope (`НИКАКИХ APK`). The UI upgrade was action-time confirmed but failed with `ERUNTIME`/`EVERIFY` because removal target `blob:4pda` has no safe runtime mapping; Registry rollback succeeded. Downgrade and reinstall remain not run, and CLI apply is prohibited as a substitute.
