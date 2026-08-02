# Zapret2 Manager — Remastered UI v2: T0 audit and design contract

## 0. Scope, evidence, and invariants

This is the T0 design contract for the LuCI remaster.  It records the repository as checked at `20ea953b8770801168ec89cd6106f6309df3d6f5`; it does not change a JavaScript, ucode, RPC, ACL, package, or release file.

The current persisted full source gate is r120: `1015 green / 0 red` at `98881c6ec7290be87b060e115ea17ad98bc47c39`, recorded by the current HEAD in `docs/zero-red-remediation.md`.  Router acceptance of destructive Auto Strategy paths remains partial: the r119 acceptance document did not exercise controlled three-failure scan, winner/apply, rollback, or reboot persistence.  T0 therefore treats source-gate success and live acceptance as separate evidence.

Non-negotiable implementation rules for T1–T9:

- Preserve existing controller, bounded Orchestra worker, trusted admission, preview/apply/rollback, persistent last-good, boot recovery, RPC names, IDs, and ACL boundaries.
- The browser renders backend truth; it never computes health, a winner, score, hysteresis, cooldown, phase transitions, or apply admission.
- Do not add a second catalog, browser persistence for controller state, upstream direct writes, broad ACL grants, external frontend frameworks, Zapret2GUI source/assets, or Windows-specific logic.
- An accepted asynchronous mutation is not completed. Unknown outcomes are refreshed once and are never retried automatically. `ECONFLICT` refreshes status and does not replay a mutation.

## 1. Current UI inventory

### Published routes and source views

The current menu has **8 registered routes** and **7 distinct view targets**.  It maps the root Manager route and the `/orchestra` child to the same `orchestra` module.  There are **11 page view modules** in the package, plus the shared `z2m-ui.js` helper and `z2m-ui.css` stylesheet.

| Current menu route | Title | Current target | T0 finding |
|---|---|---|---|
| `admin/services/zapret2-manager` | Zapret 2 Manager | `orchestra` | Root opens Orchestra, not `overview.js`. |
| `…/strategies` | Advanced | `strategies` | Advanced profile editor is user-visible. |
| `…/orchestra` | Orchestra | `orchestra` | Duplicate target of root route. |
| `…/lists` | Lists | `lists` | Existing list workflow. |
| `…/dns` | DNS | `dns` | DNS and Service DNS/provider workflows share this page. |
| `…/monitor` | Monitor | `monitor` | Technical runtime screen. |
| `…/proxy` | Proxy | `proxy` | Separate optional proxy slice. |
| `…/maintenance` | Maintenance | `maintenance` | Backup/event/diagnostic workflow. |

Source view modules not currently reached by the menu are `overview.js`, `blockcheck.js`, `catalog.js`, and `service-dns.js`.  This conflicts with `docs/ui-spec.md`, which describes a ten-entry historical menu.  The mismatch is a migration risk, not a T0 code-fix.

### Current Orchestra UI

`orchestra.js` is one large view with four hash panels: **Services**, **Find strategy**, **Runs & results**, and **Adaptive engine**.  It owns local tabs, local panel state, run polling, catalog selection, manual run form, ranking rendering, preview/apply display, and the Auto Strategy block.  The UI has useful safety behavior already: JSON-string RPC transport, busy controls, selected-run scoping, bounded polling, backend capability checks for Auto Strategy, confirmation before last-good restore, and a refresh-after-`ECONFLICT` message.

Observed UX and contract defects:

1. Auto Strategy is embedded in read-only Adaptive engine, making two apparent operating modes compete.
2. Services are full cards with checkboxes, domains and detailed mechanisms; they do not scale as a compact searchable catalog.
3. Find strategy exposes candidate mode, repeats, attempt timeout and run timeout as its primary workflow.
4. The current ranking calculates `stability`, median latency, and `score` in the browser.  This conflicts with the target rule that ranking and score are backend truth.
5. Auto Strategy renders raw phases, revisions, hashes, service IDs, infrastructure status and `[VERIFY:ROUTER]` in its normal state grid.
6. A direct `daemonRunning ? Running : Not running` mapping can report `nfqws2: Not running` without reconciling the canonical runtime/NFQUEUE state.
7. Run failures are rendered through `structuredError()` literally, so a valid response that is parsed incorrectly can surface `parse failed` without the required bounded error code and Retry presentation.
8. A button's disabled reason is often only a tooltip.  The page does not provide a persistent, clear explanation for every unavailable Enable, Run now, Stop, or Restore action.

### Current strategies and shared UI

`strategies.js` already has applied/draft separation, import-applied, preview → confirm → apply, confirmation/rollback controls, and a drift warning.  Its default content still centers profile indexes, raw option strings, protocol filters, revision-oriented draft management, and a passthrough diagnostic adjacent to normal actions.  The shared `z2m-ui.js` already provides `page`, `hero`, `cardGrid`, `card`, `badge`, `kvRow`, `callout`, `collapsible`, `empty`, `actions`, `tableWrap`, `mono`, `loading`, `error`, and section helpers; Orchestra duplicates its own `badge`, key/value, alert, details, button, heading and section functions.

## 2. Current route/view and RPC mapping

Static inspection finds **99 unique RPC methods declared by the 11 page modules**.  The remaster-relevant mapping below is the migration source of truth; unrelated DNS, lists, proxy and maintenance features remain on their current routes until a later approved scope includes them.

