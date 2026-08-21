import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');

test('Components layout has a two-column desktop grid and one-column narrow fallback', () => {
  assert.match(css, /\.z2m-components-grid\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*\.z2m-components-grid\{grid-template-columns:1fr\}/);
  assert.match(css, /\.z2m-component-card/);
  assert.match(css, /\.z2m-engine-management/);
  assert.match(css, /\.z2m-components-page \.z2m-engine-pane \.z2m-panel>\.hd\{display:grid/);
  assert.match(css, /\.z2m-components-page \.z2m-engine-pane \.z2m-proxy-kv>div\{align-items:baseline/);
  assert.match(css, /\.z2m-components-page \.z2m-engine-pane \.z2m-proxy-kv span\{flex:0 1 38%/);
  assert.match(css, /\.z2m-components-page \.z2m-engine-pane \.z2m-proxy-kv>div\{align-items:flex-start;flex-direction:column/);
  assert.match(css, /\.z2m-components-page \.z2m-engine-hero,\.z2m-components-page \.z2m-engine-source\{display:grid/);
  assert.match(css, /\.z2m-components-page \.z2m-setting-row\{display:flex/);
});
