# Final report — Z2K lifecycle and Resource ownership gate

## Scope

Implemented the selected-tag freshness, canonical Z2K lifecycle ownership projection, generic CRUD policy gate, Resources read-only UX, import collision guard, prepare-time reference conflict, snapshot fingerprint boundary, runtime postflight assertion, and focused regression matrix from the approved plan.

## Changed surfaces

- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
  - exact `git/ref/tags/<version>` resolver;
  - annotated-tag commit resolution;
  - bounded REST diagnostics separate from raw `UPDATES.json` fetch.
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
  - derived `management` projection;
  - canonical `catalog/upstream + z2k-curated-lua` lifecycle ownership;
  - pre-write `EPOLICY` for generic update/delete;
  - projected import/update/content responses.
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
  - selected removal/reference conflict before target persistence;
  - resolved-target diagnostics;
  - existing fingerprint and runtime postflight gates retained.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
  - registry management projection is merged over installed rows and is the sole editability source.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
  - lifecycle rows are view/usage/technical/duplicate-only;
  - package rows retain read-only editor access;
  - lifecycle import collision is rejected before `assets.update`.

## Verification

Command:

```text
node --test tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-version-details-contract.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/z2m-resources-model.test.mjs tests/ui/resources-update-center.test.mjs
```

Result: 64 passed, 0 failed.

Additional evidence:

- `node --check` passed for both changed frontend modules.
- `node scripts/validate-knowledge.mjs` passed.
- OpenWrt ucode import of all three changed backend modules passed.
- Exact router resolver `r-80.3` returned immutable commit `8f3787aa999dd00ffe76871c5f343a1c049973b1`, 39 managed assets, `requestCount=3`, `restRequestCount=2`.
- Router Registry listed 43 assets: 43 lifecycle-managed, 0 editable.
- Router generic update/delete for `lua:z2k-modern-core` both returned `EPOLICY`; no write occurred.

## Live acceptance evidence

Candidate and delivery:

- Candidate branch: `codex/z2k-version-lifecycle`.
- Candidate source SHA: `a32364e7fac448958fcad684ad7ac2f297eee4bb`; docs-only acceptance commits are recorded separately in the delivery history.
- Worktree was clean before acceptance.
- Direct source-only deployment to `192.168.1.1` installed exactly five changed files: `asset-registry.uc`, `resource-update.uc`, `z2k-versions.uc`, `z2m-assets.js`, and `z2m-resources-model.js`.
- Remote backup was created before replacement; installed files are `root:root`, mode `0644`.
- Installed backend hashes and HTTP-served frontend hashes match the candidate hashes. `rpcd` was reloaded; `zapret2` was not restarted.
- No APK was built or installed. The temporary build attempt was stopped and removed after the explicit user instruction: `НИКАКИХ APK`.

Baseline and post-deploy runtime:

- Registry revision remained `7`, with `43` lifecycle assets and activation-receipt authority confirming installed `r-79.7`.
- Before and after source deployment: service `running`, `nfqws2` PID `7943`, nft queue `300`, owner match, `appliedMatch=true`, strategy `z2k_all_in_one`, and applied config SHA `26c96c5a9655a3fe1949b157f5d6b8a976d0621d5e04db45f066543c04ed5cfa`.
- Runtime hashes for `z2k-modern-core.lua`, `z2k-detectors.lua`, `z2k-state-persist.lua`, and the used `quic_1.bin` remained unchanged.
- Autocircular state remained present; its hash/line count changed during live traffic, so it is treated as mutable runtime state rather than as a source artifact.

Resources UI and ownership gate:

- With cache-disabled hard reload, Resources showed `43 ресурса · 0 пользовательских · Доступно обновление`.
- Lifecycle workspace for `Z2K modern core` showed `Управляется Z2K Core` and `Lifecycle: только через Компоненты`; `Редактор` and textbox were absent, and the viewer loaded the content.
- Direct backend negative proof returned `EPOLICY` for both update and delete; the asset revision stayed `5` and SHA stayed `5f4b5312e69447b887d868be74b756d103515eca59765f9155a358bf96da08c7`.

Broad parity comparison used the same filtered command on baseline `f0e04b0f4bb64680b8c5bb2767d825b7e18d7508` and candidate `a32364e7fac448958fcad684ad7ac2f297eee4bb`:

