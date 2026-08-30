import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('Strategy IDE owns one header control set across modal reopen', () => {
  const source = read('z2m-strategies.js');
  assert.match(source, /function cleanupStrategyEditorHeader/);
  assert.match(source, /cleanupStrategyEditorHeader\(headerActions\)/);
  assert.match(source, /cleanupStrategyEditorHeader\(.*\);.*state\.editor = null/s);
  assert.match(source, /Показать инспектор/);
  assert.match(source, /Скрыть инспектор/);
  assert.doesNotMatch(source, /Показать подсказки|Скрыть подсказки/);
});

test('Strategy IDE switch suppresses the LuCI native checkbox pseudo-element', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /#z2m-view-strategy[^{}]*\.profile-toggle::before\s*\{[^}]*content\s*:\s*none/s);
});

test('Strategy IDE uses a compact preview region and removes editor jargon', () => {
  const strategies = read('z2m-strategies.js');
  const editor = read('z2m-strategy-editor.js');
  const ide = read('z2m-nfqws2-ide.js');
  assert.match(strategies, /data-editor-preview-actions-host/);
  assert.doesNotMatch(strategies, /profile\.args — источник истины/);
  assert.doesNotMatch(editor, /серверная validation/);
  assert.doesNotMatch(ide, /серверная validation|server compiler\/validation/);
  assert.doesNotMatch(editor, /strategy-editor-mode-label/);
  assert.match(editor, /mode === 'visual' \? 'Визуально' : 'Код'/);
});

test('Strategy IDE marks required create fields inline before mutation', () => {
  const strategies = read('z2m-strategies.js');
  const editor = read('z2m-strategy-editor.js');
  const css = read('z2m-ui.css');
  assert.match(editor, /id\.input\.required = true/);
  assert.match(editor, /name\.input\.required = true/);
  assert.match(strategies, /function validateEditorForm/);
  assert.match(strategies, /validateEditorForm\(strategy\)/);
  assert.match(strategies, /aria-invalid/);
  assert.match(css, /strategy-editor-field-error/);
});

test('Strategy IDE status bar prioritizes problems, server state, dirty state, and profile count', () => {
  const source = read('z2m-strategies.js');
  assert.match(source, /Проблемы: —/);
  assert.match(source, /data-editor-status-dirty/);
  assert.match(source, /Проблемы: ' \+ String\(localCount\)/);
  assert.match(source, /Не сохранено/);
  assert.doesNotMatch(source, /Локальная диагностика: ' \+ String\(localCount\) \+ ' проблем/);
});

test('Strategy IDE profile delete controls stay ghost-sized until danger hover', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /strategy-editor-profile-item > \.btn-icon-only\s*\{[^}]*background\s*:\s*transparent/s);
  assert.match(css, /strategy-editor-profile-item > \.btn-icon-only\s*\{[^}]*width\s*:\s*32px/s);
  assert.match(css, /strategy-editor-profile-item > \.btn-icon-only:hover:not\(:disabled\)[\s\S]*?var\(--red/);
});
