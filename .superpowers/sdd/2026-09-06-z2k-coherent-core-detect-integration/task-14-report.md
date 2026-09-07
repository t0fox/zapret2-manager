# Task 14 report — Z2K Detect Scanner/UI integration and review fixes

## Result

Task 14 and the review findings are implemented in the requested isolated worktree on `codex/z2k-coherent-core-detect`.

- `f10b5fcf2ca55ef92b70202a3db9901892354548` — initial Task 14 implementation.
- `d5636b5ecaf2a2cfba682c267dc99e09d914e9a1` — review fix: canonical Detect/runtime health, production closure, behavioral tests, autodiscovery UI, and UI accessibility/motion fixes.
- `424122d1264614cc177e38e28b4ffc4635652339` — review style fix: Scanner stage motion reduced to an explicit `.24s ease-out` transition.

No router deployment, browser acceptance, merge, push, or second worktree was used.

## Exact changed files

The complete Task 14 change set from the Task 14 implementation parent through the review fixes is:

- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/task-14-report.md` (this report)
- `docs/02-architecture/scanner-runtime-authority.md`
- `docs/03-products/scanner-runtime.md`
- `docs/08-development/z2k-avatar-integration.md`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- `router-deploy-runtime-composition.manifest`
- `scripts/public-projection.mjs`
- `tests/native/avatar-strategy-scanner-package.test.mjs`
- `tests/native/core/scanner-probe-native.test.mjs` (removed obsolete legacy contract)
- `tests/product/avatar-parity-fixture.test.mjs` (removed obsolete legacy contract)
- `tests/product/avatar-strategy-scanner-integration.test.mjs` (removed obsolete legacy contract)
- `tests/product/avatar-strategy-scanner-planner.test.mjs` (removed obsolete legacy contract)
- `tests/product/avatar-strategy-scanner-probes.test.mjs` (removed obsolete legacy contract)
- `tests/product/avatar-strategy-scanner-worker.test.mjs` (removed obsolete legacy contract)
- `tests/product/scanner-budget-contract.test.mjs` (removed obsolete legacy contract)
- `tests/product/scanner-funnel-red.test.mjs` (removed obsolete legacy contract)
- `tests/product/scanner-history-nfqueue-contract.test.mjs` (removed obsolete legacy contract)
- `tests/product/scanner-planner-runtime-contract.test.mjs` (removed obsolete legacy contract)
- `tests/product/scanner2-bounded-behavior.test.mjs` (removed obsolete legacy contract)
- `tests/product/z2k-old-scanner-unwired.test.mjs`
- `tests/product/z2k-runtime-summary.test.mjs`
- `tests/ui/scanner-ui-rework.test.mjs`
- `tests/ui/z2k-coherent-ui.test.mjs`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-orchestrator.uc` (removed; it imported retired modules)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc` (removed)

## RED evidence

Before production rewiring, the required RED command was run exactly:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Result: exit 1; 11 tests total, 7 passed, 4 failed. The four failures were the expected pre-fix findings: retired `scanner-planner.uc` still present, deleted-worker references in deployment/projection closure, and healthy/update coherent Core fixtures incorrectly normalizing to degraded. Broken, missing, and stale/incoherent fail-closed cases already passed.

## GREEN and syntax evidence

Required focused GREEN gate:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Result: exit 0; 18 passed, 0 failed.

Required syntax checks all exited 0:

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
```

Additional changed-UI syntax checks also exited 0 for `z2m-api.js`, `z2m-components-model.js`, and `z2m-scanner-product.js`.

