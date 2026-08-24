import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const panelSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js'), 'utf8');
const maintenanceSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');

test('engine panel terminal operation invalidates parent components cache and triggers refresh (E2E-001 root cause)', () => {
  // The mount poll's terminal branch must not only refresh the detail panel's
  // own engineState but also invalidate the outer System aggregate cache so
  // the header "0/2 ready" and Z2K card are recomputed without F5.
  assert.match(panelSource, /terminal\(state\.operation\.phase\)\)\s*\{[^}]*refresh\(ctx\)/s,
    'terminal branch must call refresh(ctx) for engine detail');
  assert.match(panelSource, /invalidateCache\(['"]components['"]\)/,
    'must invalidate components tab cache on terminal');
  assert.match(panelSource, /invalidateCache\(['"]system['"]\)/,
    'must invalidate system tab cache on terminal');
  assert.match(panelSource, /ctx\.refresh\(['"]components['"]\)/,
    'must trigger parent refresh for aggregate recompute');
});

test('maintenance aggregate recomputes Z2K on top of ready engine (E2E-004)', () => {
  assert.match(maintenanceSource, /ComponentsModel/,
    'maintenance must use ComponentsModel for Z2K/aggregate');
  assert.match(maintenanceSource, /normalizePage|aggregateHealth|renderComponents/,
    'maintenance must render aggregate from fresh model');
  const modelSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');
  assert.match(modelSource, /engineReady !== true\)\s*\{\s*healthState = 'missing'/,
    'Z2K missing gate on unproven engine is fail-closed');
});
