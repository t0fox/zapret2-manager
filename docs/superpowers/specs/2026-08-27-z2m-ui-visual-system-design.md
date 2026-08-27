---
id: z2m-ui-visual-system-design
title: "Z2M UI visual system: Strategies baseline across the product"
type: spec
status: draft
authority: proposed
updated: 2026-08-27
publish: false
tags: [ui, design-system, strategies, accessibility, responsive, luCI]
---

# Z2M UI visual system: Strategies baseline across the product

> **Status:** draft — awaiting user review
> **Authority:** proposed
> **Updated:** 2026-08-27

## Decision summary

Z2M will use the current `Обход DPI → Стратегии` surface as the canonical
visual baseline for the rest of the product. The migration copies its visual
language — graphite surfaces, compact cards, clear state badges, deliberate
action hierarchy, dense but readable metadata, and progressive disclosure —
without forcing every product page into the same card layout.

Each page keeps its existing product responsibility, route, state model, RPC
contract, and domain-specific information architecture. The work is a
presentation-layer consolidation around the existing LuCI/vanilla-JS shell.
It does not introduce React, a runtime shadcn dependency, a second component
catalog, or a backend redesign.

The work is delivered in reviewable phases. Shared primitives and the Home /
Control pilot must be accepted before the remaining product surfaces are
migrated.

## Problem statement

The product already has a strong visual reference in Strategies, but other
surfaces have accumulated page-local cards, forms, statuses, modals, spacing,
and responsive overrides. This creates three user-facing problems:

1. The same runtime state can look different on different tabs.
2. Controls that perform the same kind of action have different geometry,
   focus behavior, loading states, and error presentation.
3. The product feels like several adjacent tools instead of one coherent
   Zapret 2 Manager.

The codebase already has useful shared boundaries:

```text
app.js
  -> z2m-shell.js
  -> z2m-navigation.js
  -> route modules
  -> z2m-ui.css + z2m-components.css + z2m-avatar-ui.css
```

The solution is to strengthen these boundaries, not to replace the LuCI
frontend architecture.

## Goals

- Make Strategies the recognizable visual reference for all primary tabs.
- Provide one coherent graphite theme, spacing scale, control geometry, state
  vocabulary, and interaction model.
- Preserve each page's task-specific layout: workflow for Scanner, forms for
  DNS, lifecycle controls for Proxy, logs for Diagnostics, and health matrix
  for System.
- Make keyboard, focus, modal, form, loading, empty, error, and responsive
  behavior consistent across pages.
- Keep existing route ownership, API ownership, persistence semantics, and
  runtime behavior unchanged.
- Make the migration incremental and reversible, with source tests and real
  browser evidence at every meaningful phase.

## Non-goals

- No React, Next.js, Tailwind, Radix, or shadcn runtime migration.
- No `components.json` initialization or npm dependency installation for the
  LuCI application.
- No backend/RPC redesign, new provider, new state store, or duplicate
  lifecycle owner.
- No route renaming or removal of compatibility aliases.
- No forced conversion of logs, tables, or scanner workflows into generic
  cards.
- No rewrite of the Strategy domain model or CodeMirror editor architecture.
- No unrelated product feature work.
- No removal of legacy CSS or modules until reachability and browser gates
  prove they are unused.

## Design principles

### 1. One visual language, several task layouts

The shared language is the invariant. The layout is chosen by the task:

| Task shape | Preferred composition |
| --- | --- |
| Runtime state and lifecycle | Hero/status card + primary action + details disclosure |
| Configuration | Card sections + explicit fields + grouped actions |
| Search and selection | Toolbar + filters + list/card rows + empty state |
| Long-running operation | Workflow header + progress + current step + recovery action |
| Logs and diagnostics | Dense timeline/console surface + filters + bounded scroll region |
| Component health | Status matrix/card grid + details disclosure + safe action |

The Strategies visual treatment is a grammar, not a template to duplicate.

### 2. Preserve canonical ownership

The visual layer may project state, but it must not become a second owner.