| Current page or panel | Read RPC | Mutation RPC | Current user action / migration destination |
|---|---|---|---|
| Orchestra: Services | `catalog_list`, `catalog_status`, `catalog_get`, `health_matrix_get`, `orchestra_run_history`, `orchestra_run_status` | `catalog_preview`, `catalog_apply`, `orchestra_run_start` | Existing catalog selection and service scan → new Services. |
| Orchestra: Find strategy | `orchestra_run_status`, `orchestra_run_history` | `orchestra_run_start`, `orchestra_run_continue`, `orchestra_run_pause`, `orchestra_run_resume`, `orchestra_run_stop` | Bounded scan controls → Auto Strategy and Runs. |
| Orchestra: Runs & results | `orchestra_run_history`, `orchestra_run_status`, `orchestra_apply_status`, `orchestra_apply_events` | `orchestra_preview_best`, `orchestra_apply_best`, `orchestra_restore_previous` | Run history, candidate evidence, sanctioned preview/apply/restore → Runs and Strategy Rating. |
| Orchestra: Adaptive engine / Auto Strategy | `orchestra_auto_status`, `orchestra_status`, `orchestra_capabilities`, `orchestra_events`, `orchestra_history`, `orchestra_ratings_get` | `orchestra_auto_enable`, `orchestra_auto_disable`, `orchestra_auto_run`, `orchestra_auto_stop`, `orchestra_auto_restore` | Auto controller → Auto Strategy; read-only engine evidence → Diagnostics. |
| Strategies | `status`, `profiles_list`, `profiles_validate` | `profiles_create`, `profiles_update`, `profiles_clone`, `profiles_delete`, `profiles_import_applied`, `profiles_apply`, `confirm_alive`, `rollback`, `passthrough` | Applied/runtime/drafts and safe reapply → Strategies; passthrough → Diagnostics danger zone. |
| Monitor | `status`, `events_tail`, `job_list` | none | Runtime/NFQUEUE facts → Overview summary and Diagnostics detail. |
| Catalog / Blockcheck source views | `catalog_list`, `catalog_status`, `catalog_get`, `health_matrix_get`, `job_list`, `blockcheck_status` | `catalog_preview`, `catalog_apply`, `health_matrix_start`, `health_matrix_job_cancel`, `blockcheck_start`, `blockcheck_cancel`, `blockcheck_apply` | Preserve workflows; only reuse catalog data, never clone it in JavaScript. |

The RPC plugin exports the above Orchestra/Auto Strategy methods and keeps their current JSON-string `edit` envelope where declared.  The ACL grants `orchestra_auto_status` as read and the five Auto mutations as write.  T0 also found a compatibility issue: `orchestra.js` declares `orchestra_run_continue`, but the current ACL list does not grant that method.  T1 must decide whether the declared control is still intended; it must not widen ACL access without an evidence-backed contract and focused test.

## 3. State and phase matrix

### Auto Strategy controller

Backend phases are the only legal source: `disabled`, `waiting-network`, `healthy`, `degraded`, `scanning`, `applying`, `verifying`, `recovering`, `cooldown`, and `failed`.  T2 maps them to localized display copy; it does not create a browser state machine.

| Backend phase | User-facing copy | Primary action when capability permits | Secondary / details | Danger action |
|---|---|---|---|---|
| `disabled` | Auto Strategy is off | Enable Auto Strategy | Choose services; technical details | — |
| `waiting-network` | Waiting for router infrastructure | Refresh / Check readiness | Explain missing infrastructure | Disable, if enabled |
| `healthy` | Protection is working | Check now | Last successful check; details | Disable / Restore last-good when offered |
| `degraded` | Some selected services need attention | Check now | Affected service summary; details | Restore last-good when admitted |
| `scanning` | Checking strategies | Open active run | Progress and selected services | Stop if backend capability allows |
| `applying` | Applying confirmed strategy | Open active run | Transaction stage; details | No competing mutation |
| `verifying` | Verifying applied strategy | Open active run | Verification stage; details | No competing mutation |
| `recovering` | Restoring a safe configuration | Open active run | Recovery reason; details | No competing mutation |
| `cooldown` | Waiting before the next check | Refresh | Cooldown reason/time; details | Disable if backend permits |
| `failed` | Auto Strategy needs attention | Resolve configuration / Refresh | Bounded code and technical details | Restore last-good if admitted |
| unknown or malformed | Check has not run yet / state unavailable | Refresh | Technical details | Mutations disabled |

For every phase, `capabilities` and the backend admission result determine availability.  A disabled action has visible explanatory text beside it, not only a `title` attribute.  “Unknown” is neither healthy nor failed.  `accepted` remains “Request accepted; waiting for router confirmation” until a refreshed terminal state proves completion.

### Runs, ranking, and apply

