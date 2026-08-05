# Strategy task 4 frontend completion plan

## Goal

Finish the production Strategy frontend by composing the existing manual Strategy, Auto Strategy, and active-run controllers without changing backend contracts or the TG Proxy tab.

## Scope boundaries

Allowed:
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- a Strategy-only workflow module preserving the current full-corpus UI
- Strategy/task-4 tests
- this plan

Forbidden:
- `z2m-proxy*.js`, proxy routes, proxy styles, proxy tests
- `tg-ws-proxy-go/**` and `tg-ws-proxy-rs/**`
- backend RPC/ucode/service changes
- shared `app.js` changes unless an unavoidable integration defect is proven

## Design

1. Preserve the current full-corpus Orchestra page byte-for-byte as `z2m-strategy-workflow.js`.
2. Turn `z2m-strategy-page.js` into a small production composer.
3. In simple mode render the existing manual Strategy selection/editor, then Auto Strategy and active runs.
4. In shared Advanced mode render the preserved full-corpus workflow, then Auto Strategy and active runs.
5. Delegate `createAdapter()` to the existing manual Strategy adapter.
6. Load child modules independently with bounded error envelopes so one failed read does not blank the entire Strategy tab.
7. Unmount every child controller to stop all timers and polling.

## Test sequence

1. RED: confirm current production page fails the existing task-4 composition contracts for Auto and Runs.
2. Add/retain source-contract coverage for `Auto.load/render/unmount`, `Runs.load/render/unmount`, manual Strategy composition, Advanced-mode workflow preservation, and absence of proxy imports.
3. GREEN: run task-4 UI tests and Strategy UI smoke/source tests.
4. Regression: compare changed paths against the starting commit and verify no TG Proxy/backend file is present.