- Overview projects runtime state and links to the owning page.
- Control owns service lifecycle actions.
- Strategies owns strategy catalog, editor, preview, validation, and apply.
- Scanner owns scan workflow, history, and scanner-to-Strategy handoff.
- DNS owns DNS configuration and DNS service presentation.
- Telegram Proxy owns provider lifecycle, install/update, settings, and
  journal.
- Resources owns Asset Registry resources and resource workspaces.
- Diagnostics owns logs and monitoring views.
- System owns Components, Backups, and Settings presentation while delegating
  lifecycle operations to existing owners.

No shared component may directly call product RPCs. Route modules provide the
callbacks and state projections.

### 3. Prefer semantic primitives

The existing LuCI `E()` builder and shell helpers remain the implementation
technology. The shadcn skill supplies the composition model:

```text
PageShell
  PageHeader
  Toolbar
  Card
    CardHeader
    CardDescription
    CardContent
    CardFooter
  FieldGroup / Field
  Tabs / ToggleGroup
  Badge / Status
  Alert / Empty / Skeleton
  Dialog / Sheet
```

These are contracts and helper patterns, not a new React component tree. A
new shared helper is allowed only when it serves two or more existing
surfaces and lives behind the existing shell boundary.

### 4. States are part of the design

Every primary surface must explicitly support:

```text
loading -> ready
loading -> unavailable
ready -> dirty
ready -> pending
pending -> success
pending -> error
ready -> empty
```

The user-facing state includes a next action. Raw RPC details, paths, hashes,
and stack traces remain behind a technical disclosure or Advanced mode.

## Canonical visual language

### Theme and tokens

The current graphite tokens in `z2m-ui.css` remain the source of truth. Page
styles must consume semantic tokens instead of adding page-local raw colors.

| Token family | Meaning |
| --- | --- |
| `--bg` | App background |
| `--panel` | Primary card/panel surface |
| `--panel2` | Secondary surface, header, table head |
| `--raised` | Hovered/raised surface |
| `--border`, `--border2` | Default and emphasized borders |
| `--bg-input` | Input/editor background |
| `--tx`, `--tx2`, `--tx3` | Primary, secondary, and muted text |
| `--blue`, `--blue2` | Primary accent and active state |
| `--green`, `--orange`, `--red`, `--purple` | Semantic status accents |
| `--radius-panel`, `--radius-control` | Shared geometry tokens to be introduced if absent |
| `--space-*` | Shared 4/8/12/16/20/24 spacing scale to be introduced if absent |

The implementation must first inventory existing values and aliases. It must
not blindly replace colors that encode a product status or a deliberately
high-contrast warning.

### Geometry and density

- Panels use one primary radius and one control radius.
- Buttons and inputs share height tiers: compact, standard, and touch-safe.
- Layout uses `gap` and grid/flex primitives, not margin chains for sibling
  spacing.
- Flex/grid children that contain user or technical text use `min-width: 0`.
- Long identifiers, domains, hashes, and command lines use truncation,
  wrapping, or bounded disclosure deliberately.
- Dense surfaces may remain dense, but the primary label, state, and next
  action must be visible without opening Advanced details.

### Typography and copy

- Page header: one `h1`, one concise description, one primary action group.
- Card header: title, optional description, optional status/action cluster.
- Loading copy ends with `…`; use `…`, not `...`.
- Technical identifiers and code retain monospace treatment and are never
  allowed to widen the page unexpectedly.
- Counts and measurements use tabular numerals where comparison matters.
- Errors explain the problem and the next safe action.
- Status labels use a small canonical vocabulary:
  `Готово`, `Работает`, `Проверяется`, `Остановлено`, `Требует внимания`,
  `Недоступно`, `Не установлено`, `Состояние неизвестно`.

### Action hierarchy

Every surface has at most one primary action for the current context.

```text
Primary   = execute the safe next step
Secondary = inspect, refresh, configure, or navigate
Tertiary  = copy, disclose, filter, or open technical details
Danger    = destructive action, always confirmed or undoable
```

Pending actions keep their position, disable duplicate invocation, and show a
spinner plus a specific label. The UI never replaces an action with an
unexplained blank state.

## Shared component contracts

### Page shell and header

`app.js` and `z2m-shell.js` remain responsible for the top shell and route
navigation. Every route module supplies only page content and callbacks.

Required structure:

```text
skip link
header / product identity / global runtime status
primary navigation
secondary navigation where applicable
main#z2m-content
```

The page header is consistent in spacing, title hierarchy, action placement,
and narrow-screen wrapping.

### Cards and status surfaces

Cards use a stable header/content/footer rhythm. Status is expressed by text
and a semantic class/badge; color is never the only signal. A compact card
contains the minimum useful state and one next action. Technical evidence is
progressively disclosed.

### Forms and option sets

- Every input has a visible label or a correct accessible name.
- Related controls are grouped as a fieldset/legend-equivalent, not only a
  visual `div` heading.
- Inputs receive stable `id` and meaningful `name`; non-auth fields use
  `autocomplete="off"` where appropriate.
- Validation is inline and adjacent to the field; invalid controls expose
  `aria-invalid`.
- Two-to-seven mutually exclusive options use a segmented/toggle-group
  contract with a group label and keyboard behavior.
- Labels remain clickable and hit targets remain touch-safe.

### Navigation and tabs

Use navigation semantics for route changes and tab semantics only for an
actual in-page tabset. If `role="tablist"` is retained, implement roving
tabindex and Arrow/Home/End behavior consistently. URL/hash state remains the
single navigation authority.

### Dialogs, sheets, and confirmations

All overlays use one shared contract:

- `role="dialog"` and `aria-modal="true"`;
- a stable title id referenced by `aria-labelledby`;
- optional description id referenced by `aria-describedby`;
- focus moves into the overlay and returns to the trigger on close;
- Escape closes when safe; destructive confirmation requires an explicit
  action;
- focus cannot escape behind the overlay;
- modal scroll is bounded with `overscroll-behavior: contain`;
- mobile layout remains usable at 390px width.

Strategy's page-local modal markup should converge on the existing shell
contract rather than creating another modal implementation.

### Loading, empty, error, and async feedback

- Loading uses a stable skeleton or state panel and does not shift the page
  unnecessarily.
- Empty states explain what is empty and offer the next useful action.
- Errors preserve the last known safe state where possible.
- Toasts and validation updates use a live region; dismiss is an explicit
  keyboard-accessible button.
- Long-running progress exposes current phase, counts, and a cancellation or
  recovery action when the existing product contract supports it.

### Icons and media

- Decorative icons use `aria-hidden="true"`.
- Icon-only actions have a localized `aria-label` and visible focus.
- Meaningful images have `alt`; decorative images use `alt=""`.
- Images reserve their dimensions to prevent layout shift.
- Existing icon registry remains canonical; do not add a second icon library.

## Route-by-route target design

### Home

Home is the orientation surface, not a second control center.

- Use Strategy-like status cards for the active runtime, learned/autocircular
  state, Telegram Proxy, and key service health.
- Keep one concise human status and one primary navigation/action per card.
- Keep detailed mutations on their owning pages.
- Preserve bounded dashboard log/event presentation.
- Loading of secondary cards must not block the first meaningful dashboard
  render.

### Control

- Start with a clear lifecycle hero: current state, explanation, primary
  action, and safe secondary actions.
- Put metrics and recent events in compact cards below the hero.
- Keep destructive stop/remove actions visually and semantically separate.
- Preserve service lifecycle RPC ownership and current confirmation behavior.

### Strategies

This remains the reference surface, not a target for a wholesale rewrite in
this initiative.

- Preserve catalog, active strategy, healthcheck, learned/autocircular,
  editor, preview, validation, and scanner handoff ownership.
- Apply only baseline fixes required by the shared contracts: focus, modal
  semantics, keyboard interaction, token reuse, and responsive behavior.
- Preserve the one canonical strategy/editor data model and existing
  CodeMirror lifecycle.

### Scanner

- Retain the task workflow: target → protocol/depth → scan → progress →
  evidence → handoff/history.
- Use Strategy-style page header, cards, badges, buttons, and empty/error
  states.
- Represent protocol/depth as one labeled option group, not unrelated buttons.
- Keep progress readable on narrow screens and preserve cancellation/retry
  behavior.
- Keep scanner-to-Strategy handoff canonical; do not add a second strategy
  editor.

### Unified routing and WARP

