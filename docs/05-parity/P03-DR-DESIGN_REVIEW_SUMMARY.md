# P03-DR — DESIGN_REVIEW_SUMMARY

Status: `INITIAL_REVIEW_COMPLETE`  
Scope: deployed Z2M Strategies page versus the rendered Avatar donor at frozen
SHA `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`.  
P04: `NO`

The review used one authenticated in-app Browser session for the deployed Z2M
page and a local render of the frozen donor. The comparison screenshots were
shown during the review. Computed measurements were taken from both rendered
pages, not inferred from source alone.

## First impression

The donor communicates a focused strategy workspace: title, actions, one
cohesive active-status component, then two explanatory product cards. Z2M
communicates the same capability but the first viewport is dominated by a
catalog KPI extension and the operational cards collapse into terse control
rows. The eye goes to the Z2M catalog numbers, then the green active strip,
then the dense search/card list; in the donor it goes to the page title, the
active strategy state, and the healthcheck explanation.

Rendered baseline evidence:

- Donor: `G:\avatarDD\zapret-gui-p03`, local render `http://127.0.0.1:8765/#strategies`.
- Z2M: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager?p03v2=dr#/strategies`.
- Donor computed card metrics: Active `614x103`, Healthcheck `614x289`, Learned `614x366`, radius `12px`, padding `20px`.
- Z2M computed metrics: Active `607x112`, Strategy card `607x188`, search `393x40`, radius `7px`; the Healthcheck/Learned surfaces were visually raw operational rows rather than donor-equivalent product cards.

## Component review

