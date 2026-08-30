import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const assets = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');
const uiCss = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('managed resource grouping uses a neutral border unless an update is available', () => {
  assert.match(assets, /'data-resource-state': sectionState/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--managed\{[^}]*border-color:var\(--border\)/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--managed\[data-resource-state="update-available"\]\{[^}]*border-color:rgba\(224,163,59/);
  assert.doesNotMatch(uiCss, /#z2m-view-assets \.z2m-resource-section--managed\{[^}]*rgba\(224,163,59/);
});
