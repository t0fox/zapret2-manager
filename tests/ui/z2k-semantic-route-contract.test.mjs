import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const page = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');

test('Resources uses backend semantic kind while preserving storage type for technical details', () => {
  assert.match(page, /function semanticType\(asset\)/);
  assert.match(page, /semanticType\(asset\)/,
    'resource rows must use backend semantic classification');
  assert.match(page, /asset\.semanticKind \|\| asset\.type/,
    'semantic kind must come from backend projection, not path or id inference');
  assert.match(page, /Тип хранения/,
    'storage type remains visible as technical detail');
  assert.doesNotMatch(page, /routeParams|assetTypeForRoute/);
});
