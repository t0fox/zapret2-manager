import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'G:/zapret2-manager/.codex-avatar-parity/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js';

test('P01-T T06 keeps internal run phases behind Russian product labels', () => {
  const source = fs.readFileSync(path, 'utf8');
  assert.match(source, /function phaseLabel\s*\(/);
  assert.match(source, /Проверка завершена/);
  assert.match(source, /Не удалось завершить проверку/);
  assert.match(source, /Расширенный/);
  assert.doesNotMatch(source, /shell\.chip\(phase[),]/);
  assert.doesNotMatch(source, /reportRow\(_\('Состояние'\), view\.lastRun\.phase\)/);
});

test('P01-T T06 keeps donor-only cards and backend APIs outside the dashboard transplant', () => {
  const source = fs.readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /renderVpnGrid|renderMonitoringGrid|VPN \/ Туннели|Мониторинг DNS/);
  assert.doesNotMatch(source, /\/api\/dashboard\/status|fetch\s*\(/);
  assert.match(source, /z2m-avatar-log/);
  assert.match(source, /z2m-overview-status/);
});
