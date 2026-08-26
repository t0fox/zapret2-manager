---
id: z2m-editor-platform-design
title: "Z2M Editor Platform: CodeMirror 6"
type: spec
status: approved
authority: approved-spec
updated: 2026-08-27
publish: false
tags: [editor, codemirror, strategy, lua, resources]
---

# Z2M Editor Platform: CodeMirror 6

## Decision

Z2M will replace its textarea/pre-overlay editors with one browser-side
CodeMirror 6 platform. The platform has a small generic `CodeEditor` lifecycle
module and domain adapters for Lua and nfqws2. Strategy Visual and Code remain
two projections of one canonical `profile.args`; backend Strategy RPCs remain
the authoritative validation, preview, persistence, and apply boundary.

The migration is delivered in reviewable phases. A phase cannot be called
accepted from host tests alone when its acceptance criterion requires a real
LuCI page or router evidence.

## Current audit and hazards

The audit was performed against the refreshed `origin/main` at
`9e85867a79856826ecc3094cc68c26b8fb26d760`.

| Surface | Current authority and construction | Lifecycle hazard |
| --- | --- | --- |
| Lua resource editor | `z2m-assets.js:luaEditor()` creates a textarea, pre overlay, and manual gutter; `z2m-asset-tooling.js:highlightLua()` generates markup | `workspace.paint()` calls `root.replaceChildren(...)`, so an EditorView placed in the pane would be destroyed by every pane repaint |
| Hostlist/IPSet/Hosts editor | `z2m-assets.js:editPane()` creates a generic textarea for non-Lua textual assets | The same `paint()` path destroys the control and its listeners; sort, quick-add, import, validation, and content load repaint the pane |
| Strategy Code editor | `z2m-strategies.js:renderProfileEditor()` emits `pre.nfq-editor-overlay` and `textarea.nfq-editor-ta` | `renderEditorForm()` assigns `modal-body.innerHTML`; `renderAll()` invokes it while an editor is open; profile/mode/collapse actions also call it directly |
| Strategy Visual editor | `visualProfileHtml()`, `circularBuilderHtml()`, and `collectEditor()` derive fields from `profile.args` through `Nfqws2Ide` | Visual edits currently collect from DOM and then repaint the whole editor, which cannot preserve an EditorView identity, selection, or undo history |
| Autocomplete | `z2m-nfqws2-ide.js:NfqwsAutocomplete` attaches to a textarea and renders a body-level `.nfq-ac-popup` | It is coupled to textarea selection offsets and is removed/re-attached with every editor form repaint |
| Cursor help | `bindEditorIDE()` calls `Nfqws2Ide.tokenHelp()` and writes the Strategy side panel | Help updates must become targeted Inspector updates and must not trigger editor DOM replacement |
| Local diagnostics | `Nfqws2Ide.parseProfile()` plus `Nfqws2Lint.analyze()`; Strategy displays them in inline diagnostic containers | Current diagnostics are tied to textarea input handlers and editor-form markup |
| Backend validation | `ctx.api.strategies.validate` in `validateEditor()`; resource validation uses `ctx.api.assets.validateContent` | Results must update stable output/problems hosts, never the editor host |

The route and authority chain remains unchanged:

```text
strategies route
  -> z2m-strategy-page.js
  -> z2m-strategies.js / z2m-strategy-editor.js
  -> ctx.api.strategies.*
  -> strategies_* RPCs and strategy backend authority

resources, hostlists, ipsets, lua routes
  -> z2m-assets.js
  -> ctx.api.assets.* / ctx.api.resources.*
  -> assets_* and resources_* RPCs
```

## Scope and non-goals

In scope:

- bundled CodeMirror 6 runtime shipped as a local LuCI browser global;
- reusable generic editor lifecycle and theme;
- Lua, nfqws2, hostlist, ipset, and hosts text editing;
- nfqws2 completion, local diagnostics, token help, asset completion, and
  conservative highlighting through existing domain logic;
- stable Strategy and Resource editor hosts;
- lossless Visual/Code synchronization, circular builder transactions,
  multi-profile state, read-only package/builtin documents, and Problems UI;
