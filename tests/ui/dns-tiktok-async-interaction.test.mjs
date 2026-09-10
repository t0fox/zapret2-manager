import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DNS = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js',
  'utf8'
);

test('TikTok toggle exposes an interactive pending lifecycle before the worker finishes', () => {
  assert.match(DNS, /tiktokPendingState\(/);
  assert.match(DNS, /state\.tiktokAutoLocal\s*=\s*tiktokPendingState\(state\.tiktokAuto[\s\S]*?enabled/);
  assert.match(DNS, /state\.tiktokAutoBusy\s*=\s*true[\s\S]{0,500}ctx\.rerender\(\)/);
  assert.match(DNS, /tiktokOperationTimer|pollTiktokOperation/);
  assert.match(DNS, /phase === 'queued'|phase === 'running'/);
});

test('TikTok accepted jobs do not turn a transient status read into an RPC failure', () => {
  const toggle = DNS.slice(DNS.indexOf('function toggleTiktok'), DNS.indexOf('autoSwitch.addEventListener'));
  assert.match(toggle, /accepted|operationId/);
  assert.match(toggle, /scheduleTiktokStatusRecovery/);
  assert.doesNotMatch(toggle, /return ctx\.api\.dns\.serviceTiktokStatus\(\)[\s\S]*\.catch\(showError\)/);
});
