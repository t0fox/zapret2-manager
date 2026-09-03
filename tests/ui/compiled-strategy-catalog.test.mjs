import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const page = fs.readFileSync(path.join(viewRoot, 'z2m-strategies.js'), 'utf8');
const styles = fs.readFileSync(path.join(viewRoot, 'z2m-ui.css'), 'utf8');

test('Strategies presents the compiled catalog as explicit source-owned pools', () => {
  assert.match(page, /Compiled Strategy Catalog/);
  assert.match(page, /compiledCatalogStats/);
  assert.match(page, /data-catalog-source="avatar"/);
  assert.match(page, /data-catalog-source="z2k"/);
  assert.match(page, /data-catalog-source="user"/);
  assert.match(page, /All-in-One \+ .*standalone top-level profiles/);
  assert.match(page, /Legacy numeric strategy IDs/);
  assert.doesNotMatch(page, /strategy=\d+/i);
});

test('Compiled catalog remains compact, grouped, and responsive', () => {
  assert.match(styles, /compiled-catalog-grid/);
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /compiled-catalog-source/);
});
