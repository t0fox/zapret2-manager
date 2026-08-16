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

## P03-V2 — final Strategies visual correction

`P03-V2_STATUS: COMPLETE`. This closure stayed presentation-only: no backend,
catalog source, RPC, CRUD, Apply/Preview authority, Scanner, engine, DNS,
routing, or shared/global theme code changed. `P04_STARTED: NO` and
`CATALOG_UPSTREAM_CHANGED: NO`.

### Acceptance evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| `FLOATING_SEARCH_CLEAR_VISIBLE` | `0` | Empty search renders the clear button with `display:none` and zero-size rect |
| `SEARCH_CLEAR_INSIDE_INPUT` | `YES` | Typed search renders `×` inside the 40px input rect; click clears value and returns it to hidden |
| `SEARCH_CLEAR_VISIBLE_WHEN_EMPTY` | `NO` | Browser interaction verified after clearing |
| `SEARCH_ROW` | `PASS` | Search width `392.97px`, result count on the same row at `x=419.97px` |
| `RAW_CATALOG_HASH_PRIMARY_VISIBLE` | `0` | Summary now exposes only files, strategies, and trusted health state |
| `SUMMARY_PRIMARY_FACTS` | `PASS` | `23`, `732`, `Готов` in one cohesive surface; no fourth KPI tile |
| `ACTIVE_CARD_SURFACE` | `PASS` | Inner divider removed; active name, badges, and `Превью команды` preserved |
| `GROUP_HEADER` | `PASS` | Full-width rounded subtle surface with `1px` border and right-aligned count |
| `STRATEGY_CARD_SURFACE` | `PASS` | Action row background is transparent; readable description, tags, buttons, disabled state, and 32px favorite hitbox retained |
| `AVATAR_BRANDING_VISIBLE` | `0` | No Avatar branding introduced |
| `EXTRA_RPC` | `0` | No new RPC path; real browser rendered `80` of `732` strategies |

### Changed files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js`
  — toggles clear-button visibility and removes the raw digest from the
  primary summary while retaining trusted `value.ok` state.
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
  — final scoped search-row, active-surface, group-header, card-action, and
  Graphite control corrections.
- `tests/ui/p03-v2-visual-contract.test.mjs` — regression contract for the
  required presentation invariants.

### Verification and deployment

- P03 UI suite: `18/18` passed, including the new V2 contract (`4/4`).
- `node --check` Strategies JS: passed; `git diff --check`: passed.
- Browser acceptance: same authenticated target tab and same donor tab;
  donor snapshot captured at `http://127.0.0.1:38123/#strategies`, target at
  `http://192.168.1.1/...#/strategies`. Target final state: `80` cards, no
  raw hash, clear hidden when empty, clear inside input when typed, and clear
  action restores the full list.
- Direct target SHA-256: Strategies JS
  `d2788d88cc883711e2cb4d851bbf93d5c0984c28f0cba7dfd950bd53a27fc336`;
  Strategies CSS
  `6dcf69fc04e59aafe5950104cebf4bb67b628df0f48d3b52d6a8956e2030b559`.
- Target mode/owner: `-rw-r--r-- root:root` (`0644`) for both files;
  `rpcd` PID remained `7271`. Bounded backup:
  `/tmp/z2m-strategies-parity/backup/20260816-215959/`.
