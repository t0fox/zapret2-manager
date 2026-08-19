import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P02 Control is a dedicated frozen-donor page, not Dashboard reuse', () => {
  const app = read('app.js');
  assert.match(app, /require view\.zapret2-manager\.z2m-avatar-control as Control/);
  assert.match(app, /control:\s*Control/);
  assert.doesNotMatch(app, /control:\s*Overview/);
});

test('P02 Control preserves the donor composition and shared log primitive', () => {
  const page = read('z2m-avatar-control.js');
  const log = read('z2m-avatar-log.js');
  const composition = `${page}\n${log}`;
  const required = [
    'page-header', 'Управление', 'control-status-hero', 'control-indicator',
    'control-status-ring', 'control-status-icon', 'control-status-label',
    'control-status-detail', 'control-buttons',
    'status-grid',
    'card-strategy', 'card-process', 'card-firewall', 'fw-rules-card',
    'control-logs', 'Все логи', 'AvatarLog.renderNormalized'
  ];
  for (const marker of required)
    assert.match(composition, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `missing P02 marker: ${marker}`);
  assert.match(page, /id: 'control-btn-' \+ action/);
  const render = page.slice(page.indexOf("return E('section'"));
  const order = [
    'control-status-hero', 'control-buttons', 'status-grid',
    'firewallDetails(view)', 'renderLogs(logs)'
  ];
  let previous = -1;
  for (const marker of order) {
    const current = render.indexOf(marker, previous + 1);
    assert.ok(current > previous, `P02 donor order is missing or misplaced: ${marker}`);
    previous = current;
  }
});

test('P02 Control keeps canonical lifecycle RPCs and page cleanup', () => {
  const page = read('z2m-avatar-control.js');
  assert.match(page, /ctx\.api\.service\.status/);
  assert.match(page, /ctx\.api\.service\.start/);
  assert.match(page, /ctx\.api\.service\.stop/);
  assert.match(page, /ctx\.api\.service\.restart/);
  assert.match(page, /setInterval/);
  assert.match(page, /clearInterval/);
  assert.match(page, /function unmount|unmount:/);
  assert.doesNotMatch(page, /['"]\/api\//);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('P02 Control exposes Russian normal-state copy without raw backend enums', () => {
  const page = `${read('z2m-avatar-control.js')}\n${read('z2m-control-model.js')}`;
  for (const marker of ['Остановлен', 'Работает', 'Неизвестно', 'Запустить', 'Остановить', 'Перезапустить'])
    assert.match(page, new RegExp(marker));
  assert.doesNotMatch(page, /innerHTML\s*=|textContent\s*=\s*[^_]/);
  assert.doesNotMatch(page, /reasonCode|process-confirmed-absent|runtime-evidence-incomplete/);
  assert.doesNotMatch(page, /Backend не/);
});

test('P02 Control carries donor control CSS in the Graphite shell', () => {
  const css = read('z2m-ui.css');
  for (const marker of [
    'z2m-view#z2m-view-control', 'control-status-hero',
    'control-status-indicator', 'control-status-ring', 'control-buttons',
    'control-firewall-viewer', 'control-firewall-row', 'control-logs'
  ]) assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(css, /avatar-sidebar|donor-sidebar/);
});

test('P02 deploy closure uses the single explicit reviewed manifest path', () => {
  const deploy = fs.readFileSync('scripts/deploy-target.sh', 'utf8');
  assert.match(deploy, /TARGET=\$\{TARGET:\?/, 'target must be explicit');
  assert.match(deploy, /MANIFEST=\$\{MANIFEST:\?/, 'manifest must be explicit');
  assert.match(deploy, /EXPECTED_COMMIT=\$\{EXPECTED_COMMIT:\?/, 'source commit must be explicit');
  assert.match(deploy, /backup/i);
  assert.match(deploy, /while IFS='\|'/, 'deployment closure must be manifest-driven');
});
