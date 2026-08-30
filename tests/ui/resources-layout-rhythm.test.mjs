import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const uiCss = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('Resources applies the vertical rhythm to its root view', () => {
  assert.match(uiCss, /#z2m-view-assets\.z2m-resource-center\{display:grid;gap:16px/);
  assert.doesNotMatch(uiCss, /#z2m-view-assets \.z2m-resource-center\{display:grid;gap:16px/);
});