- Baseline: `213` tests, `200` pass, `11` fail, `2` skipped, exit `1`.
- Candidate: `223` tests, `210` pass, `11` fail, `2` skipped, exit `1`.
- The failing test-name set was identical; candidate-only failures: `0`. This is parity evidence, not a broad GREEN claim.

Machine-readable evidence: `live-acceptance-evidence.json` in this SDD directory.

## Boundaries

Package deployment is not in scope (`НИКАКИХ APK`). Browser/DOM read-only Resources acceptance is verified after cache-disabled reload. The focused `strategy-rpc-regression` test passed. The combined learned/autocircular check was not green because an unchanged existing UI contract test expects missing `learned-table-9`; this is reported rather than attributed to the lifecycle changes. The live upgrade was executed through Components UI and safely rolled back; downgrade and reinstall were intentionally stopped after the exact blocker was reproduced.

## Lifecycle operation table

| Operation | Result | Evidence boundary |
|---|---|---|
| Upgrade `r-79.7 → r-80.3` | FIRST ATTEMPT ROLLED BACK; FOLLOW-UP BLOCKED BEFORE CONFIRMATION | Actual Components UI confirmation/apply. The first `ERUNTIME` wrapping `EVERIFY` was traced to reversed UCode `join()` arguments producing a `null` activation spec; fixed in `71616247`. The follow-up fresh prepare returned `EUNAVAILABLE` because router `api.github.com` returned `403` rate limiting, so no second mutation occurred. |
| Downgrade `r-80.3 → r-79.7` | NOT RUN | Stopped after the upgrade blocker; precondition was not met. |
| Reinstall `r-79.7` | NOT RUN | Stopped after the upgrade blocker; no speculative live mutation was attempted. |

Current acceptance verdict: `NOT READY` — the serializer/runtime activation defect is fixed and covered by the final `67/67` focused gate, but a fresh UI prepare is currently blocked by the router's exhausted GitHub API rate limit (`403`, core `0/60`, reset `2026-08-28 22:54:39 MSK`). Therefore upgrade success, downgrade, and reinstall are not claimed. The prior failure path restored Registry state and left the running service healthy. CLI `resources_update` was not used as a substitute, and no APK was built or installed.

After the first rollback, the historical evidence retained a prepared `r-80.3` snapshot (`preparedAt=1787938569`); the subsequent prepare attempt consumed no target and the current read-only `resources_status` reports `preparedTarget=null` with installed authority `r-79.7`.

## Follow-up after serializer fix

- Commit `71616247bec3594b586011ad549d5e19fae2d706` is pushed to `origin/codex/z2k-version-lifecycle`; local `HEAD` equals the remote branch tip.
- Source-only router deployment installed `resource-update.uc` with SHA `dc64c09cc1699577722c6f6fde16113218da26ec6a19313bfefb6384677af509`, matching the candidate source; the previous file was backed up, ownership is `root:root`, mode `0644`, and `rpcd` was reloaded.
- Final focused verification: `67` tests passed, `0` failed. The added regression test asserts UCode's separator-first `join()` contract for token, fingerprint, and activation-spec serialization.
- Current router health is safe and unchanged by the blocked follow-up: `resources_status.ok=true`, authority `r-79.7` (`activation-receipt`), Registry revision `7`, `preparedTarget=null`, Lua `7/7`, integrity `verified`.
- In the Codex in-app Browser, LuCI authorization was restored by clicking `Log in…` and `Log in` without entering a password. The selected `r-80.3` prepare then failed before its confirmation dialog with `EUNAVAILABLE`; direct router probe confirmed GitHub `/git/ref/tags/r-80.3` returns HTTP `403`, and `/rate_limit` reported core remaining `0` of `60` until `22:54:39 MSK`.

## Final update 2026-08-29

The implementation was continued in WSL Ubuntu with native UCode. The current focused command was:

```text
timeout 180s node --test tests/product/z2k-materialization.test.mjs tests/product/z2k-full-lifecycle-review.test.mjs tests/product/z2k-final-lifecycle-ownership.test.mjs tests/product/z2k-installed-release-authority.test.mjs
```

Result: `61` tests passed, `0` failed, `0` skipped. This includes receipt resolver cases A–E, manager-sidecar refresh, lifecycle selection preservation, and runtime-mode restoration.

