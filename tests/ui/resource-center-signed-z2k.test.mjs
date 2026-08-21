import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js', 'utf8');

test('Resource Center exposes the selected Z2K trust mode without adding a second updater', () => {
  assert.match(ui, /signedSources/);
  assert.match(ui, /verification/);
  assert.match(ui, /allow-untrusted/);
  assert.match(ui, /z2k-resources/);
  assert.doesNotMatch(ui, /fetch\(|axios|Forgejo/);
});