| Backend situation | User presentation | Allowed action |
|---|---|---|
| queued/running/paused | In progress with bounded progress and last update | Open run; Pause/Resume/Stop only when backend capability says so |
| completed with confirmed winner | Confirmed winner | Preview / Apply through existing sanctioned pipeline |
| completed with working but unconfirmed candidate | Needs confirmation | View evidence; no Apply |
| partial/infrastructure error | Check could not be completed | Retry as an explicit new request only |
| malformed response | Could not read router response; bounded code; Retry | Retry read only; no implicit mutation retry |
| stale run/generation/revision | Result is no longer current | Refresh; never Apply |
| preview/apply accepted | Router is applying configuration | Poll operation; do not claim success |
| verification failure | Previous configuration was restored, or rollback needs attention | Read error/details; no automatic replay |

## 4. User roles and authorization model

The present ACL exposes one `zapret2-manager` ACL with read/write method groups, not three named product roles.  The remaster must derive the following UI roles from actual ubus authorization and capability responses; it must not add an ACL wildcard or simulate permissions in local storage.

| Product role | Visible data | Allowed operations |
|---|---|---|
| Read-only | All granted status, run history, rating, diagnostics and technical details | Refresh, filter, inspect, export only when current ACL permits; all mutations show the router-provided unavailable reason. |
| Operator | Read-only data plus safe workflow controls | Select services, request scan, enable/disable Auto Strategy, stop when admitted, preview/apply confirmed winner, restore last-good through existing RPCs. |
| Administrator | Operator functions plus existing advanced configuration controls | Manage drafts, import runtime into drafts, sanctioned reapply, backups and guarded Diagnostics danger-zone actions. |

## 5. Target navigation specification

The new internal Orchestra navigation has exactly seven entries, rendered through LuCI localization conventions: **Overview**, **Auto Strategy**, **Services**, **Strategy Rating**, **Strategies**, **Runs**, and **Diagnostics**.  The shell is internal navigation first; legacy top-level routes remain backward compatible in T2 and are redirected/mapped only after their existing controls remain reachable.

There is one primary action per screen.  Refresh, View details, Edit and Compare are secondary.  Disable, Stop, Restore and Passthrough are danger actions and use confirmation where mutation risk requires it.  Internal hashes/routes must be deep-linkable, keyboard reachable, and safe to horizontally scroll on a narrow viewport.

## 6. Text wireframes

### 6.1 Overview

```text
[Zapret2 Manager] [last refreshed]                                  [primary action]
System health: Healthy | Needs attention | Checking | Unavailable
[nfqws2] [NFQUEUE] [Auto Strategy] [selected services]
Current strategy: <safe display label>       Last-good: <safe state>
Active operation: <phase and link>           Last successful check: <time>
Actionable warnings only
  - <warning, why it matters, View details>
```

Default content excludes raw hashes, revisions, paths, generation/evidence IDs and `[VERIFY:ROUTER]`.  The primary action is selected solely from backend capability/admission: Enable Auto Strategy, Check now, Open active run, Resolve configuration drift, or Restore last-good.

### 6.2 Auto Strategy

```text
[Auto Strategy] [enabled/disabled badge]                           [primary action]
<plain-language phase>  ·  <health>  ·  Last successful check <time>
Selected services: <compact names and count> [Edit]
Current run: <progress / current stage / Open active run>
Last-good: <available / unavailable, safe label>
Admission: <why the primary action is available or unavailable>
[Technical details v]
```

The `Technical details` disclosure contains phase code, current/last-good revisions and hashes, evidence IDs, infrastructure reason, verification diagnostics and raw controller fields.  Adaptive engine facts are not part of the normal Auto Strategy workflow.

### 6.3 Services

```text
[Services] Total N · Enabled N · Healthy N · Needs attention N · In Auto Strategy N
[Search services...] [All v] [Enabled] [Needs attention] [Auto Strategy]
Category: Video (N)                                              [collapse]
  Service name | status | enabled | Auto Strategy | [single primary action]
  <expanded: domains, DNS, IDs, profile binding, diagnostics>
Selected for Auto Strategy: <names/count>                         [Edit selection]
```

Rows are sourced from the existing catalog response and preserve service IDs.  There is no second static catalog, duplicated service manifest or browser-only ownership model.

### 6.4 Strategy Rating

```text
[Strategy Rating] Service · Protocol · Target · Run date            [primary action]
Candidates N | Confirmed working N | Baseline | Applied | Last-good | Winner
[All] [Confirmed] [Working] [Failed] [Unverified] [Applied] [Last-good]
Sort: [Recommended v]
Rank | Strategy | Techniques | Confirmation | Attempts | Status | Markers | Action
 #1    <display name> <labels>  <evidence summary> <count> Confirmed winner Applied  [Apply]
        [Details: target scope, evidence, required targets, technical identifiers]
```

The page is always scoped by service, target/domain, protocol, transport, profile, `runId`, and generation.  It never declares one global best strategy.  TCP, UDP, TLS, QUIC, Discord/STUN and each profile are separate scopes.

### 6.5 Strategies

```text
[Strategies] Service running · Runtime N · Applied N · Draft N · Drift <state>
<drift notice with plain-language cause> [View differences] [Import runtime into drafts] [Reapply saved configuration]
Applied / Runtime / Draft tabs
  <purpose> · <protocol> · <ports> · <strategy display name>          [Edit]
  [Technical details: raw IDs, indexes, filters, hashes, arguments]
```

View differences is read-only.  Import creates drafts only from the canonical runtime source and never changes Applied.  Reapply invokes existing preview/apply/rollback.  Passthrough moves to Diagnostics danger zone.

### 6.6 Runs

