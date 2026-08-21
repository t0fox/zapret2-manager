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
  const css = read('z2m-ui.css');
  for (const marker of ['toggleWorkspaceMaximize', 'toggleEditorSidebar', 'toggleProfileCollapse', 'workspace-maximize', 'Скрыть подсказки'])
    assert.match(page, new RegExp(marker));
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
