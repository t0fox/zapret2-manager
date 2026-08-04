import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = readFileSync(`${root}/z2m-services.js`, 'utf8');

test('Services source defines the two real-data modes and shared draft controls', () => {
  for (const token of [
    'Собрать по сервисам', 'Готовый hosts', 'Включить все', 'Выключить все',
    'Массовые действия применяются ко всему каталогу, включая скрытые поиском сервисы',
    'aria-checked', 'toggleCategory', 'toggleAll', 'selectors', 'modeDrafts',
    'будет включено', 'будет выключено', 'изменено', 'ctx.openSemanticDiff'
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /const\s+SERVICES\s*=|let\s+SERVICES\s*=/);
  assert.doesNotMatch(source, /setInterval|rollback_ttl|confirmationTimer/);
});

test('Services render consumes backend category/source metadata without demo records', () => {
  const services = evaluateLuciModule(`${root}/z2m-services.js`);
  const model = evaluateLuciModule(`${root}/z2m-services-model.js`);
  const catalog = model.catalog({
    services: [{ id: 'alpha', name: 'Alpha', category: 'video' }],
    categories: [{ id: 'video', label: 'Video' }],
    sources: [{ id: 'ready-1', label: 'Ready hosts', revision: 3, date: '2026-08-04', validationStatus: 'valid' }]
  }, { activeMode: 'hosts' });
  assert.deepEqual(catalog.services.map((service) => service.id), ['alpha']);
  assert.deepEqual(catalog.sources.map((source) => source.id), ['ready-1']);
  assert.equal(catalog.services.some((service) => service.id === 'demo'), false);
  assert.equal(typeof services.render, 'function');
});

test('Services page aliases page preview/apply to the global coordinator', () => {
  assert.match(source, /ctx\.openSemanticDiff\(\)/);
  assert.doesNotMatch(source, /function\s+(preview|applyCatalog|applyServices)\s*\(/);
  assert.doesNotMatch(source, /catalogApply\s*\(/);
});

test('Services adapter owns backend reread and verification boundaries', () => {
  assert.match(source, /catalogStatus\(\)/);
  assert.match(source, /catalogList\(\)/);
  assert.match(source, /verifyApplied/);
  assert.match(source, /serviceIds\(wanted\).*serviceIds\(actual\)/s);
  assert.match(source, /return \{\s*value: \{ enabled:/s);
});
