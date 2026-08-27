---
id: system-components-details-redesign-design
title: "System Components: unified details presentation"
type: spec
status: approved
authority: approved-spec
updated: 2026-08-28
publish: false
tags: [ui, components, responsive, luCI, presentation]
---

# System Components: unified details presentation

## Decision

Redesign the `System → Components` presentation layer around one compact
summary row and one active full-width details panel. The mandatory Engine and
Z2K cards remain the navigation surface; expanded details are siblings below
the two-card grid and never a card inside a card.

The existing `EnginePanel` remains the owner of the standalone Engine route
and its lifecycle API. Components must not mount it as a second presentation
inside `renderEngineCard()`. Backend RPCs, update state, truth normalization,
confirmation flows, and owner boundaries remain unchanged.

## Information architecture

Engine details contain one header with status, description, and source; a
primary fact grid; an explicit Updates section; separate Service Management;
collapsed Technical Details; and a collapsed Danger Zone containing the red
delete action. The update action is primary only when the canonical model says
an update is available; otherwise the section exposes re-check.

Z2K details contain status, Lua/integrity/compatibility/release facts, an
Updates section with installed/available/local revision/state, and a standalone
review callout. A blocking review state exposes explanation/check controls but
never invents an update action. Unknown installed release is shown as
`Не определён` when assets are healthy; actual absence remains `Не установлен`.

Collapsed cards show only a compact summary and actions. The details panel is
exclusive: opening one mandatory component closes the other, keeping the page
readable at desktop and narrow widths.

## Visual and responsive constraints

- Reuse the existing graphite visual language of DPI/Strategies: restrained
  borders, clear status chips, compact controls, and deliberate whitespace.
- Use scoped helpers for facts, information rows, update sections, and review
  callouts; do not turn generic proxy key/value rows into the primary layout.
- Desktop uses two summary columns and four fact columns; medium uses two fact
  columns; narrow uses one column. Details span the available Components width.
- User-facing values wrap at word boundaries. Only technical identifiers may
  use controlled breaking. No horizontal overflow, clipped controls, or
  character-level wrapping.
- Native buttons/details remain keyboard-operable, with visible focus and
  reduced-motion-safe transitions.

## Acceptance

Behavioral tests prove that Engine expanded rendering has no embedded
`EnginePanel`, has one management presentation, exposes the correct update or
check action, and places delete only in the dedicated Danger Zone. Z2K tests
prove the standalone review callout, available release, applicable update,
blocking-review behavior, and semantic unknown/missing release wording.

Real LuCI browser evidence at 1920×1080, 1440×900, 1024×768, and approximately
768 CSS pixels proves hierarchy, no duplicate facts, readable wrapping, no
horizontal overflow, responsive action layout, and no new console errors.
Repository, router-installed, HTTP, and browser-fetched asset hashes are
compared after cache-disabled hard reload before any design-ready verdict.
