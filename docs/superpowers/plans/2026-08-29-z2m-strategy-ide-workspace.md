---
id: z2m-strategy-ide-workspace
title: "Z2M Strategy IDE Workspace Implementation Plan"
type: plan
status: active
authority: approved-plan
updated: 2026-08-30
publish: false
tags: [strategy, ide, editor, ui, codemirror]
---

# Z2M Strategy IDE Workspace Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> plan task-by-task. This execution is intentionally inline because the user
> prohibited agents and additional branches.

**Goal:** Recompose the existing StrategyEditor into a usable
`Strategy Sidebar | Workspace | Inspector` IDE without changing its owner,
canonical `profile.args`, CodeMirror lifecycle, parser contract, or Strategy
RPC lifecycle.

**Architecture:** Keep `z2m-strategy-editor.js` as the sole editor owner and
reuse its existing hosts and lifecycle functions. Change only shell and
presentation placement, add minimal validation freshness and multi-profile
Problems presentation, and keep backend and editor-core contracts unchanged.

**Tech Stack:** LuCI vanilla JavaScript modules, existing CodeMirror 6
`CodeEditor`, existing `Nfqws2Ide`, CSS tokens, Node built-in test runner,
`happy-dom`, and real LuCI browser acceptance.

**Spec:** `docs/superpowers/specs/2026-08-29-z2m-strategy-ide-workspace-design.md`

## Global Constraints

- Existing `StrategyEditor` remains owner of editing, `activeId`,
  `profileMemory`, `viewByProfile`, `flush`, Inspector, Problems, dirty state,
  and CodeMirror lifecycle.
- `profile.args` remains canonical.
- Exactly one CodeMirror `EditorView` exists for the active editor.
- Visual edits remain undoable and raw-only profiles remain safe.
- Validate, Preview, Inspector, Problems, and profile controls do not remount
  CodeMirror.
- Local diagnostics are calculated for every profile.
- Validation freshness is fingerprinted from flushed canonical `strategy_data`
  only; UI-only state is excluded.
- Parser/serializer changes require a concrete RED regression first.
- Backend, `z2m-api.js`, Strategy RPCs, APK, and automatic push are out of
  scope.

---

### Task 1: Baseline and guardrails

**Files:** Read the approved spec, `z2m-strategies.js`,
`z2m-strategy-editor.js`, `z2m-ui.css`, and the existing editor/Strategy tests.

**Produces:** Exact baseline counts and recorded pre-existing failures; no
production changes.

- [ ] Run `Set-Location frontend/editor; npm test; Set-Location ../..`.
- [ ] Run `node --test tests/ui/editor-strategy-lifecycle.test.mjs tests/ui/strategy-ide-workflow.test.mjs tests/ui/strategy-ide-regression.test.mjs`.
- [ ] Record output separately from later layout changes.
- [ ] Commit this plan and the context-map pointer with
  `git add docs/superpowers/plans/2026-08-29-z2m-strategy-ide-workspace.md docs/12-ai/context-map.yaml` and
  `git commit -m "docs: plan strategy IDE workspace implementation"`.

### Task 2: RED contract for the three-panel shell

**Files:** Modify `tests/ui/strategy-ide-design-contract.test.mjs`,
`tests/ui/strategy-ide-layout-regression.test.mjs`, and
`tests/ui/editor-responsive-contract.test.mjs`; then modify
`z2m-strategies.js`, `z2m-strategy-editor.js`, and `z2m-ui.css`.

**Interface:** Preserve `fieldsHost`, `profilesHost`, `visualHost`,
`editorHost`, `validationHost`, `previewHost`, `inspectorHost`, and
`problemsHost`; add stable `data-editor-sidebar`,
`data-editor-workspace`, `data-editor-inspector`, and `data-editor-status`.

- [ ] Add failing assertions for the four markers, a three-column layout,
  workspace `min-height:0`, and removal of the fixed
  `height:clamp(340px,48vh,620px) !important` rule. Keep lifecycle,
  accessibility, motion, and host assertions.