- regression tests for lifecycle, undo, selection, unknown syntax, assets,
  completion, resource types, and performance boundaries.

Explicitly out of scope: Monaco, Lua or nfqws2 LSPs, AI completion, debugger,
minimap, CDN loading, npm/Node on the router, a browser Strategy compiler,
browser Lua validation, backend redesign, Asset Registry redesign, Resources
IA redesign, Z2K updater/sidecar migration, APK/SDK builds, and changes to the
canonical Strategy RPC lifecycle.

## Architecture

### Vendor runtime

`frontend/editor/` is the only npm build area. `package-lock.json` pins the
direct CodeMirror packages and the minimal transitive dependency graph. The
build emits an IIFE/browser global at
`luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor/z2m-codemirror.js`.

The public global is `globalThis.Z2MCodeMirrorVendor` and exposes only:

```text
EditorState, EditorView, keymap,
lineNumbers, highlightActiveLine, highlightActiveLineGutter,
history, historyKeymap, defaultKeymap, indentWithTab,
searchKeymap, autocompletion, completionKeymap,
lintGutter, linter, setDiagnostics,
bracketMatching, foldGutter, foldKeymap,
syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
StreamLanguage, luaMode,
EditorSelection, Compartment
```

The committed artifact is generated deterministically by `npm run build`.
The reproducibility check runs `npm ci`, `npm run build`, and
`git diff --exit-code -- vendor/z2m-codemirror.js` from the frontend build
area. OpenWrt Build/Compile only copies the already-generated vendor directory;
it never runs npm. No runtime network fallback exists.

### Generic CodeEditor

`z2m-code-editor.js` is the only LuCI module allowed to access
`Z2MCodeMirrorVendor` directly. It owns one `EditorView` and exposes:

```text
CodeEditor.mount(host, {
  value, language, readOnly,
  extensions?, diagnostics?,
  onChange?(value, transaction),
  onSave?(), onFocus?(), onCursor?(context)
})
```

The returned handle exposes `getValue()`, `setValue(value, options)`,
`setReadOnly(value)`, `setDiagnostics(items)`, `focus()`, `getSelection()`,
`destroy()`, and `view`.

`setValue()` dispatches a document transaction and never destroys/recreates the
view. Equal values dispatch nothing. `{ resetHistory: true }` is used only for
an external replacement; `{ preserveHistory: true }` is used for Visual-to-Code
or other synchronization. Visual updates are ordinary undoable transactions.
An explicit transaction annotation or `syncSource` guard prevents a Visual
transaction from feeding back into the Visual model as a loop.

The core installs line numbers, active line and gutter, history, standard
keymaps, search/replace, bracket matching, folding where supported, tab
indentation, and scroll behavior. Ctrl/Cmd+S prevents the browser save action
and invokes the same `onSave` callback used by the owning product action.

The theme is a CodeMirror extension scoped to `.z2m-code-editor` and `.cm-editor`.
It sets a full-width, minimum-width-zero, full-height panel with an explicit
background, border, radius, monospace scroller, and readable non-transparent
text. It does not depend on the generic `.z2m-app textarea` rule and does not
use a textarea overlay.

If the vendor is unavailable, the owning surface shows one readable plain
textarea with the same save/validate callback and a visible console/UI warning:
`Расширенный редактор недоступен; используется простой режим.` This is an
emergency loading fallback, not a second permanent editor implementation.

### Language adapters

`z2m-editor-lua.js` supplies Lua extensions by calling
`StreamLanguage.define(luaMode)` from the vendor. It adds syntax highlighting,
bracket matching, comments, and folding only where the legacy mode supports it.
It does not contain a tokenizer. The old Lua highlighter, overlay, manual
gutter, scroll synchronization, transparent text, and Lua span CSS are removed
only after the migration gate proves no consumer remains.

`z2m-editor-nfqws2.js` supplies CodeMirror completion, lint, cursor context,
and conservative decorations. It calls `Nfqws2Ide.contextFor()`,
`Nfqws2Ide.suggestions()`, `Nfqws2Ide.diagnostics()`, and the existing help/API
for all domain knowledge. It does not copy the nfqws2 vocabulary. Completion
items retain description, source, revision, and canonical asset reference
metadata. Initial highlighting distinguishes flags, values, Lua function and
subargument tokens, numbers, asset references, and invalid/unknown tokens; if
decoration complexity threatens the migration boundary, completion and
diagnostics take priority over additional colors.

