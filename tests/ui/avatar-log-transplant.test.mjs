import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'G:/zapret2-manager/.codex-avatar-parity';
const modulePath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js`;
const overviewPath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js`;
const maintenancePath = `${root}/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`;

test('P01-T T03 uses the frozen donor log component through a Z2M adapter', () => {
  assert.equal(fs.existsSync(modulePath), true, 'shared donor-derived log module is missing');
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.match(source, /DONOR TRANSPLANT: web\/js\/pages\/logs\.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(source, /function normalizeRows\s*\(/);
  assert.match(source, /function renderNormalized\s*\(/);
  assert.match(source, /technicalDetails/);
  assert.match(source, /log-viewer/);
  assert.match(source, /log-entry/);
  assert.match(source, /log-time/);
  assert.match(source, /log-level/);
  assert.match(source, /log-source/);
  assert.match(source, /log-message/);
  assert.match(source, /ОТЛАДКА/);
  assert.match(source, /ПРЕДУПР\./);
  assert.doesNotMatch(source, /\/api\//);
});

test('P01-T T03 pages consume shared log adapter instead of owning donor rendering', () => {
  const overview = fs.readFileSync(overviewPath, 'utf8');
  const maintenance = fs.readFileSync(maintenancePath, 'utf8');
  assert.match(overview, /require view\.zapret2-manager\.z2m-avatar-log as AvatarLog/);
  assert.match(maintenance, /require view\.zapret2-manager\.z2m-avatar-log as AvatarLog/);
  assert.match(overview, /AvatarLog\.normalizeRows/);
  assert.match(maintenance, /AvatarLog\.normalizeRows/);
  assert.doesNotMatch(overview, /function eventSeverity\s*\(/);
  assert.doesNotMatch(maintenance, /function eventSeverity\s*\(/);
});
