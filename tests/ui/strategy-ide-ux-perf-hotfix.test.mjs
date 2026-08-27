import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VIEW = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(VIEW, name), 'utf8');

function loadIde() {
  const source = read('z2m-nfqws2-ide.js');
  const window = {};
  vm.runInNewContext(`(function () {${source}\n})()`, {
    baseclass: { extend: value => value },
    window,
    Event: function Event(type, init) { this.type = type; Object.assign(this, init || {}); }
  });
  return window.NfqwsIde;
}

test('UX hotfix summarizes circular Visual facts without serialized Lua', () => {
  const ide = loadIde();
  const parsed = ide.parseProfile('--filter-udp=443 --payload=all --lua-desync=circular:fails=3:time=60:key=yt_quic');
  const summary = ide.visualSummary(parsed);
  assert.equal(summary.desync, 'Circular · 3 шага');
  assert.match(summary.payload, /all/);
  assert.doesNotMatch(summary.desync, /fails=|time=|key=/);
});

test('UX hotfix provides near-fullscreen v2 workspace and migrates undersized v1 geometry', () => {
  const ide = loadIde();
  const viewport = { width: 1700, height: 950 };
  const defaults = ide.workspaceDefaults(viewport);
  assert.ok(defaults.width >= 1500 && defaults.width <= 1668);
  assert.ok(defaults.height >= 820 && defaults.height <= 918);
  const migrated = ide.migrateWorkspaceGeometry({ version: 1, width: 760, height: 520 }, viewport);
  assert.equal(migrated.version, 2);
  assert.ok(migrated.width >= 960);
  assert.ok(migrated.height >= 640);
  const restored = ide.migrateWorkspaceGeometry({ version: 2, width: 1200, height: 700 }, viewport);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), { version: 2, width: 1200, height: 700 });
});

test('UX hotfix source opens a loading modal before targeted strategies_get and keeps errors in-modal', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /editorLoadingId/);
  assert.match(page, /Открываем|Загружаем стратегию/);
  assert.match(page, /Повторить/);
  assert.match(page, /Не удалось загрузить стратегию/);
  assert.match(page, /strategies\.get/);
  assert.doesNotMatch(page, /function openEdit\(id\)\s*\{[\s\S]*?state\.pending\s*=\s*['"]details['"]/);
});

test('UX hotfix source has maximize, collapsible context, profile collapse and sticky workspace regions', () => {
  const page = read('z2m-strategies.js');
  const owner = read('z2m-strategy-editor.js');
  const css = read('z2m-ui.css');
  for (const marker of ['toggleWorkspaceMaximize', 'toggleEditorSidebar', 'workspace-maximize', 'Скрыть подсказки'])
    assert.match(page, new RegExp(marker));
  for (const marker of ['strategy-editor-profile-tabs', 'add-profile', 'remove-profile', 'add-circular-step'])
    assert.match(owner, new RegExp(marker), marker);
  for (const marker of ['strategy-modal.*display:flex', 'editor-footer.*position:sticky', 'strat-editor-main', 'strat-editor-side.*overflow', 'modal-content.*width:min\\(calc\\(100vw'])
    assert.match(css, new RegExp(marker));
});

test('UX hotfix scopes disabled button visuals and operation busy labels', () => {
  const page = read('z2m-strategies.js');
  const css = read('z2m-ui.css');
  assert.match(page, /Проверяем|Готовим превью|Сохраняем/);
  assert.match(css, /\.btn:not\(:disabled\):hover/);
  assert.match(css, /\.btn:disabled/);
  assert.match(css, /\[aria-disabled="true"\]/);
  assert.doesNotMatch(css, /#z2m-view-strategy \.btn:hover, \.z2m-view#z2m-view-strategy \.btn:hover/);
});

test('UX hotfix performance contract keeps cursor help local and editor reads targeted', () => {
  const page = read('z2m-strategies.js');
  const ide = read('z2m-nfqws2-ide.js');
  const openEdit = page.match(/function openEdit\(id\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.equal((openEdit.match(/strategies\.get/g) || []).length, 1);
  assert.doesNotMatch(openEdit, /strategies\.list|catalog/);
  assert.doesNotMatch(ide, /rpc|api\.|strategies\.(get|list)/i);
});

test('UX hotfix schedules the detail RPC after the loading modal can paint', () => {
  const page = read('z2m-strategies.js');
  const openEdit = page.match(/function openEdit\(id\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(page, /function scheduleAfterPaint\(/);
  assert.match(openEdit, /scheduleAfterPaint\(function/);
  assert.match(openEdit, /scheduleAfterPaint\(function[\s\S]*?strategies\.get/);
  assert.doesNotMatch(openEdit, /renderEditorLoading\(\);\s*call\(state\.ctx\.api\.strategies\.get/);
});

test('UX hotfix uses a reusable animated spinner with reduced-motion support', () => {
  const page = read('z2m-strategies.js');
  const css = read('z2m-ui.css');
  assert.match(page, /class="(?:z2m-)?spinner editor-loading-spinner"|class="editor-loading-spinner spinner"/);
  assert.match(page, /btn-spinner/);
  assert.match(css, /\.btn-spinner/);
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
  assert.match(css, /animation\s*:\s*(?:none|none\s*!important)/);
});

test('UX hotfix keeps card Apply scoped and renders current as a status, not a disabled primary action', () => {
  const page = read('z2m-strategies.js');
  const css = read('z2m-ui.css');
  assert.match(page, /mutate\(['"]apply['"][\s\S]*scope:\s*['"]card['"]/);
  assert.match(page, /Применяем…/);
  assert.match(page, /btn-status-current/);
  assert.match(page, /<span class="btn btn-status-current btn-sm" role="status"/);
  assert.doesNotMatch(page, /<button class="btn btn-status-current/);
  assert.doesNotMatch(page, /active \? '<button class="btn btn-primary btn-sm" disabled>Используется сейчас/);
  assert.match(css, /\.btn-status-current/);
  assert.match(css, /\.btn-primary:not\(:disabled\)[^}]*color:#fff\s*!important/);
  assert.match(css, /\.btn-primary:disabled[^}]*background\s*:/);
});

test('UX hotfix labels Create and editor operations with a local button spinner', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /Создаём…/);
  assert.match(page, /Проверяем…/);
  assert.match(page, /Готовим превью…/);
  assert.match(page, /Сохраняем…/);
  assert.match(page, /btn-spinner/);
});
