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

## Fresh Components UI attempt after transport fix — 2026-08-29

- Source-only deployment installed only `z2m-api.js` and `z2m-maintenance.js` from commit `29c3dab1`; both router hashes and HTTP-served hashes matched the source, ownership/mode were `root:root 0644`, and `rpcd reload` completed. WSL could not reach the LAN because its NAT route returned `Network is unreachable`, so the authorized deployment used the Windows OpenSSH transport; WSL remained the test environment.
- Fresh prepare succeeded for `r-79.7 → r-80.3`: immutable target commit `8f3787aa999dd00ffe76871c5f343a1c049973b1`, `39` assets, `6` removals, `resolution=selected-tag`, and the advisory review remained non-blocking. The user confirmation was sent once through the Codex in-app Browser.
- The fixed direct RPC request (`id=100001`) reached `Network.loadingFinished` after about `27.15s`, proving the former 20-second transport abort is fixed. The exact backend result was `EROLLBACK` / `Z2K runtime activation failed and rollback could not be completed`; nested runtime error: `ERUNTIME` / `nfqws2 is not running after Z2K activation`. Backend diagnostics were `planned=39`, `downloaded=39`, `verified=39`, `staged=39`, `applied=39`, `removed=6`, `postflightMatched=39`.
- Backend reported Registry restoration `ok=true` but `rollbackAvailable=false`. Read-only postflight is currently safe and non-hybrid: authority `r-79.7` confirmed, Registry revision `7`, integrity verified, Lua `7/7`, engine running, `nfqws2` running with queue `300`. Eight stale temporary staging directories remain under `/tmp/z2m-resource-update`; no manual deletion or CLI lifecycle mutation was performed.
- Per the approved gate, the lifecycle sequence stops at the failed upgrade. Downgrade and reinstall were not run, and the final verdict remains `NOT READY` with one exact blocker: backend runtime activation cannot keep `nfqws2` running and its rollback reports failure.

## Runtime readiness patch and final fresh UI gate — 2026-08-29

The earlier readiness implementation was deployed source-only to the router and the approved fresh `r-79.7 → r-80.3` transaction was launched through the Codex in-app Browser after action-time confirmation. The UI left its working state without showing a success state; the installed release remained `r-79.7`, so the lifecycle gate stopped as required. Downgrade and reinstall were not run.

- Readiness implementation commit: `25a03b45c8217243601c8cf7e138926b0df22cc0`; it waits up to 12 seconds in 1-second bounded polls, checks the `nfqws2` PID, NFQUEUE `300` listener ownership, nft table/rule evidence, and runs the status postflight only after runtime readiness. Activation and rollback share the same contract.
- Router postflight after the UI operation: `NFQWS2_ENABLE=1`, current PID `452`, queue row `300 452 ...`, nft queue rules targeting `300`, Registry revision `7`, confirmed authority `r-79.7`, integrity `verified`, Lua `7/7`, `preparedTarget=null`, and the existing Strategy identity remained intact.
- Router event evidence during the attempted target activation records `nft table zapret2 missing or empty` at `23:07:02Z` and `nfqws2 process gone; recovery start rc=0` at `23:07:04Z`. The candidate runtime did not remain ready; rollback restored the prior healthy runtime. The Browser toast had expired before capture, so no structured JSON error body is claimed beyond this exact router evidence.
- The operation increased `/tmp/z2m-resource-update` from `8` to `9` directories and left `stage.mjiljL/runtime-activation.tsv`. This exposed a cleanup defect: the activation spec was not included in the caller's cleanup path. TDD RED then GREEN was added in `tests/product/z2k-staging-cleanup.test.mjs`; commit `a90658fa85d72a56612528d4ac6ebfa5b27f7a44` deploys the two-line cleanup fix source-only. No lifecycle rerun was performed after the failed upgrade.
- Focused post-fix matrix: `68/68` passed in WSL Ubuntu with native OpenWrt UCode. No APK/package build or install was performed. The source-only cleanup deployment's `rpcd reload` printed a segmentation fault; it was not retried, and read-only `ubus resources_status` remained available with a live rpcd process.

Current verdict remains `NOT READY`: the candidate `r-80.3` runtime still fails to stay ready during the one authorized fresh upgrade attempt, and the required downgrade/reinstall gates therefore remain unrun. The cleanup fix is source-verified and router-deployed but not live-revalidated because the approved sequence stops after a failed upgrade.