| COMPONENT | DONOR_BEHAVIOR | CURRENT_Z2M_BEHAVIOR | VISUAL_GAP | UX_GAP | SEVERITY | ROOT_CAUSE | RECOMMENDED_FIX |
|---|---|---|---|---|---|---|---|
| Page Header | Compact title, description, two clear actions; no catalog KPI block before the work area. | Same title/actions plus a full catalog summary immediately below. | KPI surface competes with the page task and pushes Active below the fold. | Users must parse infrastructure status before choosing a strategy. | P1 | Z2M-only summary is in the primary flow. | Keep the summary as a compact secondary status row; reduce height and visual weight. |
| Toolbar | Clipboard and create actions have obvious primary/secondary hierarchy and icon affordance. | Three actions including refresh; similar hierarchy but denser and more LuCI-like. | Buttons are compact rectangular controls with less breathing room. | Refresh has equal prominence with user actions. | P2 | Shared LuCI button sizing and page-header spacing. | Group refresh as a quiet utility action; preserve create as the sole primary CTA. |
| Active Strategy | One cohesive padded status card: heading, state dot/name, contextual helper, debug toggle and Journal aligned as one component. | Green strip plus title row, inline checkbox/button, badges and preview; computed padding on outer card is `0px`. | Status, controls and badges read as separate fragments. | Current strategy state is harder to scan and debug/journal feel detached. | P1 | Donor composition was reduced to shared card/title primitives. | Recompose as a padded status block with state line, helper text, and grouped controls. |
| Debug Control | Small muted toggle sits in the Active header with tooltip and deliberate spacing. | Checkbox and label are inline against title; current snapshot can visually run into the title. | Weak grouping and cramped control hierarchy. | Users can miss that debug is part of Active Strategy. | P1 | Header content is rendered as a flat flex line. | Give debug a compact control cluster with stable gap and label treatment. |
| Journal | Quiet ghost action with document icon, aligned to debug in the Active header. | Text button is present but visually small and close to debug. | Donor control has clearer icon/target composition. | Journal is less discoverable as the log destination. | P2 | Z2M uses a generic small ghost button. | Match donor spacing/icon weight while keeping Z2M shell. |
| Healthcheck | Product card with title/subtitle, grouped controls, explanatory panel, explicit disabled message, config summary and restrained status. | Loose line: toggle, `Выключен · expired`, two buttons; no donor-equivalent explanation or config summary in the visible card. | Highest visible component-quality gap; no surface hierarchy. | Healthcheck looks like a debugging switch, not an understandable safety feature. | P1 | Runtime data is rendered directly into a minimal operational template. | Use donor hierarchy: subtitle, grouped actions, explanation, localized status, config metadata, last-result/outage-guard row. |
| Learned Strategies | Product card explains autocircular, empty state, numbered onboarding, CTA, reset and secondary help. | Two lines plus `Показать авто-стратегии` and `Сбросить всё`. | Empty state lacks hierarchy and onboarding context. | New users do not learn what autocircular does or what to do next. | P1 | Empty state was reduced to a status sentence. | Add concise explanation, three numbered steps, CTA, reset action and secondary help. |
| Search | Donor search is a clear list-control entry with readable placeholder and count nearby. | Search is `393x40`, placeholder is small, clear icon/count/filter controls form a dense strip. | Search/filter row feels compressed and generic. | Finding a strategy requires more visual parsing. | P2 | Shared ListUI spacing and small LuCI input typography. | Increase usable search prominence slightly and separate count from pills without expanding the page excessively. |
| Filter Pills | Donor pills use consistent compact controls with clear active state; Auto and Recommended are semantic filters. | Same base set plus Z2M `Витрина`; active blue outline works but pills are visually uniform. | Z2M row is denser and adds an extension filter without hierarchy. | Semantic filters are not visually prioritized. | P2 | Generic `.btn-ghost` styling for all filters. | Keep all filters but use semantic color only for active/Recommended; make Auto and Recommended easier to scan. |
| Group Header | Full-width, lightly surfaced bar with arrow, label and count, separated from cards. | Similar TCP header, but smaller/admin-like and visually close to first card. | Lower contrast and weaker section rhythm. | Group boundaries are easy to miss in a long list. | P2 | Z2M reuses compact ListUI group styles. | Increase group padding slightly and preserve clear gap before first card. |
| Strategy Card | Card hierarchy: name, `builtin`/user, green `recommended`, labeled author, description, protocol/port/profile metadata, favorite and actions. | Compact card hides args and shows `Встроенная`, raw author/label values such as `recommendedCommunity`, generic `TCP`/`Профиль 1`, then five equal-looking actions. | Z2M is flatter and more admin-like; metadata is incomplete at a glance. | Users cannot quickly distinguish recommendation, source, coverage and next action. | P1 | Card renderer maps donor fields into generic badges and compact profile labels. | Restore donor metadata hierarchy and use a quieter secondary action row. |
| Recommended Card | `recommended` is a distinct green semantic marker and card metadata visibly differs from normal cards. | Recommended data is visible in raw compound labels such as `recommendedCommunity`; no reliable donor-like green marker in the baseline. | Hard parity failure for recommended semantics. | Recommendation signal is unclear and may look like an internal enum. | P1 | Model label and author are concatenated without semantic presentation mapping. | Render a localized/semantic recommended badge using Z2M green; keep normal cards neutral. |
| Featured Metadata | Donor supports priority metadata through card/list semantics when present. | Current Forgejo catalog has no featured rows; Z2M filter exists but no visible featured metadata. | No visual evidence can be shown from the current source. | None for current data, but the distinction must remain separate from recommended/favorite. | P2 | Current source dataset has no featured entries. | Preserve field/filter and document the source-empty boundary; do not invent badges. |
| Favorite | Star control is a distinct user state with accessible label and active treatment. | Tiny `★` icon button is present; neutral state is visually quiet and active state is not demonstrated in the baseline. | Target/label hierarchy is weaker than donor. | Users may not understand the star affordance until hover. | P2 | Icon-only control inherits compact LuCI sizing. | Keep star semantics separate; enlarge target and make active state explicit without making it a recommendation color. |
| Bulk Selection | Checkbox, selected outline, selected count and sticky rounded bulk toolbar form one clear mode. | Checkbox exists, selected state uses a blue outline, toolbar is hidden until selection and has a rectangular admin surface. | Selection state is visually less cohesive and can compete with active/recommended colors. | Bulk mode is easy to miss after selecting a card. | P1 | Generic selected-card shadow and non-sticky toolbar styling. | Use clear selection precedence and donor-like sticky rounded toolbar with count, Combine and Clear actions. |
| Actions | Apply is primary; Details/Preview/Clipboard/Copy are grouped secondary actions with consistent icon/text rhythm. | Apply is blue; remaining actions are equal compact ghost buttons, and `В буфер`/`Копировать` are visually near-duplicates. | Action hierarchy is flatter and row is crowded. | Users must read five buttons to distinguish copy/export versus duplicate. | P1 | All actions share the same small button primitive. | Separate primary Apply, details/preview utilities, and copy/duplicate semantics with labels/icons and consistent targets. |
| Empty / Error / Loading | Donor has a designed empty learned state and skeleton/list loading shape. | Loaded empty learned state is terse; transient loading uses generic skeletons; no error is visible in this pass. | Empty/loading states do not carry donor-level guidance. | Recovery and next action are less obvious. | P2 | State renderers use generic text/skeleton defaults. | Apply the same component hierarchy to empty and loading states; keep error copy localized and actionable. |

## Hard gates from the initial review

| Gate | Initial result |
|---|---|
| INITIAL_DESIGN_REVIEW | COMPLETE |
| INITIAL_P0 | 0 |
| INITIAL_P1 | 9: Active, Debug, Healthcheck, Learned, Strategy Card, Recommended Card, Bulk Selection, Actions, Header hierarchy |
| INITIAL_P2 | 8: Toolbar, Journal, Search, Filters, Group Header, Featured boundary, Favorite, Empty/Error/Loading |
| RAW_HEALTHCHECK_ENUM_VISIBLE | FAIL: `expired` visible in the rendered Z2M page |
| MIXED_RU_EN_PRODUCT_COPY | FAIL: raw `recommendedCommunity`, `cautionCustom`, `experimentalloop-uh`, and `expired` are visible; technical protocol names are excluded |
| RECOMMENDED_GREEN_VISUAL | FAIL in the baseline: recommended marker is not rendered as a distinct donor-like green semantic badge |
| DONOR_STRUCTURAL_PARITY | FAIL for Healthcheck, Learned, Active and Strategy Card composition |