- No APK build/install, reboot, rpcd reload, or Apply was performed.
- Evidence: `p03v2-z2m-before.png`, `p03v2-donor.png`,
  `p03v2-z2m-final-top.png`, and `p03v2-z2m-final-card.png` under
  `C:\Users\Kirill\.codex\visualizations\2026\08\16\01a00aad-3cb6-7cc0-aa5f-be2d7b0d1f71\`.

The broader product/backend test invocation remains separately non-clean in
this dirty worktree because of pre-existing ucode/WSL target-runtime failures;
those failures are outside this presentation-only closure. No unrelated
working-tree changes were reset, staged, or modified.

## P03-V visual polish evidence

- `STATUS: DONE`.
- `DONOR_SHA: 38ed85ce487c6b3dbdf703a5be197795f7c0cad1`.
- The frozen donor was rendered again in the same authenticated browser tab at
  `http://127.0.0.1:38123/#strategies`; the deployed Z2M route was rendered in
  that same tab at `#/strategies`. Donor top, Z2M before, and Z2M after
  screenshots are stored under
  `C:\Users\Kirill\.codex\visualizations\2026\08\16\01a00aad-3cb6-7cc0-aa5f-be2d7b0d1f71\`.

### VISUAL_ROOT_CAUSES

| Finding | Classification | Evidence | Closure |
| --- | --- | --- | --- |
| Strategies wrapper left 28px of avoidable internal gutter at the target viewport | `CONTAINER_WIDTH_PROBLEM`, `Z2M_WRAPPER_INTERFERENCE` | LuCI content width `627px`; `z2m-wrap` was `599px`; donor content was `614px` inside a `646px` page container | scoped Strategies wrapper is `607px`, with no horizontal overflow |
| Catalog facts were four equal bordered tiles | `INFORMATION_HIERARCHY_PROBLEM`, `BORDER_OVERUSE` | before summary was `177px` tall with four child borders | one cohesive `130px` panel; counts lead, digest/status are secondary |
| Card and control rules lost to donor-derived and LuCI selector specificity | `TYPOGRAPHY_SCALE_PROBLEM`, `LUCI_STYLE_LEAK`, `BUTTON_STYLE_PROBLEM`, `BADGE_STYLE_PROBLEM` | computed before card description was `12px`, header padding `14px 16px 8px`, favorite hitbox `15px`; toolbar buttons had an inset shadow | card description `13px/18.85px`, header `16px 20px 10px`, favorite `32px`, buttons have explicit Graphite tokens and no glow |
| Filter controls read as generic LuCI buttons | `BUTTON_STYLE_PROBLEM`, `SPACING_SCALE_PROBLEM` | before filters were `23px` high with inherited button treatment | `30px` rounded filter pills, quiet inactive state and clear active state |
| Search height was inflated by LuCI `content-box` sizing | `LUCI_STYLE_LEAK` | CSS height was `40px` but the rendered hitbox was `50px` | scoped `border-box` gives an actual `40px` hitbox |

### Required closure fields

| Field | Before | After |
| --- | --- | --- |
| `CONTENT_WIDTH_ROOT_CAUSE` | `z2m-wrap` used `calc(100% - 28px)` at `max-width:1100px` | Strategies-only `calc(100% - 20px)` at the same viewport band |
| `CONTENT_WIDTH_BEFORE` | `599px` |  |
| `CONTENT_WIDTH_AFTER` |  | `607px` |
| `PAGE_TITLE_BEFORE` | `22px / 27.5px` | `22px / 27.5px`, retained as stronger page-level hierarchy |
| `BODY_TEXT_BEFORE` | `14px / 21px`; card description `12px / 18px` | `14px / 21px`; card description `13px / 18.85px` |
| `CARD_TITLE_BEFORE` | `14px / 21px` | `15px / 21px` |
| `CATALOG_SUMMARY_BEFORE` | four equal bordered KPI tiles, `177px` high |  |
| `CATALOG_SUMMARY_AFTER` |  | cohesive panel, `130px` high; internal dividers only |
| `CATALOG_HASH_PRIMARY_VISUAL` | visually equal to count | `NO`; secondary `12px` technical metadata |
| `ACTIVE_STRATEGY` | working but dense badges and `125px` panel | readable `15px` name, `11px/22px` badges, `130.5px` panel |
| `SEARCH` | generic LuCI input, `40px` CSS / `40px` before hitbox | Graphite surface, `13px`, `40px` actual hitbox |
| `FILTERS` | inherited small LuCI buttons | rounded filter pills, `30px`, quiet active/inactive states |
| `GROUP_HEADER` | thin divider treatment | readable `13px` disclosure row with count and divider |
| `STRATEGY_CARDS` | `163.5px`, `14px` header padding, weak hierarchy | `186.2px`, `16px 20px 10px` header, stronger title/actions |
| `CARD_DESCRIPTIONS` | `12px / 18px` | `13px / 18.85px`, readable two-line density |
| `PROTOCOL_TAGS` | small bordered labels | `12px` compact semantic tags, no primary-action styling |
| `ACTION_ROW` | inherited equal-looking LuCI controls | blue primary `Применить`, quiet secondary actions, `30px` controls |
| `DISABLED_ACTIONS` | inherited opacity could make controls disappear | explicit readable disabled surface, `opacity:.58`, no business-rule change |
| `FAVORITE_CONTROL` | `15px` rendered width | `32px` hitbox, active amber, hover/focus state |
| `TOP_TOOLBAR` | `23px` inherited buttons with inset shadow | `33.5px` Graphite buttons, `Создать стратегию` primary, shadow `none` |
| `BORDER_NESTING_REDUCED` | four nested summary borders plus button borders | `YES`; summary is one surface with deliberate internal dividers |

`DONOR_SIDE_BY_SIDE: PASS`. The donor and target were compared from rendered
screenshots and computed geometry, not recollection. `Z2M_THEME_CHANGED_GLOBALLY:
NO`; all new selectors are scoped to `#z2m-view-strategy`, and no Avatar
branding is present in the target DOM (`0` matches).

`MIXED_RU_EN_PRODUCT_COPY: 0`; technical labels (`TCP`, `nfqws2`, HTTP) remain
technical. `RAW_INTERNAL_ENUM_VISIBLE: 0`. `RAW_REASON_CODE_VISIBLE: 0`.

`INITIAL_RPC_COUNT_BEFORE: 5`; `INITIAL_RPC_COUNT_AFTER: 5`. The closure is
CSS-only, adds no JavaScript or RPC path, and the final browser render still
has one search control, one catalog summary, and `80` visible cards from the
real `732`-strategy catalog.

### Files, commits, and target

- Only `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css` changed for P03-V.
- Atomic visual commits: `036676a8` (workspace/toolbar), `a5f0b9a0`
  (catalog/active panel), `f94b3397` (cards/filters), `a36a698a`
  (card selector specificity), `23499bed` (search height), `886894df`
  (search box sizing).
- Final worktree HEAD: `886894df3ab2ace1459f8f6b649f34baef709723`.
- Target CSS SHA-256 matched local:
  `eeaddd254fcabd4c02dd78d89fdd6f8c47d5e417f9feb7b3794a595171d8989c`.
  Target mode/owner: `-rw-r--r-- root:root` (`0644`); `rpcd` PID remained
  `7271`. Each upload used a bounded backup under
  `/tmp/z2m-strategies-parity/backup`; no APK, reboot, rpcd reload, or Apply.

### Verification

- Focused P03 suite: `18/18` passed.
- `node --check` Strategies JS: passed.
- `git diff --check`: passed.
- Final real Browser: `PASS`; `#/strategies` rendered `23 files / 732
  strategies`, active `Split`, `80` cards, polished summary/search/filters,
  readable cards and actions. Final screenshots: `p03v-z2m-before.png`,
  `p03v-donor-before.png`, `p03v-z2m-final-top.png`, and
  `p03v-z2m-final-card.png` in the evidence directory above.
- P01/P02 shared-style safety: no shared component/token changed; all P03-V
  rules are Strategies-scoped. Same-tab smoke navigation to the existing
  overview/control shell produced no visible error text.
- `P04_STARTED=NO`.
