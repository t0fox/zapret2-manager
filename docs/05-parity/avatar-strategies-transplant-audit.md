# P03 — Avatar Strategies transplant audit

## Initial state

- Donor remote: `avatarDD/zapret-gui`
- Donor branch: `main`
- Frozen donor HEAD: `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`
- Donor worktree: `G:\avatarDD\zapret-gui-p03`
- Donor clean: `YES`
- Active Z2M worktree: `G:\zapret2-manager\.codex-avatar-parity`
- Initial P03 HEAD: `ad2e7f797dd6cfc906d7182b497356d2ffe0b267`

P03 is limited to `Обход DPI → Стратегии`. P01 Dashboard and P02 Control remain
closed. The existing Z2M Strategy backend, state, revisions, validation,
preview, Apply, and persistence remain authoritative.

## Donor manifest

The frozen donor source audit covers `web/js/pages/strategies.js`,
`web/js/components/list_ui.js`, `web/js/components/confirm.js`,
`web/js/components/toast.js`, `web/js/utils/nfqws2_lint.js`,
`web/js/utils/syntax.js`, `web/js/utils/autocomplete.js`, and the Strategies
CSS ranges in `web/css/style.css`.

## P03-R2 exact donor execution map

This map was written from the frozen checkout at the pinned SHA, not from a
screenshot. The donor page is the authority for composition and interaction;
the Z2M RPC boundary remains the authority for data and mutations.

| Contract | Exact donor source/symbol | Z2M adaptation |
| --- | --- | --- |
| `DONOR_PAGE_FILE` | `web/js/pages/strategies.js` | `z2m-strategies.js` |
| `DONOR_RENDER_ENTRY` | `StrategiesPage.render(container)` | `Strategies.render(ctx)` |
| `DONOR_DESTROY_ENTRY` | `StrategiesPage.destroy()` | `Strategies.unmount()` |
| `DONOR_INITIAL_API_CALLS` | `fetchStrategies()`, `refreshDebugToggle()`, `refreshState()`, `refreshHealthcheck()` | `load(ctx)` reads `strategies_list`, catalog status, service status, and profiles list; unsupported donor healthcheck/autocircular calls are excluded |
| `DONOR_CATALOG_LOAD` | `StrategyManager.get_strategies()` through `core/catalog_loader.CatalogManager.get_catalog_entries()` | `strategy_catalog_load()` and canonical Z2M catalog snapshot |
| `DONOR_ACTIVE_STRATEGY_LOAD` | `fetchStrategies()` → `renderActiveCard(active)` | canonical selected/applied/runtime identity from Z2M status and list state |
| `DONOR_SEARCH_HANDLER` | `ListUI.create(...).onInput()` | local presentation filtering in `ListUI` |
| `DONOR_FILTER_HANDLER` | `ListUI.create(...).onFilter()` | local presentation filtering over supported fields |
| `DONOR_GROUP_RENDERER` | `ListUI.refresh()` `groupBy`/`groupLabel` branch | protocol groups derived from current filtered rows |
| `DONOR_CARD_RENDERER` | `renderStrategyCard(s)` | `renderStrategyCard(strategy)` |
| `DONOR_APPLY_HANDLER` | `applyStrategy(sid)` | `strategies_apply` with canonical identity and revision |
| `DONOR_DETAILS_HANDLER` | `ListUI.onBody()` `[data-list-ui-toggle]` branch | donor expand/collapse action |
| `DONOR_PREVIEW_HANDLER` | `showPreview(sid)` and `validatePreview()` | `strategies_preview` / `strategies_validate`; final command is backend-generated |
| `DONOR_COPY_HANDLER` | `copyPreview()` and `copyStrategyToClipboard(sid)` | supported Z2M duplicate/copy action; no client-side command authority |
| `DONOR_FAVORITE_HANDLER` | `toggleFavorite(sid)` | `strategies_favorite` |
| `DONOR_CREATE_FLOW` | `openCreate()` → `openEditor(data, 'create')` → `saveEditor()` | `strategies_create` with all profiles preserved |
| `DONOR_EDITOR_FLOW` | `openEditor()`, `renderEditorForm()`, `renderProfileEditor()`, `addProfile()`, `removeProfile()`, `saveEditor()` | Z2M Strategy CRUD model with `profiles[]`, raw profile args, and `--new` boundaries preserved |
| `DONOR_MODAL_COMPONENT` | `web/js/components/confirm.js` and page modal blocks | page-owned LuCI modal hierarchy and cleanup |
| `DONOR_TOAST_COMPONENT` | `web/js/components/toast.js` | existing Z2M shell toast adapter |
| `DONOR_CSS_SELECTORS` | `.page-header`, `.card`, `.active-strategy-card`, `.strategy-card`, `.strategy-card-header`, `.strategy-card-profiles`, `.strategy-card-actions`, `.list-ui-*`, `.strat-editor-*`, `.modal-*` in `web/css/style.css` | same donor hierarchy on `z2m-ui.css`, under Z2M Graphite shell |