## Fix order

1. Localize and semantically render status/metadata labels, including the green
   Recommended badge. This removes misleading internal copy first.
2. Recompose Healthcheck and Learned into donor-equivalent product cards while
   keeping the canonical Z2M RPCs and state semantics unchanged.
3. Recompose Active Strategy/debug/Journal as one status component.
4. Restore Strategy Card metadata hierarchy and action grouping.
5. Compact/demote the catalog summary, then tune search/filter/group/bulk
   spacing and selection precedence.

No backend rewrite is required by this review. The current Forgejo source has no
featured rows and no circular rows, so those empty data boundaries remain
explicit rather than being faked visually.

## Final second-pass review

Status: `FINAL_REVIEW_COMPLETE`  
Date: `2026-08-17`  
Reviewer skill: `design-review` used for both the initial and final passes.  
Final rendered target: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager?p03v2=finaldr#/strategies`.

The final pass used the same authenticated in-app Browser session. A temporary
wide viewport was used for the detailed interaction screenshots and was closed;
the user's original tab was restored to the Strategies route. The donor remained
the rendered frozen SHA listed above.

| FINAL_GATE | RESULT | EVIDENCE |
|---|---|---|
| FINAL_P0 | 0 | No blocking visual or interaction defect observed. |
| FINAL_P1 | 0 | All nine initial P1 gaps were corrected and rechecked. |
| Active strategy | PASS | Padded `active-strategy-card`, state/helper copy, grouped Debug and Journal controls; rendered `607x159`, `20px` padding, `12px` radius at the user's viewport. |
| Healthcheck | PASS | First-class `strategy-ops-card` with subtitle, grouped controls, localized status, explanation, config and outage-guard metadata; rendered `607x269`, `20px` padding, `12px` radius. |
| Learned strategies | PASS | First-class autocircular card with explanation, three onboarding steps, CTA, reset and secondary help; rendered `607x282`, `20px` padding, `12px` radius. |
| Strategy/recommended metadata | PASS | Semantic `Рекомендуемая` badge, green treatment, localized source label and neutral normal cards. |
| Bulk selection | PASS | Selected cards show blue selection precedence; sticky rounded toolbar shows `Выбрано`, `Объединить`, and `Снять выделение`. |
| Raw health enum visible | PASS | Browser body leak check returned `[]` for `succeeded`, `pending`, `failed`, `running`, `stopped`, `expired` and internal compound labels. Backend retains its canonical `expired` state; only the UI presentation is localized. |
| Mixed RU/EN product copy | PASS | Product copy is Russian; technical names (`nfqws2`, `healthcheck`, `autocircular`, protocol names) and source author metadata remain intentional. |
| Recommended green visual | PASS | Computed badge: `rgb(92,185,139)`, `rgba(92,185,139,0.1)`, `1px solid rgb(63,111,87)`. |
| Browser diagnostics | PASS | Final in-app Browser dev log list was empty. |

### Final parity classification

- `DONOR_EQUIVALENT`: Active Strategy composition, Debug/Journal grouping,
  Healthcheck hierarchy, Learned/autocircular empty state, strategy metadata,
  Recommended semantic color, selection precedence and bulk toolbar behavior.
- `INTENTIONAL_Z2M_EXTENSION`: compact Forgejo catalog summary, existing
  horizontal LuCI navigation, Z2M route/API/RPC authority, and the `Витрина`
  filter. The catalog summary is now compact and demoted so it does not own the
  primary visual hierarchy.
- `SOURCE_EMPTY_BOUNDARY`: no current Forgejo `featured` or `circular` rows;
  the fields and filters remain distinct and no unsupported badges were invented.
- `REMAINING_P2`: small-screen LuCI shell/navigation density, compact search and
  group spacing, and the fact that the current source has no featured/circular
  examples. None blocks P03 closure.

### Deployment and regression evidence

- Direct static deployment to `root@192.168.1.1` completed without package
  rebuild, auth-daemon restart, Apply, firewall change, reboot or WAN mutation.
- Target read-only RPCs remained healthy: catalog `ok:true` with 4 files and
  639 unique strategies; learned state is explicitly empty; debug is `false`.
- Focused regression suite: `17/17` passed. JavaScript syntax checks and
  `git diff --check` passed.
- Final target file SHA256 matches the local worktree for all four deployed
  assets: `z2m-strategies.js`, `z2m-strategies-model.js`, `z2m-ui.css`, and
  `z2m-shell.js`. Target files are regular `root:root` mode `0666` files as
  reported by the router's mounted filesystem (no symlink or directory target).