Commit `a9bb6240` corrected the production rollback mode bug found during the first browser upgrade attempt. Source-only router deployment now restores executable Lua/Shell assets as `0755`; the deployed closure hashes are `resource-update.uc=ca5814331cfd7a9a8202d1d36ba8634ad283a77526e3ccc2e93c61c96d007390`, `z2k-versions.uc=3653538761fc883e555724d321a518a73035e1969706c0832495913cc25b9978`, and `strategy-runtime-assets-sync.sh=7457c235d5d36c9ed5a0ad60541403a575fa35620686b13af99a472a5ffee213`.

The fresh retry was performed through the Codex in-app Browser: the `r-79.7 → r-80.3` operation reached and passed the confirmation dialog, but produced no success result. The router remained unchanged at confirmed `r-79.7`, Registry revision `7`, `preparedTarget=null`, integrity `verified`, Lua `7/7`; `nfqws2` remained running with queue `300`, and Strategy/autocircular state remained preserved. Downgrade and reinstall were not run. No APK was built or installed.

The correct final verdict is `NOT READY`. The bounded browser retry did not prove a successful lifecycle mutation, so no claim is made for upgrade success, downgrade, or reinstall. The broad WSL filtered matrix was `131` tests / `127` pass / `4` fail / `0` skipped; its failures are the known stale candidate contract, signed-update fixture, upstream-classification expectation, and missing `vitest` environment dependency, so it is not a product GREEN gate.

## Delivery

Commit and remote branch identity are recorded in the final task response after the final clean-worktree check.

## Frontend transport timeout fix — 2026-08-29

The fresh instrumented Components UI attempt reached confirmation and sent the exact `resources_update` JSON-RPC request, but the browser canceled it at `20.009981s` with `net::ERR_ABORTED` after receiving HTTP 200 headers. The response body was not available after the browser cancellation, so no backend error is invented here. Router state remained at confirmed `r-79.7`, Registry revision `7`, with no prepared target after cleanup.

The exact transport boundary was verified from the router-served LuCI `rpc.js`: request timeout is `(L.env.rpctimeout ?? 20) * 1000`; `rpc.declare({ timeout: 60 })` options are ignored by that transport. The page's generic `LOAD_TIMEOUT_MS=30000` was therefore not the first abort boundary. The fix in commit `29c3dab1` keeps ordinary page loads at `30000ms`, gives confirmed Z2K mutations an independent `180000ms` bounded lifetime, and routes `resources.update` through a direct authenticated non-batched LuCI request with an explicit `180000ms` transport timeout. Successful backend result objects and structured backend error objects remain handled by the existing checked-result path.

TDD evidence: `tests/product/z2k-frontend-timeout-contract.test.mjs` failed `2/2` before the production change and passed `2/2` after it. The complete focused matrix then passed `63/63` with native OpenWrt UCode. The exact broad command was run against both clean baseline `f0e04b0f4bb64680b8c5bb2767d825b7e18d7508` and candidate: baseline `101/105` passed, candidate `129/133` passed, with the same four failures and zero candidate-only failures. The broad result is parity evidence, not a product GREEN claim.

No APK/package build or installation was performed. Source-only router deployment and a fresh live Components UI upgrade are the next acceptance gates; downgrade/reinstall remain prohibited until the fresh upgrade succeeds.

## Final live gate after transport fix — 2026-08-29

The source-only deployment installed exactly the two changed frontend files from `29c3dab1`; router and HTTP-served SHA-256 values matched the source, ownership/mode were `root:root 0644`, and `rpcd reload` completed. WSL's NAT route could not reach `192.168.1.1` (`Network is unreachable`), so the deployment transport was Windows OpenSSH; all test execution remained in WSL Ubuntu. No APK/package operation occurred.

After cache-disabled hard reload, the Components UI prepared `r-79.7 → r-80.3` successfully using the selected immutable tag (`8f3787aa999dd00ffe76871c5f343a1c049973b1`), with `39` target assets and `6` removals. The confirmation was sent once. The new direct request stayed alive beyond 20 seconds and completed after about `27.15s`; `Network.loadingFinished` proved the transport fix.

The completed backend response is the exact blocker:

```text
EROLLBACK: Z2K runtime activation failed and rollback could not be completed.
runtime: ERUNTIME: nfqws2 is not running after Z2K activation.
rollback.registry.ok: true
rollbackAvailable: false
diagnostics: planned=39 downloaded=39 verified=39 staged=39 applied=39 removed=6 postflightMatched=39
```

Read-only router postflight is non-hybrid and operational at the prior release: authority `r-79.7` confirmed, Registry revision `7`, integrity verified, Lua `7/7`, Engine running, `nfqws2` running with queue `300`. Eight stale temporary stage directories remain under `/tmp/z2m-resource-update`; they are recorded as residue, not silently removed. No CLI lifecycle mutation was used as a substitute.

The approved sequence stops after this failed fresh upgrade. Downgrade and reinstall are `NOT RUN`. Final verdict: `NOT READY` — backend runtime activation cannot keep `nfqws2` running after target activation, and rollback reports failure. This is no longer a frontend transport-timeout blocker.

## Final readiness-gate attempt — 2026-08-29

The bounded readiness implementation from `25a03b45c8217243601c8cf7e138926b0df22cc0` was deployed source-only to the router. The user then confirmed the visible Components UI action and one fresh `r-79.7 → r-80.3` upgrade was executed. The UI left its working state without a success state; the installed version remained `r-79.7`, so the approved sequence stopped. No downgrade or reinstall was run.

The exact observed runtime blocker is recorded by router events during target activation: `nft table zapret2 missing or empty` at `23:07:02Z`, followed by `nfqws2 process gone; recovery start rc=0` at `23:07:04Z`. The candidate runtime did not remain ready. The final read-only state is safe and non-hybrid: `NFQWS2_ENABLE=1`, PID `452`, queue `300` owned by PID `452`, nft rules target queue `300`, Registry revision `7`, confirmed authority `r-79.7`, integrity `verified`, Lua `7/7`, `preparedTarget=null`, and Strategy identity preserved. The transient Browser toast had expired before capture; no structured backend body is claimed beyond these exact observations.

The failed operation changed `/tmp/z2m-resource-update` from `8` to `9` directories and left `stage.mjiljL/runtime-activation.tsv`. A TDD RED/GREEN follow-up added `tests/product/z2k-staging-cleanup.test.mjs` and registered the activation spec in the existing cleanup path. Commit `a90658fa85d72a56612528d4ac6ebfa5b27f7a44` was deployed source-only; router/source SHA-256 is `ff51ecc906d54a5dae55adb915652b8bda5e7687da3beaf720daa8e3e35fb412`, mode `root:root 0644`. The cleanup fix is not live-revalidated because the lifecycle stop gate forbids another mutation after the failed upgrade.

Post-fix focused verification passed `68/68` in WSL Ubuntu with native OpenWrt UCode. The source-only reload printed `rpcd` registration errors and `Segmentation fault`; it was not retried. A read-only follow-up confirmed a live rpcd process and readable `ubus resources_status`. No zapret2 restart and no APK/package build or install occurred.

Final review:

1. Yes, the original false-negative was caused by the premature PID check; the new bounded gate waits for complete runtime evidence. The fresh candidate subsequently failed to stay ready.
2. Diagnostic restart→PID latency: `40–90 ms`.
3. Diagnostic restart→queue-300 latency: `200–210 ms`.
4. Yes, bounded to `12 s` with `1 s` polls.
5. Yes, target activation uses it.
6. Yes, rollback uses the same contract.
7. Yes, a permanently crashing daemon reaches bounded `ERUNTIME` diagnostics.
8. Yes, the kernel queue listener and peer PID are checked in addition to nft rules.
9. No; the fresh upgrade did not pass.
10. Not run; blocked by the required stop gate.
11. Not run; blocked by the required stop gate.
12. Not established for all three operations; current post-rollback Registry, receipt, and runtime agree on `r-79.7`.
13. Preserved in the current post-rollback state; no all-three-cycle claim is made.
14. No candidate-only broad regression: the exact broad matrix remained `135/139` passed with the same four baseline/environment failures.

Final verdict: `Z2K VERSION LIFECYCLE NOT READY`. Blockers: the fresh `r-80.3` runtime activation did not remain ready, and downgrade/reinstall were therefore not run.

## Final autonomous lifecycle completion — 2026-08-29

The approved live sequence was completed end-to-end through the Codex in-app Browser. No CLI lifecycle mutation, APK build, APK install, or package deployment was used.

