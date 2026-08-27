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

test('CodeMirror vendor is a LuCI-loadable baseclass module', () => {
  const bundle = read(path.join(view, 'vendor/z2m-codemirror.js'));
  let extended = false;
  const moduleClass = Function('baseclass', bundle)({
    extend: value => {
      extended = true;
      function VendorModule() {}
      Object.assign(VendorModule.prototype, value);
      return VendorModule;
    },
  });

  assert.equal(extended, true);
  assert.equal(typeof moduleClass, 'function');
  assert.ok(globalThis.Z2MCodeMirrorVendor.EditorView);
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
