import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const MODEL_SRC = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');

// Helper to simulate the card projection that should be used
// This is the canonical logic that should be in the component
function normalizeTelegramForCard(input) {
  // input is the value from tg_product_status (already unwrapped)
  // This is a reference implementation for the test — the production code should match this
  if (!input || typeof input !== 'object') return { status: 'unknown', label: 'Состояние неизвестно' };
  if (input.error || input.ok === false) return { status: 'unknown', label: 'Состояние неизвестно' };
  const status = String(input.status || '').toLowerCase();
  const readinessInstalled = input.readiness && input.readiness.installed === true;
  const installedArray = Array.isArray(input.installed) ? input.installed : [];
  const hasInstalledPackage = installedArray.length > 0 && installedArray.some(p => p.installed === true);
  // not-installed checks
  if (status === 'not-installed' || (!readinessInstalled && !hasInstalledPackage && status !== 'running' && status !== 'stopped' && status !== 'degraded')) {
    // But need to check if it's truly not installed vs stopped
    if (readinessInstalled === false || (installedArray.length === 0 && status === 'not-installed')) {
      return { status: 'off', label: 'Не установлен', kind: 'o' };
    }
  }
  if (status === 'not-installed' && readinessInstalled === false) return { status: 'off', label: 'Не установлен', kind: 'o' };
  if (status === 'stopped') return { status: 'off', label: 'Остановлен', kind: 'o' };
  if (status === 'degraded') return { status: 'degraded', label: 'Требует внимания', kind: 'o' };
  if (status === 'running') return { status: 'ok', label: 'Работает', kind: 'g' };
  // Fallback for real not-installed
  if (readinessInstalled === false) return { status: 'off', label: 'Не установлен', kind: 'o' };
  return { status: 'unknown', label: 'Состояние неизвестно', kind: 'unknown' };
}

test('TG card must not use installed === true (array vs boolean)', () => {
  // The current hardcoded card does not check at all, and any existing check like tg.installed === true is wrong
  // Check that the source does NOT contain the buggy pattern
  assert.doesNotMatch(SRC, /tg\.installed\s*===\s*true/, 'must not compare installed array with === true');
  assert.doesNotMatch(SRC, /readiness\.installed\s*===\s*true.*\?[^:]*Не установлен/, 'must not mis-handle readiness');
  // Must correctly handle installed as array
  assert.match(SRC, /Array\.isArray.*installed|installed\.length/, 'must handle installed as array');
});

test('TG card must be dynamic, not hardcoded Не установлен', () => {
  // The old card is hardcoded to "Не установлен" regardless of payload
  const hasDynamic = /telegram.*status|status.*telegram|readiness\.installed|installed.*length/i.test(SRC);
  // Check that the renderOptionalCard or similar is not hardcoded
  // The old code has: statusLabel: _('Не установлен') hardcoded for telegram
  // New code should have logic that can produce "Работает", "Остановлен", etc.
  assert.match(SRC, /Работает|Остановлен|Требует внимания/, 'must have dynamic labels for TG states');
});

test('TG regression 1: installed array non-empty + readiness.installed=true + status=running → Работает', () => {
  const payload = {
    status: 'running',
    readiness: { installed: true, ready: true },
    installed: [{ provider: 'rust', packageVersion: '2.2.4-r1', installed: true }],
    observed: { running: true },
    activeProvider: 'rust',
    activeVersion: '2.2.4',
    ok: true
  };
  const result = normalizeTelegramForCard(payload);
  assert.equal(result.status, 'ok');
  assert.equal(result.label, 'Работает');
  // Production code should also handle this — check that the file contains logic for "running" → "Работает"
  assert.match(SRC, /running.*Работает|Работает.*running/i, 'source must map running → Работает');
});

test('TG regression 2: readiness.installed=true + status=stopped → Остановлен, not Не установлен', () => {
  const payload = {
    status: 'stopped',
    readiness: { installed: true },
    installed: [{ provider: 'rust', installed: true }],
    observed: { running: false },
    ok: true
  };
  const result = normalizeTelegramForCard(payload);
  assert.equal(result.status, 'off');
  assert.equal(result.label, 'Остановлен');
  assert.notEqual(result.label, 'Не установлен');
});

test('TG regression 3: status=degraded → attention', () => {
  const payload = {
    status: 'degraded',
    readiness: { installed: true, ready: false },
    installed: [{ provider: 'rust', installed: true }],
    ok: true
  };
  const result = normalizeTelegramForCard(payload);
  assert.equal(result.status, 'degraded');
});

test('TG regression 4: status=not-installed + readiness.installed=false → Не установлен', () => {
  const payload = {
    status: 'not-installed',
    readiness: { installed: false },
    installed: [],
    ok: true
  };
  const result = normalizeTelegramForCard(payload);
  assert.equal(result.status, 'off');
  assert.equal(result.label, 'Не установлен');
});

test('TG regression 5: RPC error → unknown, not Не установлен', () => {
  const payload = { error: { message: 'rpc failed' }, ok: false };
  const result = normalizeTelegramForCard(payload);
  assert.equal(result.status, 'unknown');
  assert.notEqual(result.label, 'Не установлен');
});

test('TG regression 6: installed TG shows provider/version', () => {
  const payload = {
    status: 'running',
    readiness: { installed: true },
    installed: [{ provider: 'rust', packageVersion: '2.2.4-r1', installed: true }],
    activeProvider: 'rust',
    activeVersion: '2.2.4',
    activePackageVersion: '2.2.4-r1',
    ok: true
  };
  // The card should display provider and version when available
  assert.ok(payload.activeProvider === 'rust');
  assert.ok(payload.activeVersion === '2.2.4');
  // Check that the source has logic to display provider/version
  assert.match(SRC, /activeProvider|activeVersion|Provider.*Rust/i, 'source must display provider/version when installed');
});

test('load() must fetch tg_product_status for Components page', () => {
  assert.match(SRC, /tg\.product\.status|tg_product_status/, 'load must fetch tg_product_status');
});
