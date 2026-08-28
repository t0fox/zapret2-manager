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

## Boundaries

The following are not claimed as verified: deployed browser/DOM acceptance, package deployment, and destructive live upgrade/downgrade/reinstall with runtime Strategy/autocircular checks. The focused `strategy-rpc-regression` test passed. The combined learned/autocircular check was not green because an unchanged existing UI contract test expects missing `learned-table-9`; this is reported rather than attributed to the lifecycle changes.

## Delivery

Commit and remote branch identity are recorded in the final task response after the final clean-worktree check.
