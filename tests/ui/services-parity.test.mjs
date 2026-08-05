import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = readFileSync(`${root}/z2m-services.js`, 'utf8');

test('Services exposes the canonical Domain Hub panes, filters and shared draft controls', () => {
  for (const token of [
    "id: 'catalog'", "id: 'domains'", "id: 'autohost'", "id: 'sources'",
    'Найти сервис', 'Фильтр состояния', 'Фильтр категории', 'Включить все', 'Выключить все',
    'toggleCategory', 'togglePackage', 'Показать различия', 'ctx.openSemanticDiff',
    'Применение заблокировано', 'include/exclude'
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /const\s+SERVICES\s*=|let\s+SERVICES\s*=/);
  assert.doesNotMatch(source, /setInterval|rollback_ttl|confirmationTimer/);
});

test('Domain Hub model consumes backend package/category/source metadata without demo records', () => {
  const services = evaluateLuciModule(`${root}/z2m-services.js`);
  const model = evaluateLuciModule(`${root}/z2m-domain-hub-model.js`);
  const snapshot = model.normalize({
    revision: 3,
    catalog: { digest: 'digest-3', version: 'backend-catalog', enabled: ['alpha'],
      packages: [{ id: 'alpha', name: 'Alpha', category: 'video' }], categories: ['video'] },
    userDomains: { include: [], exclude: [] },
    sources: { items: [{ id: 'ready-1', label: 'Ready hosts', revision: 3 }], writable: false }
  });
  assert.deepEqual(snapshot.packages.map((item) => item.id), ['alpha']);
  assert.deepEqual(snapshot.sources.items.map((item) => item.id), ['ready-1']);
  assert.equal(snapshot.packages.some((item) => item.id === 'demo'), false);
  assert.equal(typeof services.render, 'function');
});

test('Services page routes apply through the global coordinator', () => {
  assert.match(source, /ctx\.openSemanticDiff\(\)/);
  assert.doesNotMatch(source, /function\s+(applyCatalog|applyServices)\s*\(/);
  assert.doesNotMatch(source, /hub\.apply\([^)]*\)(?![\s\S]*applyDraft)/);
});

test('Services adapter owns exact Domain Hub reread, preview, apply and verification boundaries', () => {
  for (const token of ['hub.get()', 'hub.preview', 'hub.apply', 'reloadAppliedState', 'verifyApplied',
    'expectedRevision', 'expectedCatalogDigest', 'fileSha256', 'catalogDigest', 'requestId'])
    assert.match(source, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(source, /same\(object\(actual\.catalog\)\.enabled,\s*object\(value\.catalog\)\.enabled\)/);
  assert.match(source, /same\(object\(actual\.userDomains\)\.include,\s*object\(value\.lists\)\.include\)/);
  assert.match(source, /same\(object\(actual\.userDomains\)\.exclude,\s*object\(value\.lists\)\.exclude\)/);
});