Focused closure/projection suite:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/native/avatar-strategy-scanner-package.test.mjs tests/knowledge/public-projection.test.mjs
```

Result: exit 0; 27 passed, 0 failed. The package/closure/public-projection subset is 13/13.

Canonical backend runtime suite under WSL with `/opt/ucode/bin/ucode`:

```text
wsl -e bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-runtime-summary.test.mjs"
```

Result: exit 0; 5 passed, 0 failed. The Windows invocation is bounded by the unavailable local ucode binary: 1 passed and 4 skipped, 0 failed.

Other gates:

- `node scripts/validate-knowledge.mjs` — `Knowledge validation passed.`
- `git diff --check` — passed.
- `node --test tests/ui/scanner-ui-rework.test.mjs` after the final motion fix — 7 passed, 0 failed.

## Behavioral coverage and implementation

- `z2m-components-model.js` now validates Detect architecture/digest/source identity against the canonical runtime health, coherence, compatibility identity, and bundle digest. Healthy and update states derive `ready`/`compatible`; broken, missing, stale, and incoherent states remain degraded or fail-closed.
- `resource-update.uc` projects the canonical runtime Detect identity and derives validated `detect.status`/`detectCompatible`; no second Detect authority was introduced.
- `tests/ui/z2k-coherent-ui.test.mjs` invokes the real model normalizer and covers healthy, update, broken, missing, stale/incoherent, managed Resources, independent Avatar ownership, and no independent Z2K refresh.
- `scanner-cli.uc` is a compatibility shell over typed Detect actions only. Scanner dispatch tests call the real exported mapping and typed API stubs for `probe`, `classify`, `quic`, `voice`, and `tcp16`.
- Scanner error tests preserve canonical Detect codes and map unknown errors to `EDETECT_FAILED`; there is no Detect-to-old-scanner fallback.
- Scanner autodiscovery uses typed status plus enable/disable/restart controls, with canonical loading, ready, schema-invalid, unavailable, and error normalization. The UI exposes the status/control state instead of static copy.
- Production manifests, RPC/UI closure tests, and public-projection evidence no longer reference deleted scanner planner/worker/probe modules.
- Legacy tests that asserted the intentionally removed implementation were deleted and replaced by behavioral Detect and production-closure tests; assertions were not weakened.
- Avatar/other independent source update ownership remains preserved.

## Design consultation and direction

Product outcome stated before UI edits: one coherent Z2K Core, one source of truth, and an obvious status/action relationship across Components, Resources, and Scanner.

Direction: calm APP UI using existing `z2m-*` tokens, panels, buttons, and hierarchy; utility copy; explicit ready/update/broken/unavailable states; no new visual system, decorative card/grid redesign, or parallel lifecycle. The existing visual language was searched and preserved before the scoped style/accessibility adjustments.

## Design review findings

| Before | After | Why |
| --- | --- | --- |
| Components had Detect architecture/digest evidence but the model defaulted status to `unknown`/compatible `false`, so healthy/update Core appeared degraded. | `normalizeDetect()` and the runtime health gate validate canonical readiness and compatibility, while broken/missing/stale/incoherent inputs fail closed. | One trustworthy Core status and obvious action state. |
| Scanner described strategy selection and had static autodiscovery copy. | Copy describes detection/classification; typed autodiscovery status/control/error states are rendered from the canonical interface. | Matches actual ownership and avoids fake controls. |
| Scanner controls used small/implicit interaction and motion rules. | Scoped Scanner controls have 44px targets, `:active`, `:focus-visible`, fine-pointer hover guards, explicit sub-300ms transitions, and reduced-motion handling. | Mobile touch, keyboard, and calm APP UI behavior. |
| Target validation was visual-only inline text. | URL input has `name`/`autocomplete`/`inputmode`, `aria-invalid`/`aria-describedby`, and an `alert` error node. | Screen-reader and form error state is explicit. |

Live browser/visual verification: **UNVERIFIED** by boundary; no browser acceptance was run.

## Explicit design checklist

- Emil APP UI: existing `z2m-*` language preserved; no new decorative system; no `transition: all` or `scale(0)` in the affected CSS; new Scanner transitions list properties and stay below 300ms; `:active` feedback is present (`z2m-components.css:396-408`); reduced motion is present (`z2m-components.css:413-415`); entering UI uses no new `ease-in` transition.
- Design consultation: single Z2K Core outcome and canonical ownership were stated before edits; existing tokens/components were reused.
- Designer review: hierarchy/copy, update/error/empty/loading states, mobile stacking, 44px targets, keyboard focus, and no visual-system redesign were checked. Browser rendering remains unverified.
- Web Interface Guidelines: semantic `<button>`/`<select>`/`<label>` paths (`z2m-scanner.js:305-306`, `z2m-scanner.js:427-477`); status/alert live regions (`z2m-scanner.js:317`, `z2m-scanner.js:400-406`); focus-visible (`z2m-components.css:397`, `z2m-components.css:407`); reduced motion and explicit transitions (`z2m-components.css:395`, `z2m-components.css:413-415`); hover guard (`z2m-components.css:399-403`); long text/overflow handling remains in existing Scanner styles (`z2m-ui.css:3348-3359`); exact Detect error copy and next-step retry remain in `z2m-scanner.js:311-320`.
- Fresh rules source used for this checklist: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), fetched during this review.

## Known baseline failures and unrun boundaries

Before reconciling obsolete tests, the intentional-retirement baseline was run:

```text
node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs tests/native/avatar-strategy-scanner-package.test.mjs
```

Result: exit 1; 83 tests total, 7 passed, 76 failed. These are legacy contracts requiring deleted worker/probe/planner modules or asserting that they remain packaged. They were removed as obsolete and replaced with typed Detect behavioral and production-closure coverage.

The following remain explicitly unrun: router deployment/runtime postflight, live Detect/autodiscovery on a router, browser/E2E acceptance, human visual approval, full repository test harness, package build/release verification, merge, and push.

## Worktree state

After committing the report, the worktree is expected to be clean. No unrelated files were modified.