```text
[Runs] [Refresh]
Target/service | time | state | candidates | duration | winner/no winner | apply/rollback
<selected run>
  Progress · candidates · ranking link · winner · confirmation · apply · verification · rollback
  <bounded error code/message if present>                             [Retry]
```

No raw shell output is displayed.  A malformed valid backend envelope receives a bounded user error and a read Retry; it must never be labelled merely `parse failed`.

### 6.7 Diagnostics

```text
[Diagnostics] [Refresh]
Runtime: PID · start time · argv hash · applied/runtime comparison · NFQUEUE · counters
Auto Strategy: controller state · last-good · active run · evidence · locks · cooldown
Compatibility: target ucode · Lua · package · RPC
Danger zone: [Passthrough] [advanced recovery] (confirmation required)
```

Diagnostics intentionally contains raw identifiers, paths, hashes, raw capability/evidence records and legacy Adaptive engine information.  It is visually and semantically separate from normal operation.

## 7. Strategy Rating specification

### Data contract and status

The backend supplies canonical ranking rows, recommended order, display name, technique labels, status, confirmation strength, success ratio, configuration-delta classification, stable candidate order, evidence scope, and apply admission.  The client only formats these values, filters already returned rows, and links to a selected run.  Latency is display evidence, never the sole rank criterion.

Required row states are: Confirmed winner, Working, Partially confirmed, Failed, Infrastructure error, Not tested, and Stale result.  Stale results are visually explicit and non-applicable.  Markers separately identify applied and last-good candidates.

### Trusted apply contract

The only Apply request payload is `{ runId, generation, candidateId, expectedRevision, requestId }`.  It contains neither raw strategy configuration nor a browser-computed score.  The router's existing sanctioned sequence remains preview → snapshot → apply → restart → verification → success or rollback.  Any admission denial is rendered as an `AdmissionReason`; a revision conflict refreshes the scoped response and does not retry.

## 8. Shared component inventory

T2 extracts composable LuCI helpers, using `E()` and existing theme variables rather than a framework.  The inventory is **16 components/helpers**:

1. `PageHeader` — title, description, freshness and one primary action.
2. `StatusBadge` — canonical status with text equivalent, never color alone.
3. `SummaryPanel` — compact key facts with unknown/unavailable support.
4. `NoticeBanner` — actionable warning, informational or bounded error.
5. `PrimaryButton` — capability/admission-aware main action.
6. `SecondaryButton` — Refresh, details, edit and compare action pattern.
7. `DangerButton` — confirmation-aware destructive action pattern.
8. `EmptyState` — no data, unavailable data or not-yet-run state.
9. `FilterBar` — scoped filter/sort controls with result count.
10. `SearchInput` — labelled, debounced local filtering of returned data only.
11. `ServiceRow` — catalog-backed compact row and controlled disclosure.
12. `StrategyRatingRow` — backend-ranked row, status, markers and trusted action.
13. `ProgressPanel` — accepted/running/terminal operation presentation without invented completion.
14. `DetailsDisclosure` — accessible generic disclosure for non-sensitive detail.
15. `ConfirmationDialog` — explicit irreversible/danger confirmation with intent-specific text.
16. `ErrorPanel`, including `TechnicalDetails` and `AdmissionReason` subhelpers — bounded code/message, Retry/read refresh, raw diagnostics disclosure and availability explanation.

The final group may share a common implementation but remains separate semantic APIs so errors, technical data and admission are not conflated.  Existing `z2m-ui.js` is the seed; duplicate Orchestra helper markup/state logic is removed only in T2 after contract tests protect behavior.

## 9. Responsive, error, empty and accessibility rules

### Responsive

| Viewport | Required layout |
|---|---|
| Desktop (1366px+) | Summary grids may use multiple columns; wide tables retain labelled columns. |
| Compact desktop (1024–1365px) | Fewer summary columns; table actions never overlap labels. |
| Tablet (768–1023px) | Two/one-column adaptive grid; service/rating rows may move metadata below title. |
| Mobile (<768px) | One column; touch-safe buttons; row disclosures; tabs scroll horizontally without page overflow. |
| Browser zoom (100% and 80%) | Both are checked; design must remain usable at 100% and must not depend on 80%. |

Long service and strategy names wrap or truncate with an accessible full label.  Controls never overlap; no horizontal document overflow is accepted.  Technical details start collapsed.

### Errors and empty states

- Loading uses a labelled skeleton for known layout, otherwise a concise progress text; it does not look like completed data.
- No prior check: “Проверка ещё не выполнялась” / localized equivalent, with the permitted action.
- Partial: “Состояние подтверждено не полностью”; infrastructure not ready: “Система ещё не готова к проверке”; no last-good: “Последняя рабочая стратегия отсутствует.”
- RPC, parse and malformed envelopes show a stable bounded code/message and read Retry.  Raw shell output, paths and stack-like text stay in Technical details or Diagnostics.
- Unknown values never fall back to success or failure.  Empty ratings, services, runs and drafts explain why they are empty and what available action can create data.

### Accessibility and keyboard