## Final autonomous lifecycle gate — 2026-08-29

The remaining lifecycle sequence was completed through the Codex in-app Browser, with a fresh PREPARE and one visible confirmation for each operation:

- Upgrade `r-79.7 -> r-80.3`: job `z2k-1787965701-af29beb70f4393de`, target commit `8f3787aa999dd00ffe76871c5f343a1c049973b1`, `39/39` downloaded, verified, staged, applied, `6` removed, runtime postflight `39/39`, completed.
- Downgrade `r-80.3 -> r-79.7`: job `z2k-1787966219-a6dac665f7d6a2bd`, target commit `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c`, `43/43` downloaded, verified, staged, applied, `2` removed, runtime postflight `43/43`, completed.
- Reinstall `r-79.7 -> r-79.7`: job `z2k-1787966336-3d5c539070e0699a`, target commit `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c`, `43/43` downloaded, verified, staged, applied, `0` removed, runtime postflight `43/43`, completed.

Every job returned `rollbackAvailable=true`, `lifecycleCleanup.pause.ok=true`, `lifecycleCleanup.pause.released=true`, and `lifecycleCleanup.lock.ok=true`. The browser's final read-only refresh shows installed `r-79.7`, latest `r-80.3`, confirmed integrity, and the reinstall action for the selected current release.

Final router evidence: Registry revision `10`, exactly `43` assets, all `43` provenance `r-79.7`, seven activation receipts with the last receipt `r-79.7` / `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c` / `43` assets; `resources_status.ok=true`, installed authority `r-79.7` with confidence `confirmed`, Lua `7/7`, integrity `verified`. `nfqws2` is running as PID `31268`, NFQUEUE `300` is owned by that PID, and the nft queue rule is present. The watchdog is one process (`/usr/bin/ucode /usr/libexec/zapret2-manager/watchdog.uc`); the final 10-sample stability window had no recovery events. Pause and lifecycle-lock files are absent after completion, and the nine old failed-attempt staging directories were removed only after verifying each contained only its temporary `runtime-activation.tsv`; final `stage.*` count is zero.

The exact broad command was run on both clean baseline and candidate after correcting a test anchor that matched the new `resource_center_update_status` export by prefix:

```text
timeout 300s node --test tests/product/z2k-*.test.mjs tests/ui/z2k-*.test.mjs
```

Baseline `f0e04b0f4bb64680b8c5bb2767d825b7e18d7508`: `105` tests, `101` pass, `4` fail, `0` skipped. Candidate: `150` tests, `146` pass, `4` fail, `0` skipped. The failing test-name set is identical and candidate-only failures are `0`; the four are the existing stale refresh-state assertion, signed-manifest fixture, upstream-classification expectation, and missing WSL `vitest` dependency. The final lifecycle focused matrix including the new regression tests and target contract is `84/84` in WSL with native OpenWrt UCode.

Final adversarial answers Q1-Q17: Q1 no watchdog interference in the final transactions; Q2 yes, the pause contract was missing and is now explicit; Q3 no duplicate watchdog process; Q4 yes, pause spans intentional mutation, restart/readiness, rollback, and cleanup; Q5 yes, recovery remains enabled after the pause is released; Q6 no candidate crash remained once the guard and readiness path were fixed; Q7 the concrete defects were the bounded synchronous RPC transport, executable-mode invocation, Registry-vs-catalog byte-size postflight assumption, and txt-to-blob downgrade mapping, all covered by tests/fixes; Q8 rpcd is healthy and `resources_status` is readable; Q9 no reload is needed for the file-based coordinator worker path (one reload was used for RPC/ACL deployment and the process remained live); Q10 no staging leak remains; Q11 no candidate-only broad regression; Q12 upgrade PASS; Q13 downgrade PASS; Q14 reinstall PASS; Q15 receipt, Registry, runtime, and Resources agree after all three operations; Q16 Strategy/autocircular identity is preserved; Q17 delivery proof follows after commit/push.

Final verdict: `Z2K VERSION LIFECYCLE READY`.

## Delivery proof — 2026-08-29

- Commit: `1926e8cddd74ccb243ae89bc5086ca5e9d013c31` (`fix: complete async z2k lifecycle transport`).
- `git rev-parse HEAD` equals `git rev-parse origin/codex/z2k-version-lifecycle`.
- Final worktree is clean.
