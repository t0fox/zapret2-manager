import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('P02-V5 lifecycle buttons share one structural icon-slot component', () => {
  assert.match(page, /control-button-icon-slot/);
  assert.match(page, /control-button-label/);
  assert.match(page, /item\.pending \? E\('span', \{ 'class': 'spinner spinner-inline' \}\) : icon/);
  assert.match(page, /'aria-label': item\.pending \? item\.pendingLabel : item\.label/);
});

test('P02-V5 process control removes the inner divider and normalizes geometry', () => {
  assert.match(css, /#control-process-card \.card-title\{[^}]*padding:14px 18px 6px[^}]*border-bottom:0/);
  assert.match(css, /\.control-buttons\{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 18px 18px/);
  assert.match(css, /\.control-buttons \.btn-lg\{display:inline-flex;align-items:center;justify-content:center;gap:var\(--icon-gap\)[^}]*height:40px/);
  assert.match(css, /\.control-button-icon-slot\{display:inline-flex;align-items:center;justify-content:center;width:var\(--icon-md\);height:var\(--icon-md\);flex:0 0 var\(--icon-md\)/);
  assert.match(css, /\.control-button-label\{display:inline-flex;align-items:center;line-height:1\.2;white-space:nowrap\}/);
});
