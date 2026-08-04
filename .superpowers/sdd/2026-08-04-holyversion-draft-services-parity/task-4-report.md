# Task 4 Report: Real-Data Services Page Parity

## Scope

Implemented the Services page parity slice without backend changes or a second apply engine.

- Added real-data Services mode presentation for `services` and `hosts`.
- Added backend-only source normalization for catalog/status/health source metadata.
- Reused `z2m-services-model.js` for the shared draft-aware selector, category tri-state, catalogue-wide bulk actions, and changed deltas.
- Added deterministic category switch behavior: `mixed -> on`, `on -> off`, `off -> on` for click and Enter/Space keyboard activation.
- Added mode-safe draft retention through `modeDrafts`; switching modes does not destroy the other mode draft.
- Added `Включить все` / `Выключить все` with the exact hidden-search copy.
- Added applied-state chips, changed-row direction/status, synchronized KPI/filter/row data, source metadata rows, and responsive Services layout.
- Kept page `Показать различия` and `Применить` as aliases to `ctx.openSemanticDiff()`.
- Preserved the existing Services adapter, catalog preview/apply preconditions, coordinator reread/verification path, and backend ownership-safe domain behavior.

## RED Evidence

Initial focused run before the Task 4 implementation:

```text
node --test tests/ui/services-model.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-services-lists-dns.test.mjs tests/ui/render-harness.test.mjs
```

Result: 26 tests, 23 passed, 3 failed. The failures were the intended missing source normalization, Services parity source contracts, and Services metadata render contract.

## GREEN Evidence

Focused Services/render run after implementation:

```text
node --test tests/ui/services-model.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-services-lists-dns.test.mjs tests/ui/render-harness.test.mjs
```

Result: 27 tests, 27 passed, 0 failed.

The render harness now uses backend fixture records and verifies both modes, source metadata, no demo service, and retention of the Services draft while switching modes.

Full reviewed UI-focused set:

```text
node --test tests/ui/draft-model.test.mjs tests/ui/services-model.test.mjs tests/ui/global-draft-apply.test.mjs tests/ui/services-parity.test.mjs tests/ui/single-view-manager.test.mjs tests/ui/single-view-services-lists-dns.test.mjs tests/ui/video-drafts-service-dns-regressions.test.mjs tests/ui/render-harness.test.mjs
```

Result: 76 tests, 76 passed, 0 failed.

## Static Checks

```text
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js
node --check luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services-model.js
```

All three checks passed with no output/errors.

## Changed Files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
- `tests/ui/services-model.test.mjs`
- `tests/ui/services-parity.test.mjs`
- `tests/ui/render-harness.test.mjs`
- `.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/task-4-report.md`

The pre-existing untracked plan file was not modified.

## Concerns

- No live LuCI/browser or router acceptance run was available in this task; verification is source, model, DOM harness, and static-check based.
- The existing facade exposes no ready-host source-selection mutation contract, so hosts mode intentionally renders backend-provided source metadata and validation state without inventing a selection/apply RPC.

## Commit

Required commit title: `feat: match holyversion services controls`
