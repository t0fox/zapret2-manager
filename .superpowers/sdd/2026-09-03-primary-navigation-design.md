# Primary navigation — consolidated design

Date: 2026-09-03
Scope: primary horizontal navigation only
Status: DESIGN_APPROVED_FOR_IMPLEMENTATION

## Read-only findings

- `z2m-shell.js` is the canonical renderer for the six top-level tabs and already owns tab roles, `aria-selected`, focus management, and ArrowLeft/ArrowRight/Home/End behavior.
- `z2m-navigation.js` is the canonical IA/route model. The existing six group ids, labels, order, and route targets remain unchanged.
- `z2m-icons.js` is the existing shared SVG registry. It already provides one 24×24 outline set with a common stroke contract and suitable semantic glyphs: `dashboard`, `shield-check`, `route`, `activity`, and `settings`; `database` is added to this same registry for the data group.
- `z2m-ui.css` currently gives the primary row a LuCI-like left start and its narrow breakpoint wraps the row. The latter must become a single-line horizontal scroll track.

## Design skill 1 — Emil design engineering

- Layout/alignment/spacing: make the six tabs read as one compact focal cluster; center the cluster only while it fits, keep 12px inline breathing room, and use a stable 40px minimum click height.
- Iconography: icons are quiet scanning anchors, not toolbar controls; use 16px outline glyphs with a shared optical box and no decorative flourish.
- Active/inactive hierarchy: preserve the blue accent and thin underline as the single strong active cue; do not introduce pills, fills, or weight changes that cause layout shift.
- Responsive/accessibility: preserve the existing roving-tab keyboard model; make the active item visible after route changes without scrolling the page; keep motion limited to a short underline/color transition and honor reduced motion.

## Design skill 2 — design consultation

- Layout/alignment/spacing: reuse the current Z2M typography, border, and color tokens; add only the spacing needed for icon-text rhythm (`7px` gap, compact 12px horizontal padding).
- Iconography: extend the canonical `z2m-icons.js` registry instead of introducing a second framework or asset family; map home, DPI protection, routing, data, diagnostics, and system to semantically legible glyphs.
- Active/inactive hierarchy: inactive labels/icons stay cool-muted, active labels/icons use the existing blue token, and hover raises contrast without a full-button background.
- Responsive/accessibility: keep text labels in the DOM, use semantic tab buttons, mark SVGs decorative, and use start-aligned overflow on small viewports so both edge tabs remain reachable.

## Design skill 3 — design review

- Layout/alignment/spacing: the visual defect is the parent track alignment, not the page content; fix the primary track only and leave the secondary row and content grid untouched.
- Iconography: one monochrome 24×24 viewBox, 16px rendered size, shared stroke width/caps/joins; avoid brand marks and aggressive hacker imagery.
- Active/inactive hierarchy: the underline spans the whole clickable tab, remains thin, and transitions only border/color; no pill radius or active fill.
- Responsive/accessibility: desktop uses centered flex alignment; at the scroll breakpoint the track switches to `justify-content:flex-start`, `white-space:nowrap`, and `overflow-x:auto`; focus-visible remains obvious.

## Design skill 4 — Web Interface Guidelines

- Layout/alignment/spacing: use flex layout with fixed-size tab items, `min-width:0` on the shell, and no wrapping; avoid JS layout measurement during render.
- Iconography: decorative SVGs use `aria-hidden="true"`; labels remain visible and are the accessible names.
- Active/inactive hierarchy: interactive states increase contrast; focus uses `:focus-visible`; transitions list explicit properties and include a reduced-motion override.
- Responsive/accessibility: keep `<button role="tab">`, `aria-selected`, roving `tabindex`, keyboard handlers, touch scrolling, and `touch-action: manipulation`; auto-reveal the active tab with a bounded scroll calculation after rendering.

## Conflicts and resolutions

- Centered desktop cluster vs. usable mobile scroll: center only in the fit/desktop mode and switch to start alignment at the responsive scroll breakpoint, preserving edge reachability.
- More visual anchors vs. lightweight navigation: add exactly one 16px outline icon per top-level item, with no badges, fills, or extra controls.
- Existing icon infrastructure vs. semantic coverage: reuse the existing registry and add only the missing `database` glyph; no second icon helper or library.
- Active emphasis vs. layout stability: keep font metrics unchanged and use a full-item 2px underline with explicit color/border transitions.

## Final consolidated decision

- Alignment: `z2m-primary-nav` is a single-line flex scroll track with 12px inline padding; it centers a compact cluster on desktop and becomes start-aligned horizontal overflow at widths below 900px.
- Icon set: existing `z2m-icons.js` outline registry; `dashboard`, `shield-check`, `route`, `database`, `activity`, `settings` in that order.
- Icon size/spacing: 16px rendered SVGs, shared 24×24 viewBox and stroke contract, 7px icon-to-label gap, baseline-aligned inline-flex content.
- Active state: blue icon/text plus a thin 2px blue underline across the full clickable tab; inactive cool gray; hover/focus increase contrast without pills.
- Responsive behavior: no wrapping at any tested width; touch/keyboard horizontal scrolling remains available; route updates reveal the active tab when necessary; secondary navigation is unchanged.

