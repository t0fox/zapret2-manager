import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const source = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');

test('asset import controls have stable names and non-autofill metadata', () => {
  assert.match(source, /E\('select',\s*\{[^}]*name:\s*'asset-type'[^}]*autocomplete:\s*'off'/s);
  assert.match(source, /E\('input',\s*\{[^}]*name:\s*'asset-id'[^}]*autocomplete:\s*'off'[^}]*autocapitalize:\s*'none'[^}]*spellcheck:\s*'false'/s);
  assert.match(source, /E\('textarea',\s*\{[^}]*name:\s*'asset-content'[^}]*autocomplete:\s*'off'[^}]*spellcheck:\s*'false'/s);
});
