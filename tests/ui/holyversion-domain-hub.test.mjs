import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-domain-hub-model.js`);

const snapshot = {
  revision: 'rev-1',
  catalog: {
    digest: 'a'.repeat(64),
    enabled: ['video-a'],
    packages: [
      { id: 'video-a', name: 'Video A', category: 'video', domainCount: 3 },
      { id: 'video-b', name: 'Video B', category: 'video', domainCount: 2 },
      { id: 'chat-a', name: 'Chat A', category: 'chat', domainCount: 4 }
    ],
    categories: ['video', 'chat']
  },
  userDomains: {
    include: ['custom.example'],
    exclude: ['blocked.example'],
    conflicts: []
  },
  autohost: {
    entries: ['learned.example', 'noise.example'],
    counts: { total: 2 },
    writable: false
  },
  sources: {
    items: [], schedule: null, lastBuild: null,
    writable: false, reason: 'owner unavailable'
  }
};

test('normalization preserves only backend records and four hub tabs', () => {
  const state = model.normalize(snapshot);
  assert.deepEqual(state.tabs, ['catalog', 'domains', 'autohost', 'sources']);
  assert.deepEqual(state.packages.map((item) => item.id), ['video-a', 'video-b', 'chat-a']);
  assert.equal(state.packages.some((item) => item.id === 'demo'), false);
});

test('category state reports on off and mixed', () => {
  const state = model.normalize(snapshot);
  const video = state.packages.filter((item) => item.category === 'video');
  assert.equal(model.categoryState(video, ['video-a']).state, 'mixed');
  assert.equal(model.categoryState(video, ['video-a', 'video-b']).state, 'on');
  assert.equal(model.categoryState(video, []).state, 'off');
});

test('bulk package action ignores search visibility', () => {
  const state = model.normalize(snapshot);
  const visible = model.selectPackages(state, 'chat', 'all', 'all');
  assert.deepEqual(visible.map((item) => item.id), ['chat-a']);
  assert.deepEqual(model.toggleAll(state.packages, state.enabled, true), ['chat-a', 'video-a', 'video-b']);
});

test('category toggle applies to every package in category', () => {
  const state = model.normalize(snapshot);
  assert.deepEqual(model.toggleCategory(state.packages, ['video-a'], 'video'), ['video-a', 'video-b']);
  assert.deepEqual(model.toggleCategory(state.packages, ['video-a', 'video-b'], 'video'), []);
});

test('domain draft normalizes exact include exclude identity and conflicts', () => {
  const state = model.normalize(snapshot);
  const next = model.setDomains(state, ['Custom.Example', '.new.example'], ['blocked.example']);
  assert.deepEqual(next.include, ['custom.example', 'new.example']);
  assert.deepEqual(next.exclude, ['blocked.example']);
  assert.deepEqual(next.conflicts, []);

  const conflict = model.setDomains(state, ['same.example'], ['same.example']);
  assert.deepEqual(conflict.conflicts, ['same.example']);
});

test('autohost promote and ignore stage semantic operations', () => {
  const state = model.normalize(snapshot);
  const promoted = model.promoteAutohost(state, 'learned.example');
  assert.deepEqual(promoted.userDomains.include, ['custom.example', 'learned.example']);
  assert.deepEqual(promoted.autohostOps.promote, ['learned.example']);

  const ignored = model.ignoreAutohost(state, 'noise.example');
  assert.deepEqual(ignored.userDomains.exclude, ['blocked.example', 'noise.example']);
  assert.deepEqual(ignored.autohostOps.ignore, ['noise.example']);
});

test('source operations remain blocked when backend owner is unavailable', () => {
  const state = model.normalize(snapshot);
  const result = model.setSourceOperation(state, { schedule: 'daily' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'owner unavailable');
});

test('draft payload carries exact revision digest and semantic changes', () => {
  const state = model.normalize(snapshot);
  const next = {
    ...state,
    enabled: ['video-a', 'video-b'],
    userDomains: { include: ['custom.example', 'new.example'], exclude: ['blocked.example'], conflicts: [] },
    autohostOps: { promote: ['learned.example'], ignore: [], cleanupStale: [] },
    sourceOps: {}
  };
  const draft = model.draft(state, next);
  assert.equal(draft.expectedRevision, 'rev-1');
  assert.equal(draft.expectedCatalogDigest, 'a'.repeat(64));
  assert.deepEqual(draft.catalog.enabled, ['video-a', 'video-b']);
  assert.deepEqual(draft.lists.include, ['custom.example', 'new.example']);
  assert.equal(Object.keys(draft.changes).length, 3);
  assert.equal(model.changedCount(draft), 3);
});

test('empty semantic delta produces no draft', () => {
  const state = model.normalize(snapshot);
  assert.equal(model.draft(state, state), null);
});
