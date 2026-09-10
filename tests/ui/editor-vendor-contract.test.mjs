import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const view = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = file => fs.readFileSync(file, 'utf8');

test('shipped CodeMirror vendor and package copy contract are present', () => {
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
  const makefile = read(path.join(root, 'zapret2-manager-full/Makefile'));
  assert.match(makefile, /luci-files/);
  assert.match(makefile, /\/www\/luci-static\/resources\/view\/zapret2-manager/);
  assert.match(makefile, /find[^\n]*luci-static\/resources\/view\/zapret2-manager/);
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