Donor backend inspection also covered `api/strategies.py` and the actual
current equivalents `core/strategy_builder.StrategyManager`,
`core/catalog_loader.CatalogManager`, and `core/catalog_merge`. The pinned
checkout has no `api/catalog_update.py`; its update-related API is split across
`api/gui_update.py` and `api/update_checker.py`. Those external update flows
remain secondary to local Strategy availability in Z2M.

Donor symbols/blocks to transplant or adapt include `render`, `_bindEvents`,
`fetchStrategies`, `renderActiveCard`, `renderList`, `renderStrategyCard`,
`applyStrategy`, `toggleFavorite`, `deleteStrategy`, `duplicateStrategy`,
`showPreview`, `validatePreview`, `openEditor`, `renderEditorForm`,
`renderProfileEditor`, `saveEditor`, `attachAutocompleteToProfiles`,
`copyStrategyToClipboard`, `pasteStrategyFromClipboard`, `mergeSelected`,
`attachGlobalKeys`, modal resize helpers, and `destroy`.

Donor DOM hierarchy includes the page header, active-strategy card, search /
filter / grouping toolbar, compact strategy cards with profile badges and raw
argument preview, bulk-selection bar, editor modal, preview modal, loading /
empty / error states, and donor-derived active/selected visual classes.

Donor-only healthcheck, autocircular-state, debug-toggle, and `/api/*` backend
flows are not supported by the canonical Z2M Strategy boundary. They must be
classified `BACKEND_NOT_READY` or `INTENTIONAL_Z2M_DIFFERENCE`, never faked.

## Final R2 evidence

- Final P03-R2 candidate: `dcafaece` (`fix: keep strategies filter state in sync`);
  the preceding implementation and target runtime closure is `c0404245`.
- Focused contract suite: `17/17` passed. New Strategies JS passes `node
  --check`; `git diff --check` passed.
- Target list root cause: each uncached list request reparsed and reverified
  the complete canonical manifest/catalog before serializing a large response.
  The bounded projection reduced the direct call to about `15.69s`; the
  digest-keyed disposable derived snapshot then reduced the cached ubus call to
  `2.07s`. The target `strategies_list` RPC completed with `732` strategies,
  and the cache key matched manifest digest
  `5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1`.
- Target deployment: P03-only files were copied with SHA-256 verification;
  the final frontend patch is `root:root`, `0644`. No APK build, reboot, or
  Apply was performed.
- Post-acceptance repair: favorite mutations now send the shared Strategy
  state revision (`favoritesRevision`), not the per-Strategy revision. Preview
  now falls back to a server-owned baseline derived from the upstream init
  helper and applied config when no nfqws2 process is running; it never accepts
  client-composed runtime arguments.
- Real authenticated Browser acceptance in the existing tab: `PASS`.
  `#/strategies` rendered the real catalog summary `23 files / 732
  strategies`, active `Split`, and `80` visible cards. Search narrowed the
  rendered rows to disorder matches; the recommended filter rendered `2` rows
  and switched its active class; details expanded; preview opened the real
  modal with a complete generated command while the target `nfqws2` service
  remained stopped; the first card favorite toggle completed successfully.
  No Apply was attempted.
- Final DOM checks: `[object HTMLDivElement]` absent, Scanner absent from the
  Strategies surface, and Avatar/donor/transplant branding absent from the
  rendered page. The same tab was left on the live Strategies route.
- Donor-only healthcheck/autocircular/debug flows remain
  `BACKEND_NOT_READY` / `INTENTIONAL_Z2M_DIFFERENCE`; no donor `/api/*` call is
  used by the Z2M route.
- Target Apply canary: `NOT RUN` because the service is stopped and no
  rollback-safe baseline was established.
- `P04_STARTED=NO`.
