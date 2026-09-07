# Final whole-branch review fix report

Branch: `codex/z2k-coherent-core-detect`  
Worktree: `G:\zapret2-manager\.worktrees\z2k-coherent-core-detect`

## Implemented findings

- `z2m-resources-model.js`: unresolved `catalog/upstream` registry rows are no
  longer appended to `z2k-resources`; they are returned as explicit
  `unassignedAssets` with `state: unknown`.
- `z2m-components-model.js`: legacy Lua counts can no longer produce `ready`;
  canonical V3/runtime/Detect evidence remains the readiness gate.
- `z2k-versions.uc`: the production `z2k_compare_versions` comparator now
  fails closed for unresolved cross-family ordering, preserving the existing
  numeric sign convention for same-family versions.
- `resource-update.uc`: the prepare path now routes target operation through
  authoritative family-aware comparison and rejects unresolved ordering before
  mutation. Rollback verification consumes captured `receiptId` and
  `runtimeBundleDigest`; exact receipt/digest restoration passes while either
  mismatch fails closed. The post-materialize failure seam verifies the exact
  LKG receipt object and digest through the same identity matcher.

## Changed files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `tests/product/z2m-resources-model.test.mjs`
- `tests/ui/components-truth-normalization.test.mjs`
- `tests/product/z2k-update-source-integration.test.mjs`
- `tests/product/z2k-coherent-transaction.test.mjs`
- `.superpowers/sdd/2026-09-06-z2k-coherent-core-detect-integration/final-review-fix-report.md`

## Test evidence

Focused regression and verification results:

- `node --test tests/ui/components-truth-normalization.test.mjs` — **6 passed, 0 failed, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test --test-name-pattern="cross-family ordering fails closed" tests/product/z2k-update-source-integration.test.mjs'` — **1 passed, 0 failed, 0 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test --test-name-pattern="production target operation|rollback verification|post-materialize readiness" tests/product/z2k-coherent-transaction.test.mjs'` — **3 passed, 0 failed, 20 skipped**.
- `wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/g/zapret2-manager/.worktrees/z2k-coherent-core-detect && UCODE_BIN=/opt/ucode/bin/ucode node --test tests/product/z2k-coherent-transaction.test.mjs'` — **23 passed, 0 failed, 0 skipped**.
- `node --test tests/product/z2k-version-details-contract.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs` — **15 passed, 0 failed, 0 skipped**.
- `node --test tests/product/z2m-resources-model.test.mjs` — **21 passed, 5 failed, 0 skipped**. The five failures are pre-existing Resources callout/count expectations; the new unresolved-asset regression passes. The same unrelated failures were present in the pre-fix RED run.
- Full `z2k-update-source-integration.test.mjs` under WSL/ucode — **13 passed, 1 failed, 0 skipped**. The new cross-family regression passes; the remaining failure is the pre-existing presentation request-count expectation (`3` actual vs `5` expected), present in the pre-fix RED run.
- `node --check` on both changed UI model files — **passed**.
- `git diff --check` — **passed**.

## Design checklist

| Check | Result |
| --- | --- |
| Existing Russian UI language preserved | Pass |
| No new visual system, layout, animation, or CSS introduced | Pass |
| Unknown state is explicit rather than silently presented as healthy/system-owned | Pass |
| Existing accessibility/focus/motion behavior untouched | Pass |

The four required design skills were read and applied: Emil design engineering,
design consultation, design review, and Web Interface Guidelines. The UI
changes are data-state normalization only, so no visual redesign or browser
visual claim is made.

## Residual concerns and evidence boundaries

- The five Resources-model failures and one full update-source failure remain
  outside this Important-finding fix and need a separate baseline reconciliation.
- No live-router, browser, Discord, autocircular, persistence, or deployment
  evidence was collected or claimed.
- No merge, push, or deploy was performed.

The delivery commit hash is provided in the final handoff; no merge, push, or
deploy was performed.