| Operation | Job | Target commit | Registry transaction | Runtime postflight | Cleanup | Result |
|---|---|---|---:|---:|---|---|
| Upgrade `r-79.7 -> r-80.3` | `z2k-1787965701-af29beb70f4393de` | `8f3787aa999dd00ffe76871c5f343a1c049973b1` | `39 applied / 6 removed` | `39/39`, `ok=true` | pause released, lock released | PASS |
| Downgrade `r-80.3 -> r-79.7` | `z2k-1787966219-a6dac665f7d6a2bd` | `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c` | `43 applied / 2 removed` | `43/43`, `ok=true` | pause released, lock released | PASS |
| Reinstall `r-79.7 -> r-79.7` | `z2k-1787966336-3d5c539070e0699a` | `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c` | `43 applied / 0 removed` | `43/43`, `ok=true` | pause released, lock released | PASS |

Each row used fresh PREPARE, immutable target identity, visible browser confirmation, full download/verify/stage/apply, runtime restart/readiness, and postflight. The final browser refresh shows `r-79.7` installed, `r-80.3` latest, `Подтверждена` integrity, and `Переустановить r-79.7` for the current selection.

Final router postflight is non-hybrid: Registry revision `10`; `43` assets, all with provenance version `r-79.7`; seven activation receipts, with the last receipt `r-79.7`, source commit `8455ae2c5da9c60d7c9ff07409b79ea6d04dd16c`, and `43` members; `resources_status.ok=true`; confirmed installed authority `r-79.7`; integrity `verified`; Lua `7/7`. The runtime is `nfqws2` PID `31268`, NFQUEUE `300` with matching owner, and the nft queue rule is present. The live command line still includes the canonical Strategy `z2k_all_in_one`, Z2K Lua assets, and `z2m-autocircular-policy.lua`; `status.json` reports one runtime instance, three profiles, and rules present. The autocircular state remained present and was treated as mutable runtime state, not overwritten by lifecycle.

Watchdog evidence is explicit: one watchdog process was present, `/tmp/zapret2-manager/paused` was held by each intentional lifecycle worker and released in each result, and the final 10-sample stability check had no watchdog recovery events. The old event log retains historical crash-recovery entries from failed iterations, but no matching watchdog recovery occurred during the final three transactions. After lifecycle completion, watchdog remained active, so ordinary post-lifecycle crash recovery is preserved. Guards and all final lifecycle locks are absent. Nine stale directories from earlier failed iterations were inspected and removed with exact file deletion plus `rmdir`; no recursive broad deletion was used, and final `stage.*` count is zero.

The final broad parity command was identical on baseline and candidate:

```text
timeout 300s node --test tests/product/z2k-*.test.mjs tests/ui/z2k-*.test.mjs
```

Baseline `f0e04b0f4bb64680b8c5bb2767d825b7e18d7508`: `105 / 101 pass / 4 fail / 0 skipped`. Candidate: `150 / 146 pass / 4 fail / 0 skipped`. Failure names are identical; candidate-only failures `0`. The four known failures are the stale refresh-state assertion, signed-manifest fixture assertion, upstream classification expectation, and missing WSL `vitest` dependency. The focused lifecycle/ownership matrix, including async transport, runtime guard, postflight-size, downgrade type, target contract, materialization, and receipt-authority tests, passed `84/84` in WSL with native OpenWrt UCode. JS syntax checks, `git diff --check`, and the knowledge validator passed.

### Final adversarial review Q1-Q17

