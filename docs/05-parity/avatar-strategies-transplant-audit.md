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

## Final evidence

The earlier evidence below is historical and is superseded while P03-R2 is
open. Current R2 closure requires a passing `strategies_list` RPC and a real
authenticated Browser acceptance; a timeout fallback is not accepted.

- GREEN focused contract suite: `32/32` P03/P02/P01 UI tests passed after the
  final route change; all three P03 modules pass `node --check`; `git diff
  --check` passed.
- Final implementation candidate: `7724c6784916c3da5578ccad9801966e8aa22319`.
- Target deploy: `STRATEGIES_ONLY` via clean detached worktree; target SHA,
  `root:root`, and `0644` were verified for all four deployed files. `rpcd
  reload` ran; no APK build, reboot, or Apply was performed.
- Target read-only characterization: `engine_status` returned installed and
  stopped; `strategies_list` timed out. The page therefore bounds read RPCs and
  renders safe unavailable/empty states instead of waiting forever.
- Browser acceptance: `PARTIAL / BLOCKED`. The existing tab was claimed and
  the session-expiry login control was exercised as requested. After a full
  navigation the LuCI form reported `Invalid username and/or password` with
  the prefilled `root` username and empty password; no credentials were
  available, so post-final-deploy DOM/editor/preview interaction could not be
  completed. No strategy mutation or Apply was attempted.
- Navigation/lifecycle source evidence: one replaceable timeout poller,
  listener removal, autocomplete detach, modal cleanup, and forced Avatar
  Strategies route are covered by the P03 lifecycle contracts.
- Donor-only healthcheck/autocircular/debug flows: `BACKEND_NOT_READY` /
  `INTENTIONAL_Z2M_DIFFERENCE`; no donor `/api/*` call is used.
- Target Apply canary: `NOT RUN` because the service was stopped and no
  rollback-safe baseline was established.
