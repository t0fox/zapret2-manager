import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('P03-V2 keeps the clear control inside the search field and hides it when empty', () => {
  const page = read('z2m-strategies.js');
  const css = read('z2m-ui.css');
  assert.match(page, /<div class="list-ui-search">[\s\S]*list-ui-search-input[\s\S]*list-ui-search-clear/);
  assert.match(page, /clear\.style\.display\s*=\s*search\s*\?\s*''\s*:\s*'none'/);
  assert.match(css, /\.z2m-view#z2m-view-strategy \.list-ui-search-input[^\n]*padding-right/);
  assert.match(css, /\.z2m-view#z2m-view-strategy \.list-ui-search-clear[^\n]*position:absolute/);
});

test('P03-V2 removes raw catalog digest from the primary summary', () => {
  const page = read('z2m-strategies.js');
  assert.doesNotMatch(page, /value\.digest\s*\?\s*value\.digest\.slice\(0,\s*12\)/);
  assert.match(page, /counts\.files/);
  assert.match(page, /counts\.uniqueStrategies/);
  assert.match(page, /value\.ok\s*===\s*true/);
});

test('P03-V2 uses one cohesive active/card surface', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /\.z2m-view#z2m-view-strategy \.active-strategy-card \.card-title[^\n]*border-bottom:0/);
  assert.match(css, /\.z2m-view#z2m-view-strategy \.strategy-card-actions[^\n]*background:transparent/);
  assert.match(css, /\.z2m-view#z2m-view-strategy \.list-ui-group-header[^\n]*border:1px solid/);
});

test('P03-V2 puts search and result count on one donor-like desktop row', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /\.z2m-view#z2m-view-strategy \.list-ui-toolbar[^\n]*flex-direction:row/);
  assert.match(css, /\.z2m-view#z2m-view-strategy \.list-ui-count[^\n]*flex:0 0 auto/);
});
