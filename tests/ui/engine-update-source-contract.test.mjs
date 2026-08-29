import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PANEL = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js';

test('Engine catalog exposes stale and unavailable source states while retaining installed state', () => {
  const ui = fs.readFileSync(PANEL, 'utf8');
  assert.match(ui, /state\.catalog\.source/);
  assert.match(ui, /source\.stale/);
  assert.match(ui, /source\.error/);
  assert.match(ui, /installedRelease/);
});