## Closure report

```text
DESIGN_REVIEWER_SKILL_USED_INITIAL: YES
DESIGN_REVIEWER_SKILL_USED_FINAL: YES
INITIAL_DESIGN_SCORE: D
INITIAL_P0: 0
INITIAL_P1: 9
INITIAL_P2: 8
FINAL_DESIGN_SCORE: B
FINAL_DESIGN_REVIEW_P0: 0
FINAL_DESIGN_REVIEW_P1: 0
RAW_HEALTHCHECK_ENUM_VISIBLE: 0
MIXED_RU_EN_PRODUCT_COPY: 0
RECOMMENDED_GREEN_VISUAL: PASS
FIXED_P0: ALL (none present)
FIXED_P1: ALL 9
FUNCTIONAL_REGRESSION_TESTS: 17/17 PASS
REAL_BROWSER_ACCEPTANCE: PASS
TARGET_SHA_MATCH: PASS
TARGET_OWNER_MODE: PASS (root:root, regular files)
P04_STARTED: NO
STATUS: DONE
```

## P03 iconography + expanded-card correction: initial findings

Status: `CORRECTION_INITIAL_REVIEW_COMPLETE`  
Date: `2026-08-17`  
Donor authority: frozen SHA `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`, rendered at
`http://127.0.0.1:8765/#strategies`. The deployed baseline was inspected in the
same authenticated Browser session before implementation changes.

The donor uses one lightweight inline SVG language: `viewBox="0 0 24 24"`,
`fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, rounded joins/caps,
with compact `14px` control icons and `18px` favorite icons. Its usable source is
the inline SVG markup in `web/js/pages/strategies.js`, the search/group SVGs in
`web/js/components/list_ui.js`, and the shared `btn-icon`/`btn-icon-only` rules
in `web/css/style.css`. The donor Details handler is delegated
`[data-list-ui-toggle]` behavior that toggles `.expanded` on the same card;
multiple cards can be expanded at once, the state is not persisted, and a list
rerender clears the old DOM.

| CONTROL | DONOR_ICON | Z2M_ICON_BEFORE | INITIAL_FINDING |
|---|---|---|---|
| Paste from clipboard | clipboard SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Create Strategy | plus SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Active Strategy | activity SVG + status dot | status dot only | P1 `MISSING_ICONOGRAPHY` |
| nfqws2 Debug | bug SVG | checkbox + emoji-free text, no icon | P1 `MISSING_ICONOGRAPHY` |
| Journal | document SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Healthcheck | activity/status SVG | status dot only | P1 `MISSING_ICONOGRAPHY` |
| Run check now | play SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Settings | gear SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Learned Strategies | circular/activity SVG | text-only heading | P1 `MISSING_ICONOGRAPHY` |
| Reset all | trash SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Show auto Strategies | circular/play affordance | text-only | P1 `MISSING_ICONOGRAPHY` |
| Search | magnifier SVG | Unicode `⌕` | P1 `MISSING_ICONOGRAPHY` |
| Auto/circular filter | no decorative icon beyond donor filter language | Unicode `⟳` | P2 consistency gap; replace with SVG filter icon |
| Favorites filter | star semantics | text-only `Избранное` | P1 `MISSING_ICONOGRAPHY` |
| Group disclosure | chevron SVG | Unicode `⌄` | P1 `MISSING_ICONOGRAPHY` |
| Strategy favorite | outlined/filled star SVG | Unicode `☆`/`★` | P1 `MISSING_ICONOGRAPHY` |
| Apply | primary action has no donor icon | text-only | P2 donor-equivalent exception: donor has no icon |
| Details | chevron SVG | text-only and no state marker | P1 `DETAILS_EXPANDED_STATE_MISSING_OR_WEAK` |
| Preview | code/terminal SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Clipboard | copy SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Copy/Duplicate | copy SVG | text-only | P1 `MISSING_ICONOGRAPHY` |
| Bulk toolbar | donor action controls use normal icon+label rhythm | text-only | P1 `MISSING_ICONOGRAPHY` |
| Combine | donor copy/action affordance | text-only | P1 `MISSING_ICONOGRAPHY` |
| Clear selection | donor close/clear affordance | text-only | P1 `MISSING_ICONOGRAPHY` |

Initial correction gates:

- `ICONOGRAPHY_P1_REMAINING: 18` (all listed donor-icon controls except
  donor-equivalent text-only Apply, plus the group/filter consistency item).
- `DETAILS_STATE_P1_REMAINING: 1`: current Z2M already toggles `.expanded` and
  reveals args, but the control has no SVG chevron, no active state, no
  accessible expanded state, and no explicit one-card-vs-multi-card contract.
- `TEXT_ONLY_WHERE_DONOR_HAS_ICON: FAIL`.
- `DETAILS_EXPANDED_CONTROL_VISUAL: FAIL`.
- `NFQWS_ARGUMENTS_READABLE: PARTIAL`: raw args exist but the current compact
  card has no donor-style syntax presentation or clear expanded divider.

Baseline evidence: the deployed screenshot showed text-only page actions,
Healthcheck controls, filters, group disclosure, favorite, card actions and
Details; the first card was collapsed with `.strategy-card-args-wrap` hidden.
No backend or RPC change is part of this correction.

## P03 iconography + search/filter/group: final review

Status: `CORRECTION_FINAL_REVIEW_COMPLETE`  
Date: `2026-08-17`  
Final Browser target: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager?p03v2=finaldr#/strategies`.

