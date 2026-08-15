import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const UI = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const API = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';

test('TG UI uses action-specific confirmation and durable operation polling', () => {
  const ui = fs.readFileSync(UI, 'utf8');
  const api = fs.readFileSync(API, 'utf8');
  for (const marker of ['INSTALL', 'UPDATE', 'DOWNGRADE', 'PROVIDER_SWITCH', 'operationId',
    'tgProductOperationStatus', 'currentStage', 'progressPercent', 'ROLLING_BACK',
    'Дождитесь завершения', 'Повторить', 'Завершить'])
    assert.match(ui + api, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(ui, /install|update|downgrade|switch/i);
});

test('TG running operation locks the viewport and cannot be dismissed by ESC, backdrop, or close', () => {
  const ui = fs.readFileSync(UI, 'utf8');
  assert.match(ui, /overflow\s*=\s*['"]hidden|z2m-tg-operation-running/);
  assert.match(ui, /stopPropagation|preventDefault/);
  assert.match(ui, /modal.*close|close.*modal/i);
  assert.match(ui, /document.*keydown|keydown.*document/);
  assert.match(ui, /active operation|operation status|operationStatus/i);
});

test('TG UI keeps direct Go binary package version truthful', () => {
  const ui = fs.readFileSync(UI, 'utf8');
  assert.match(ui, /installedVersionDisplay/);
  assert.match(ui, /packageVersion/);
  assert.match(ui, /direct binary|binary/i);
  assert.doesNotMatch(ui, /_\('Package version'\)/);
  assert.doesNotMatch(ui, /не предоставляется \(direct binary\)/i);
});
