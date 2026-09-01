import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// App-shell load contract (XHR-timeout corrective):
// The root LuCI view's load() gates the ENTIRE application (single menu entry).
// It must use the bounded status_fast collector only — the full diagnostic
// collector is a heavyweight popen pipeline that starves rpcd on clean
// installs and delays first paint of every tab.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'luci-app-zapret2-manager', 'files', 'www',
  'luci-static', 'resources', 'view', 'zapret2-manager', 'app.js');
const API = path.join(ROOT, 'luci-app-zapret2-manager', 'files', 'www',
  'luci-static', 'resources', 'view', 'zapret2-manager', 'z2m-api.js');

const source = readFileSync(APP, 'utf8');
const apiSource = readFileSync(API, 'utf8');

test('z2m-api declares both status and bounded status_fast transports', () => {
  assert.match(apiSource, /method:\s*'status_fast'/, 'status_fast ubus method must be declared');
  assert.match(apiSource, /statusFast\s*:/, 'statusFast facade must exist');
});

test('root view load() uses status_fast, never the full status collector', () => {
  const loadMatch = source.match(/load:\s*function\s*\(\)\s*\{([\s\S]*?)\n\s*\},\s*\n\s*render:/);
  assert.ok(loadMatch, 'root view load() block not found');
  const body = loadMatch[1];
  assert.match(body, /Api\.service\.statusFast/, 'load() must call Api.service.statusFast');
  assert.doesNotMatch(body, /Api\.service\.status\(/,
    'full status collector must not be a prerequisite of the app shell');
});

test('no LuCI view may call the blocking full status transport', () => {
  // The full collector runs for seconds on hardware; any view invoking it
  // risks an XHR timeout AND freezes rpcd for unrelated services while it
  // runs. Diagnostics-grade state must go through bounded transports.
  const viewsDir = path.dirname(APP);
  const offenders = [];
  for (const name of fs.readdirSync(viewsDir)) {
    if (!name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(viewsDir, name), 'utf8');
    if (/service\.status\(/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `views calling full status: ${offenders.join(', ')}`);
});

test('rpcd status method serves cache and refreshes in background (never inline)', () => {
  const rpcdPlugin = fs.readFileSync(path.join(ROOT, 'zapret2-manager', 'files',
    'usr', 'share', 'rpcd', 'ucode', 'zapret2-manager.uc'), 'utf8');
  const fnAt = rpcdPlugin.indexOf('function status_method(req)');
  assert.notEqual(fnAt, -1);
  const fnBody = rpcdPlugin.slice(fnAt, fnAt + 900);
  assert.doesNotMatch(fnBody, /popen\([^)]*COLLECTOR[^)]*\)\s*;\s*(\/\/)?[^\n]*inline/,
    'collector must not run inline');
  assert.match(fnBody, /status_refresh_async\(\)/, 'must trigger async refresh');
  assert.match(rpcdPlugin, /function status_refresh_async\(\)/);
  assert.match(rpcdPlugin, /EPENDING/, 'first-ever call must report pending instead of blocking');
});

test('header state mapping tolerates the status-fast payload shape', () => {
  // runtime-state.state() reads runtimeSummary.status which status-fast.v1 provides.
  const runtimeState = readFileSync(path.join(path.dirname(APP), 'z2m-runtime-state.js'), 'utf8');
  assert.match(runtimeState, /runtimeSummary/, 'runtime state mapping must consume runtimeSummary');
});

test('global header refreshes from status_fast after lifecycle actions', () => {
  assert.match(source, /function scheduleHeaderStatusRefresh\(\)/);
  assert.match(source, /Api\.service\.statusFast\(\)\.then/);
  assert.match(source, /updateHeaderStatus\(\{ status: \{ value: data \} \}\)/);
});
