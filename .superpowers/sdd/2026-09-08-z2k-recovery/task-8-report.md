# Task 8 — Components single Z2K Core surface

Status: VERIFIED

## Scope

Task 8 removes the duplicate Components Z2K dashboard. The normal-flow Components page owns one `.z2m-component-card--z2k`; release lifecycle details and diagnostics are subordinate to `Подробнее`, with technical identity kept inside `Технические детали`.

## Implementation

- `7fb84cc0` — `refactor: collapse Components to one Z2K Core surface`
- `7b31d3e3` — `fix: restore Z2K lifecycle details in single card`

The final implementation keeps product facts and lifecycle actions in the primary Z2K card, renders release selection and lifecycle information only in the expanded subordinate details, and keeps digests, Registry/provenance, compatibility identity, and dependency diagnostics under the nested `Технические детали` disclosure.

## Automated evidence

- Focused Task 8 suite: **47/47 passed**.
- Node syntax checks: passed.
- Scope/diff checks: passed.
- Independent cumulative review: `reviews/review-task-8.md`, PASS, no P0/P1/P2 findings.

## Router/source deployment

Source-only deployment used the Task 8 manifest:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js|/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js|0644
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css|/www/luci-static/resources/view/zapret2-manager/z2m-components.css|0644
```

The deployed `z2m-maintenance.js` hash was `73a5136cd2110ba82a206e792a736ea2ac0b6d16fea23e33cc524fdf438f536f`, matching the local source.

## Browser gate

Route: `#/components` on the live LuCI router.

- After cache-disabled reload, the collapsed Components view showed one normal-flow Z2K Core product card and no `УПРАВЛЕНИЕ РЕСУРСАМИ` text.
- The card exposed product facts (`p-82.18`, latest `p-82.18`, 8 strategies, `12/12 Lua`, Detect `unknown · arm64`, compatibility `Синхронизировано`) and the expected lifecycle controls.
- After clicking `Подробнее`, the Z2K card contained exactly one `Z2K Core` heading, no `УПРАВЛЕНИЕ РЕСУРСАМИ`, and the subordinate `Технические детали` disclosure.
- An earlier inspection showed the old label because the LuCI module had remained cached in the SPA. `Network.clearBrowserCache` followed by `Page.reload` removed that stale DOM; the cache-busted current module then rendered the expected single-card surface.

No APK was built locally. No merge, push, or branch deletion was performed.
