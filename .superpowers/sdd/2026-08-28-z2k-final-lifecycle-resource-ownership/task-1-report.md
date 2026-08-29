# Task 1 Report: Z2K lifecycle baseline and generic-editable reproducer

## Status

RED baseline reproduced. No production UI/backend code was changed.

## Files inspected

- `.superpowers/sdd/2026-08-28-z2k-final-lifecycle-resource-ownership/task-1-brief.md`
- `.superpowers/sdd/2026-08-28-z2k-final-lifecycle-resource-ownership/progress.md`
- `docs/superpowers/plans/2026-08-28-z2k-final-lifecycle-resource-ownership.md`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc`
- `tests/product/z2m-resources-model.test.mjs`
- `tests/product/cross-view-z2k-contract.test.mjs`
- `tests/ui/editor-resources-contract.test.mjs`
- `tests/ui/resources-update-center.test.mjs`

## Exact baseline commands and outputs

### `git status --short --branch`

```text
## codex/z2k-version-lifecycle...origin/codex/z2k-version-lifecycle
?? graphify-out/
```

### `git branch --show-current`

```text
codex/z2k-version-lifecycle
```

### `git rev-parse HEAD`

```text
f0e04b0f4bb64680b8c5bb2767d825b7e18d7508
```

### `git log --oneline -5`

```text
f0e04b0f fix(z2k): preserve legacy receipt authority
5c7613ab fix(z2k): close live lifecycle review gaps
772f2d2e fix(z2k): close full lifecycle review gaps
2db63158 docs(z2k): record review fix and live acceptance
b16a0023 fix(z2k): close version UX review gaps
```

### `git diff --check`

```text
(no output)
```

## Baseline mutation matrix

| Surface | Frontend/RPC entry | Backend writer | Observed ownership meaning |
| --- | --- | --- | --- |
| Canonical Z2K lifecycle update | `z2m-maintenance.js -> ctx.api.resources.prepareVersion({ version }) -> confirmAction() -> ctx.api.resources.update(JSON.stringify({ bundleId: 'z2k-curated-lua', targetVersion, operation, installedVersion, planToken, confirm: true }))` | `resource-update.uc -> resource_center_update() -> z2k_apply_prepared() -> asset_registry_apply_bundle() -> z2k_runtime_activate()` | Lifecycle mutation is routed through Components and the Resource Center coordinator; Asset Registry is the sole writer and runtime activation happens after Registry postflight. |
| Generic Resources edit | `z2m-assets.js -> save() -> ctx.api.assets.update(json({ id, expectedRevision, contentBase64 }))` | `asset-registry.uc -> asset_registry_update()` | Editability is currently inferred in the UI from generic asset mutability, not from lifecycle ownership. |
| Generic Resources delete | `z2m-assets.js -> remove() -> ctx.api.assets.delete(json({ id }))` | `asset-registry.uc -> asset_registry_delete()` | Delete availability is currently gated in the UI by `ownership !== 'package'` plus references, not by Z2K lifecycle ownership. |
| Generic Resources import collision path | `z2m-assets.js -> importPanel() -> current ? ctx.api.assets.update(...) : ctx.api.assets.import(...)` | `asset-registry.uc -> asset_registry_update()` / `asset_registry_import()` via RPC | Existing lifecycle IDs would currently fall into the same generic update path when the asset is mutable. |

## Actual fixture and test surface

- The closest existing reusable Z2K fixture surface is `tests/product/z2m-resources-model.test.mjs`, especially `makeInstalledForZ2k()`, because it already models `ownership: 'manager'`, `mutable: true`, and `provenance.kind: 'catalog/upstream'` with `bundleId: 'z2k-curated-lua'`.
- The actual bug surface for this task is not grouping but workspace editability in `z2m-assets.js`:
  - `function mutable(asset) { return asset && asset.mutable === true; }`
  - `readOnly: asset.ownership === 'package'`
  - `actionBar()` shows save actions for any `mutable(asset)`
- For the smallest RED reproducer I therefore added one focused UI contract test in `tests/ui/resources-update-center.test.mjs` with an inline lifecycle fixture using the exact requested values:
  - `ownership: 'manager'`
  - `mutable: true`
  - `provenance.kind: 'catalog/upstream'`
  - `provenance.bundleId: 'z2k-curated-lua'`
  - `provenance.version: 'r-79.7'`

## Reproducer summary

The current Resources workspace predicate is effectively:

```text
asset.ownership !== 'package' && asset.mutable === true
```

For the lifecycle fixture above this evaluates to `true`, so the Resources UI currently treats a lifecycle-owned Z2K asset as generic-editable even though the canonical lifecycle writer is `asset_registry_apply_bundle()` through Components -> `resources.prepareVersion/resources.update`.

## Exact test command and output showing RED

### Validator

Command:

```text
node scripts/validate-knowledge.mjs
```

Output:

```text
Knowledge validation passed.
```

### RED reproducer

Command:

```text
node --test tests/ui/resources-update-center.test.mjs
```

Output:

```text
✔ Resources page keeps the canonical Asset Registry center and segmented filters (0.7991ms)
✔ Resources UI exposes human states, provenance details, consumer references, and user CRUD protection (0.1922ms)
✔ Resources UI has stable catalog geometry and narrow layout rules (0.4987ms)
✔ Resource Center exposes one lazy route-aware workspace for first-class assets (0.3745ms)
✔ Package resources keep content available in a read-only editor (0.1934ms)
✖ Z2K lifecycle assets must not be treated as generic-editable when mutable is only lifecycle capability (0.8181ms)
ℹ tests 6
ℹ suites 0
ℹ pass 5
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 85.4154

✖ failing tests:

test at tests\ui\resources-update-center.test.mjs:50:1
✖ Z2K lifecycle assets must not be treated as generic-editable when mutable is only lifecycle capability (0.8181ms)
  AssertionError [ERR_ASSERTION]: lifecycle-owned Z2K assets must stay read-only in Resources even though apply_bundle needs mutable=true internally

  true !== false
```

## Changed files

- `tests/ui/resources-update-center.test.mjs`
- `.superpowers/sdd/2026-08-28-z2k-final-lifecycle-resource-ownership/task-1-report.md`

## Commit SHA

Reproducer test commit:

```text
2d7c0cfd4d379961206be4dabdd06877662ec310
```

## Concerns

- The worktree already contained unrelated untracked `graphify-out/`; it was preserved untouched.
- This task intentionally stops at a RED reproducer. No ownership fix was implemented in `z2m-assets.js`, `asset-registry.uc`, or `resource-update.uc`.
- The focused RED command was run exactly as required; no broad green suite was claimed because Task 1 intentionally introduces a failing contract test.
- The report is committed separately from the reproducer so it can record the exact reproducer commit SHA without inventing a self-referential final hash.
