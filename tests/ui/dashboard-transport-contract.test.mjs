import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js',
  'utf8'
);
const loading = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js',
  'utf8'
);
const fastStatus = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/status-fast.uc',
  'utf8'
);

test('Dashboard reuses the bounded app-shell transport and schedules enrichment after bootstrap', () => {
  assert.match(loading, /hasInitial\(ctx\.initial\)/,
    'Dashboard must reuse the app-shell status_fast result when available');
  assert.match(loading, /var read = .*ctx\.api\.service && \(ctx\.api\.service\.statusFast \|\| ctx\.api\.service\.status\)/,
    'direct module consumers still get a bounded status_fast fallback');
  assert.match(loading, /MAX_DEFERRED_IN_FLIGHT = 2/,
    'deferred Dashboard reads must use two lanes');
  assert.match(loading, /scheduleDeferred\(data\)/,
    'enrichment must be queued only after the first render data resolves');
  assert.match(loading, /ctx\.api\.tg\.product\.status\(\)/,
    'Telegram status remains a deferred local block');
});

test('Dashboard deferred blocks are independently settled and generation guarded', () => {
  assert.match(loading, /runtime\.deferred\[job\.key\] = settled/);
  assert.match(loading, /if \(token !== runtime\.loadToken\) return/);
  assert.match(loading, /active < MAX_DEFERRED_IN_FLIGHT/);
  assert.doesNotMatch(loading, /loadSecondary|secondaryReady/);
});

test('status_fast supplies the autostart evidence used by the Dashboard', () => {
  assert.match(fastStatus, /function autostart_observation\(\)/,
    'fast status must collect the cheap init-link observation');
  assert.match(fastStatus, /system:\s*\{\s*autostart:\s*autostart_observation\(\)/,
    'fast status must expose system.autostart for the Dashboard card');
});
