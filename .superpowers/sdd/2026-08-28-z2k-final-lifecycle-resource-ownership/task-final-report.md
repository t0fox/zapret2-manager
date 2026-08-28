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
- Candidate SHA and remote SHA: `a32364e7fac448958fcad684ad7ac2f297eee4bb`.
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
| Upgrade `r-79.7 → r-80.3` | FAILED → ROLLED BACK | Actual Components UI confirmation/apply. `ERUNTIME` wrapping `EVERIFY`: `Registry removal target has no safe runtime mapping`, `id=blob:4pda`. Registry rollback `ok=true`; current authority restored to `r-79.7`. |
| Downgrade `r-80.3 → r-79.7` | NOT RUN | Stopped after the upgrade blocker; precondition was not met. |
| Reinstall `r-79.7` | NOT RUN | Stopped after the upgrade blocker; no speculative live mutation was attempted. |

Current acceptance verdict: `NOT READY` — the actual UI upgrade reproducibly blocks on the removal mapping for `blob:4pda`; downgrade and reinstall are not claimed. The failure path restored Registry state and left the running service healthy. CLI `resources_update` was not used as a substitute, and no APK was built or installed.

After rollback, read-only `resources_status` still exposed the prepared `r-80.3` upgrade snapshot (`preparedAt=1787938569`) while the installed authority was `r-79.7`; no replay or manual cleanup was performed.

## Delivery

Commit and remote branch identity are recorded in the final task response after the final clean-worktree check.
