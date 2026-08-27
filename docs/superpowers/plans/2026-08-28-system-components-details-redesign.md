# System Components Details Redesign Implementation Plan

> This plan is approved by the user-provided brief and is executed without an
> additional approval checkpoint.

Goal: Replace the duplicated nested Components details UI with a clear,
responsive presentation that keeps Engine and Z2K ownership and behavior
unchanged.

Architecture: `z2m-maintenance.js` remains the Components route owner and
continues to consume `ComponentsModel` and existing RPCs. It will render two
compact summary cards plus one active full-width details projection. The
standalone Engine route continues to use `EnginePanel`. Scoped Components CSS
provides the fact grid, section hierarchy, responsive breakpoints, wrapping,
and accessible disclosure states.

Spec: docs/superpowers/specs/2026-08-28-system-components-details-redesign-design.md

## Global constraints

- Preserve backend RPC contracts, update truth, confirmations, operation
  lifecycle, and component owner boundaries.
- Do not delete or replace the standalone `EnginePanel` API.
- Do not add a React/shadcn runtime to this manual LuCI frontend; use the
  shadcn composition principles in existing native LuCI vnode helpers.
- Preserve unrelated checkout changes, including the main checkout's unknown
  untracked entry; work only in this feature worktree.
- Run the repository knowledge validator after every created or modified
  documentation file and before completion.
- Test behavior through rendered vnode structure, not only source regexes.

## Task 1: Establish the failing behavioral gate

Files:

- Create `tests/ui/system-components-details-presentation.test.mjs`.
- Modify `tests/ui/system-components-remaster.test.mjs` to remove assertions
  that encode the obsolete nested disclosure layout.

Work:

- Reuse the existing VM harness shape used by the lifecycle tests.
- Assert Engine expansion renders no `z2m-component-engine-panel`, has one
  `z2m-component-details` presentation, explicit Updates and Service
  Management sections, and a delete control only under Danger Zone.
- Assert Engine current/update states expose check/update actions respectively.
- Assert Z2K review-required renders a standalone review callout and no update
  control; update-available renders available release and update control.
- Assert unknown release with healthy Lua assets is `Не определён`, while
  `local.installed === false` is `Не установлен`.
- Assert only one details panel exists after opening Engine or Z2K.

Verification: run the new focused test before production edits and record the
expected failures as the RED stage.

## Task 2: Refactor Components presentation ownership

File: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`.

Work:

- Make `toggleEngine()` and `toggleZ2K()` exclusive while preserving local
  state and rerender behavior.
- Add scoped semantic helpers for fact grids, info rows, update sections, and
  review callouts.
- Keep collapsed Engine/Z2K cards compact; remove their embedded expanded
  markup and remove the `EnginePanel.render()` call from Components rendering.
- Build `renderEngineDetails()` with header/facts/updates/service management,
  collapsed technical details, and collapsed danger zone. Route all existing
  restart/reinstall/delete/check/update actions through their current APIs and
  confirmation behavior; do not add fake repair/update actions.
- Build `renderZ2KDetails()` with facts, versions/updates, standalone review
  callout, and collapsed provenance/trust/hash/path/reason technical details.
- Render the active details sibling below the mandatory two-card grid and keep
  inline operation status visible in the relevant details area.
- Keep `renderEngine()` and module load/mount/unmount delegation unchanged for
  standalone Engine consumers.

Verification: run focused tests after each logical renderer change and inspect
the vnode tree for duplicate headings and nested panel boundaries.

## Task 3: Apply scoped responsive visual system

File: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`.

Work:

- Add Components-only classes for details shell, header, fact grid, update
  state, service management, review callout, technical disclosure, and danger
  zone.
- Use four/ two/ one-column fact-grid breakpoints and full-width details flow.
- Replace ordinary `overflow-wrap:anywhere` in the Components presentation
  with normal/break-word behavior; use controlled technical identifier rules.
- Ensure action rows wrap without clipping and focus-visible styling remains
  unobscured. Add reduced-motion behavior for the scoped transition/animation.
- Retain optional component cards and unrelated route styles.

Verification: run CSS/static contracts and inspect computed dimensions in the
real browser at desktop, medium, and narrow viewports.

## Task 4: Update focused contracts and run broader gates

Files: focused `tests/ui/system-components*.test.mjs` files only as needed.

Work:

- Update stale remaster assertions to the new IA without weakening ownership,
  model, lifecycle, or action contracts.
- Run all Components/model/lifecycle tests, then the broader UI test suite.
- Run `node scripts/validate-knowledge.mjs`, `git diff --check`, and a legacy
  path/cross-reference check. Record unrelated baseline failures separately.

## Task 5: Deploy and perform real browser acceptance

Work:

- Capture the final changed-file manifest and local SHA-256 values.
- Deploy only the changed frontend assets to the configured router using the
  existing bounded deployment script and verify installed hashes.
- Disable browser cache, hard reload, verify the loaded CSS/JS URLs and fetched
  response hashes, then inspect Components in the real LuCI browser.
- Save final screenshots for Engine expanded and Z2K expanded at 1920 and
  approximately 1024 CSS pixels, plus collapsed desktop; also inspect 1440 and
  approximately 768 widths.
- Check hierarchy, action semantics, duplicate facts, natural wrapping,
  horizontal overflow, clipped controls, and console errors.

## Task 6: Finalize evidence and delivery

Work:

- Create `.superpowers/sdd/2026-08-28-system-components-details-redesign.md`
  with baseline/final revisions, changed files, test results, browser and
  router evidence, hash identity, screenshots, console status, and regressions.
- Run the final validator and all required gates again.
- Commit only current-task files with a coherent message. Push the feature
  branch only if the existing repository workflow permits it; never force push
  and never rewrite main.
- Report `DESIGN READY` only if the screenshot and identity stop conditions are
  satisfied; otherwise report `DESIGN NOT READY` with the exact blocker.
