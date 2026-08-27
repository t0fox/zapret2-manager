import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const editorPath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-code-editor.js',
);
const read = file => fs.readFileSync(file, 'utf8');

test('generic CodeEditor owns CodeMirror lifecycle and has no overlay editor', () => {
  const source = read(editorPath);
  for (const marker of [
    'mount', 'getValue', 'setValue', 'setReadOnly', 'setDiagnostics',
    'focus', 'getSelection', 'destroy', 'EditorView', 'Compartment',
  ]) assert.match(source, new RegExp(marker), marker);
  assert.doesNotMatch(source, /transparent|text-fill-color|innerHTML\s*=.*value/i);
});
