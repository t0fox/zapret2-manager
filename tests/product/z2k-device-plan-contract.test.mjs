import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const upstream = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');

test('A: historical manifest may be unknown while canonical device plan is known', () => {
  assert.match(upstream, /updateItems/);
  assert.match(versions, /targetPlan\.updateItems/);
  assert.match(versions, /deviceChanges:/);
  assert.match(versions, /change_payload\(deviceChangeSet\)/);
});

test('B: repository compare is requested from valid release identities alone', () => {
  assert.match(versions, /includeCompare && installedRow != null && valid_sha\(installedCommit\)/);
  assert.match(versions, /installedCommit/);
  assert.match(versions, /resolve_tag_commit\(installedVersion/);
  assert.doesNotMatch(versions, /includeCompare && installChangeSet\.known && installedRow/);
});

test('C: device rows carry backend-owned resource identity and target digest', () => {
  assert.match(upstream, /updateItems/);
  assert.match(upstream, /sourcePath/);
  assert.match(upstream, /targetSha256/);
  assert.match(upstream, /currentSha256/);
  assert.match(versions, /modifiedItems/);
  assert.match(versions, /addedItems/);
});

test('D: missing repository explanation cannot remove a planned device row', () => {
  assert.match(maintenance, /z2kManagedChangeFallback/);
  assert.match(maintenance, /sourcePath/);
});

test('E: device presentation reads deviceChanges, not release-history availability', () => {
  assert.match(model, /deviceChanges/);
  assert.match(maintenance, /selected\.deviceChanges|details\.deviceChanges/);
  assert.match(model, /releaseChanges/);
});

test('F: canonical device plan does not invent removals from release history', () => {
  assert.match(upstream, /updates/);
  assert.doesNotMatch(upstream, /removedItems.*files_sha256|push\(removedItems/);
  assert.match(versions, /removedItems/);
});
