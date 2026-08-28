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
- Tasks 12-13: the first live upgrade attempt through Components UI reached apply and rolled back safely. Its apparent `blob:4pda` runtime-mapping failure was traced to a production UCode serializer bug: `join()` arguments were reversed, so the activation spec contained `null`; commit `71616247` fixes the serializer and adds a regression test. A follow-up UI attempt was then blocked before confirmation because the router's GitHub API rate limit was exhausted (`403`, `0/60`, reset `2026-08-28 22:54:39 MSK`); no second mutation occurred. Downgrade and reinstall remain unrun.
- Task 14: final focused matrix passed `67/67`; broad filtered matrix remains non-green on unrelated/pre-existing tests and is not claimed as a product GREEN gate.
- Task 15: complete — adversarial review recorded below and in `task-final-report.md`.
- Tasks 16-17: complete after recording the exact live blocker, post-rollback health, final report, and machine-readable evidence; final commit/push follows the acceptance outcome.

## Final evidence summary

- Initial focused lifecycle/resource matrix: 64/64 tests passed; final focused matrix after the production serializer fix and regression test: 67/67 tests passed.
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
- Package deployment is intentionally out of scope (`НИКАКИХ APK`). The first UI upgrade was action-time confirmed and safely rolled back; its `ERUNTIME`/`EVERIFY` report was caused by the reversed UCode `join()` serializer and is fixed in `71616247`. The follow-up UI attempt stopped before confirmation on fresh immutable-tag `EUNAVAILABLE` caused by GitHub API `403` rate limiting. Downgrade and reinstall remain not run, and CLI apply is prohibited as a substitute.

## Follow-up after serializer fix

- Commit `71616247bec3594b586011ad549d5e19fae2d706` is pushed to `origin/codex/z2k-version-lifecycle`; local `HEAD` equals the remote branch tip.
- The production `resource-update.uc` SHA on the router is `dc64c09cc1699577722c6f6fde16113218da26ec6a19313bfefb6384677af509`, matching the candidate source. It was deployed source-only with a backup, `root:root`, mode `0644`, followed by `rpcd` reload.
- The final focused matrix is `67/67` passed. The new `4a` regression test prevents reversed separator/list `join()` arguments from returning a `null` activation spec.
- Read-only router health after deployment remains safe: installed authority `r-79.7`, Registry revision `7`, `preparedTarget=null`, `integrity=verified`, Lua `7/7`, and `resources_status.ok=true`.
- In the Codex in-app Browser, the session was recovered by clicking `Log in…` and `Log in` without entering a password. The selected `r-80.3` prepare then returned `EUNAVAILABLE` before the confirmation dialog because `api.github.com` returned `403`; `/rate_limit` reported core `remaining=0`, `limit=60`, reset `2026-08-28 22:54:39 MSK`. No mutation was attempted after this blocker.

## Final update 2026-08-29

- Work continued in WSL Ubuntu; native OpenWrt UCode was available and the focused lifecycle/ownership matrix passed `61/61` (`0` failed, `0` skipped), including legacy receipt cases A–E, sidecar refresh precedence, and daemon-readable runtime modes.
- The first real Components UI upgrade had already exposed and safely rolled back the `0700` restored-runtime-mode defect. Commit `a9bb6240` fixes restoration modes (`0755` for executable Lua/Shell runtime assets, `0644` for other assets), and the router was redeployed source-only; selected Z2K Lua files are now `0755`.
- A bounded retry through the Codex in-app Browser reached the confirmation dialog for `r-79.7 → r-80.3` and was confirmed. It produced no success result and did not change the Registry: authority remained `r-79.7`, revision `7`, `preparedTarget=null`. No CLI mutation was used as a substitute.
- Final router read-only state is healthy: `resources_status` integrity `verified`, Lua `7/7`, `nfqws2` running with queue `300`, Strategy identity preserved, and no APK/package operation performed.
- The exact final verdict remains `NOT READY`: the fresh UI upgrade retry did not complete, and downgrade/reinstall were not run. Broad WSL parity was `131` tests / `127` pass / `4` fail / `0` skipped; failures are baseline or environment-related and are not claimed green.

## Frontend transport timeout fix — 2026-08-29

- The fresh instrumented Components UI attempt reached confirmation and sent the exact `resources_update` JSON-RPC request. The browser received HTTP 200 headers, then canceled the request at `20.009981s` with `net::ERR_ABORTED`; no response body was captured after cancellation.
- Read-only inspection of the router-served `rpc.js` established the root cause: transport timeout is `(L.env.rpctimeout ?? 20) * 1000`; `rpc.declare({ timeout: 60 })` does not control this served transport. The generic maintenance page timeout was `30000ms`, but the transport aborted first.
- Before changing production code, the new frontend contract file was run RED (`2` failures): no independent Z2K mutation timeout and no operation-specific transport timeout. The minimal fix is now GREEN (`2/2`): ordinary loads remain `30000ms`, confirmed Z2K mutation lifetime is `180000ms`, and `resources.update` uses a direct authenticated non-batched LuCI request with `180000ms` transport timeout while returning structured backend results unchanged.
- Commit `29c3dab1` contains only `z2m-api.js`, `z2m-maintenance.js`, and `z2k-frontend-timeout-contract.test.mjs`. No APK/package build or install was performed.
- Focused matrix after the fix: `63/63` passed, `0` failed, `0` skipped, with native OpenWrt UCode. Exact broad command parity: baseline `101/105` passed, candidate `129/133` passed; both have the same four failures and no candidate-only failure. The four are the stale candidate compatibility assertion, signed-update fixture assertion, upstream-classification expectation, and missing `vitest` dependency.
- The prior router state after the aborted attempt remained safe: authority `r-79.7`, Registry revision `7`, no prepared target, receipts unchanged, staging eventually cleaned, `nfqws2` running with queue `300`. A fresh source-only deployment and a new Components UI lifecycle attempt are still required before any live operation can be claimed successful.
