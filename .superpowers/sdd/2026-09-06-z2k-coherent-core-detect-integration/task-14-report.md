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

## Re-review fixes — 2026-09-07

The re-review implementation is committed as `e8e11dd7` (`fix: close Task 14 canonical readiness and a11y review`). The report update is committed separately after evidence capture. No unrelated files were modified in this pass.

### Exact files changed in this pass

- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `tests/product/z2k-runtime-summary.test.mjs`
- `tests/ui/scanner-accessibility-behavior.test.mjs`
- `tests/ui/assets-import-accessibility.test.mjs`
- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/task-14-report.md`

### TDD RED evidence

The new behavioral tests were written before the production changes.

```text
wsl -e bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-runtime-summary.test.mjs"
```

Exit 1: 7 tests, 5 passed, 2 failed. Both expected failures showed `ready` instead of `degraded` for an incompatible local Detect contract and divergent remote coherence.

```text
node --test tests/ui/scanner-accessibility-behavior.test.mjs tests/ui/assets-import-accessibility.test.mjs
```

Exit 1: 3 tests, 0 passed, 3 failed. The expected failures were missing target focus/ARIA mutation, missing Scanner `role="status"`, and missing asset import names/autocomplete metadata.

### GREEN and verification evidence

Canonical runtime regression gate:

```text
wsl -e bash -lc "cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-runtime-summary.test.mjs"
```

Exit 0: 7 passed, 0 failed. Healthy and update projections are ready/compatible only with valid local Detect status/compatibility and aligned remote coherence; incompatible local Detect and divergent coherence are degraded with `detect.status=unknown` and `detectCompatible=false`.

Focused UI and behavioral gate:

```text
node --test tests/ui/scanner-accessibility-behavior.test.mjs tests/ui/assets-import-accessibility.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/ui/z2k-coherent-ui.test.mjs
```

Exit 0: 17 passed, 0 failed.

Prescribed Task 14 gate:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Exit 0: 18 passed, 0 failed.

Production package/closure/public-projection gate:

```text
node --test tests/native/avatar-strategy-scanner-package.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs tests/knowledge/public-projection.test.mjs tests/ui/frontend-module-closure.test.mjs
```

Exit 0: 22 passed, 0 failed.

The prescribed and additional Node syntax checks all exited 0:

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js
```

`node scripts/validate-knowledge.mjs` exited 0 with `Knowledge validation passed.`; `git diff --check` exited 0.

### Canonical readiness and UI review changes

| Before | After | Why |
| --- | --- | --- |
| `resource-update.uc` reconstructed Detect readiness from health, digests, architecture, and commit identity, while the local authority omitted explicit readiness fields. | The canonical `z2k_detect_status` contract supplies local Detect evidence; the projection preserves `local.detect.status/compatible`, and the health gate requires `status=ready`, `compatible=true`, and aligned `remote.coherence` before projecting `detect.status=ready` and `detectCompatible=true`. | One Detect/runtime authority; divergent, incompatible, missing, broken, or incomplete evidence fails closed. |
| Invalid Scanner target validation showed an inline error but did not move keyboard focus. | The first invalid target input receives focus and retains `aria-invalid=true` plus `aria-describedby=z2m-scanner-target-error`; valid submission clears the description. | Keyboard users reach the actionable error immediately without changing the existing form flow. |
| Async Scanner progress and successful results had no single polite announcement region. | Progress and completed result containers each use one `role=status` region; no redundant `aria-live` is added. | Screen readers receive concise state changes without duplicate announcements. |
| Asset import controls had labels but no stable field names or autofill metadata. | Type, stable ID, and content controls now have `name` and `autocomplete=off`; the ID also uses `autocapitalize=none` and `spellcheck=false`. | Stable semantics and predictable entry for import data, preserving existing import behavior. |

### Explicit four-skill design checklist

- Emil design engineering: the pass preserves the existing calm `z2m-*` APP language and utility copy; it adds no visual system or decorative redesign, no `transition: all`, no `scale(0)`, and no entering `ease-in`. Existing explicit sub-300ms transitions, `:active`, reduced-motion, and hover guards remain covered by `tests/ui/scanner-ui-rework.test.mjs` and the prior checklist (`z2m-components.css:395-415`).
- Design consultation: product outcome remains one coherent Z2K Core, one source of truth, and an obvious status/action relationship. Existing tokens, panels, form fields, and buttons were reused.
- Design review: hierarchy, error/success/loading state, mobile/touch behavior, keyboard focus, copy, and no-card-grid redesign were reviewed. The current findings are recorded in the Before | After | Why table above. Live browser/visual verification remains **UNVERIFIED** because browser acceptance was out of scope.
- Web Interface Guidelines: target focus and `aria-invalid`/`aria-describedby` are behavioral-tested (`z2m-scanner.js:326-340`); one polite status region is behavioral-tested (`z2m-scanner.js:376`, `426`); stable form metadata is tested (`z2m-assets.js:78`); semantic buttons/inputs, focus-visible, reduced motion, explicit transitions, long/error states, and 44px targets remain covered by the existing UI contract (`z2m-scanner.js:436-477`, `z2m-components.css:395-415`). Fresh rules source used: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

