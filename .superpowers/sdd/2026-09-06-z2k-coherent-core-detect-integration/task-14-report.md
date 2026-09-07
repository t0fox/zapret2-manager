# Task 14 report — Z2K Detect Scanner/UI integration

## Result

Implemented Task 14 in the existing `codex/z2k-coherent-core-detect` worktree.
No router deployment, browser acceptance, merge, push, or second worktree was used.

Implementation commit: `f10b5fcf2ca55ef92b70202a3db9901892354548`

## Exact changed files

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc` (removed)
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-orchestrator.uc` (removed because it retained imports of the four retired modules)
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `tests/ui/z2k-coherent-ui.test.mjs`
- `tests/ui/scanner-ui-rework.test.mjs`
- `tests/product/z2k-old-scanner-unwired.test.mjs`

## RED evidence

Before production rewiring, ran exactly:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Result: `5 failed, 1 passed`.
The failures were the expected old `scanner-worker` import, missing typed Detect shell/import closure, and missing coherent Components/maintenance projection assertions. This RED output was recorded before production changes.

## GREEN evidence

Prescribed focused gate:

```text
node --test tests/ui/z2k-coherent-ui.test.mjs tests/ui/scanner-ui-rework.test.mjs tests/product/z2k-old-scanner-unwired.test.mjs
```

Result: `9 passed, 0 failed`.

Syntax gates passed with exit code 0:

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js
```

Additional checks passed:

- `node scripts/validate-knowledge.mjs` — `Knowledge validation passed.`
- `git diff --check` — clean.
- Production import-closure test covers all scanner ucode, RPC ucode, and Scanner UI JavaScript; no retired module imports remain.

## Implemented behavior

- `scanner-cli.uc` is now a compatibility shell over typed `z2k_detect_*` actions and discovery controls only.
- Scanner UI exposes `probe`, `classify`, `quic`, `voice`, `tcp16`, autodiscovery messaging, typed Detect result/history provenance, and canonical Detect errors.
- Legacy candidate-count/planner-complexity controls and Detect-to-old-scanner fallback are absent.
- Components projects one Z2K Core with release, strategy count, runtime/compatibility identity, Detect architecture/status, and coherent health/update states.
- Resources/Assets identify Z2K-owned content as `Управляется Z2K Core` and no longer offer an independent resource update action.
- Independent strategy-source/Avatar projection remains available through the existing strategy-source path.

## Known baseline failures

The pre-existing Manager-owned Scanner harness was run after the intentional retirement:

```text
node --test tests/product/avatar-strategy-scanner-worker.test.mjs tests/product/avatar-strategy-scanner-probes.test.mjs tests/native/avatar-strategy-scanner-package.test.mjs
```

Result: `82 tests: 4 passed, 78 failed`.
These failures are legacy contracts that require the removed worker/probe files or assert that those files are packaged. They are expected consequences of Task 14 and are not represented as GREEN.

## Unrun boundaries

- Full repository test harness was not run.
- ucode execution/compile validation was not run on OpenWrt or a router.
- Router deployment/runtime postflight was not run.
- Browser/E2E and human visual acceptance were not run.
- Package build/release verification was not run.
- Merge and push were not performed.

## Worktree state

The implementation commit was created on the requested isolated branch. The report is committed separately after this evidence capture.
