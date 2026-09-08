# Task 9 — Resources managed Z2K inventory

Status: VERIFIED

## Implementation

- `cdeecf59` — `refactor: make Z2K resources Core-managed only`
- `a306709e` — `fix: preserve Z2K owner on managed refresh`

Resources now treats Z2K as managed inventory. The Z2K source card shows `Управляется Z2K Core` and no independent refresh or enable/disable controls. Bulk refresh uses explicit independent source candidates, excludes Z2K, and retains an independently stale Avatar candidate. The duplicate Resources lifecycle callout was removed; release lifecycle remains owned by Components.

The live RPC boundary also now preserves the canonical owner field instead of returning only the error code/message.

## Automated evidence

- Focused Task 9 suite: **53 passed, 0 failed, 0 skipped**.
- `node --check` passed for `z2m-resources-model.js` and `z2m-assets.js`.
- `git diff --check` passed.
- Independent Luna review: `reviews/review-task-9.md`, PASS; no P1/P2 findings.

## Router/source deployment

Source-only deployment used the explicit manifest:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js|/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js|0644
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js|/www/luci-static/resources/view/zapret2-manager/z2m-assets.js|0644
zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc|/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc|0644
```

Remote hashes matched local source:

- `z2m-resources-model.js`: `510dbe5ce6239c678508cb8fd57917cab9cb6aa4bc7c93b48d1dfb1975decf09`
- `z2m-assets.js`: `2d67c3650d752a63a1a744ca47c240fbbb05bb98a000e4624a7693b1f2d887a5`
- `strategy-catalog-refresh.uc`: `a61182b8d9ec8e28f39ba52fcb000b14de9c94e68c11b5c66d99874e9c0a8d49`

## Router RPC evidence

Direct authenticated router call:

```text
ubus call zapret2-manager strategies_source_refresh '{"sourceId":"z2k"}'
```

returned:

```json
{
  "ok": false,
  "error": {
    "code": "EMANAGED",
    "owner": "z2k-core",
    "message": "Z2K strategy source is managed by Z2K Core"
  }
}
```

The call stopped before source mutation. Avatar was not refreshed against upstream during this gate; its independent `Обновить` and `Отключить` controls were verified in the live UI and its independent path remains covered by the focused contract tests.

## Browser gate

Route: live LuCI `#/assets`, after cache-cleared hard reload.

- Z2K source card visibly showed `Управляется Z2K Core` and no `Обновить`, `Отключить`, or `Включить` controls.
- Avatar source card visibly retained `Обновить` and `Отключить`.
- `Обновить все` was disabled because no independent stale source required refresh; the model contract separately proves a stale Avatar candidate is retained while Z2K is excluded.
- The managed resources group visibly showed `Управляется Z2K Core · 42 ресурса` and a `Компоненты` navigation action.
- Browser module cache was cleared before the final observation, avoiding stale SPA modules from earlier source deployments.

No APK was built locally. No merge, push, or branch deletion was performed.