### Final correction report

```text
DONOR_ICON_SYSTEM: inline SVG; viewBox 0 0 24 24; fill none; currentColor stroke; stroke-width 2; round caps/joins; 14px controls and 18px favorite
Z2M_ICON_SYSTEM: one local svgIcon(name,size) helper using the donor SVG language; no emoji, Unicode arrows, Unicode stars, or external icon framework
ICON_CONTROLS_AUDITED: 23 named controls plus search/filter/group/bulk surfaces
ICON_CONTROLS_FIXED: all donor-icon controls; Apply remains text-only as the donor-equivalent exception
TEXT_ONLY_WHERE_DONOR_HAS_ICON: 0
DETAILS_DONOR_HANDLER: ListUI delegated [data-list-ui-toggle] handler toggles .expanded on the same card; rerender replaces card DOM
DETAILS_EXPANSION_MODEL: MULTI
DETAILS_EXPANDED_CONTROL_VISUAL: PASS (active blue treatment, aria-expanded=true, chevron rotates 180 degrees, label becomes Скрыть)
COLLAPSED_CARD: PASS (checkbox, name/metadata/source, description, protocol/profile tags, favorite and action row; args hidden)
EXPANDED_CARD: PASS (same card, divider, readable syntax-colored nfqws2 args, inline code rows, no nested giant card)
EXPANDED_ARGS_PRESENTATION: PASS (Nfqws2Ide.syntax.highlight; flags/equals/values use donor-derived nfq styles)
RECOMMENDED_PLUS_EXPANDED: PASS (green recommendation badge remains visible while Details is active)
BULK_SELECTED_PLUS_EXPANDED: PASS (blue selected border remains distinct from blue Details surface and sticky toolbar)
FAVORITE_PLUS_EXPANDED: PASS by separate-state CSS/DOM precedence; current canonical dataset has zero favorite rows, so no backend favorite mutation was performed

SEARCH_FIELD_WIDTH_BEFORE: 100% / wrapped count on the deployed baseline
SEARCH_FIELD_WIDTH_AFTER: 52% of the usable toolbar width
RESULT_COUNT_ALIGNMENT: same horizontal toolbar row, right edge aligned
SEARCH_PLACEHOLDER: Поиск по имени, автору, описанию, args...
SEARCH_ICON: inline SVG magnifier inside the field
SEARCH_CLEAR: inline SVG X action inside the right edge; verified visible after query input
FILTER_COMPONENTS_UNIFIED: YES; all filters use the same 29px pill component and hitbox
ACTIVE_FILTER_VISUAL: filled blue donor-equivalent state, not outline-only
AUTO_FILTER_ICON: PASS; inline SVG refresh/circular icon
FAVORITES_FILTER_ICON: PASS; inline SVG star icon
SHOWCASE_FILTER_SOURCE: no equivalent filter in frozen donor strategies.js; Z2M catalog exposes strategy.featured
SHOWCASE_FILTER_CLASSIFICATION: INTENTIONAL_Z2M_EXTENSION in secondary UI, labeled Дополнительно; not claimed as donor parity
FILTER_HITBOX_CONSISTENT: YES
GROUP_HEADER: PASS; full-width 607px quiet graphite bar, 38px rendered height, count at the far right
GROUP_DISCLOSURE_ICON: PASS; donor-derived SVG chevron, rotated on collapse
RESULT_COUNT_SOURCE: ListUI shown.length from the current canonical Z2M rows
RESULT_TOTAL_SOURCE: ListUI items.length from the current canonical Z2M rows; Browser showed 80 из 639 стратегий
GROUP_COUNT_SOURCE: grouped current ListUI window, not donor screenshot numbers
SEARCH_FILTER_GROUP_INITIAL_P1: 5
SEARCH_FILTER_GROUP_FINAL_P1: 0
ICONOGRAPHY_P1_REMAINING: 0
DETAILS_STATE_P1_REMAINING: 0
SEARCH_FILTER_GROUP_P0: 0
SEARCH_FILTER_GROUP_P1: 0
NFQWS_ARGUMENTS_READABLE: PASS
REAL_BROWSER_SEARCH_FILTER_PARITY: PASS
REAL_BROWSER_ACCEPTANCE: PASS
DESIGN_REVIEW_FINAL_P0: 0
DESIGN_REVIEW_FINAL_P1: 0
P04_STARTED: NO
STATUS: DONE
```

