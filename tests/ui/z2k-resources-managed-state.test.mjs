import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
const assets = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
const sourceRefresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const strategySources = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const candidates = ['\n  function ', '\nfunction ']
    .map(prefix => source.indexOf(prefix, start + 10))
    .filter(index => index >= 0);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return source.slice(start, next < 0 ? source.length : next);
}

test('Z2K Resources is visibly Core-managed and has no independent group/source mutation affordance', () => {
  const group = sliceFunction(assets, 'renderGroupCard');
  const source = sliceFunction(assets, 'renderStrategySource');

  assert.match(model, /if \(src\.id === 'z2k-resources'\) group\.managedBy = 'Z2K Core'/);
  assert.match(group, /Управляется Z2K Core/);
  assert.doesNotMatch(source, /sourceSetEnabled/);
  assert.match(source, /var managed = card\.id === 'z2k'/);
  assert.match(source, /managed\s*\? \[E\('span'/);
  assert.doesNotMatch(source, /sourceRefresh\(card\.id\)/);
});

test('bulk source refresh keeps a stale Avatar candidate but excludes the Core-managed Z2K source', () => {
  const bulk = sliceFunction(assets, 'renderStrategySources');

  assert.match(model, /bulkRefreshCandidates/);
  assert.match(bulk, /bulkRefreshCandidates/);
  assert.match(bulk, /sourceRefresh\(card\.id\)/);
  assert.doesNotMatch(bulk, /catalogRefreshStart/);
  assert.match(bulk, /Обновить все/);
});

test('independent Z2K refresh is rejected by the canonical owner boundary', () => {
  assert.match(sourceRefresh, /code: 'EMANAGED'/);
  assert.match(sourceRefresh, /owner: 'z2k-core'/);
  assert.match(strategySources, /code: 'EMANAGED'/);
  assert.match(strategySources, /owner: 'z2k-core'/);
});