- Use native button, input, label, table, heading and `details/summary` semantics; preserve visible focus.
- Tabs use a labelled tablist/navigation pattern with `aria-current` or managed selected state, arrow-key movement where implemented, Enter/Space activation, and deep-link focus restoration.
- Every icon, color, badge and progress cue has text.  Status changes use a concise polite live region; critical rollback/error notices use an assertive region only when new.
- Disclosure controls expose `aria-expanded`; dialogs trap focus, provide Escape/cancel, restore focus to the invoker, and use explicit confirmation text.
- Respect `prefers-reduced-motion`; progress animation is decorative and never the only progress signal.

## 10. Backend contract inventory

### Already available and reusable

| Area | Existing fields/semantics |
|---|---|
| Auto Strategy | `revision`, `generation`, `enabled`, `serviceIds`, canonical phase, timestamps, cooldown, active run ID, consecutive/infrastructure failures, current-applied and last-good revision/hash, divergence/recovery status, bounded `lastError`, capabilities, health/infrastructure, active-run progress and last-good record.  Mutations already require `expectedRevision` and bounded `requestId` and are idempotency-aware. |
| Runs | `runId`, target/service target type, protocols, candidate mode/count, run phase/timestamps/progress, selected winner, candidate evidence, validity/compatibility fields, run history, preview and apply status/events. |
| Trusted apply | Existing preview/apply/restore operation, transaction snapshot, runtime verification, rollback and confirmed persistent last-good path. |
| Service catalog | Catalog list/status/get, category, service ID/name, domains, mechanisms, limitations, enabled selection, ownership-safe preview/apply and health matrix. |
| Strategies | Service/runtime state, applied profiles, draft profiles, optimistic revisions, validation, import-applied, preview/apply verification/rollback, drift flag/reason and manual recovery controls. |
| Runtime/diagnostics | `status`, Monitor/NFQUEUE fields, `orchestra_status`, capability matrix, events/history availability reason/evidence and compatibility data. |

### Missing compatible additions (only if T1 confirms they are absent)

1. A canonical Run response version with bounded error `{ code, message, retryable }`, stable progress fields and no ambiguous parse wrapper.
2. A canonical Runtime status verdict that reconciles process, process start time and NFQUEUE ownership, plus an explanation code for unavailable/partial rather than a boolean-only `daemonRunning` label.
3. Auto Strategy `admissionReason`/action availability objects for each control, so availability is not reconstructed from client conditionals.
4. Display-safe Auto summary fields: selected-service names/counts, friendly phase/health explanation code, last successful check and active operation summary.
5. Catalog summary counts and canonical service display labels/statuses/Auto participation, sourced from the existing catalog rather than a duplicated data structure.
6. Canonical, scope-bound Strategy Rating response containing server ranking/order, display labels, technique labels, status, confirmations/attempts, applied/last-good marker, stale verdict, generation and trusted apply admission.
7. Read-only drift comparison preview that identifies the canonical runtime source and applies no mutation.

All additions are additive and backwards compatible.  Existing response fields, IDs and RPC method names remain unchanged.

## 11. Migration map

| Current screen/panel | Target remastered screen | Migration rule |
|---|---|---|
| Root Manager / Orchestra Services | Overview + Services | Root becomes Overview only after legacy route compatibility is retained; catalog remains single source. |
| Orchestra Find strategy | Auto Strategy + Runs | Simple operation uses controller actions; expert run configuration is guarded/secondary. |
| Orchestra Runs & results | Runs + Strategy Rating | History/progress stays in Runs; scoped evidence/ranking/apply moves to Rating. |
| Orchestra Adaptive engine | Diagnostics | Read-only engine/capability evidence moves out of normal workflow. |
| Embedded Auto Strategy block | Auto Strategy | Keep exact existing controller RPCs and polling semantics. |
| Strategies applied/draft editor | Strategies | Keep draft CRUD and sanctioned apply; simplify cards and move raw fields to details. |
| Strategies passthrough | Diagnostics danger zone | Preserve method/ACL; add confirmation and remove it from normal workflow. |
| Monitor | Overview summary + Diagnostics | Overview shows only health; Monitor-level raw facts stay diagnostic. |
| Catalog / Blockcheck source views | Services / Diagnostics links as applicable | Do not delete or clone during remaster; reconcile route reachability first. |

## 12. T1–T9 implementation plan

### T1 — Truth and contract stabilization

Fix valid Run responses that become `parse failed`; create canonical run fixtures from router responses; establish a canonical runtime/NFQUEUE verdict; add only additive admission/explanation/progress/rating/drift fields needed by the UI.  Cover all success, malformed, unavailable, conflict, accepted and rollback envelopes.  Do not redesign pages.

### T2 — Shared UI foundation and navigation

Extract the component inventory from `z2m-ui.js`/Orchestra duplication; add the seven-item internal shell, loading/error primitives, capability/admission rendering and responsive base.  Preserve legacy pages/routes and exact RPC transport.  Do not deliver a page-specific workflow redesign beyond wiring the shell.

### T3 — Overview

Build the concise truthful overview from canonical status summaries.  Implement backend-selected primary action, active-operation link, actionable warnings and technical disclosure.  Do not expose raw diagnostics by default.

### T4 — Auto Strategy

Move the controller to its dedicated workflow: service selection via the existing catalog, enable/disable/run/stop/restore, progress, last-good, admission reason and technical details.  Move Adaptive engine read-only content to Diagnostics; retain non-overlapping polling and no-retry semantics.

