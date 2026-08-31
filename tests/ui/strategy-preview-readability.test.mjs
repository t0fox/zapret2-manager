import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const page = fs.readFileSync(`${root}/z2m-strategies.js`, 'utf8');
const css = fs.readFileSync(`${root}/z2m-ui.css`, 'utf8');

test('Preview presents dependency rows and server verification as readable status surfaces', () => {
  assert.match(page, /strategy-preview-dependency-item/);
  assert.match(page, /strategy-preview-dependency-kind/);
  assert.match(page, /strategy-preview-dependency-state/);
  assert.match(page, /data-state/);
  assert.match(page, /strategy-preview-validation-state/);
  assert.match(page, /Проверка запускается кнопкой ниже/);
  assert.match(page, /Нативный preflight завершён/);
});

test('Preview keeps raw diagnostics secondary and gives the verification footer its own layer', () => {
  assert.match(page, /JSON для диагностики/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(css, /#z2m-view-strategy #preview-modal \.modal-body\{[^}]*flex:1 1 auto/);
  assert.match(css, /#z2m-view-strategy \.strategy-preview-footer\{[^}]*position:static/);
  assert.match(css, /#z2m-view-strategy \.strategy-preview-footer\{[^}]*box-shadow:/);
});

test('Preview dependency rows reserve space for the status and keep long identifiers readable', () => {
  assert.match(css, /\.strategy-preview-list ul\{[^}]*padding:[^}]*\b6px\b[^}]*overflow:auto/);
  assert.match(css, /\.strategy-preview-dependency-item\{[^}]*grid-template-columns:minmax\(0,1fr\) max-content/);
  assert.match(css, /\.strategy-preview-dependency-state\{[^}]*white-space:nowrap/);
  assert.match(css, /\.strategy-preview-dependency-item code\{[^}]*overflow-wrap:anywhere/);
});
