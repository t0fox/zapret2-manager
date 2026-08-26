# Z2M Editor Platform Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Replace the legacy textarea/pre-overlay editors with a bundled
CodeMirror 6 platform shared by Strategy Code mode and Lua/text resources,
while preserving canonical profile.args, Asset Registry semantics, Strategy RPC
lifecycle, and backend authority.

Architecture: A small npm/esbuild area produces a deterministic IIFE and one
generic LuCI CodeEditor owns all EditorView instances. Lua and nfqws2 adapters
provide extensions through that core; z2m-strategy-editor.js owns Strategy
editor state and stable hosts; z2m-assets.js owns a stable Resource workspace
shell. Visual/Code are projections of profile.args, and all validate,
preview, and save operations stay on existing RPCs.

Tech Stack: CodeMirror 6 packages @codemirror/state, view, commands, search,
autocomplete, lint, language, legacy-modes; esbuild; Node node:test; Happy DOM
for browser/DOM tests; existing LuCI JavaScript modules, Nfqws2Ide, and Asset
Registry APIs.

Spec: docs/superpowers/specs/2026-08-27-z2m-editor-platform-design.md

## Global Constraints

- Use only the pinned CodeMirror packages listed in the spec; do not ship
  Monaco, LSPs, CDN fallback, npm/Node on the router, browser compilers, or
  backend redesign.
- profile.args is the only canonical Strategy text; never add rawArgs,
  visualArgs, or codeMirrorArgs mirrors.
- Nfqws2Ide remains the nfqws2 domain authority; adapters call its context,
  suggestions, diagnostics, parse, and serialize APIs rather than duplicating
  vocabulary.
- Do not change ctx.api.strategies.*, ctx.api.assets.*, ctx.api.resources.*,
  expectedRevision semantics, scanner handoff, clipboard contracts, or
  Test-unavailable behavior.
- An EditorView is destroyed only on an explicit host/document lifecycle
  boundary; dirty state, diagnostics, Inspector, validation, preview, save
  spinners, and metadata updates must not remount it.
- Do not run OpenWrt SDK, APK/IPK, firmware, or release builds locally.
- Preserve unrelated checkout/runtime state and commit only current-task files.
- Run the repository validator after every created or modified documentation
  file and before any completion claim; baseline failures remain separate.

---

## File map

Create or modify only these feature-owned files plus focused tests:

~~~text
frontend/editor/
  package.json
  package-lock.json
  build.mjs
  src/vendor-entry.mjs
  test/editor-core.test.mjs

luci-app-zapret2-manager/Makefile

luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/
  vendor/z2m-codemirror.js
  z2m-code-editor.js
  z2m-editor-lua.js
  z2m-editor-nfqws2.js
  z2m-strategy-editor.js
  z2m-strategies.js
  z2m-assets.js
  z2m-nfqws2-ide.js
  z2m-asset-tooling.js
  z2m-ui.css

tests/ui/
  editor-vendor-contract.test.mjs
  editor-core-contract.test.mjs
  editor-nfqws2-contract.test.mjs
  editor-strategy-lifecycle.test.mjs
  editor-visual-sync.test.mjs
  editor-resources-contract.test.mjs
  editor-responsive-contract.test.mjs
~~~

Existing Strategy and Resource tests stay in place. Tests asserting old
overlay behavior change only when the corresponding migration phase replaces
that behavior; unrelated catalog, Scanner, Asset Registry, and product
contracts are not weakened.

## Task 1: Vendor build, shipped artifact, and package copy

Files:

- Create frontend/editor/package.json, package-lock.json, build.mjs, and
  src/vendor-entry.mjs.
- Create tests/ui/editor-vendor-contract.test.mjs.
- Modify luci-app-zapret2-manager/Makefile.
- Create the generated LuCI vendor/z2m-codemirror.js.

Interfaces:

- The build produces globalThis.Z2MCodeMirrorVendor with exactly the public
  names in the spec.
- The generated frontend artifact and shipped LuCI file are byte identical.
- Make install copies the vendor directory without invoking npm.

- [ ] Step 1: Add the failing vendor contract test.

Create tests/ui/editor-vendor-contract.test.mjs:

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const frontend = path.join(root, 'frontend/editor');
const view = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = file => fs.readFileSync(file, 'utf8');