### Strategy editor ownership

`z2m-strategy-editor.js` owns the Strategy IDE workspace, profile list, active
CodeMirror document, Visual/Code controls, Inspector, Problems, dirty state,
focus/cursor routing, multi-profile document state, and destruction.
`z2m-strategies.js` remains page/catalog/routing/orchestration code and keeps
catalog, apply, favorite, delete, clipboard, scanner handoff, learned state,
Discord, healthcheck, preview, and existing RPC contracts.

`profile.args` is the only canonical profile text. There are no
`rawArgs`, `visualArgs`, or `codeMirrorArgs` mirrors. Code changes update
`profile.args`, parse it through `Nfqws2Ide`, and update Visual only when the
result is structured and lossless. Unknown/future syntax keeps Code mode
editable, disables Visual with a safety explanation, and remains byte-for-byte
preserved until the user edits it. Visual changes call
`Nfqws2Ide.serializeProfile()` and update the same CodeMirror document through
an undoable transaction.

Only the active profile needs an EditorView. Switching profiles first flushes
the current document into its `profile.args`, stores optional selection/scroll
state, and then changes the active document without data loss. Validate,
Preview, diagnostics, metadata, Inspector, dirty flags, and spinners update
stable sibling hosts and never remount the view. Closing the IDE, deleting the
active profile, changing the architectural host, page dispose, or workspace
close are the explicit destruction points.

Inspector updates are targeted from cursor movement and show the existing
token context: flag, description, expected value, function, subargument, asset
reference, and source Lua file. Problems combines IDE and Backend diagnostics
with distinct source labels; Backend is authoritative. Known line/column/offset
locations map to CodeMirror ranges. Message-only backend errors appear in the
Problems panel without invented coordinates. Clicking a located problem focuses
the corresponding document and selection.

### Resource workspace ownership

`z2m-assets.js` retains resource listing, metadata, import, generator, usage,
and canonical Asset Registry actions. Its workspace becomes a stable shell with
separate header, tabs, pane/editor, validation, and actions hosts. Pane and
validation updates mutate only their own hosts; they never replace the host
containing the EditorView.

The generic editor is used for `lua`, `hostlist`, `ipset`, and `hosts`.
`blob`, `geosite`, and `geoip` retain their specialized binary/view/generator
flows. Resource Ctrl/Cmd+S calls the existing Validate → Update path with
revision semantics. Line-based `assets.validateContent` diagnostics are sent
to `CodeEditor.setDiagnostics()`; aggregate errors remain in the validation
host. Lua validation and Strategy validation remain separate backend contracts.

## Data and error flows

### Strategy

```text
Code transaction
  -> profile.args
  -> Nfqws2Ide.parseProfile
  -> Visual model when structured/lossless, or raw-only state

Visual change
  -> Nfqws2Ide.serializeProfile(profile.args, edits)
  -> CodeEditor.setValue(newArgs, { preserveHistory: true })
  -> profile.args

Validate
  -> flush active document
  -> IDE diagnostics
  -> existing strategies.validate
  -> map server diagnostics
  -> update Problems/validation hosts only

Preview
  -> flush active document
  -> existing strategies.preview
  -> update preview/dependencies/diff hosts only

Save
  -> flush active document
  -> block on existing local error contract
  -> existing strategies.create/update with expectedRevision
```

The optional `strategies.test` capability is detected as it is today. If it is
absent, the UI keeps `Test unavailable`; it never emulates Test with Apply.
Scanner session-storage handoff, provenance, clipboard import, and duplicate-as-
user-copy remain on their existing canonical paths and open imported args in
CodeMirror.

### Resource

```text
CodeEditor value
  -> state.content
  -> assets.validateContent
  -> line diagnostics or validation host
  -> assets.update(expectedRevision)
  -> ctx.refresh(ctx.route)
```

