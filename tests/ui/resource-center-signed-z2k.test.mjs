import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js', 'utf8');

test('Resource Center exposes the selected Z2K lifecycle owner without adding a second updater', () => {
  assert.match(ui, /Управляется Z2K Core/);
  assert.match(ui, /lifecycle/);
  assert.match(ui, /z2k-resources/);
  assert.doesNotMatch(ui, /fetch\(|axios|Forgejo/);
});