- Use the same page header, state card, field grouping, and action hierarchy.
- Keep routing-specific tables/disclosures where they carry important
  technical detail.
- Disabled or unavailable capabilities must explain why and what can be done
  next.
- Preserve existing route aliases and owner boundaries.

### Telegram Proxy

- Reuse the Strategies/autocircular visual tone for overview and status cards.
- Keep the information architecture as `Обзор | Компонент | Настройки |
  Журнал`.
- Overview shows one human status, provider/version metadata, health chain,
  and the next action.
- Component owns install/update/provider lifecycle; Settings owns config and
  secrets; Journal owns activity/logs.
- Preserve Go/Rust provider state distinctions and existing lifecycle/RPC
  contracts.

### DNS and service-domain routing

- Use section cards for global DNS, per-domain rules, providers, and advanced
  options.
- Use the same status vocabulary for active, pending, failed, unavailable,
  and inherited/system states.
- Keep provider tables dense but responsive with explicit column priorities.
- Use native accessible switches/toggle groups and clear apply/cancel action
  bars.
- Preserve DNS ownership and the current single-writer/runtime contracts.

### Services and Resources

- Services use catalog toolbar + grouped rows/cards + category/status badges.
- Resources use catalog toolbar + resource rows + metadata disclosure + stable
  workspace shell.
- Resource editing keeps one canonical editor lifecycle and Asset Registry
  ownership.
- Read-only package resources must look intentionally read-only and explain
  `Duplicate as user copy` as the safe mutation path.

### Diagnostics, Logs, and Monitor

- Keep console/log density and technical content; do not turn a log viewer
  into a marketing card grid.
- Use a consistent diagnostic header, severity/status tokens, filters, empty
  state, and bounded scroll region.
- Keep technical details copyable and wrapped without horizontal page overflow.
- Async collector status uses live regions and clear retry/reconnect states.

### System: Components, Backups, Settings

- Components uses Strategy-like health cards for the mandatory Engine and Z2K
  Core, with details and safe actions.
- Backups uses a clear `create → preview → confirm → restore → verify`
  workflow with the same state and modal primitives.
- Settings stays compact and separates user preference from technical
  diagnostics.
- Preserve the existing Components ownership model and separate Backups /
  Settings routes.

## Responsive contract

Acceptance viewports:

| Viewport | Required behavior |
| --- | --- |
| 390px | No page-level horizontal overflow; actions stack; dialogs fit; touch targets remain usable |
| 600–768px | Two-column layouts collapse intentionally; dense tables scroll inside their container |
| 1024px | Tablet/compact desktop composition remains readable; navigation can scroll horizontally |
| 1366px | Standard desktop composition; no excessive empty space or stretched controls |
| 1920px | Content width remains bounded; cards do not become unreasonably wide |

Required rules:

- `min-width: 0` on flex/grid text children.
- `overflow-x: auto` belongs to bounded tables/technical views, not the body.
- Long labels and identifiers wrap or truncate with a visible disclosure path.
- Action groups wrap without hiding the primary action.
- Sticky headers, apply bars, and overlays never cover focused content.
- Touch hover effects are gated for fine pointers.
- Dark theme exposes `color-scheme: dark` at the document/app boundary and
  native selects have explicit colors.

## Motion contract

The product is a professional dashboard. Motion communicates state; it is not
decoration on every repaint.

- No animation for repeated keyboard navigation or frequent list changes.
- Button press feedback: subtle `scale(0.95–0.98)` or color feedback,
  100–160ms.
- Small popovers/tooltips: 125–200ms, origin-aware where anchored.
- Dialogs/drawers: 200–300ms where motion helps spatial continuity; centered
  modal origin is correct.
- Use `ease-out` for enter, `ease-in-out` for movement, and `ease`/custom
  curve for color or hover transitions. Never use `ease-in` for UI response.
- Animate `transform` and `opacity` where possible; never `transition: all`.
- Dynamic toasts and toggles must use interruptible transitions rather than
  restart-heavy keyframes.
- Honor `prefers-reduced-motion`: remove movement while retaining useful
  opacity/color state feedback.

## Implementation architecture

### Canonical files