Package/builtin documents mount read-only while still allowing selection,
copying, search, folding, and scrolling. Duplicate-as-user-copy remains the
canonical edit escape hatch.

## Delivery phases and gates

1. **Platform foundation:** vendor bundle, package install copy, generic
   `CodeEditor`, theme, fallback, and standalone DOM tests. Gate: vendor
   reproducibility and core DOM/lifecycle tests pass.
2. **nfqws2 adapter:** CodeMirror completion/lint/context bridge, asset source,
   and conservative decorations. Gate: model-level completion, asset filtering,
   diagnostics, and metadata tests pass.
3. **Strategy Code migration:** extract Strategy editor ownership and mount one
   active CodeMirror document without changing Strategy RPC lifecycle. Gate:
   editor identity, selection, undo, read-only, multi-profile, and operation
   lifecycle tests pass.
4. **Visual synchronization:** connect Visual, circular builder, canonical
   `profile.args`, Inspector, Problems, backend diagnostic mapping, scanner
   handoff, and clipboard flows. Gate: lossless structured/raw-only and
   Visual-to-Code undo tests pass.
5. **Lua resource migration:** mount Lua adapter in a stable Resource shell and
   remove the confirmed overlay implementation. Gate: old overlay is absent;
   Lua samples, selection, search, undo, long lines, and large documents pass.
6. **Other text resources:** migrate hostlist, ipset, and hosts while preserving
   normalization/import/save behavior. Gate: type routing, read-only behavior,
   validation diagnostics, and Ctrl/Cmd+S tests pass.
7. **Cleanup and acceptance:** remove dead editor-only code and CSS, run
   focused and full host verification, then perform real LuCI acceptance at
   `/admin/services/zapret2-manager` at wide and narrow widths if a target is
   available. Gate: report exact evidence boundaries; no real LuCI PASS is
   claimed when it was not run.

Phases remain separately reviewable and are not collapsed into one large
unreviewed commit. OpenWrt SDK/APK/firmware builds and release pipelines are
not run as part of this migration.

## Verification contract

Required tests include:

- vendor file existence, no CDN URL, exact global surface, package vendor copy,
  deterministic rebuild, and stale-artifact failure;
- CodeEditor mount, initial value, typing/onChange, equal-value no-op,
  setValue/history modes, read-only behavior, save key handling, diagnostics,
  and destroy cleanup;
- lifecycle regression proving the same `EditorView`, selection, and undo
  remain after validation and preview UI updates;
- nfqws2 completion contexts for flags, L7 values, Lua functions/subarguments,
  and type-filtered canonical assets;
- structured Visual/Code round trips, circular builder undo, unknown syntax
  preservation, multi-profile isolation, scanner provenance, and clipboard;
- Lua comments, strings, long strings/comments, functions, numbers, 500+
  lines, long lines, and 10k-line performance boundaries;
- hostlist/ipset/hosts editor behavior and resource diagnostics.

Before completion, run the repository validator and relevant tests, then run
`git diff --check` and `git diff --find-renames`. Existing baseline failures
must be listed separately from regressions. Package, router, and real LuCI
acceptance remain distinct evidence classes.

## File responsibilities

```text
frontend/editor/
  package.json              pinned build contract
  package-lock.json         reproducible dependency graph
  build.mjs                 deterministic IIFE build and size report
  src/vendor-entry.mjs      minimal public CodeMirror surface

luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/
  vendor/z2m-codemirror.js  generated browser runtime
  z2m-code-editor.js        generic EditorView lifecycle and theme
  z2m-editor-lua.js         Lua CodeMirror extensions
  z2m-editor-nfqws2.js      nfqws2 CodeMirror integration
  z2m-strategy-editor.js    Strategy IDE workspace ownership
  z2m-strategies.js         page/catalog/orchestration and RPC actions
  z2m-assets.js             Resource workspace and Asset Registry actions
  z2m-nfqws2-ide.js         domain parse/serialize/completion/diagnostics
```

`z2m-code-editor.js` stays focused on generic lifecycle and does not become a
new monolith. `z2m-nfqws2-ide.js` remains domain authority even after its
textarea-specific popup and markup helpers are removed.

