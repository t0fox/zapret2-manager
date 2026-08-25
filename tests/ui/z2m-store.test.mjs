import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuciModule } from './support/luci-module.mjs';

const storeModule = loadLuciModule(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-store.js',
);

test('store initializes defaults with only truly global state', () => {
  const store = storeModule.create({ ui: { tab: 'strategy' } });
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().server)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(store.get().ui)), { tab: 'strategy' });
  // No global draft/coordinator state exists in the store.
  assert.equal(store.get().draft, undefined);
  assert.equal(store.get().coordinator, undefined);
  assert.equal(store.get().applied, undefined);
  assert.equal(store.snapshotDraft, undefined);
  assert.equal(store.setDraft, undefined);
  assert.equal(store.clearDraft, undefined);
  assert.equal(store.setCoordinator, undefined);
});

test('store publishes immutable root updates and supports unsubscribe', () => {
  const store = storeModule.create();
  const seen = [];
  const unsubscribe = store.subscribe(state => seen.push(state));
  const initial = store.get();

  const updated = store.update({ ui: { tab: 'dns-routing', advanced: true } });
  assert.notStrictEqual(updated, initial);
  assert.deepEqual(JSON.parse(JSON.stringify(updated.ui)), { tab: 'dns-routing', advanced: true });
  assert.equal(seen.length, 1);
  assert.strictEqual(seen[0], updated);

  unsubscribe();
  store.update({ jobs: { active: 1 } });
  assert.equal(seen.length, 1);
  assert.throws(() => store.subscribe(null), /subscriber must be a function/);
});