- [ ] Run `node --test tests/ui/strategy-ide-design-contract.test.mjs tests/ui/strategy-ide-layout-regression.test.mjs tests/ui/editor-responsive-contract.test.mjs` and confirm the failure is caused by the missing shell.
- [ ] Change `renderEditorForm()` so the existing hosts are placed as
  `sidebar -> fieldsHost + profilesHost`,
  `workspace -> active header + visualHost/editorHost + previewHost`,
  `inspector -> inspectorHost + problemsHost`, and `status -> status host`.
- [ ] Keep `StrategyEditor.create/update/destroy`; do not create a new owner or
  document/store layer.
- [ ] Re-run the same three UI tests and confirm the new shell contract passes.

### Task 3: Sidebar profile presentation

**Files:** Modify `z2m-strategy-editor.js:116-193`, `z2m-ui.css`,
`tests/ui/strategy-ide-design-contract.test.mjs`,
`frontend/editor/test/strategy-editor-sync.test.mjs`, and
`frontend/editor/test/strategy-editor-owner.test.mjs`.

**Interface:** Preserve `switchProfile(id)`, `addProfile()`,
`removeProfile(id)`, `profileMemory`, `viewByProfile`, and `flush()`.

- [ ] Add RED assertions for `data-editor-profile-list`,
  `data-profile-diagnostic-count`, and `data-profile-enabled`, while asserting
  the existing lifecycle functions remain present.
- [ ] Add a DOM regression that switches to the second profile and asserts the
  same `handle.view` object remains mounted and the second args are loaded.
- [ ] Run the affected owner/sync tests and observe the new assertions fail.
- [ ] Decompose `renderProfileTabs()` presentation-wise: render metadata,
  profile list, add/remove actions, active/enabled state, and diagnostic count
  in the sidebar. Keep all profile mutation and switching logic in the current
  owner functions.
- [ ] Run `node --test frontend/editor/test/strategy-editor-sync.test.mjs frontend/editor/test/strategy-editor-owner.test.mjs` and require same-EditorView, undo, selection, isolation, circular-edit, update/flush, and cleanup tests to pass.

### Task 4: Workspace header and full-height CodeMirror

**Files:** Modify `z2m-strategy-editor.js`, `z2m-ui.css`,
`tests/ui/strategy-ide-design-contract.test.mjs`, and
`tests/ui/editor-core-contract.test.mjs`.

**Interface:** Keep `viewFor(profile, index)` as mode authority and keep
`editorHost` mounted once by `CodeEditor.mount()`.

- [ ] Add RED assertions that active profile name, enabled state, and
  Visual/Code controls occur under the workspace marker and the fixed code
  height is absent.
- [ ] Run the two UI tests and confirm RED.
- [ ] Move only presentation controls to a workspace header; preserve
  `viewByProfile`, `renderVisual()`, and `renderCodeMode()`.
- [ ] Make the workspace a flex column and the editor area `min-height:0;
  flex:1`; do not recreate the CodeMirror handle.
- [ ] Run `node --test frontend/editor/test/strategy-editor-sync.test.mjs frontend/editor/test/strategy-editor-owner.test.mjs frontend/editor/test/editor-core.test.mjs`.

### Task 5: Bounded Preview and status bar

**Files:** Modify `z2m-strategy-editor.js`, `z2m-strategies.js`, `z2m-ui.css`,
`tests/ui/strategy-ide-design-contract.test.mjs`, and
`tests/ui/strategy-ide-regression.test.mjs`.

**Interface:** Keep `setPreview()` and current Preview RPC payloads unchanged.

- [ ] Add RED assertions that Preview is inside the workspace and the status
  exposes local diagnostics, validation freshness, and profile count.
- [ ] Run the affected UI tests and confirm RED.
- [ ] Present existing `previewHost` as a bounded/collapsible workspace panel.
  Keep preview content, RPC calls, and canonical `strategy_data` unchanged.
- [ ] Add in-place status rendering for editor, Problems, validation, and save
  events without duplicating the full Problems list.
- [ ] Run `node --test frontend/editor/test/strategy-editor-owner.test.mjs tests/ui/strategy-ide-regression.test.mjs`.

### Task 6: Minimal validation freshness

**Files:** Modify `z2m-strategies.js`; modify `z2m-strategy-editor.js` only if
the existing owner needs a semantic-change callback; create
`tests/ui/strategy-ide-validation-freshness.test.mjs`; modify
`tests/ui/strategy-ide-workflow.test.mjs`.

