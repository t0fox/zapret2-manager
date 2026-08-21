# Engine gate and Lists/Data runtime fix

Date: 2026-08-21

## Outcome

Restored the cheap engine gate RPC contract and the canonical Asset Registry RPC surface used by the Lists/Data views. The implementation commit is `1124e5c6288b9c5b804d9519fc8b27ff5808e65e`.

## Files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc`
- `luci-app-zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json`
- `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`

## Evidence

- Reproduced the original failure in the in-app browser: engine-dependent Lists/Data views showed `Состояние движка недоступно` and `Backend вернул ошибку`.
- Router RPC evidence: `zapret2-manager-engine engine_gate_status` and `engine_status` returned successful installed/running envelopes.
- Added `Api.engine.gateStatus`, registered `engine_gate_status`, and exposed it in the engine ACL.
- Added the missing Asset Registry RPC wrappers and ACL permissions; router `ubus call zapret2-manager assets_list` returned `ok:true`, schema 1, revision 38, and two assets.
- In-app browser acceptance after cache-disabled reload: `Сервисы и домены`, `Ресурсы`, and `DNS-маршрутизация` all rendered data with no backend error, engine-unavailable banner, or loading state.
- Focused tests: `node --test tests/ui/perf-1-contract.test.mjs tests/ui/full-avatar-parity-assets-warp.test.mjs tests/product/test_asset_provenance.test.mjs` — 17/17 passed.
- Router verification: both modified ucode RPC files compiled; deployed SHA-256 matched local SHA-256 for all five files.
- TikTok auto-fix was restored to the pre-check state: enabled, healthy, selected IP `212.188.77.140`.

## Scope boundary

Scanner and other pre-existing dirty worktree changes were preserved and excluded from the commit. No APK operations were used.
