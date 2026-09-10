# Reference Header Implementation

Date: 2026-09-10

Status: `READY_FOR_UI_REVIEW`

## Scope

Adapt the LuCI app shell to the supplied dark graphite header reference while preserving the existing router/product mark and current navigation, status, and RPC ownership.

## Implementation

- Kept `icons/zapret2-manager-mark.svg` unchanged and byte-identical to the repository canonical asset.
- Added the existing `z2m-icons` `system` glyph as the device indicator beside the dynamic host name.
- Added the reference header divider, graphite shell surfaces, 12px shell radius, larger brand lockup, green runtime pill geometry, subtle blue active-tab fill, and responsive narrow-screen hiding/overflow behavior.
- Kept the dynamic `statusState(initial/raw)` mapping, `status_fast` transport, `Shell.primaryNavigation(...)` owner, labels, routes, and keyboard semantics unchanged.
- Bumped the shared stylesheet cache-busting revision.

## Verification

- Passed: `node --check` for the touched JavaScript files.
- Passed: `git diff --check`.
- Passed: focused UI gates: 11 tests, 11 passed, 0 failed.
- Passed: packaged mark digest check through `app-shell-branding.test.mjs`.
- Broader `tests/ui/*.test.mjs` run is not green because of unrelated pre-existing Z2K/DNS/resource contract failures, an outdated direct `statusFast().then` assertion, and a missing `vitest` package.
- Not run: router deployment, live LuCI HTTP/browser acceptance, and final human visual approval.

## Review boundary

The implementation is ready for visual review after the package is deployed to the router. This report does not claim live-router acceptance or final aesthetic approval.
