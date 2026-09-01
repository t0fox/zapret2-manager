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

test('source labels stay orthogonal to the true builtin flag', () => {
  const model = loadModel();
  const z2k = model.normalize({ id: 'z2k:rkn_tcp_strat_1', sourceId: 'z2k', origin: 'z2k_builtin', is_builtin: false, profiles: [] });
  const avatar = model.normalize({ id: 'avatar:catalog-entry', sourceId: 'avatar', origin: 'avatar_builtin', is_builtin: false, profiles: [] });
  const builtin = model.normalize({ id: 'builtin:local', sourceId: 'builtin', origin: 'builtin', is_builtin: true, profiles: [] });
  assert.equal(z2k.sourceId, 'z2k');
  assert.equal(z2k.isBuiltin, false);
  assert.equal(avatar.sourceId, 'avatar');
  assert.equal(avatar.isBuiltin, false);
  assert.equal(builtin.isBuiltin, true);
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
  assert.match(page, /strategy-filters-surface/);
  assert.match(page, /strategy-filter-label.*Источник/);
  assert.match(page, /Все источники/);
  assert.match(page, /filterLabel: 'Тип стратегии'/);
  assert.match(page, /Все типы/);
  assert.match(page, /strategy\.origin === 'user'/);
  assert.doesNotMatch(page, /test: function \(strategy\) \{ return !strategy\.isBuiltin; \}/);
  assert.match(page, /strategy_data: transient/);
  assert.match(page, /composition: 'discord'/);
  assert.doesNotMatch(page, /call\(api\.create/);
  assert.doesNotMatch(page, /call\(api\.delete/);
  assert.match(page, /Array\.isArray\(value\)/);
  assert.match(page, /function strategySourceId/);
  assert.match(page, /function discordDonorSourceFilter\(strategy\)/);
  assert.match(page, /sourceFilter: discordDonorSourceFilter\(source\)/);
  assert.match(page, /var groups = \{}, groupTotals = \{\}/);
  assert.match(page, /groupTotals\[id\] = \(groupTotals\[id\] \|\| 0\) \+ 1/);
  assert.match(model, /canonicalId/);
  assert.match(model, /sourceId/);
  assert.doesNotMatch(page, /sourceFilter.*strategies\.apply/);
});

test('Discord donor discovery keeps the UI request open for bounded native checks', () => {
  const api = read('z2m-api.js');
  assert.match(api, /strategiesDiscordDonor:rpc\.declare\(\{[^}]*timeout:\s*120/);
});