### Browser evidence

The same authenticated Browser session verified:

- initial collapsed card, inline expansion, `Скрыть` active state, rotated
  chevron, syntax-colored args, collapse cleanup, and a second card expanded
  independently;
- query input with internal SVG clear button, canonical count suffix only while
  filtered, and clean `80 из 639 стратегий` after clearing;
- filled active `Авто (circular)` pill with SVG icon, unified pill hitboxes,
  full-width TCP group bar and rotated disclosure chevron;
- recommendation green treatment remains present during expansion;
- selected-plus-expanded state retains the blue selected border and separate
  Details surface; the selection toolbar was cleared before handoff;
- final UI raw-copy gate returned no `expired`, compound internal labels, emoji,
  or Unicode placeholder icons; Browser diagnostics were empty.

The final screenshot showed the search row, right-aligned count, all primary
filters, secondary `Витрина` extension, TCP group header and Strategy cards.

### Correction deployment and tests

- Only frontend assets and one new UI regression contract changed in this pass;
  no catalog, healthcheck, autocircular, Apply, scanner, engine, DNS or TG
  backend work was performed.
- Target SHA256 matches local for `z2m-strategies.js`:
  `4d7f60ae73f129032476555117bdebb39d2fdd000975bdc8c947862810e14d43` and
  `z2m-ui.css`:
  `c182fe3798a96bbcaff2ddaba8de307c4a3e8aafd29a2c193a4204a4a396994d`.
- Target files are regular `root:root` mode `0666` files on the mounted router
  filesystem. No auth daemon restart, Apply, firewall change, reboot or WAN
  mutation was used.
- Final focused regression suite: `20/20 PASS`; all JS syntax checks and
  `git diff --check` pass.

## P03 Healthcheck settings initial review

The live authenticated Z2M page was audited at
`/cgi-bin/luci/admin/services/zapret2-manager?p03v2=healthcheck#/strategies`.
The collapsed Healthcheck card exposed `Проверить сейчас`, `Настроить`,
`Интервал: 5 мин`, `Сайтов: 3`, `Сброс после: 2 провалов подряд`, and the
outage/auto-reset labels. Activating the existing `configureHealthcheck()`
handler invoked `window.prompt()` and then sent a partial
`healthcheck_config` mutation.

The frozen Avatar donor renderer was traced in `web/js/pages/strategies.js`:
`toggleHealthcheckSettings()` opens an inline nested panel and
`renderHealthcheckSettings()` renders canonical service selection, custom
domains, interval, failure threshold, outage guard, control site, Save and
Cancel. Its save handler submits one complete healthcheck configuration body.
The donor also renders last-run/result rows from returned data. Donor service
icons are defined in `web/js/pages/diagnostics.js`.

INITIAL_FUNCTIONAL_PARITY: FAIL
INITIAL_DESIGN_PARITY: FAIL
INITIAL_SEVERITY: P1
HEALTHCHECK_NATIVE_PROMPT: 1
HEALTHCHECK_SETTINGS_INLINE: 0
CURRENT_CONFIG_FIELDS: services, custom_domains, interval_min, consecutive_failures, auto_reset, history_size, control_domain, outage_guard
DONOR_CONFIG_FIELDS: services, custom_domains, interval_min, consecutive_failures, outage_guard, control_domain
UI_MISSING_FIELDS: services, custom_domains, consecutive_failures, outage_guard, control_domain
BACKEND_CONFIG_STORAGE: PARTIAL (fields exist, validation and custom-target handoff absent)
BACKEND_CANONICAL_MUTATION: healthcheck_config
HEALTHCHECK_INITIAL_P1: 1
P03_HEALTHCHECK_STARTED: YES

## P03 Healthcheck final closure

The donor was run locally from frozen checkout `38ed85ce487c6b3dbdf703a5be197795f7c0cad1` and compared in Browser with the deployed target card. The donor collapsed card keeps the operation controls and compact interval/site/threshold summary in the card; its expanded state nests the settings panel, service icon checkboxes, custom-domain textarea, numeric controls, outage/control-domain fields, and Save/Cancel actions. The Z2M card now follows that same hierarchy while retaining Z2M's canonical RPC and LuCI shell.

