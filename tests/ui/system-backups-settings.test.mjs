import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js', 'utf8');

test('Backups default to a full snapshot and keep advanced scopes explicit', () => {
  assert.match(source, /create\('all'\)/);
  assert.match(source, /Всё|Все области/);
  assert.match(source, /Дополнительно|advanced/i);
  for (const scope of ['engineConfig', 'ourState', 'lists', 'profiles']) assert.match(source, new RegExp(scope));
  assert.match(source, /backupPreview/);
  assert.match(source, /backupRestore/);
  assert.match(source, /Целостность/);
  assert.match(source, /Проверка версии/);
});

test('Settings exposes only the supported advanced-mode control', () => {
  const settings = source.match(/function renderSettings[\s\S]*?\n}\n\nfunction render\(/);
  assert.ok(settings, 'renderSettings block should exist');
  assert.match(settings[0], /Расширенный режим/);
  assert.doesNotMatch(settings[0], /Граница контракта|нет отдельного RPC настроек/);
});
