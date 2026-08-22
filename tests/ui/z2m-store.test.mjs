import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuciModule } from './support/luci-module.mjs';

const storeModule = loadLuciModule(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js',
);

test('store initializes defaults and returns detached draft snapshots', () => {
  const store = storeModule.create({
    draft: { strategy: { enabled: true, ports: [80, 443] } },
    ui: { tab: 'strategy' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().server)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().ui)), { tab: 'strategy' });

  const snapshot = store.snapshotDraft();
  snapshot.strategy.enabled = false;
  snapshot.strategy.ports.push(8443);
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().draft.strategy)), {
    enabled: true,
    ports: [80, 443],
  });
});

test('store publishes immutable root updates and supports unsubscribe', () => {
  const store = storeModule.create();
  const seen = [];
  const unsubscribe = store.subscribe(state => seen.push(state));
  const initial = store.get();

  const updated = store.update({ pending: { save: true } });
  assert.notStrictEqual(updated, initial);
  assert.deepEqual(JSON.parse(JSON.stringify(updated.pending)), { save: true });
  assert.equal(seen.length, 1);
  assert.strictEqual(seen[0], updated);

  unsubscribe();
  store.update({ jobs: { active: 1 } });
  assert.equal(seen.length, 1);
  assert.throws(() => store.subscribe(null), /subscriber must be a function/);
});

test('store manages coordinator, applied, and draft scopes independently', () => {
  const store = storeModule.create();
  let emissions = 0;
  store.subscribe(() => { emissions++; });

  assert.deepEqual(JSON.parse(JSON.stringify(store.setCoordinator({ status: 'ready' }))), {
    status: 'ready',
    availability: { enabled: false, reason: 'Нет изменений', blockers: [] },
  });

  const applied = { nested: { value: 1 } };
  store.setApplied('strategy', applied);
  applied.nested.value = 2;
  assert.equal(store.get().applied.strategy.nested.value, 1);

  store.setDraft('dns', { enabled: true });
  store.setDraft('proxy', { enabled: false });
  store.clearDraft('dns');
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().draft)), { proxy: { enabled: false } });
  store.clearAllDrafts();
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().draft)), {});
  assert.equal(emissions, 6);
});
