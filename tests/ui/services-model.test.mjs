import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-services-model.js`);

const catalog = {
  services: [
    { id: 'alpha', label: 'Alpha', category: 'video', domainCount: 2 },
    { id: 'beta', label: 'Beta', category: 'video', domainCount: 4 },
    { id: 'gamma', label: 'Gamma', category: 'chat', domainCount: 1 }
  ],
  categories: [{ id: 'video', label: 'Video' }, { id: 'chat', label: 'Chat' }],
  modes: [{ id: 'services', label: 'By services' }, { id: 'hosts', label: 'Hosts' }],
  activeMode: 'services', revision: 'r1'
};

test('catalog normalizes only backend records and preserves mode metadata', () => {
  const result = model.catalog(catalog, {
    ledger: { revision: 0, enabled: ['alpha'] }, activeMode: 'hosts'
  });
  assert.deepEqual(result.services.map((service) => service.id), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(result.categories.map((category) => category.id), ['video', 'chat']);
  assert.deepEqual(result.modes, catalog.modes);
  assert.equal(result.activeMode, 'hosts');
  assert.equal(result.revision, 0);
  assert.equal(result.services.some((service) => service.id === 'demo'), false);
});

test('selectors share draft-aware visible rows, counts, and KPIs', () => {
  const result = model.selectors(catalog.services,
    { alpha: true, beta: false, gamma: true },
    { changes: { beta: { before: false, after: true } } },
    '', 'all', 'all');
  assert.deepEqual(result.counts, { all: 3, on: 3, off: 0, changed: 1 });
  assert.deepEqual(result.kpis, { total: 3, enabled: 3, changed: 1 });
  assert.deepEqual(result.visible.map((service) => [service.id, service.enabled, service.changed]), [
    ['alpha', true, false], ['beta', true, true], ['gamma', true, false]
  ]);
});

test('selectors apply query, state, and category filters to the same data', () => {
  const result = model.selectors(catalog.services,
    { alpha: true, beta: false, gamma: true }, {}, 'a', 'off', 'video');
  assert.deepEqual(result.visible.map((service) => service.id), ['beta']);
  assert.equal(result.counts.all, 3);
  assert.equal(result.kpis.enabled, 2);
});

test('category state reports off, on, and mixed with counts', () => {
  const video = catalog.services.filter((service) => service.category === 'video');
  assert.deepEqual(model.categoryState(video, {}), {
    state: 'off', enabled: 0, total: 2
  });
  assert.deepEqual(model.categoryState(video, { alpha: true, beta: true }), {
    state: 'on', enabled: 2, total: 2
  });
  assert.deepEqual(model.categoryState(video, { alpha: true }), {
    state: 'mixed', enabled: 1, total: 2
  });
});

test('category toggles use mixed to on and on to off for every category service', () => {
  assert.deepEqual(model.toggleCategory(catalog.services, { alpha: true, beta: false }, 'video'), {
    alpha: true, beta: true
  });
  assert.deepEqual(model.toggleCategory(catalog.services, { alpha: true, beta: true }, 'video'), {
    alpha: false, beta: false
  });
});

test('bulk all and none ignore search visibility and individual overrides are deterministic', () => {
  const enabled = model.toggleAll(catalog.services, { alpha: false, stale: true }, true);
  enabled.gamma = false;
  assert.deepEqual(enabled, { alpha: true, beta: true, gamma: false });
  assert.deepEqual(model.toggleAll(catalog.services, enabled, false), {
    alpha: false, beta: false, gamma: false
  });
});

test('changes returns only service IDs whose enabled value differs from baseline', () => {
  assert.deepEqual(model.changes(catalog.services,
    { alpha: true, beta: false, gamma: true },
    { alpha: true, beta: true, gamma: false }), {
    beta: { before: false, after: true },
    gamma: { before: true, after: false }
  });
});