### T5 — Services

Render the existing catalog as search/filterable, category-collapsible compact rows with counts, selected-service summary and synchronized Auto participation.  No JavaScript service catalog is added; domain/DNS/ID/profile diagnostics are disclosures.

### T6 — Strategy Rating

Consume the canonical scope-bound backend ranking; build filters, backend sort choices, evidence details and trusted Apply payload.  Mark stale results non-applicable and keep preview/apply/rollback pipeline unchanged.

### T7 — Strategies

Reframe applied/runtime/drafts around readable purpose/protocol/ports/display name.  Add read-only differences, canonical runtime import into drafts and sanctioned reapply; relocate passthrough to Diagnostics danger zone.

### T8 — Runs

Build understandable run history, selected-run progress, candidate/ranking links, winner, apply/verification/rollback state and bounded retryable errors.  Remove raw-shell exposure and make accepted vs completed visually distinct.

### T9 — Diagnostics, responsive polish and packaging

Consolidate technical runtime/controller/compatibility facts and danger-zone controls; complete 1366/1024/768/mobile plus 100%/80% acceptance, authorization/read-only coverage, localization readiness, package-content validation, APK and router UI acceptance.

## 13. Tests required per stage

| Stage | Focused required tests | Boundary gate |
|---|---|---|
| T1 | Router-response fixtures; Run parser/envelope; runtime/NFQUEUE truth; Auto admission; RPC/ACL contract tests | Full source gate, no new red IDs. |
| T2 | Shared-component render/accessibility tests; legacy hash/route compatibility; responsive DOM contracts; RPC transport semantics | Full source gate and package-content check if assets change. |
| T3 | Overview status matrix, primary-action capability matrix, unknown/degraded/error states | Full source gate. |
| T4 | Existing Auto Strategy suite plus phase/admission/progress/accepted/conflict/rollback UI fixtures | Full source gate; target read-only status check when available. |
| T5 | Catalog single-source proof, filters/search/categories/counts/long-name layout tests | Full source gate. |
| T6 | Scope isolation, stale non-apply, trusted payload-only, server-order/no-browser-score, preview/apply/rollback tests | Full source gate and target sanctioned-apply acceptance when authorized. |
| T7 | Drift comparison read-only, import-only-drafts, reapply confirmation/rollback, passthrough relocation tests | Full source gate. |
| T8 | Run history, malformed bounded error + Retry, polling/terminal state, ranking links and rollback presentation | Full source gate. |
| T9 | Diagnostics authorization/confirmation, keyboard and reduced-motion tests, viewport evidence, package validation, APK and router UI acceptance | Full source gate and approved live acceptance. |

All stages retain syntax/render tests and `git diff --check`.  No skip, xfail, known-failure exception or discovery bypass is allowed.  If a future full gate is red, record exact failing IDs and stop production UI work pending policy approval.

## 14. Known risks and compatibility controls

1. **Route drift:** actual menu (8 routes/7 targets) differs from historical UI documentation and has orphaned source views.  T2 inventories and protects every legacy deep link before changing menu behavior.
2. **ACL drift:** `orchestra_run_continue` is declared in the view but absent from the current ACL.  Treat it as unavailable until deliberate contract resolution; never broaden access incidentally.
3. **Truth drift:** `daemonRunning`, legacy Adaptive telemetry and process/NFQUEUE evidence can disagree.  T1 defines a canonical status response before presentation changes.
4. **Ranking safety:** the current browser score conflicts with trusted-backend ranking.  T6 cannot ship until backend ranking scope, ordering and stale/admission semantics are testable.
5. **Live evidence gap:** source gate is green, but destructive Auto Strategy acceptance is incomplete.  Do not claim live rollback/reboot UX acceptance before an authorized target exercise.
6. **LuCI compatibility:** use `rpc.declare`, `E()`, existing theme variables and JSON-string `edit` transport; do not introduce a framework, `L.ubus`, unsafe HTML or a local persistence model.
7. **Localization:** all new copy uses the existing `_()` convention, while raw backend strings remain bounded/escaped and technical only.
8. **Responsive regression:** dense service/rating layouts need fixture and visual evidence at 100%, not only compact 80% screenshots.

## 15. Definition of Done

The remastered program is complete only when all of the following are true:

1. The seven-page internal navigation is reachable, localized, keyboard usable, responsive and backward compatible with protected legacy routes.
2. Overview and Auto Strategy expose only truthful, actionable state; raw hashes, IDs, paths and `[VERIFY:ROUTER]` are hidden in Technical details/Diagnostics.
3. All control availability and admission messages come from backend capability/admission responses; unknown is never painted healthy/failed; accepted is never painted complete.
4. Services use the existing catalog as their sole source and work at the stated viewport/zoom targets without horizontal overflow.
5. Strategy Rating is backend-scoped and backend-ranked, shows confirmation/stale/applied/last-good truth, and applies only the trusted five-field payload through sanctioned preview/apply/rollback.
6. Strategies support readable applied/runtime/draft views, read-only drift differences, import-to-draft and sanctioned reapply; passthrough is guarded in Diagnostics.
7. Runs render valid responses without false `parse failed`, give bounded retryable errors for malformed responses, and show scan/apply/verification/rollback lifecycle honestly.
8. Diagnostics contains technical facts and guarded danger actions without contaminating normal workflow.
9. Focused, syntax, render, package-content (when applicable), full-gate and authorized target acceptance evidence all pass without weakened tests.
10. No prohibited backend rewrite, duplicate state/catalog, ACL wildcard, raw direct write, copied external asset/code, Windows logic or unrelated refactor is introduced.