DESIGN_REVIEW_COLLAPSED_DONOR_VS_Z2M: PASS
DESIGN_REVIEW_EXPANDED_DONOR_VS_Z2M: PASS
DESIGN_REVIEW_SERVICE_ICONS: PASS (donor-derived presentation map; canonical catalog IDs/names remain authoritative)
DESIGN_REVIEW_VISUAL_HIERARCHY: PASS
DESIGN_REVIEW_WRAPPING: PASS
DESIGN_REVIEW_READABILITY: PASS
FUNCTIONAL_PARITY: PASS
DESIGN_PARITY: PASS
HEALTHCHECK_NATIVE_PROMPT: 0
HEALTHCHECK_SETTINGS_INLINE: YES
HEALTHCHECK_CANCEL_BACKEND_MUTATIONS: 0
HEALTHCHECK_SAVE_MUTATIONS: 1 canonical `healthcheck_config` call
HEALTHCHECK_SETTINGS_FIELDS: services, custom_domains, interval_min, consecutive_failures, outage_guard, control_domain
HEALTHCHECK_CUSTOM_DOMAIN_VALIDATION: PASS (blank lines ignored; malformed, bounded and total-target limits rejected)
HEALTHCHECK_RAW_ENUMS_IN_UI: 0
HEALTHCHECK_RESULTS_SOURCE: canonical health_matrix job rows
P1_REMAINING: 0

### Real Browser acceptance

The same authenticated Browser session verified the deployed router UI:

1. Opened the collapsed Healthcheck card and expanded the inline panel. No native dialog appeared. Canonical current services were rendered as icon-backed checkboxes, with custom domains, interval, threshold, outage guard, control site, Save and Cancel.
2. Changed the interval to `7`, pressed Cancel, and verified the panel closed while the router config remained at `interval_min: 5`.
3. Reopened, saved bounded value `6`, verified the collapsed card showed `Интервал: 6 мин`, then reopened and saved `5`.
4. Final target config was restored to the original values: services `youtube, discord, twitch`, custom domains empty, interval `5`, threshold `2`, auto-reset enabled, outage guard enabled, control site empty.
5. Pressed `Проверить сейчас`. Browser showed `Проверка выполняется`; the resulting job was `job-1786919084-3`, `status: succeeded`, `elapsedSec: 28`, and three canonical result rows. Reopened settings after completion and verified the result table rendered without raw backend class enums.

HEALTHCHECK_BROWSER_ACCEPTANCE: PASS
HEALTHCHECK_ASYNC_COMPLETION: PASS
HEALTHCHECK_FINAL_JOB: job-1786919084-3 / succeeded / 3 rows
HEALTHCHECK_FINAL_CONFIG_RESTORED: YES
HEALTHCHECK_LEARNED_RESET: NOT RUN
HEALTHCHECK_FIREWALL_APPLY: NOT RUN
HEALTHCHECK_REBOOT_OR_WAN_MUTATION: NOT RUN

### Verification and deployment

- Focused contract suite: `4/4 PASS` (`tests/ui/p03-healthcheck-settings-contract.test.mjs`).
- `git diff --check`: PASS.
- Target `ubus call zapret2-manager healthcheck_status` loaded the deployed ucode successfully; invalid `custom_domains: ["bad domain"]` returned `EINPUT` without a mutation.
- Local and target SHA256 matched for all six deployed files:
  - `z2m-strategies.js`: `be518b6a9b2b4ee786fa514d202e36dd034a9ed9e182fb93e4e64595e7030ff8`
  - `z2m-healthcheck-model.js`: `6926dff07a06302bbbd78ac4e717a46908d7ca906c77374e6dd2611dbdec6cdb`
  - `z2m-ui.css`: `17b322aedb3d686a3fdf681633bd927125a13d4913ed6747a01873d2e305d6a8`
  - `strategies-ops.uc`: `78ca1f93b43fbfea87a1ff379005a0cb59310ac9c85dceffc6af5121f5c411f8`
  - `jobs.uc`: `4498fd17b749ecb3accf180a2cf405d24d4ce423d05c7904f53787ca6e72170f`
  - `health-run.sh`: `191771e8b9e11b1d1b1db506ebe35777c6d74e00895b117490f6737a8ea7262f`
- No Apply, firewall change, reboot, WAN mutation, learned-state reset, or unrelated checkout cleanup was performed.

P03_HEALTHCHECK_FINAL: DONE

## P03 Strategy collapsed-card port metadata parity

The frozen Avatar donor renderer was traced in `web/js/pages/strategies.js`:
collapsed cards render the already-derived Profile `name`; `_detectProfileInfo`
derives `TCP (порты ...)` and `UDP (порты ...)` from canonical
`--filter-tcp/udp=` arguments. The Z2M model now applies the same presentation
boundary to canonical Profile fields (`tcpPorts`, `udpPorts`, `filters`) and
the raw Profile `args`, preserving each protocol and range as a separate tag.
No port value is stored in the renderer or hardcoded into the card.

The deployed target was verified in Browser against a temporary user Strategy
containing real TCP and UDP ranges. Its collapsed card showed
`TCP (порты 2053,2083,2087,2096,8443)` and
`UDP (порты 19294-19344,50000-50100)` while `Подробнее` remained closed. The
temporary Strategy and bounded `/tmp` verification artifacts were removed
after acceptance; the pre-existing selected Strategy and Healthcheck config
were unchanged.