### Known baseline failures and unrun boundaries for this pass

An expanded Scanner test command was intentionally not treated as green:

```text
node --test tests/ui/scanner-accessibility-behavior.test.mjs tests/ui/assets-import-accessibility.test.mjs tests/ui/scanner-detect-api-boundary.test.mjs tests/ui/scanner-runtime-integration.test.mjs tests/ui/scanner-detect-generation.test.mjs tests/ui/scanner-detect-history.test.mjs tests/ui/scanner-targets.test.mjs
```

Exit 1: 21 tests, 18 passed, 3 failed. The three failures are obsolete legacy tests that try to read intentionally removed `z2m-scanner-hub.js` and `z2m-scanner-targets.js`; the surviving typed Detect suite passed. Their assertions were not weakened and no old modules were reintroduced.

The extended WSL runtime command reached the surviving runtime tests, but exited 1 with 68 total, 48 passed, 18 failed, 1 skipped, 1 todo because several older test harnesses invoke `/opt/ucode/bin/ucode` without a loadable `libucode.so.0`. The canonical `z2k-runtime-summary`, `z2k-runtime-composition`, and `z2k-runtime-readiness` portions passed; this environment limitation is not reported as a green full runtime suite.

Still unrun by explicit boundary: router deployment/runtime postflight, live Detect/autodiscovery on a router, browser/E2E acceptance, human visual approval, full repository harness, package build/release verification, merge, and push. No router, browser, deploy, merge, push, or second worktree was used.

### Worktree and commits

- `e8e11dd7` — implementation, behavioral regressions, and accessibility fixes.
- The report update is committed separately after the implementation commit.
- Worktree must be clean after the report commit; no unrelated files are included.

## Minor UI re-review fix — 2026-09-07

Implementation commit: `618c004e` (`fix: preserve Scanner segmented focus outline`). This is the remaining scoped UI fix; no router, browser, deploy, merge, push, or second worktree was used.

### Exact files changed in this pass

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `tests/ui/scanner-ui-rework.test.mjs`
- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/task-14-report.md`

### TDD evidence

The focused assertion was added before the CSS change:

```text
node --test tests/ui/scanner-ui-rework.test.mjs
```

RED: exit 1; 7 tests, 6 passed, 1 failed. The new assertion correctly found the unscoped `.z2m-app .z2m-scanner-segmented button:hover { outline:none }` rule.

After the CSS fix:

```text
node --test tests/ui/scanner-ui-rework.test.mjs tests/ui/scanner-accessibility-behavior.test.mjs tests/ui/z2k-coherent-ui.test.mjs
```

GREEN: exit 0; 16 passed, 0 failed.

Relevant syntax and diff checks:

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js
git diff --check
```

All exited 0.

### Design review finding

| Before | After | Why |
| --- | --- | --- |
| Fine-pointer hover rules applied `outline:none` to `.z2m-scanner-segmented button:hover`, which could override the visible keyboard focus ring when a focused button was also hovered. | Both segmented hover selectors use `:hover:not(:focus-visible)`, so hover polish applies only when the control is not keyboard-focused; the existing `:focus-visible` outline remains visible. | Pointer hover must not hide keyboard focus. This keeps the existing visual language and hover guard while preserving accessible focus indication. |

Design checklist for this pass:

- Emil design engineering: no new visual system, motion, decorative treatment, or transition change; existing calm APP UI and explicit focus treatment are preserved.
- Design consultation: the fix remains scoped to the one coherent Scanner interaction outcome and reuses the existing `:focus-visible` token/style.
- Design review: pointer/keyboard interaction conflict was reviewed; responsive/touch behavior is unchanged, and browser visual verification remains **UNVERIFIED** because browser acceptance was not run.
- Web Interface Guidelines: the regression assertion covers focus-visible precedence in the hover media guard; the existing semantic buttons, 44px targets, reduced-motion rule, and explicit transitions remain unchanged. Fresh guideline source is recorded above: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

### Boundaries

No router deployment/runtime postflight, live browser/E2E acceptance, full repository harness, package build/release verification, merge, or push was run. The worktree is expected to be clean after the report commit.