## T1 — factual contract baseline (2026-08-02)

### Run and results boundary

- The existing Runs & results panel calls `orchestra_run_history` without an argument for its list, `orchestra_run_status` with `edit: '{"runId":"…"}'` for a selected detail (and `{}` for the active run), and `orchestra_preview_best` / `orchestra_apply_best` / `orchestra_apply_status` / `orchestra_restore_previous` for the sanctioned transaction result.
- `orchestra_run_history()` currently returns `{ ok, runs, limit, maxLimit }`; an empty list is success. `orchestra_run_status()` returns `{ ok:true, run }` or a structured `ENOENT` envelope. The run loader turns invalid JSON into `null`, so a corrupt journal is skipped from history but is not reported as a bounded per-entry warning.
- The rpcd CLI/request-file adapter parses CLI output once. If a runner emits no valid JSON it currently returns a string-shaped `parse failed` error plus raw output. The UI then presents `structuredError()` literally. This is the concrete error-shape boundary that permits the user-visible symptom; no browser double-`JSON.parse` of a successful object was found.
- Existing run ranking is stored in `run.rankedResults`, but the view derives stability, latency and score again. T1 must add canonical, additive list/detail/ranking fields and leave the legacy fields intact; T2/T6 consume the new fields.

### Runtime boundary and false-negative evidence

- `status.uc` is the existing broad runtime collector: it scans `/proc`, parses NUL-separated argv with `split(chr(0))`, records PID, binary and start-time proxy, reconciles NFQUEUE 300 registration/owner, compares runtime and APPLIED state, and derives `serviceState`.
- `orchestra_status()` independently used `pidof nfqws2` and mapped its null result directly to `daemonRunning:false`. `auto-strategy.uc` independently used `pgrep` and a raw queue regexp. `watchdog.uc` has its own liveness collector. These are the independent sources to converge on a canonical runtime summary.
- The redacted target capture in `tests/fixtures/ps-full.out` has `/opt/zapret2/nfq2/nfqws2` at PID 19820 and `tests/fixtures/proc-nfnetlink_queue.out` has queue 300 owned by PID 19820, while the older `nfqws2-cmdline.out` capture says `NFQWS2_NOT_RUNNING`. Therefore an optional/failed `pidof` observation is insufficient evidence for `stopped`.

### T1 canonical source decision

`status.uc` remains the sole collector of process, argv, APPLIED/drift, NFQUEUE and watchdog evidence. T1 adds an additive canonical `runtimeSummary` projected from that collected status. Orchestra and Auto Strategy consume that projection; an absent projection is `unknown`/`runtime-not-confirmed`, never `stopped`. Existing status, Auto, run, ACL and legacy boolean fields remain present for compatibility.

## T2 — shared UI foundation and Orchestra shell (2026-08-02)

### Public API and scope

`z2m-ui.js` remains the only shared UI API.  The existing public `Z2M` object
and its v1 methods are unchanged; T2 adds the backwards-compatible `Z2M.ui`
namespace.  It provides `PageShell`, `PageHeader`, `SectionHeader`, status,
summary, notice, empty/error/loading, details, admission, action, confirmation,
progress, filter/search and safe-text/time/error-formatting primitives.  These
are presentation-only helpers: they make no RPC calls and hold no workflow
state.  `z2m-ui.css` remains the only shared stylesheet; all T2 selectors are
under `.z2m-orchestra-shell`.

### Registry and legacy routes

`Z2M.ui.orchestraNavigation` is the sole registry.  Every item has a unique
`key` and canonical `route`, its aliases, `capability: 'read'`, planned stage,
and `available`/`implemented` flags.  `activeNavigation()` is the one alias
resolver used by the shell only to select an active tab and to retain old deep
links; it does not redirect or alter query parameters.

| Key | Canonical route | Legacy alias/content route | Stage | T2 visibility |
|---|---|---|---|---|
| overview | `orchestra-overview` | — | T3 | hidden |
| auto | `orchestra-auto` | `orchestra-adaptive` | T4 | existing legacy panel |
| services | `orchestra-services` | `orchestra-services` | T5 | existing legacy panel |
| rating | `orchestra-rating` | — | T6 | hidden |
| strategies | `orchestra-strategies` | `orchestra-find` | T7 | existing legacy panel |
| runs | `orchestra-runs` | `orchestra-results` | T8 | existing legacy panel |
| diagnostics | `orchestra-diagnostics` | — | T9 | hidden |

The visible transitional items have `implemented: false`: they expose only an
already-existing legacy panel so navigation and old hashes continue to work.
The T3/T6/T9 destinations are unavailable and therefore create neither a tab,
an empty page nor a dead link.  Canonical future routes are registry facts for
gradual migration, not new LuCI menu paths.

### Orchestra integration and responsive contract

Only the existing Orchestra view uses `PageShell` in T2.  It supplies the
header, registry-derived navigation and existing content node; all current
RPC declarations, arguments, mutations, ranking, service selection,
Auto-Strategy state and apply/rollback handlers remain in place.  The existing
default landing and `history.pushState` behavior are retained.

