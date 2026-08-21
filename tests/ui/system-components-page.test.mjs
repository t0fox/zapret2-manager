import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js', 'utf8');
const model = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js', 'utf8');

test('System maintenance owns the canonical Components page and keeps engine management behind it', () => {
  assert.match(source, /z2m-components-model/);
  assert.match(source, /components:\s*\{\s*title:\s*_\(/);
  assert.match(source, /function renderComponents\s*\(/);
  assert.match(source, /Zapret2 Engine/);
  assert.match(model, /Z2K Core/);
  assert.match(source, /Обязательные компоненты/);
  assert.match(source, /Управление/);
  assert.match(source, /EnginePanel\.render/);
  assert.match(source, /resources\.status\(\)/);
  assert.match(source, /resources\.check\(\)/);
});

test('Components page does not become a second resource catalog or product owner', () => {
  const render = source.match(/function renderComponents[\s\S]*?\n}\n\nfunction renderEngine/);
  assert.ok(render, 'renderComponents block should exist');
  assert.doesNotMatch(render[0], /Telegram Proxy|Ресурсы|WARP|Удалить Z2K/);
  assert.match(render[0], /2 из 2 готовы/);
  assert.match(render[0], /Проверить/);
});
