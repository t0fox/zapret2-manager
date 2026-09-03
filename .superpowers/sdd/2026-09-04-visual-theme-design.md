---
title: Visual theme design audit
status: DESIGN_APPROVED_FOR_IMPLEMENTATION
date: 2026-09-04
---

# Scope

This is an app-UI theme pass for the existing zapret2.manager LuCI surface.
The reference image is used only for surface treatment, spacing, borders, and
radius hierarchy. DOM structure, route ownership, page composition, controls,
states, data, and actions remain out of scope.

## Baseline findings

- The app already owns a dark graphite palette and a blue accent, but the
  header uses a visible gradient and has no framed relationship with the
  navigation shell.
- Surface radii are scattered across `z2m-ui.css` (`4px`, `6px`, `7px`, and
  `8px`) with no central radius vocabulary.
- The shared button and input controls are visually sharper than the reference
  and do not share the requested 7–9px control radius.
- The root app does not clip accidental page-level horizontal overflow, while
  intentional scroll tracks such as navigation must remain independently
  scrollable.

## Four design skill audits

### Emil design engineering

Use a small, deliberate radius scale instead of making every component bubbly:
14px for the shell, 11px for primary surfaces, 8px for controls, 6px for
nested rows, and a true pill only for status metadata. Remove ornamental header
gradient treatment. Keep transitions limited to state feedback and preserve
the existing reduced-motion rules; do not introduce motion or restructure
frequent interactions.

### Design consultation

Treat the existing Z2M CSS variables as the source of truth. Add only a
central theme vocabulary and apply it through already-owned shared classes.
Connect the existing header and primary/secondary navigation visually by
removing the spacer between their existing DOM siblings and framing the
navigation shell; do not add or move nodes. Keep the current graphite surfaces,
blue accent, and status colors. Purple remains logo-only.

### Design review

The highest-impact fix is the upper shell: a quiet navy surface with a thin
border and controlled 14px outer corners. The next fix is consistency across
existing panels/cards and controls. Nested tables and rows should remain
visibly subordinate with a smaller radius. Avoid selector-wide changes that
would turn tabs, switches, editors, or data rows into cards.

| Before | After | Why |
| --- | --- | --- |
| `background: linear-gradient(...)` on `.z2m-apptop` | `background: var(--z2m-header)` | The reference calls for a calm dark-blue header, not decorative gradient chrome. |
| Separate sharp header and navigation | Existing siblings share one bordered shell with 14px outer corners | Strengthens orientation without changing DOM or information architecture. |
| Mixed hard-coded `4px`–`8px` surface radii | `--z2m-radius-shell`, `--z2m-radius-surface`, `--z2m-radius-control`, `--z2m-radius-row` | One visual hierarchy can be tuned centrally and audited reliably. |
| `.z2m-btn { border-radius: 6px }` | `.z2m-btn`/existing `.btn` controls use the 8px token | Matches the requested control treatment while preserving sizing and behavior. |

### Web Interface Guidelines

Keep visible labels and existing semantics intact. Preserve focus-visible
outlines and keyboard operation. Apply `overflow-x: clip` only to the app
surface so page-level spill is contained; leave existing navigation and code
viewer scroll containers explicit. Do not shrink text or touch target sizes.
Avoid new shadows, gradients, animation, or decorative icon containers.

## Consolidated implementation decision

`z2m-ui.css` is the only visual source to change, with a cache-busting
stylesheet revision in the existing shell loader. The implementation is CSS
first, uses the existing DOM and palette, and has no route/backend/API impact.
The result is approved for implementation, followed by responsive browser
checks and router/HTTP byte verification.
