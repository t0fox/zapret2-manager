import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const pagePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');

test('Strategies keeps Пользовательские only on the source axis', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /sourceFilterLabel\(id\)[\s\S]*Пользовательские/);
  assert.doesNotMatch(page, /\{ id: 'user', label: 'Пользовательские'/);
});