| Responsibility | Canonical location |
| --- | --- |
| App root, main content, route activation | `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js` |
| Shared DOM primitives and modal/navigation shell | `.../z2m-shell.js` |
| Route/group navigation model | `.../z2m-navigation.js` |
| Global theme and shared layout | `.../z2m-ui.css` |
| Domain component styles | `.../z2m-components.css` |
| Avatar-derived state/toast/confirm helpers | `.../z2m-avatar-ui.js` and `.../z2m-avatar-ui.css` |
| Product-specific composition | each existing route module |

`z2m-ui.js` must not become a second production component catalog. The
existing orphan/legacy library and the currently unreferenced
`z2m-holyversion.css` are reviewed in the foundation phase; removal or wiring
requires reachability evidence.

### State and data flow

```text
route module state
  -> presentation adapter
  -> shared shell primitive
  -> DOM
  -> existing route callback
  -> existing API/RPC owner
```

Shared primitives receive already-normalized values and callbacks. They do not
know product RPC method names, backend error codes, or persistence details.

## Phased implementation plan

### Phase 0 — Foundation and contracts

**Purpose:** make the common layer safe before changing page composition.

**Files in scope:**

- `app.js`
- `z2m-shell.js`
- `z2m-ui.css`
- `z2m-components.css`
- `z2m-avatar-ui.js`
- `z2m-avatar-ui.css`
- focused UI contract tests

**Work:**

- Add skip-link and stable main-content semantics.
- Unify `:focus-visible` behavior and remove focus-removing overrides.
- Replace page-local custom switches with native button-backed switch
  primitives or complete keyboard behavior.
- Normalize modal title/focus/restore/scroll contracts.
- Decide whether to load `z2m-holyversion.css` or merge its still-needed
  guardrails into the canonical stylesheet.
- Introduce/normalize semantic spacing, radius, status, and action tokens.
- Replace `transition: all` in shared/domain styles with explicit properties.
- Add shared live-region and dismissible-toast behavior.

**Gate:** no route-specific redesign starts until keyboard, modal, CSS load,
and syntax/contract tests pass.

### Phase 1 — Home and Control pilot

**Files in scope:**

- `z2m-overview.js`
- `z2m-control.js` and its existing model/style dependencies
- scoped CSS and UI tests only

**Work:**

- Recompose Home status cards using the Strategies card grammar.
- Recompose Control around one lifecycle hero and compact supporting cards.
- Keep all mutations and status reads on current owners.
- Verify loading, stopped, running, unavailable, error, and pending states.

**Gate:** user-facing visual review at all acceptance viewports plus focused
Home/Control tests.

### Phase 2 — Scanner and Telegram Proxy

**Files in scope:**

- `z2m-scanner-hub.js`
- `z2m-scanner.js`
- `z2m-scanner-product.js`
- `z2m-proxy-page-core.js`
- related scoped CSS and tests

**Work:**

- Apply common header/card/status/action grammar while retaining workflows.
- Bring Scanner option groups and progress states into the shared contract.
- Keep Telegram Proxy IA and lifecycle ownership unchanged.
- Keep Telegram dashboard projection read-only and concise.

**Gate:** Scanner handoff and Telegram lifecycle regression tests, then real
browser navigation through search/progress/history and overview/component/
settings/journal.

### Phase 3 — DNS, Services, and Resources

**Files in scope:**

- `z2m-dns.js`
- `z2m-services.js`
- `z2m-assets.js`
- `z2m-domain-hub-page.js`
- related scoped CSS and tests

**Work:**

- Normalize field groups, option sets, provider/service cards, and apply bars.
- Keep dense tables and workspaces where they are the correct information
  architecture.
- Preserve the Resource Registry and DNS single-writer boundaries.

**Gate:** no form label/focus/unsaved-state regressions; mobile test of long
  domains, hashes, provider rows, and editor workspace.

### Phase 4 — Diagnostics and System

**Files in scope:**

- `z2m-avatar-log.js`
- `z2m-monitor.js`
- `z2m-maintenance.js`
- `z2m-maintenance-components.js`
- `z2m-engine-panel.js`
- backup/settings modules and related scoped CSS/tests

**Work:**