The real donor card `ALL TCP & UDP YTDisBystro 3.4 v1` was compared with the
real Z2M card for protocol tags, ranges, visual hierarchy, wrapping and
readability. Both retained separate TCP/UDP pills in the collapsed state.

COLLAPSED_CARD_PROTOCOL_VISIBLE = YES
COLLAPSED_CARD_PORTS_VISIBLE = YES
PORT_DATA_SOURCE = CANONICAL_STRATEGY_DATA
HARDCODED_PORT_LABELS = 0
DESIGN_REVIEW_PROTOCOL_TAGS: PASS
DESIGN_REVIEW_PORT_RANGES: PASS
DESIGN_REVIEW_VISUAL_HIERARCHY: PASS
DESIGN_REVIEW_WRAPPING: PASS
DESIGN_REVIEW_READABILITY: PASS
PORT_METADATA_PARITY = PASS

### Verification and deployment

- Focused port contract: `3/3 PASS` (`tests/ui/p03-strategy-port-metadata.test.mjs`).
- JavaScript syntax checks and `git diff --check`: PASS.
- Local and target SHA256 matched after scoped deployment:
  - `z2m-strategies.js`: `49e1507727633df4ea00cee71ecfb55b9fa09dc7622f3f7ed616278a53b32c83`
  - `z2m-strategies-model.js`: `35652709bd7cad7e8d6dbfe1607a52af824d3c260157480e05afeb44c2a19afa`
  - `z2m-ui.css`: `2ab84c559470f1d449d4c79303391d907b9a573f2b8c18e0a552d54eca22717b`
- Browser acceptance: real collapsed-card DOM contained two independent protocol/range badges; details rectangle was zero-sized and `expanded=false`.

P03_PORT_METADATA_FINAL: DONE

### Healthcheck result visibility correction

The canonical `healthcheck_status` response already contained the completed
job rows, including rows from an `expired` job. Z2M rendered those rows only
inside the settings-open branch, while the donor renders the latest result
body in the normal collapsed Healthcheck card. The renderer now appends the
canonical result table independently of the settings panel.

HEALTHCHECK_RESULT_SOURCE = CANONICAL_HEALTHCHECK_JOB_ROWS
HEALTHCHECK_RESULTS_COLLAPSED_VISIBLE = YES
HEALTHCHECK_RESULTS_SETTINGS_REQUIRED = NO
HEALTHCHECK_RESULTS_PARITY = PASS

Browser acceptance on the live target, with settings closed, showed the
actual completed run with three rows: `youtube`, `discord`, and `twitch`.
The result table remained visible without opening «Настроить».

### Verification and deployment

- Focused P03 regression set: `20/20 PASS`.
- JavaScript syntax check and `git diff --check`: PASS.
- Local and target SHA256 matched for the deployed `z2m-strategies.js`:
  `52c1ed4526934b6f0854338379ce3e98fcef239804c0b3c7f8661845f9616d24`.
- Browser screenshot and DOM inspection confirmed the visible result table
  while the settings fields were absent (`settingsFields = 0`).

HEALTHCHECK_RESULTS_FINAL: DONE

### Healthcheck selected-service classification correction

The previous target run incorrectly classified every checked service as
`skipped` when `catalogPresent=false`. That field only describes presence in
the separate domain include list; it is not the Healthcheck selection. A
checked service is already an explicit canonical target, so catalog presence
is now retained as diagnostic evidence and no longer short-circuits the
DNS/TCP/TLS/HTTP classifier.

HEALTHCHECK_CHECKBOX_IS_EXPLICIT_TARGET = YES
HEALTHCHECK_CATALOG_PRESENCE_IS_DIAGNOSTIC_ONLY = YES
HEALTHCHECK_SELECTED_SERVICE_SKIP_ON_LIST_MISS = NO
HEALTHCHECK_CLASSIFICATION_PARITY = PASS

Live target acceptance after the backend deployment:

- `youtube`: `unknown-timeout` / TCP probe timed out.
- `discord`: `unknown-timeout` / TCP probe timed out.
- `twitch`: `reachable-http` / HTTP 301.

The Browser card showed the corresponding user-facing statuses `Недоступен`,
`Недоступен`, and `OK`; no row was `Пропущен`.

### Verification and deployment

- Focused P03 regression set: `21/21 PASS`.
- JavaScript syntax check, target `ash -n`, and `git diff --check`: PASS.
- Deployed target SHA256:
  - `jobs.uc`: `a5231950477e13763a046729cabce4d6d9707750dcfeb1e8aa88e5eb5366f4fa`
  - `health-run.sh`: `ce7adedb3911d4034ef590003a1afaa693981c34bf08a62cb8b7bb4c59d71a75`

HEALTHCHECK_SELECTED_SERVICE_CLASSIFICATION_FINAL: DONE
