import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadModel() {
  const source = read('z2m-strategies-model.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  });
}

test('strategy source identity is canonical and survives normalization', () => {
  const model = loadModel();
  assert.equal(model.sourceId({ id: 'z2k:z2k_all_in_one' }), 'z2k');
  assert.equal(model.sourceId({ id: 'avatar:recommended', sourceId: 'avatar' }), 'avatar');
  assert.equal(model.sourceId({ id: 'custom:discord', origin: 'user', isBuiltin: false }), 'user');
  const normalized = model.normalize({ id: 'z2k:manual_autocircular_rkn', sourceId: 'z2k', name: 'RKN', profiles: [] });
  assert.equal(normalized.sourceId, 'z2k');
  assert.equal(normalized.canonicalId, 'z2k:manual_autocircular_rkn');
});

test('Strategies exposes independent source filters and source badges without changing operation IDs', () => {
  const page = read('z2m-strategies.js');
  const model = read('z2m-strategies-model.js');
  assert.match(page, /sourceFilter/);
  assert.match(page, /Все/);
  assert.match(page, /Avatar/);
  assert.match(page, /Z2K/);
  assert.match(page, /Пользовательские/);
  assert.match(page, /data-strategy-source/);
  assert.match(page, /strategy\.id/);
  assert.match(model, /canonicalId/);
  assert.match(model, /sourceId/);
  assert.doesNotMatch(page, /sourceFilter.*strategies\.apply/);
});
