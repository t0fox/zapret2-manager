---
id: z2m-strategy-ide-workspace-design
title: "Z2M Strategy IDE Workspace Redesign"
type: spec
status: draft
authority: proposed
updated: 2026-08-29
publish: false
tags: [strategy, ide, editor, ui, codemirror]
---

# Z2M Strategy IDE Workspace Redesign

## Decision

Transform the existing Strategy Editor from a form-like shell into a
three-panel workspace:

```text
Strategy Sidebar | Workspace | Inspector
```

This is a composition and presentation change over the existing editor
owner. It is not a new Strategy document architecture.

The existing `StrategyEditor` remains the owner of strategy/profile editing,
`activeId`, `profileMemory`, `viewByProfile`, `syncSource`, dirty state,
Visual/Code synchronization, Inspector, Problems, and the CodeMirror handle.
The existing `profile.args` field remains the canonical source of truth at the
editor and Strategy RPC boundary.

The existing Strategy RPC lifecycle remains unchanged:

```text
get -> edit -> validate / preview -> create or update -> apply
```

Backend changes, a new editor framework, a new document/store layer, and a
parser/serializer rewrite are out of scope unless a concrete failing test
proves that a minimal change is required.

## Current implementation boundary

The page shell and editor form are composed in:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js
```

The current editor owner and stable lifecycle are in:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js
```

The shared CodeMirror lifecycle is in:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-code-editor.js
```

The nfqws2 parser, Visual projection, serializer, completion, help, and
local diagnostics are in:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-nfqws2-ide.js
```

The current layout is a scrollable main form with metadata, profile tabs,
Visual/Code controls, a bounded editor, bottom preview/validation output, and
an Inspector/Problems aside. The redesign changes where these existing hosts
are presented and how they are visually grouped.

## Scope and non-goals

### In scope

- three-panel Strategy IDE composition;
- Strategy Sidebar containing existing metadata and profile presentation;
- Workspace header containing active-profile controls and Visual/Code mode;
- full-height CodeMirror workspace using the existing EditorView;
- bounded or collapsible existing Preview inside the workspace;
- sticky header actions and bottom status bar;
- IDE-quality Problems presentation and cross-profile navigation;
- mandatory local diagnostics counts for every profile;
- minimal validation freshness state tied to the canonical flushed draft;
- responsive behavior, keyboard access, focus-visible states, reduced motion,
  readable typography, and consistent spacing;
- layout and presentation regression tests.

### Explicitly out of scope

- a new `StrategyDocument` or client store architecture;
- replacing the existing StrategyEditor owner;
- changing `profile.args` canonical ownership;
- replacing CodeMirror or adding Monaco/another heavy editor framework;
- rewriting `parseProfile` or `serializeProfile` without a concrete RED test;
- making `profiles.uc` a mandatory frontend dependency;
- changing `z2m-api.js`, `strategy-cli.uc`, or any Strategy RPC contract;
- adding a fake or separate Strategy test endpoint;
- changing Apply authority or backend lifecycle;
- redesigning Dashboard, DNS, Monitoring, or unrelated pages;
- APK builds or installation;
- automatic push to `origin/main`.

## Load-bearing invariants

The following existing contracts must remain true throughout the change:

- one CodeMirror `EditorView` for the active Strategy editor;
- `profile.args` remains canonical;
- Visual edits update canonical args and remain undoable;
- raw-only profiles remain safe and editable in Code mode;
- profiles remain isolated when switching between them;
- `profileMemory`, `viewByProfile`, `flush`, and existing profile lifecycle
  functions continue to work;
- selection, scroll, and undo history are not lost by ordinary UI updates;
- Validate, Preview, Inspector, Problems, and profile controls do not remount
  the CodeMirror host or EditorView;
- current Strategy RPC requests continue to use canonical `strategy_data` or
  persisted identity/revision inputs;
- backend remains unchanged by default.

The load-bearing behavior is covered by:

```text
frontend/editor/test/strategy-editor-sync.test.mjs
frontend/editor/test/strategy-editor-owner.test.mjs
frontend/editor/test/editor-core.test.mjs
```

## Target composition

### Modal header

The header contains only global, high-value controls and state:

- Strategy IDE title;
- dirty indicator;
- aggregate Problems count/state;
- Validate;
- Save/Create;
- maximize;
- close.

The header must not duplicate page-level navigation or repeat the same status
in multiple locations.

### Strategy Sidebar

The left sidebar presents existing strategy metadata and profile navigation.

It contains:

- ID, name, and description using the existing metadata fields;
- read-only ID for persisted records where the current model requires it;
- profile list instead of the current profile tabs;
- active, enabled, disabled, warning, error, and clean states;
- mandatory local error/warning counts for every profile;
- add profile;
- remove, rename, and duplicate actions using accessible buttons or a
  context menu.