test('CodeMirror vendor build and package copy contract are present', () => {
  assert.ok(fs.existsSync(path.join(frontend, 'package.json')));
  assert.ok(fs.existsSync(path.join(frontend, 'package-lock.json')));
  assert.ok(fs.existsSync(path.join(frontend, 'src/vendor-entry.mjs')));
  assert.ok(fs.existsSync(path.join(frontend, 'build.mjs')));
  const bundle = read(path.join(view, 'vendor/z2m-codemirror.js'));
  assert.match(bundle, /Z2MCodeMirrorVendor/);
  assert.doesNotMatch(bundle, /https?:\/\//i);
  for (const name of [
    'EditorState', 'EditorView', 'keymap', 'lineNumbers',
    'highlightActiveLine', 'highlightActiveLineGutter', 'history',
    'historyKeymap', 'defaultKeymap', 'indentWithTab', 'searchKeymap',
    'autocompletion', 'completionKeymap', 'lintGutter', 'linter',
    'setDiagnostics', 'bracketMatching', 'foldGutter', 'foldKeymap',
    'syntaxHighlighting', 'defaultHighlightStyle', 'HighlightStyle',
    'StreamLanguage', 'luaMode', 'EditorSelection', 'Compartment',
  ]) assert.match(bundle, new RegExp('\\b' + name + '\\b'), name);
  const makefile = read(path.join(root, 'luci-app-zapret2-manager/Makefile'));
  assert.match(makefile, /vendor/);
  assert.match(makefile, /INSTALL_DIR/);
  assert.match(makefile, /wildcard[^\n]*vendor/);
});

test('vendor package contains only intended direct packages', () => {
  const pkg = JSON.parse(read(path.join(frontend, 'package.json')));
  assert.deepEqual(Object.keys(pkg.dependencies || {}).sort(), [
    '@codemirror/autocomplete', '@codemirror/commands',
    '@codemirror/language', '@codemirror/legacy-modes',
    '@codemirror/lint', '@codemirror/search', '@codemirror/state',
    '@codemirror/view', 'esbuild',
  ].sort());
});
~~~

- [ ] Step 2: Run the contract and verify the expected RED failure.

Run:

~~~text
node --test tests/ui/editor-vendor-contract.test.mjs
~~~

Expected: FAIL because frontend/editor and the shipped bundle do not exist.
Do not proceed if it errors for a test typo instead of the missing feature.

- [ ] Step 3: Add the pinned npm package and entry point.

Create frontend/editor/package.json with type module and scripts build, check,
and test. Install exact direct dependencies with:

~~~text
npm install --save-exact @codemirror/autocomplete @codemirror/commands @codemirror/language @codemirror/legacy-modes @codemirror/lint @codemirror/search @codemirror/state @codemirror/view esbuild
npm install --save-dev --save-exact happy-dom
~~~

Run these commands in frontend/editor so package-lock.json records concrete
versions. Do not add @codemirror/basic-setup or a convenience bundle.

Create src/vendor-entry.mjs with direct named imports and one explicit global
assignment:

~~~js
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { lintGutter, linter, setDiagnostics } from '@codemirror/lint';
import { bracketMatching, foldGutter, foldKeymap,
  syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
  StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';

const api = {
  EditorState, EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, history, historyKeymap, defaultKeymap,
  indentWithTab, searchKeymap, autocompletion, completionKeymap,
  lintGutter, linter, setDiagnostics, bracketMatching, foldGutter,
  foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
  StreamLanguage, luaMode: lua, EditorSelection, Compartment,
};

globalThis.Z2MCodeMirrorVendor = api;
export default api;
~~~

- [ ] Step 4: Implement deterministic build and generate the artifact.

build.mjs bundles src/vendor-entry.mjs with esbuild using browser platform, IIFE
format, target es2020, no external imports, no source map, no timestamps, and
legalComments none. It writes frontend/editor/vendor/z2m-codemirror.js and
copies exact bytes to the LuCI vendor path. It also prints unminified and
in-memory minified byte counts using esbuild transform. The shipping path is:

~~~text
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor/z2m-codemirror.js
~~~

The build must assign the global through globalThis so evaluation inside the
LuCI loader still exposes Z2MCodeMirrorVendor.

- [ ] Step 5: Add the vendor directory install rule.

Add after the existing top-level JavaScript copy in the LuCI Makefile:

~~~make
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/zapret2-manager/vendor
	$(foreach vendor,$(wildcard ./files/www/luci-static/resources/view/zapret2-manager/vendor/*.js),$(INSTALL_DATA) $(vendor) $(1)/www/luci-static/resources/view/zapret2-manager/vendor/;)
~~~

Do not add npm commands to Build/Compile.

- [ ] Step 6: Run the vendor gate and commit only Task 1.

Run:

~~~text
npm ci --prefix frontend/editor
npm run build --prefix frontend/editor
node --test tests/ui/editor-vendor-contract.test.mjs
git diff --no-index -- frontend/editor/vendor/z2m-codemirror.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor/z2m-codemirror.js
git diff --check
~~~

Expected: the two bundle files are identical and all vendor tests pass.
Commit the feature files with:

~~~text
git add frontend/editor luci-app-zapret2-manager/Makefile luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor tests/ui/editor-vendor-contract.test.mjs
git commit -m "feat(editor): add bundled codemirror runtime"
~~~

## Task 2: Generic CodeEditor core, theme, fallback, and DOM gate

Files:

- Create z2m-code-editor.js.
- Create frontend/editor/test/editor-core.test.mjs and
  tests/ui/editor-core-contract.test.mjs.
- Modify z2m-ui.css.

Interfaces:

- CodeEditor.mount(host, options) returns getValue, setValue, setReadOnly,
  setDiagnostics, focus, getSelection, destroy, and view.
- CodeEditor.vendor is the only adapter access path to the vendor global.
- CodeEditor.theme and CodeEditor.baseExtensions are reusable extensions.

- [ ] Step 1: Add failing core tests.

The static test asserts the API names and absence of overlay patterns:

~~~js
test('generic CodeEditor owns CodeMirror lifecycle and has no overlay editor', () => {
  const source = read('z2m-code-editor.js');
  for (const marker of ['mount', 'getValue', 'setValue', 'setReadOnly',
    'setDiagnostics', 'focus', 'getSelection', 'destroy', 'EditorView',
    'Compartment']) assert.match(source, new RegExp(marker), marker);
  assert.doesNotMatch(source, /transparent|text-fill-color|innerHTML\s*=.*value/i);
});
~~~

The DOM test loads the generated vendor and core source in a Happy DOM
document. It mounts a real editor, checks .cm-editor, initial value, a real
document change and onChange transaction, selection, Ctrl/Cmd+S exactly once,
diagnostic gutter, read-only typing rejection, equal-value no-op, and destroy.
The lifecycle test records handle.view, selection, and undo availability before
and after setDiagnostics and operation-host updates.

- [ ] Step 2: Run the DOM tests and verify RED.

Run:

~~~text
npm test --prefix frontend/editor
node --test tests/ui/editor-core-contract.test.mjs
~~~

Expected: FAIL because the core module and test loader do not exist.

- [ ] Step 3: Implement the minimal CodeEditor module.

The module executes the local vendor module before reading
window.Z2MCodeMirrorVendor, creates one EditorView per mount, and uses
Compartment for read-only and diagnostics reconfiguration. Install line
numbers, active line/gutter, history, default/history/search/completion/fold
keymaps, tab indentation, autocomplete, lint gutter, bracket matching, fold
gutter, default syntax highlighting, and the scoped theme.

Use an update listener for onChange, onFocus, and onCursor. setValue compares
the full document first and dispatches nothing for equal text. A normal
replacement preserves history unless resetHistory is requested; resetHistory
uses a real history compartment effect, never destroy/recreate. preserveHistory
adds an internal transaction annotation for Visual synchronization.

Ctrl/Cmd+S must prevent the browser default and invoke onSave once. The handle
destroy method calls view.destroy and removes the mounted DOM/listeners.

If the vendor is unavailable, return a readable single textarea fallback with
full width, no overlay, the same onChange/onSave callbacks, and the exact
warning: Расширенный редактор недоступен; используется простой режим.

- [ ] Step 4: Add the scoped editor theme.

Define an EditorView.theme extension in z2m-code-editor.js and CSS for
.z2m-code-editor, .cm-editor, and .cm-scroller. Set width 100%, min-width 0,
height 100%, explicit panel/input background, border, radius, overflow auto,
the ui-monospace/SFMono-Regular/Menlo/Monaco/Consolas stack, 12–13px font size,
1.5–1.6 line height, and readable non-transparent text. Do not reuse generic
textarea hacks.

- [ ] Step 5: Run the core green gate and commit.

Run:

~~~text
npm test --prefix frontend/editor
node --test tests/ui/editor-core-contract.test.mjs
git diff --check
~~~

Commit:

~~~text
git add frontend/editor luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-code-editor.js luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css tests/ui/editor-core-contract.test.mjs
git commit -m "feat(editor): add reusable z2m code editor"
~~~

## Task 3: Lua and nfqws2 adapters without duplicated domain logic

Files:

- Create z2m-editor-lua.js, z2m-editor-nfqws2.js, and
  tests/ui/editor-nfqws2-contract.test.mjs.
- Modify z2m-nfqws2-ide.js only for precise adapter-facing positions and
  metadata.

Interfaces:

- LuaEditor.extensions() returns extensions from
  StreamLanguage.define(luaMode), with no custom tokenizer.
- Nfqws2Editor.create(options) returns extensions, completionSource, lintSource,
  contextAt, and helpAt.
- Completion items preserve descriptions, source, revision, and canonical
  asset reference metadata.

- [ ] Step 1: Add failing adapter tests.

Assert the adapter calls Nfqws2Ide.contextFor, suggestions, diagnostics, and
tokenHelp, and does not define knownNames/specFlags/vocabulary. Assert Lua uses
StreamLanguage.define and neither adapter uses overlay markup.

Add model tests for:

~~~text
--fil              -> --filter-tcp=
--filter-l7=       -> tls/quic/etc
--lua-desync=cir   -> circular
--lua-desync=circular:host -> hostkey=
--lua-desync=circular:hostkey= -> standard_hostkey and other existing values
--hostlist=        -> hostlist assets only
--ipset=           -> ipset assets only
--blob=            -> blob assets only
--lua-init=        -> Lua assets only
~~~

- [ ] Step 2: Run adapter tests and verify RED.

Run node --test tests/ui/editor-nfqws2-contract.test.mjs. Expected: FAIL
because adapter files and CodeMirror extension surfaces do not exist.

- [ ] Step 3: Implement Lua adapter.

Require z2m-code-editor.js and use CodeEditor.vendor indirectly:

~~~js
var vendor = CodeEditor.vendor;
var luaLanguage = vendor.StreamLanguage.define(vendor.luaMode);
return baseclass.extend({
  extensions: function () {
    return [luaLanguage, vendor.bracketMatching(), vendor.foldGutter()];
  }
});
~~~

Use only folding/comment support that the legacy mode actually provides. Do
not recreate tokenization or output HTML.

- [ ] Step 4: Implement nfqws2 adapter.

The completion source reads document text and cursor offset, calls
Nfqws2Ide.contextFor(text, pos), and converts existing suggestions to
CodeMirror label/apply/detail/info/type items using the existing token range.
The lint source maps existing start/end values to CodeMirror from/to ranges and
leaves message-only diagnostics unlocated. Cursor movement calls tokenHelp and
updates the owner Inspector callback without changing editor DOM.

Asset data enters through one setAssets(value) function and the existing
Nfqws2Ide resource path. Initial decorations may use viewport-aware CodeMirror
marks from Nfqws2Ide.tokenize; if positions are unavailable, keep completion
and diagnostics and omit that color.

- [ ] Step 5: Run Phase 2 gate and commit.

Run:

~~~text
node --test tests/ui/editor-nfqws2-contract.test.mjs tests/ui/strategy-ide-passpp.test.mjs
npm run build --prefix frontend/editor
git diff --check
~~~

Commit with message feat(strategies): add nfqws2 codemirror adapter.

## Task 4: Extract Strategy editor ownership and preserve lifecycle

Files:

- Create z2m-strategy-editor.js and tests/ui/editor-strategy-lifecycle.test.mjs.
- Modify z2m-strategies.js and z2m-ui.css.

Interfaces:

- StrategyEditor.create(ctx, state, hosts) owns profile UI, the active
  CodeMirror document, Visual/Code controls, Inspector, Problems, dirty state,
  focus/cursor, multi-profile document state, and destruction.
- z2m-strategies.js retains catalog/list/routing, learned state, healthcheck,
  clipboard, scanner, and RPC orchestration.
- renderAll and validation/preview result paths never replace a mounted editor
  host.

- [ ] Step 1: Add failing lifecycle tests.

Assert z2m-strategy-editor.js exists, z2m-strategies.js requires it, the owner
contains CodeEditor but no nfq-editor-overlay, NfqwsAutocomplete, or
textarea.profile-args, and the page still contains canonical strategies
validate/preview/create/update calls.

The DOM regression mounts a fixture, types abc, records view identity,
selection, and undo, runs validation/preview host updates, and asserts the same
view, selection, and undo remain.

- [ ] Step 2: Run lifecycle tests and verify RED.

Run node --test tests/ui/editor-strategy-lifecycle.test.mjs. Expected: FAIL
because the page still renders legacy overlay textareas.

- [ ] Step 3: Add stable Strategy editor hosts and owner module.

Move only editor responsibilities from z2m-strategies.js into
z2m-strategy-editor.js. The stable markup has fieldsHost, profilesHost,
actionsHost, validationHost, previewHost, inspectorHost, and problemsHost.
Mutate those hosts individually; never assign modal-body.innerHTML while a view
is mounted.

Mount one active profile with language nfqws2 and Nfqws2Editor extensions. Flush
the handle before mode/profile changes. Destroy on closeModal, unmount, actual
profile deletion, or an architectural host change.

- [ ] Step 4: Connect Code mode to profile.args.

On CodeMirror change set profile.args to handle.getValue(), parse with
Nfqws2Ide.parseProfile, update Visual only when structured/lossless, and set
raw-only safety text otherwise. Use an explicit syncSource guard or transaction
annotation so Visual transactions do not loop. No second text mirror is
allowed.

- [ ] Step 5: Delegate page actions without a big-bang rewrite.

Replace bindEditorIDE and direct textarea reads with the owner. Make
collectEditor call editor.flush and stable metadata fields. Route Validate,
Preview, Save, close, profile actions, scanner handoff, clipboard, and
duplicate through the owner while preserving existing payloads and RPC calls.
Keep Test unavailable when strategies.test is absent.

- [ ] Step 6: Run Strategy lifecycle gate and commit.

Run:

~~~text
node --test tests/ui/editor-strategy-lifecycle.test.mjs tests/ui/strategy-ide-workflow.test.mjs tests/ui/strategy-ide-ux-perf-hotfix.test.mjs tests/ui/p03-strategies-lifecycle-contract.test.mjs
npm test --prefix frontend/editor
git diff --check
~~~

Commit with message refactor(strategies): migrate code mode to editor platform.

## Task 5: Visual/Code, circular builder, Problems, Inspector, multi-profile

Files:

- Create tests/ui/editor-visual-sync.test.mjs.
- Modify z2m-strategy-editor.js, z2m-strategies.js,
  z2m-nfqws2-ide.js, and z2m-ui.css.

Interfaces:

- Visual changes call Nfqws2Ide.serializeProfile and
  CodeEditor.setValue(newArgs, { preserveHistory: true }).
- Code changes parse the same profile.args and update Visual only for
  structured/lossless data.
- Problems entries have source IDE or Backend, message, severity, optional
  from/to, and optional profileIndex. Missing positions are never fabricated.

- [ ] Step 1: Add failing lossless and synchronization tests.

Use a structured fixture with --filter-tcp=443 and assert Visual 443 to 8443
updates the CodeMirror document and Ctrl+Z restores 443. Assert an unknown
future flag keeps exact text, mode raw-only, Code editable, and Visual disabled.
Assert switching A to B and back preserves both profile documents and their
diagnostics.

- [ ] Step 2: Run tests and verify RED.

Run node --test tests/ui/editor-visual-sync.test.mjs. Expected: FAIL on the
missing owner integration and transaction behavior.

- [ ] Step 3: Implement canonical Visual/Code synchronization.

Implement applyVisualEdits(profile, edits): parse profile.args, refuse Visual
editing when not structured/lossless, serialize through Nfqws2Ide, assign only
profile.args, set syncSource to visual in try/finally, and call
setValue(next, { preserveHistory: true }). Equal text must not dispatch.
Circular builder add/remove uses this path and no second representation.

- [ ] Step 4: Implement backend diagnostic mapping and Problems.

Accept line, column, offset, path, and profile index only when returned by the
backend. Convert known locations to current document ranges. Message-only
results appear as Backend Problems with no invented coordinates. Merge IDE
Nfqws2Ide diagnostics with Backend results and render only the stable Problems
host. Clicking a located item focuses the correct profile and selects its range.

- [ ] Step 5: Implement Inspector and profile switching.

Cursor movement calls Nfqws2Ide.tokenHelp and updates only Inspector. Switching
profiles flushes current text, stores selection/scroll keyed by profile id,
changes the active document through one handle transaction, and restores state.
Destroy only when deleting the active profile or closing the host.

- [ ] Step 6: Run gate and commit.

Run:

~~~text
node --test tests/ui/editor-visual-sync.test.mjs tests/ui/strategy-ide-passpp.test.mjs tests/ui/strategy-ide-workflow.test.mjs
npm test --prefix frontend/editor
git diff --check
~~~

Commit with message feat(strategies): sync visual and code profile editing.

## Task 6: Stable Resource workspace and Lua migration

Files:

- Create tests/ui/editor-resources-contract.test.mjs.
- Modify z2m-assets.js, z2m-ui.css, and only then z2m-asset-tooling.js.
- Modify old highlight tests only after their consumer is removed.

Interfaces:

- workspace returns stable headerHost, tabsHost, paneHost, editorHost,
  validationHost, and actionsHost.
- CodeEditor mounts once when a textual resource opens and destroys on close or
  final asset change.
- lua, hostlist, ipset, and hosts use CodeEditor; blob, geosite, and geoip keep
  specialized binary/view/generator flows.
- Save remains assets.validateContent then assets.update with expectedRevision;
  Ctrl/Cmd+S invokes the same save function.

- [ ] Step 1: Add failing Resource/Lua tests.

Assert the stable host names, CodeEditor and LuaEditor usage, textual/binary
split, existing validation/update calls, and absence of
z2m-lua-editor-overlay/manual gutter/transparent text after migration.

- [ ] Step 2: Run Resource tests and verify RED.

Run node --test tests/ui/editor-resources-contract.test.mjs
tests/ui/resources-update-center.test.mjs. Expected: FAIL because luaEditor
and whole-pane replacement still exist.

- [ ] Step 3: Refactor workspace into stable hosts.

Create the shell once, append separate header/tabs/pane/editor/validation/action
hosts, and replace paint with targeted update functions. Tab changes and
validation mutate siblings; no post-mount replaceChildren call may contain
editorHost.

- [ ] Step 4: Migrate Lua and text assets.

Lua mounts language lua with LuaEditor.extensions. Other textual types mount
plain language. Package-owned content is readOnly but still selectable,
searchable, foldable, and scrollable. Keep state.content synchronized through
onChange. Map line-based assets.validateContent diagnostics to
CodeEditor.setDiagnostics and aggregate errors to validationHost. Save reads
the current handle and runs existing canonical RPCs without remounting.

- [ ] Step 5: Remove old Lua editor after consumer audit.

Run:

~~~text
rg -n "highlightLua|luaEditor|z2m-lua-editor-overlay|z2m-lua-editor-gutter|nfq-editor-overlay|transparent|text-fill-color|lua-(comment|string|num|kw|builtin|func|op)" luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager tests
~~~

Delete luaEditor, old Lua CSS, and Tooling.highlightLua exports/tests only
when no runtime consumer remains. Keep all Nfqws2Ide domain functions used by
the new adapter.

- [ ] Step 6: Run Lua/Resource gate and commit.

Run:

~~~text
node --test tests/ui/editor-resources-contract.test.mjs tests/ui/resources-update-center.test.mjs tests/ui/z2m-asset-tooling.test.mjs tests/product/resource-center-tooling.test.mjs
npm test --prefix frontend/editor
git diff --check
~~~

Commit with message feat(resources): migrate lua editor to codemirror.

## Task 7: Text-resource completeness, CSS cleanup, and responsive contracts

Files:

- Create tests/ui/editor-responsive-contract.test.mjs.
- Modify z2m-assets.js, z2m-strategy-editor.js, and z2m-ui.css.

- [ ] Step 1: Add failing text-resource/responsive tests.

Assert all four textual types call CodeEditor.mount, the editor has
min-width:0, and a breakpoint exists for the approximately 800px Strategy
layout.

- [ ] Step 2: Run the test and verify RED.

Run node --test tests/ui/editor-responsive-contract.test.mjs. Expected: FAIL
until text-resource mounts and responsive rules are complete.

- [ ] Step 3: Finish text-resource paths and responsive CSS.

Ensure quick-add, sort/dedupe, URL import, ASN import, validation, package
read-only content, duplicate, and save mutate state/handle without repainting
its host. Keep the desktop Profiles | Editor | Inspector layout and move the
Inspector below/collapsible at narrow width; never force three narrow columns.

- [ ] Step 4: Run Phase 6 gate and commit.

Run:

~~~text
node --test tests/ui/editor-responsive-contract.test.mjs tests/ui/resources-update-center.test.mjs tests/ui/strategy-ide-workflow.test.mjs
git diff --check
~~~

Commit with message feat(resources): use editor platform for text assets.

## Task 8: Cleanup, closure, and final verification

Files:

- Modify p03-full-feature-contract.test.mjs to assert new ownership and
  absence of replaced overlay code.
- Modify frontend-module-closure.test.mjs to include vendor asset existence
  without treating bundle internals as LuCI require modules.
- Remove textarea popup/markup helpers from z2m-nfqws2-ide.js only after all
  consumers are gone.
- Create .superpowers/sdd/2026-08-27-z2m-editor-platform.md.

- [ ] Step 1: Run the complete legacy-consumer audit.

Run:

~~~text
rg -n "highlightLua|luaEditor|z2m-lua-editor-overlay|z2m-lua-editor-gutter|manual overlay|nfq-editor-overlay|NfqwsAutocomplete|nfq-ac-popup|profile-args-ta|text-fill-color|lua-(comment|string|num|kw|builtin|func|op)" luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager tests
~~~

Classify each match as an intentional domain helper, a new test assertion, or
dead legacy editor code. Delete only the last category. Keep
Nfqws2Ide.parseProfile, serializeProfile, contextFor, suggestions, diagnostics,
and token-help APIs used by adapters.

- [ ] Step 2: Verify final dependency closure and package install.

Run the closure test recursively for vendor asset existence, verify new modules
are reachable through app.js, verify Makefile copies vendor, and verify no npm
command appears in Build/Compile.

- [ ] Step 3: Run focused and full host tests.

Run:

~~~text
npm ci --prefix frontend/editor
npm run check --prefix frontend/editor
npm test --prefix frontend/editor
node --test tests/ui/editor-vendor-contract.test.mjs tests/ui/editor-core-contract.test.mjs tests/ui/editor-nfqws2-contract.test.mjs tests/ui/editor-strategy-lifecycle.test.mjs tests/ui/editor-visual-sync.test.mjs tests/ui/editor-resources-contract.test.mjs tests/ui/editor-responsive-contract.test.mjs
node --test tests/ui/strategy-ide-*.test.mjs tests/ui/p03-*.test.mjs tests/ui/resources-update-center.test.mjs tests/ui/frontend-module-closure.test.mjs tests/ui/luci-install-regression.test.mjs
~~~

Record exact pass/fail counts. Do not call documented baseline failures
regressions unless this branch introduced them.

- [ ] Step 4: Run repository verification.

Run:

~~~text
node scripts/validate-knowledge.mjs
node scripts/docs.mjs verify
node scripts/docs.mjs build internal
node scripts/docs.mjs build public --production
node --test tests/knowledge/public-leak.test.mjs
git diff --check
git diff --find-renames
git status --short --branch
~~~

The known baseline validator error at
docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md must be reported if it
remains; do not modify that unrelated file.

- [ ] Step 5: Perform bounded real LuCI acceptance if available.

At /admin/services/zapret2-manager check Lua open/CM/no overlay/syntax/lines/
typing/selection/Ctrl+F/Ctrl+Z/Ctrl+S/Validate/Save-copy; Strategy Code/
completion/Inspector/Visual-Code/circular/Validate/Preview/Save and cursor/
undo preservation; and widths 1280px and approximately 800px. If browser or
router access is unavailable, mark real LuCI/router acceptance NOT_RUN.

- [ ] Step 6: Write the evidence report after the final commit.

The internal report must state the branch, commit hash from git rev-parse
HEAD, exact created and modified files, removed legacy pieces, unminified and
minified vendor byte counts, exact package/version list from package-lock,
preserved Strategy features, exact Nfqws2Ide adapter calls, focused/full
commands and counts, real LuCI evidence boundary, and explicit unverified
areas. It must contain no credentials or tokens.

Commit only the report:

~~~text
git add .superpowers/sdd/2026-08-27-z2m-editor-platform.md
git commit -m "docs(editor): record CodeMirror migration evidence"
~~~

Before the final response inspect git diff --find-renames origin/main...HEAD,
confirm the worktree status, and do not claim architecture success when real
LuCI acceptance was not run.
