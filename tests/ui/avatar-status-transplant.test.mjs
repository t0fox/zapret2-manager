import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('status cards retain the frozen donor DOM/icon structure through a Z2M adapter', () => {
  assert.match(page, /DONOR TRANSPLANT: web\/js\/pages\/dashboard\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(page, /function donorStatusIcon/);
  assert.match(page, /E\('svg'/);
  assert.match(page, /status-card-header/);
  assert.match(page, /status-card-icon/);
  assert.match(page, /status-dot/);
  assert.match(page, /id: 'nfqws-dot'/);
});

test('core status card order and responsive donor selectors remain explicit', () => {
  const order = ['card-nfqws', 'card-strategy', 'card-autostart', 'card-system', 'card-zapret-ver'];
  let previous = -1;
  for (const marker of order) {
    const current = page.indexOf(marker, previous + 1);
    assert.ok(current > previous, `status card order missing: ${marker}`);
    previous = current;
  }
  assert.match(css, /status-card-header/);
  assert.match(css, /@media\s*\(max-width:480px\)[\s\S]*status-grid/);
  assert.doesNotMatch(page, /\/api\//);
});