The profile lifecycle remains the existing lifecycle. The sidebar changes the
presentation of `renderProfileTabs()`; it does not replace
`switchProfile`, `addProfile`, `removeProfile`, `flush`, `profileMemory`, or
`viewByProfile`.

### Workspace

The workspace is the primary surface and receives the available height.

Its header contains:

- active profile name/edit control;
- enabled state;
- Visual/Code mode switch.

The workspace body contains the existing `visualHost` or `editorHost`.
CodeMirror uses flex layout and fills the available editor height. It must not
be constrained to the previous fixed `clamp(340px, 48vh, 620px)` pane.

Preview remains the existing preview operation and host, but is presented as
a bounded or collapsible workspace panel with:

- effective runtime representation;
- active profile identity;
- data source;
- server/runtime validation information when returned;
- dependencies and diagnostics already supplied by the current contract.

### Inspector and Problems

The right side keeps the existing Inspector and Problems hosts.

Inspector remains contextual to the current token, selection, or diagnostic.
Problems becomes a visibly complete IDE panel rather than an incidental block
below the form. Its layout must support counts, severity, source, and
navigation without inventing position information.

### Sticky status bar

The bottom status bar is always visible within the modal and contains compact
state only:

- local error/warning count;
- server validation freshness;
- profile count;
- current operation state when validating, previewing, or saving.

Status must not duplicate the full Problems list or repeat the modal header
actions.

## Visual and Code contract

The existing round-trip contract is an invariant:

```text
profile.args
  -> parseProfile
  -> Visual
  -> serializeProfile
  -> the same profile.args / same CodeMirror document
```

The implementation must preserve:

- one shared CodeMirror document for Visual and Code;
- undoability of Visual changes;
- raw-only fallback safety;
- unknown/future syntax preservation already covered by current tests;
- profile isolation and document restoration when switching profiles;
- no editor remount caused by non-editor updates.

The implementation must not proactively rewrite the parser or serializer.
Potential issues with repeated, quoted, or opaque arguments require a focused
regression test first. If the current raw-only path safely preserves the
input, it remains unchanged. If a RED test proves data loss, implement the
smallest fix that makes that test pass and update the contract explicitly.

## Problems and diagnostics contract

The existing local diagnostics and `backendProblems` collections remain the
source of diagnostic data. The presentation layer may extend the normalized
items with fields needed for display and navigation:

```text
severity, profileId, message, code, line, column, range, token, source
```

The minimum behavior is:

- display source as `IDE` or `Backend`;
- display aggregate count in the header and status bar;
- calculate local diagnostics for every `strategy.profiles[]` using the
  existing `Nfqws2Ide.diagnostics(profile.args)`;
- display local error/warning counts beside every profile in the sidebar;
- include a backend problem in a profile count only when the existing backend
  item reliably identifies that profile;
- do not invent `profileId`, line, column, range, token, or other location
  data when the backend did not provide it;
- clicking a problem from another profile switches to that profile, selects
  Code mode when appropriate, focuses the existing EditorView, and selects a
  reliable range if one exists.

No new diagnostics subsystem is required. The existing `renderProblems()` and
backend mapping should be extended minimally.

## Validation freshness contract

The editor keeps the existing `editorState.dirty` and close protection. A
small explicit validation object is added alongside the existing state:

```text
validation.status:
  not-checked | validating | current | outdated | failed

validation.validatedDraftFingerprint
```

The fingerprint is computed only from the canonical flushed Strategy draft:

```text
flush()
  -> strategyInput(editorState.strategy)
  -> the exact strategy_data sent to ctx.api.strategies.validate
  -> deterministic serialized snapshot/fingerprint
```

The fingerprint must not include UI-only state such as:

- `activeId`;
- Visual/Code mode;
- selection;
- scroll position;
- sidebar collapse;
- Inspector context;
- Problems expansion;
- modal geometry.

After successful Validate, store the fingerprint of the draft actually sent
to Validate. After a semantic edit of the canonical draft:

- if the current canonical draft fingerprint is equal, validation remains
  `current`;
- if it differs, validation becomes `outdated`;
- after a new successful Validate for that draft, it becomes `current` again;
- failed validation becomes `failed`;
- an active request is shown as `validating`.

No backend validation or RPC changes are needed.

## Accessibility and visual quality

The new shell follows the four approved design references: Emil Design
Engineering, Design Consultation, Design Review, and Web Interface
Guidelines.

Required behaviors:

- clear visual hierarchy with the workspace as the primary surface;
- no card mosaic or decorative UI that competes with the editor;
- one restrained accent system and meaningful status colors;
- visible labels, adequate contrast, and keyboard-operable controls;
- `:focus-visible` states;
- touch targets of at least 44px where applicable;
- explicit disabled and busy states;
- no `transition: all`;
- reduced-motion support;
- no duplicated headings or status messages;
- stable scroll containers for sidebar, workspace, Inspector, and Problems;
- responsive collapse at narrow widths without destroying editor usability.

## Files expected to change

Primary implementation files:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
```

Possible minimal change only if a focused RED regression requires it:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-nfqws2-ide.js
```

Stable supporting modules that should not be structurally replaced:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-code-editor.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-editor-nfqws2.js
```

Not expected to change for this task:

```text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js
zapret2-manager/files/usr/share/rpcd/ucode/strategy-cli.uc
```

## Test strategy

### Baseline and invariants

Run the existing focused suites before implementation:

```text
frontend/editor/test/strategy-editor-sync.test.mjs
frontend/editor/test/strategy-editor-owner.test.mjs
frontend/editor/test/editor-core.test.mjs
tests/ui/editor-core-contract.test.mjs
tests/ui/editor-strategy-lifecycle.test.mjs
tests/ui/editor-responsive-contract.test.mjs
tests/ui/editor-nfqws2-contract.test.mjs
```

The sync and owner suites remain load-bearing and must continue to prove:

- same EditorView;
- selection preservation;
- undo preservation;
- Visual to canonical args;
- raw-only safety;
- multi-profile isolation;
- validation/preview without remount;
- cleanup lifecycle.

### New RED layout and behavior tests

Add or update focused tests for:

- `Sidebar | Workspace | Inspector` composition;
- metadata and profiles in the sidebar;
- active profile controls in the workspace header;
- full-height editor host;
- bounded/collapsible preview;
- sticky status bar;
- mandatory local diagnostics for every profile;
- profile diagnostic counts and source labels;
- cross-profile Problems navigation;
- validation fingerprint based only on flushed canonical `strategy_data`;
- UI-only changes not invalidating validation;
- canonical draft changes producing `outdated`;
- responsive and accessibility contracts.

Existing layout tests that describe the transitional two-column form may be
rewritten. Existing lifecycle and synchronization tests may not be weakened.

### Browser acceptance

After focused tests pass, verify the real LuCI page with cache-disabled
reloads:

1. open an existing strategy;
2. switch profiles;
3. edit Code and undo;
4. edit Visual and verify the same CodeMirror document;
5. open a raw-only profile;
6. inspect local diagnostics for every profile;
7. navigate to a backend and local Problem;
8. run Preview;
9. run Validate;
10. change only mode, selection, scroll, or sidebar state and confirm
    validation remains current;
11. make a canonical edit and confirm `outdated`;
12. validate again, save, close, and reopen.

Browser acceptance is separate evidence from host tests. No APK build or
installation is part of this work.

## Implementation order after written-spec approval

1. Receive approval for this written spec.
2. Use `superpowers:writing-plans` to produce the implementation plan.
3. Run and record the baseline suites.
4. Add RED UI/layout contracts for the new composition.
5. Rebuild `renderEditorForm()` around the three existing panel hosts.
6. Move metadata and profile presentation to the sidebar.
7. Move active-profile controls and Visual/Code into the workspace header.
8. Make the CodeMirror host flex/full-height without changing EditorView
   lifecycle.
9. Place the existing Preview in the bounded workspace panel.
10. Add the sticky status bar.
11. Add minimal validation freshness based on flushed canonical draft data.
12. Improve Problems and profile diagnostic presentation/navigation.
13. Consolidate Strategy IDE CSS overrides.
14. Run responsive/accessibility checks and all load-bearing regression tests.
15. Run the real browser/LuCI acceptance loop.
16. Review the final diff and report exact verification boundaries.

No automatic push is included. Any push to `origin/main` requires a separate
explicit authorization after implementation and verification.

## Definition of Done

- The existing StrategyEditor owner remains authoritative.
- The UI is a usable three-panel Strategy IDE workspace.
- `profile.args` remains canonical and Visual/Code round-trip invariants pass.
- One CodeMirror EditorView survives all ordinary editor updates.
- Multi-profile local diagnostics are visible in the sidebar.
- Problems navigation works without fabricated locations.
- Validation freshness is tied only to the flushed canonical draft sent to
  Validate.
- Backend and Strategy RPC contracts remain unchanged.
- Parser/serializer changes, if any, are justified by a concrete RED test.
- Focused tests and browser acceptance evidence are reported separately.
- No APK is built or installed.
- Push is not performed unless separately authorized.