1. No watchdog interference in the final transactions; the lifecycle pause was active throughout each intentional window.
2. Yes. Z2K lacked the Engine-style pause contract; the canonical pause flag is now acquired before mutation and released only during final cleanup.
3. No. The final router process list contains one watchdog instance.
4. Yes. Mutation, restart/readiness, rollback, and cleanup run under the same guard.
5. Yes. Releasing the pause restores normal watchdog recovery; the final stability window proves it remained active.
6. No remaining candidate crash was observed once the guard, bounded readiness, and activation fixes were deployed.
7. The engineering defects fixed were the 20-second LuCI transport abort, non-executable `/etc/init.d/zapret2` invocation, catalog-missing byte-size postflight check, and `txt` classification not mapping to Registry `blob` during downgrade. Each has focused regression coverage.
8. Yes. rpcd is live and `resources_status` is readable after the one deployment reload; no repeated reload is required for the file-based worker coordinator.
9. No for coordinator source changes; the RPC/ACL deployment reload was performed once, with the process and RPC remaining healthy.
10. No. Final staging count is zero and guards/lock are absent.
11. No. Same broad failure set on baseline and candidate; candidate-only failures `0`.
12. PASS. Fresh UI upgrade completed with `39` target assets and `6` removals.
13. PASS. Fresh UI downgrade completed with `43` target assets and `2` removals.
14. PASS. Fresh UI reinstall completed with `43` target assets and `0` removals.
15. Yes. After each operation, the activation receipt, Registry membership, runtime bytes/postflight, and final Resources projection agree; final authority is `r-79.7`.
16. Yes. Strategy identity, nfqws2 command line, rules, and autocircular state were preserved.
17. PASS. Commit `1926e8cddd74ccb243ae89bc5086ca5e9d013c31` is pushed; local `HEAD` equals `origin/codex/z2k-version-lifecycle`, and the final worktree is clean.

Final acceptance verdict before delivery: `Z2K VERSION LIFECYCLE READY`.

## Managed release details UI — 2026-08-29

This bounded follow-up continued directly on `codex/z2k-version-lifecycle`, without creating an additional branch, agent, APK, or package operation. Base commit was `30e5b637fbe0026d7cba2d7b43d93758aad77689`; implementation commit is `7dda7d09f686d524fe79dce88a9795159f97db6f`.

- Backend `installChanges` now compares the confirmed installed manifest to the selected release through exact-managed membership only. It exposes `modified/added/removed`, grouped path arrays, structured item arrays, and a deduplicated compatibility `managedPaths` union. Removed items retain the old membership identity (`id`, `name`, `sourcePath`, `type`). Upstream release history remains separate in `releaseChanges` and the compare link.
- The Components model preserves the grouped contract. The expanded Z2K panel now uses `installChanges` for the prominent `Что изменится на устройстве` section and renders only managed item names/paths; the human `Что нового в r-X` body and `Сравнить upstream изменения ↗` remain intact. No prepare, confirm, mutation, rollback, runtime, receipt, ownership, or watchdog semantics changed.
- TDD evidence: the managed-delta regression covers exact-managed noise filtering, modified/added/removed identity, count/array invariants, and deduplicated paths. The focused lifecycle/ownership/UI matrix passed `107/107`; both frontend files passed `node --check`; `git diff --check` passed. A browser-only VDOM defect (`[object HTMLDivElement]`) was found after the first deployment, reproduced as a focused RED assertion, fixed by flattening the region children, and the UI test returned `14/14`.
- Source-only router deployment used Windows OpenSSH with `scp -O`, backups, staging, `root:root`, mode `0644`, and one `rpcd reload`. Final deployed hashes: `z2k-versions.uc=5db939dfe883491ad5903e64aa3a1720873063182289095e212336faf32b8565`, `z2m-components-model.js=38c5f22b949cc2131f499f14820e036f3131207bb04b428711d16ba9ab64fe0c`, `z2m-maintenance.js=65f04b1e9b16f3eae5e6db12787f40e920c0f6b865bdd39cd52e8f3faa5e49f8`, `z2m-components.css=116b50f6da1e942025381ea719fcb2204e5dabaade9eee1146b1ada276851920`.
- Real-router read-only browser acceptance after cache-disabled reload selected `r-80.3` from installed `r-79.7` and showed `Обновится · 2`, `Добавится · 2`, `Удалится · 6`; managed names included `z2k-alert.lua`, `z2k-state-persist.lua`, `active_discord_udp.bin`, `warp-endpoints.txt`, and the six removed exact-managed resources. `S51z2k-warp`, `mtproxy-client`, `webpanel`, the old upstream heading, and `[object HTMLDivElement]` were absent. The compare link remained; no update button or confirmation was activated.
- Router `zapret2-manager resources_status` remained readable and non-mutated: `resourcesStatus.ok=true`, installed authority `r-79.7` with confirmed confidence, Registry revision `10`, integrity `verified`, Lua `7/7`, and `preparedTarget=null`.

Final verdict: `Z2K MANAGED RELEASE DETAILS READY`.