**Interface:** Add deterministic `editorDraftFingerprint(draft)` over the
exact object returned by `strategyInput()` and sent as Validate
`strategy_data`. Add only `state.editor.validation.status` and
`state.editor.validation.validatedDraftFingerprint`.

- [ ] Add RED tests showing equal canonical drafts have equal fingerprints,
  semantic draft changes differ, and adding UI-only `{activeId, mode, scroll}`
  does not change the canonical fingerprint.
- [ ] Add a source/behavior assertion that Validate stores the fingerprint of
  the flushed draft actually sent as `strategy_data`.
- [ ] Run `node --test tests/ui/strategy-ide-validation-freshness.test.mjs tests/ui/strategy-ide-workflow.test.mjs` and confirm RED.
- [ ] Before Validate, use the existing collect/flush path once and fingerprint
  the exact draft payload. After success store it; after semantic changes,
  equal keeps `current`, different becomes `outdated`, no prior success is
  `not-checked`, active request is `validating`, and failure is `failed`.
- [ ] Exclude active profile, mode, selection, scroll, collapse, Inspector,
  Problems expansion, and modal geometry.
- [ ] Run the freshness tests plus owner/sync tests and require all existing
  lifecycle invariants to remain green.

### Task 7: Multi-profile Problems and safe navigation

**Files:** Modify `z2m-strategy-editor.js` and `z2m-ui.css`; modify
`frontend/editor/test/strategy-editor-owner.test.mjs`,
`tests/ui/strategy-ide-design-contract.test.mjs`, and
`tests/ui/strategy-ide-workflow.test.mjs`.

**Interface:** Call `Nfqws2Ide.diagnostics(profile.args)` for every profile;
preserve backend mapping and use only supplied reliable profile/location data.

- [ ] Add RED test with two profiles and one local warning in the second;
  assert both sidebar items expose counts and Problems contains the warning.
- [ ] Add a message-only backend diagnostic; assert it is static and has no
  fabricated `from`, `to`, `profileIndex`, or navigation target.
- [ ] Run owner/workflow tests and confirm RED.
- [ ] Aggregate local diagnostics across all profiles, show `IDE`/`Backend`,
  attach profile index only when reliable, and keep message-only rows
  non-interactive.
- [ ] On a reliable click, call existing `switchProfile()`, select Code when
  appropriate, focus the same EditorView, and select only a real range.
- [ ] Run owner/sync/workflow tests and require no remount.

### Task 8: CSS, accessibility, responsive behavior

**Files:** Modify `z2m-ui.css`,
`tests/ui/strategy-ide-design-contract.test.mjs`, and
`tests/ui/editor-responsive-contract.test.mjs`.

- [ ] Add RED assertions for measured desktop columns, `min-height:0` scroll
  boundaries, focus-visible, 44px icon targets, disabled/busy states,
  reduced-motion, no `transition: all`, and usable narrow-screen collapse.
- [ ] Run the CSS tests and confirm RED.
- [ ] Replace contradictory Strategy IDE overrides with one coherent CSS block
  for sidebar/workspace/Inspector, sticky header/footer, scroll boundaries,
  focus states, disabled states, and reduced motion. Do not alter unrelated
  page styles.
- [ ] Run the CSS tests and `git diff --check`.

### Task 9: Full verification and real LuCI acceptance

**Files:** Read all changed files; run the existing and new tests.

- [ ] Run `Set-Location frontend/editor; npm test; Set-Location ../..`.
- [ ] Run focused UI tests: strategy design/layout/freshness/workflow/
  regression, editor lifecycle/responsive/nfqws2 contracts.
- [ ] Run product regressions for avatar strategy preview, RPC, and UI.
- [ ] Perform cache-disabled LuCI acceptance: open/edit, switch profiles, Code
  undo, Visual sync, raw-only safety, all-profile diagnostics, Problem
  navigation, Preview, Validate, UI-only changes preserving `current`,
  canonical edits producing `outdated`, revalidation, save, close, reopen.
- [ ] Review `git diff --check`, `git status --short --branch`, and
  `git diff --stat`. Keep unrelated `/` untouched.
- [ ] Report host tests, router deployment, browser acceptance, and any
  unverified boundary separately. Do not build APK and do not push without a
  separate explicit authorization.
