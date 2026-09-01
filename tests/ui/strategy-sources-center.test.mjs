import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadModel() {
  const source = read('z2m-resources-model.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: value => value },
    UpdatePresentation: { normalize: value => value || 'unknown', describe: value => ({ state: value, label: value, kind: 'muted' }) },
    _: value => value,
  });
}

const sources = {
  ok: true,
  config: { revision: 8 },
  sources: {
    avatar: {
      id: 'avatar', enabled: true, revision: 4,
      currentSnapshotId: 'avatar-snapshot-4', lastKnownGoodSnapshotId: 'avatar-snapshot-4',
      repository: 'avatarDD/zapret-gui', sourceCommit: 'a'.repeat(40),
      contentDigest: 'b'.repeat(64), entryCount: 31, normalizedEntryCount: 31,
    },
    z2k: {
      id: 'z2k', enabled: false, revision: 5,
      currentSnapshotId: 'z2k-snapshot-2', lastKnownGoodSnapshotId: 'z2k-snapshot-2',
      repository: 'necronicle/z2k', sourceCommit: 'c'.repeat(40),
      contentDigest: 'd'.repeat(64), entryCount: 19, normalizedEntryCount: 18,
    },
  },
};

test('source model preserves source identity, LKG and snapshot counts', () => {
  const model = loadModel();
  const cards = model.buildStrategySourceCards(sources);
  assert.deepEqual(Array.from(cards, card => card.id), ['avatar', 'z2k']);
  assert.equal(cards[0].label, 'Avatar');
  assert.equal(cards[0].repository, 'avatarDD/zapret-gui');
  assert.equal(cards[0].entryCount, 31);
  assert.equal(cards[0].sourceCommit, 'a'.repeat(40));
  assert.equal(cards[0].hasLkg, true);
  assert.equal(cards[1].label, 'Z2K');
  assert.equal(cards[1].enabled, false);
  assert.equal(cards[1].normalizedEntryCount, 18);
});

test('Resource Center loads source state and exposes bounded source mutations', () => {
  const page = read('z2m-assets.js');
  const api = read('z2m-api.js');
  assert.match(page, /strategies\.sourcesGet/);
  assert.match(page, /strategies\.sourceRefresh/);
  assert.match(page, /strategies\.sourceSetEnabled/);
  assert.match(page, /ИСТОЧНИКИ СТРАТЕГИЙ/);
  assert.match(page, /Обновить все/);
  assert.match(page, /Не применять автоматически/);
  assert.match(api, /strategies_sources_get/);
  assert.match(api, /strategies_source_refresh/);
  assert.match(api, /strategies_source_set_enabled/);
});

test('source UI keeps mutation identity separate from applied strategy identity', () => {
  const page = read('z2m-assets.js');
  assert.match(page, /data-strategy-source-id/);
  assert.match(page, /currentSnapshotId/);
  assert.match(page, /lastKnownGoodSnapshotId/);
  assert.match(page, /Не применять автоматически/);
  assert.doesNotMatch(page, /strategies\.apply\(/);
});
