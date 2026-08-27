import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const assetsPath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js',
);
const read = () => fs.readFileSync(assetsPath, 'utf8');

test('Resource workspace uses stable editor hosts and CodeMirror text lifecycle', () => {
  const source = read();
  assert.match(source, /z2m-code-editor as CodeEditor/);
  assert.match(source, /z2m-editor-lua as LuaEditor/);
  for (const host of ['headerHost', 'tabsHost', 'paneHost', 'editorHost', 'validationHost', 'actionsHost']) {
    assert.ok(source.includes(host), host);
  }
  for (const type of ['lua', 'hostlist', 'ipset', 'hosts']) assert.ok(source.includes(type), type);
  assert.match(source, /CodeEditor\.mount/);
  assert.match(source, /LuaEditor\.extensions/);
  assert.match(source, /assets\.validateContent/);
  assert.match(source, /assets\.update/);
  for (const legacy of [
    'function luaEditor',
    'z2m-lua-editor-overlay',
    'z2m-lua-editor-gutter',
    'z2m-lua-editor-input',
    'manual overlay',
    'text-fill-color',
  ]) assert.doesNotMatch(source, new RegExp(legacy, 'i'), legacy);
});

test('binary resources retain specialized view/generator branches', () => {
  const source = read();
  for (const marker of ['bytesToHex', 'hexRows', 'generatorPane', 'Generate preview', 'saveGenerated']) {
    assert.ok(source.includes(marker), marker);
  }
});