- Apply common status/header/disclosure language to technical surfaces.
- Preserve console density, backup workflow, EnginePanel capability, and
  Components ownership.
- Make safe actions and blockers legible without exposing internal details by
  default.

**Gate:** System/Diagnostics focused tests plus browser acceptance for
  Components, Engine details, Backups, Settings, Logs, and Monitor.

### Phase 5 — Cleanup and release evidence

**Work:**

- Remove or archive proven orphan styles/modules only after reachability
  checks.
- Consolidate duplicate selector overrides and document the canonical tokens.
- Run source syntax, focused UI suite, `git diff --check`, and package/module
  closure checks.
- Capture browser evidence at 390/768/1024/1366/1920 where applicable.
- Separate host-test results, browser results, router deployment, and reboot
  acceptance in the handoff.

## Verification plan

### Static and contract checks

- `node --check` for every changed JavaScript module.
- Existing UI tests for navigation, route closure, CSS reachability, state
  semantics, lifecycle, editor contracts, and responsive contracts.
- New tests for:
  - skip link and main target;
  - focus-visible coverage for shared controls;
  - native/keyboard switch behavior;
  - modal title, Escape, focus restore, and bounded scroll;
  - required labels/names for new or changed fields;
  - no `transition: all` in changed UI CSS;
  - consistent loading/error/empty/pending states;
  - no accidental RPC or route ownership changes.

### Browser acceptance

The browser gate must exercise the built/served LuCI UI, not only source
contracts:

1. Navigate every visible group and canonical route.
2. Verify primary navigation, back/forward/hash deep links, and compatibility
   aliases.
3. Run keyboard-only flows for navigation, forms, switches, segmented groups,
   dialogs, confirmation, and close/restore focus.
4. Check loading, unavailable, empty, error, pending, and success states.
5. Check long labels, domains, hashes, command lines, tables, and logs.
6. Check reduced-motion mode and touch-sized controls.
7. Record fresh console errors separately from historical console buffer.

### Acceptance criteria

- All primary tabs visibly belong to the same graphite/Strategies design
  family while retaining task-appropriate layouts.
- No changed route introduces a second state store, provider, writer, or
  lifecycle owner.
- All changed interactive controls are keyboard operable and visibly focused.
- All changed dialogs have accessible titles, bounded scroll, Escape behavior,
  and focus restoration.
- All changed fields have an accessible label and meaningful browser metadata.
- No page-level horizontal overflow exists at 390px.
- Primary actions, pending states, errors, and next steps are readable without
  inspecting technical details.
- Animations respect reduced motion, use explicit properties, and remain
  within the motion contract.
- Focused host tests and browser acceptance are reported separately; no
  GREEN/PASS claim is made for an unverified gate.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A global CSS change breaks a legacy page | Scope selectors, run route tests, and verify each viewport before widening |
| A visual refactor moves product ownership | Keep API callbacks in route modules; review diffs for RPC/route changes |
| Cardification reduces technical density | Use task-specific layouts; keep logs/tables/workspaces dense where useful |
| Duplicate primitives continue to drift | Extend `z2m-shell` only; do not add another global component catalog |
| Mobile fixes are hidden by a dead stylesheet | Resolve CSS reachability in Phase 0 and add a reachability contract |
| Accessibility fixes change click behavior | Add keyboard/DOM tests before visual polish and preserve hit targets |
| Big-bang migration becomes hard to review | Use the five phases and stop at each browser gate |

## Approval and next step

This document is the proposed design spec, not an implementation plan for a
single coding turn. After the user reviews and approves it, the next artifact
will be a task-level implementation plan with exact file changes, test-first
steps, and phase-specific verification commands. No production UI changes
should begin before that approval.

## References

- `docs/12-ai/ai-entry-point.md`
- `docs/00-home/current-state.md`
- `docs/superpowers/plans/2026-08-21-telegram-proxy-ui.md`
- `docs/99-archive/superpowers/specs/2026-08-21-system-components-ia-design.md`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js`
- Vercel Web Interface Guidelines: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
- shadcn composition principles: use semantic primitives and existing project conventions; no runtime migration.
- Emil design-engineering principles: deliberate motion, explicit transitions, responsive feedback, and accessibility-aware interaction.
