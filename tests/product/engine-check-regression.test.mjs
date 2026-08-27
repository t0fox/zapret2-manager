import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const maintenance = fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const enginePanel = fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js'), 'utf8');
const catalog = fs.readFileSync(path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
const manager = fs.readFileSync(path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');

function checkBody(source, nextFunction) {
  const start = source.indexOf('function checkUpdates');
  const end = source.indexOf(nextFunction, start);
  assert.ok(start >= 0 && end > start, 'checkUpdates function must be present');
  return source.slice(start, end);
}

test('Components Engine check calls the canonical fresh engine check, not status polling', () => {
  const body = checkBody(maintenance, 'function updateZ2K');
  assert.match(body, /ctx\.api\.engine\.check\(\{\s*forceRefresh:\s*true\s*\}\)/,
    'manual Components check must execute the Engine release check');
  assert.doesNotMatch(body, /ctx\.api\.engine\.status\(\)/,
    'manual Components check must not substitute a status read for a release check');
});

test('Components check-all includes both Z2K and the canonical fresh Engine check', () => {
  const body = checkBody(maintenance, 'function updateZ2K');
  assert.match(body, /scope === 'all' \|\| scope === 'z2k'[\s\S]*ctx\.api\.resources\.check\(\)/);
  assert.match(body, /scope === 'all' \|\| scope === 'engine'[\s\S]*ctx\.api\.engine\.check\(\{\s*forceRefresh:\s*true\s*\}\)/);
});

test('Engine detail check requests a fresh upstream catalog through the backend', () => {
  const body = enginePanel.slice(enginePanel.indexOf('function checkRelease'), enginePanel.indexOf('function installAction'));
  assert.match(body, /ctx\.api\.engine\.check\(\{\s*version:\s*state\.selectedVersion\s*,\s*forceRefresh:\s*true\s*\}\)/);
});

test('Engine manual check bypasses the release cache while normal reads retain cache', () => {
  const check = catalog.slice(catalog.indexOf('export const engine_check'), catalog.indexOf('export const load_checked_candidate'));
  assert.match(check, /forceRefresh\s*=\s*type\(input\)/);
  assert.match(check, /cache:\s*forceRefresh\s*!==\s*true/);
  assert.doesNotMatch(check, /allowStale:\s*true/,
    'fresh manual check must never turn an upstream failure into a stale success');
});

test('Fresh Engine check preserves canonical checkedAt and updateState in its response', () => {
  const backendCheck = catalog.slice(catalog.indexOf('export const engine_check'), catalog.indexOf('export const load_checked_candidate'));
  const check = manager.slice(manager.indexOf('function canonical_engine_check'), manager.indexOf('export const engine_check_release'));
  assert.match(backendCheck, /checkedAt:\s*now/);
  assert.match(check, /answer\.updateState\s*=\s*answer\.updateAvailable/);
  assert.match(check, /answer\.available\s*=\s*\{/);
});
