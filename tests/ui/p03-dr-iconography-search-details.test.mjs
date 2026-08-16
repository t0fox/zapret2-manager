import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = fs.readFileSync(path.join(here, '../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js'), 'utf8');
const css = fs.readFileSync(path.join(here, '../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('P03-DR uses one inline SVG icon helper for donor interaction affordances', () => {
  assert.match(js, /var STRATEGY_ICONS = \{/);
  assert.match(js, /viewBox="0 0 24 24" width="/);
  for (const name of ['clipboard', 'plus', 'bug', 'file', 'play', 'settings', 'refresh', 'trash', 'search', 'star', 'chevronDown', 'terminal', 'copy', 'merge', 'x']) {
    assert.match(js, new RegExp(`${name}:`));
  }
  assert.doesNotMatch(js, /label: '⟳|>☆<|>★<|>⌕<|<span>⌄<\/span>/);
});

test('P03-DR Details is an inline multi-card state with accessible active control', () => {
  assert.match(js, /data-list-ui-toggle type="button" aria-expanded="false"/);
  assert.match(js, /aria-controls="strategy-details-/);
  assert.match(js, /card\.classList\.toggle\('expanded'\)/);
  assert.match(js, /toggle\.setAttribute\('aria-expanded', expanded \? 'true' : 'false'\)/);
  assert.match(js, /toggle\.classList\.toggle\('active', expanded\)/);
  assert.match(js, /strategy-card-toggle-label/);
  assert.match(js, /highlightStrategyArgs/);
  assert.match(css, /strategy-card\.expanded \.strategy-card-toggle \.z2m-icon\{transform:rotate\(180deg\)\}/);
});

test('P03-DR search count and filters keep canonical data semantics', () => {
  assert.match(js, /list-ui-toolbar-right/);
  assert.match(js, /searchPlaceholder: 'Поиск по имени, автору, описанию, args\.\.\.'/);
  assert.match(js, /var isFiltered = !!search/);
  assert.match(js, /extension: true/);
  assert.match(css, /list-ui-search\{flex:0 1 52%/);
  assert.match(css, /list-ui-filter\.active\{background:var\(--blue\)/);
  assert.match(css, /list-ui-group-header\{width:100%/);
});
