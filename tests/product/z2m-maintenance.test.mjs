import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('maintenance must use scoped componentOperation, not single componentBusy boolean', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /componentOperation\s*:\s*null/, 'must have componentOperation: null');
  assert.match(src, /componentBusy.*componentOperation|componentOperation.*componentBusy/, 'componentBusy must be derived from componentOperation');
  assert.doesNotMatch(src, /componentBusy\s*:\s*false\s*,\s*\n.*componentBusy.*true.*componentBusy.*false/s, 'must not use old boolean toggle pattern for busy');
});

test('checkUpdates must set kind check scope all and clear via finally', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /checkUpdates[\s\S]*componentOperation\s*=\s*\{\s*kind:\s*["']check["']/);
  assert.match(src, /checkUpdates[\s\S]*scope:\s*["']all["']/);
  assert.match(src, /checkUpdates[\s\S]*\.finally|checkUpdates[\s\S]*\.then[\s\S]*\.catch[\s\S]*componentOperation\s*=\s*null/, 'must clear operation in finally/then+catch');
});

test('updateZ2K must set kind update scope z2k and not affect Engine', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /updateZ2K[\s\S]*componentOperation\s*=\s*\{\s*kind:\s*["']update["']/);
  assert.match(src, /updateZ2K[\s\S]*scope:\s*["']z2k["']/);
  // Engine must not show fake update when Z2K is updating
  assert.doesNotMatch(src, /renderEngineCard[\s\S]*componentOperation.*all.*update/i);
});

test('check lifecycle must show checking text, not updating', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /Проверка обновлений|Проверяем доступные версии/);
  // Check should not display "Обновление…" for a check
  const checkSection = src.slice(src.indexOf('function checkUpdates'));
  assert.doesNotMatch(checkSection, /phase:\s*['"]Обновление/);
  assert.match(checkSection, /Проверка/);
});

test('Z2K update must show only Z2K busy, not Engine', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  // renderEngineCard should check scope
  assert.match(src, /renderEngineCard[\s\S]*componentOperation.*scope.*z2k|isBusy.*scope/i);
  // renderZ2KCard should also check scope
  assert.match(src, /renderZ2KCard[\s\S]*componentOperation/);
});

test('every operation must clear via finally or both then/catch', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const checkFn = src.slice(src.indexOf('function checkUpdates'), src.indexOf('function checkUpdates') + 2000);
  const updateFn = src.slice(src.indexOf('function updateZ2K'), src.indexOf('function updateZ2K') + 2000);
  const refreshFn = src.slice(src.indexOf('function refreshState'), src.indexOf('function refreshState') + 1500);
  for (const [name, fn] of [['checkUpdates', checkFn], ['updateZ2K', updateFn], ['refreshState', refreshFn]]) {
    assert.match(fn, /componentOperation\s*=\s*null/, `${name} must clear operation`);
  }
});
