import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const viewRoot = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager',
);
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('text resources share a measurable CodeMirror host and Strategy collapses Inspector on narrow screens', () => {
  const assets = read('z2m-assets.js');
  const owner = read('z2m-strategy-editor.js');
  const css = read('z2m-ui.css');
  for (const type of ['lua', 'hostlist', 'ipset', 'hosts']) assert.match(assets, new RegExp(type), type);
  assert.match(assets, /textAsset = \['lua', 'hostlist', 'ipset', 'hosts'\]/);
  assert.match(assets, /CodeEditor\.mount\(editorHost/);
  assert.match(assets, /data-editor-host.*editorHost/);
  assert.match(assets, /assets\.validateContent/);
  assert.match(assets, /assets\.update/);
  assert.match(owner, /hosts\.editorHost/);
  assert.match(owner, /hosts\.inspectorHost/);
  assert.match(css, /\.z2m-asset-editor-host[^}]*min-width\s*:\s*0/);
  assert.match(css, /\.z2m-code-editor[^}]*min-width\s*:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*(?:800|820|900)px\)/);
  assert.match(css, /\.strat-editor-layout\s*\{[^}]*grid-template-columns\s*:\s*1fr/);
});

test('text asset edit path has no specialized textarea branch', () => {
  const assets = read('z2m-assets.js');
  assert.match(assets, /if \(!textAsset && asset\.type === 'blob'\)/);
  assert.doesNotMatch(assets, /if \(asset\.type === 'lua'\)[\s\S]{0,400}textarea/);
});