The shell has labelled navigation, native buttons/inputs/progress/details,
`aria-current` for the active tab, polite loading and alert errors.  Unknown
and partial statuses remain explicit rather than being painted healthy.
The scoped layout has 1366+, 1024–1365, 768–1023 and `<768px` breakpoints;
the navigation scrolls horizontally on small screens and controls wrap instead
of overlapping.

### Migration example and next-stage prerequisites

Future views should compose primitives rather than add another shared module:
`Z2M.ui.PageShell({ header: Z2M.ui.PageHeader(...), content: ... })` and
`Z2M.ui.StatusBadge({ status: ... })`.  A T3–T9 page becomes visible only when
its existing backend/capability contract is sufficient and it has focused
render, unknown/error/empty, keyboard and viewport tests.  T2 intentionally
adds no backend field, ACL/menu change, RPC change, package bump or APK.

Remaining risks are the inherited legacy-panel semantics and unverified visual
browser evidence; neither is represented as a successful remastered workflow
until its dedicated stage validates it.

## T3 — remastered Overview (2026-08-02)

### Route, data and access contract

`#orchestra-overview` is now the default Orchestra landing and the only visible
internal remastered destination.  The existing Services, Find, Results and
Adaptive hashes remain valid legacy deep links, but T4–T9 registry entries are
not shown until their own implementation stages.  No LuCI menu path, ACL or
redirect was added; a fragment-only history update preserves existing query
parameters.

Overview reads the existing `status`, `orchestra_auto_status`, `catalog_list`
and `catalog_status` responses already allowed by the current ACL.  It renders
the canonical `runtimeSummary`, APPLIED/runtime presence and drift, Auto
Strategy status/admission/last-good, and catalog-supplied service display
names.  It creates no mutation, state machine, ranking, service-health
classification or second catalog.  Refresh repeats only this bounded read
snapshot and marks previous content as potentially stale while pending.

### Overall-state presentation adapter

The adapter is deliberately presentation-only and has this fixed priority:

1. `recovery-required`, `state-corrupt`, confirmed stopped process, or failed runtime;
2. backend runtime mismatch/degraded verdict, drift, absent NFQUEUE, or owner mismatch;
3. active scan, apply or verification operation;
4. verified running process, owned NFQUEUE and matching APPLIED/runtime;
5. backend-disabled runtime;
6. unknown or unavailable evidence.

It never calls an unavailable runtime `stopped`, never upgrades unknown NFQUEUE
to healthy, and does not treat disabled Auto Strategy or an absent last-good
record as a system failure.  Partial status remains explicitly partial.

### Actions, partial failure and responsive behavior

At most one primary action is displayed.  Its deterministic order is recovery
admission (shown as its backend reason when unavailable), active-operation
navigation, allowed Auto enable, then allowed Auto run.  Every such action only
opens an existing workflow; T3 moves no Enable/Run/Stop/Restore handler.
Refresh is a secondary read-only action.  A read-only session sees all status
and Refresh, no mutation control, and a bounded insufficient-rights message.

A failed `status` response makes the overall state unconfirmed while other
sections continue; its error panel exposes only a stable code and Retry.
Technical details are collapsed and bounded, with reason/admission/error codes
but no secrets, raw RPC payloads, shell output, profile arguments or hashes.
The Overview grid uses two columns at 1366+ and tablet/compact desktop, and
one below 768px; service and technical text wrap safely and navigation remains
scroll-safe.

### Verification boundary and T4 prerequisites

T3 has source/render and contract evidence only.  It does not claim browser,
APK, install or router acceptance.  T4 may expose Auto Strategy as a dedicated
workflow only after preserving this read-only summary, server admission reasons,
existing mutation handlers and legacy deep links.
## T4 — Auto Strategy presentation (completed)

The remastered shell now exposes the internal `orchestra-auto` route while preserving `#orchestra-adaptive` as a legacy alias. Auto Strategy is presentation-only: the existing `orchestra_auto_*` RPCs, backend catalog, admission reasons, and production writer remain unchanged.

- Overview remains the default route and uses a responsive 2×2 desktop grid; mobile content wraps without horizontal page overflow.
- Unix seconds, Unix milliseconds, ISO timestamps, missing/epoch/future values are normalized centrally and rendered with bounded relative labels.
- A run is shown as active only when the backend supplies a run id, positive generation, active phase, valid ownership, and an unexpired/fresh lease or heartbeat. Stale/incomplete state is presented as “Предыдущая проверка не была корректно завершена” and is never promoted to “Выполняется операция”.
- Auto page hierarchy is status → one primary action → service selector → current operation → tested-strategies journal → final result → collapsed read-only diagnostics. Services and categories come only from the backend catalog; candidate ordering/ranking is never recomputed in the browser.
- Candidate rows are scoped by run/generation and expose display names, status, target/attempt counters, and bounded technical details. Winner, no-winner, stopped, timed-out, and infrastructure outcomes have explicit user-facing messages; raw hashes and backend error text stay in technical disclosures or are omitted.

Remaining verification is target-router evidence for the real catalog/active-run payloads and browser visual QA. No router reboot, APK build, or APK installation is part of T4 source work.
