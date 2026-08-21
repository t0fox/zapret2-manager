import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const UX = ROOT + 'z2m-product-ux-model.js';
const DNS = ROOT + 'z2m-dns.js';
const TG = ROOT + 'z2m-proxy-page-core.js';
const UPDATES = ROOT + 'z2m-maintenance.js';

function loadModel() {
  const source = fs.readFileSync(UX, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

test('DNS and Telegram share explicit state semantics including UNKNOWN', () => {
  const model = loadModel();
  assert.equal(model.state({ ok: true }), 'ok');
  assert.equal(model.state({ installed: false }), 'off');
  assert.equal(model.state({ running: false }), 'off');
  assert.equal(model.state({ degraded: true }), 'degraded');
  assert.equal(model.state({ status: 'error' }), 'error');
  assert.equal(model.state({}), 'unknown');
  assert.equal(model.state({ error: { message: 'RPC unavailable' } }), 'unknown');
});

test('health evidence is freshness-aware and missing timestamps stay UNKNOWN', () => {
  const model = loadModel();
  const fresh = model.freshness({ generatedAt: 90 }, { now: 100, maxAgeSec: 20 });
  assert.equal(fresh.state, 'fresh');
  assert.equal(fresh.usable, true);
  assert.equal(fresh.timestamp, 90);
  assert.equal(fresh.ageSec, 10);
  assert.equal(model.freshness({ generatedAt: 1 }, { now: 100, maxAgeSec: 20 }).state, 'stale');
  assert.equal(model.freshness({}, { now: 100, maxAgeSec: 20 }).state, 'unknown');
});

test('shared error language preserves technical evidence for DNS and TG failures', () => {
  const model = loadModel();
  const cases = [
    ['dnsmasq unavailable', 'dnsmasq недоступен'],
    ['invalid dns configuration', 'Некорректная конфигурация'],
    ['provider unreachable', 'Провайдер недоступен'],
    ['apply timeout', 'Применение не завершилось вовремя'],
    ['rollback required', 'Требуется откат'],
    ['external ownership conflict', 'Конфликт внешнего владельца']
  ];
  cases.forEach(([technical, human]) => {
    const result = model.errorMessage({ message: technical });
    assert.equal(result.message, human);
    assert.equal(result.technical, technical);
  });
});

test('DNS first screen exposes health hierarchy without removing advanced ownership details', () => {
  const source = fs.readFileSync(DNS, 'utf8');
  for (const marker of ['ProductUX', 'Активный профиль', 'Provider', 'dnsmasq', 'Последнее применение', 'managed', 'external', 'provenance', 'revision'])
    assert.match(source, new RegExp(marker, 'i'), marker);
  assert.match(source, /ProductUX\.errorMessage/);
  assert.match(source, /rollbackAvailable/);
  for (const rpc of ['product\.preview', 'product\.validate', 'product\.apply', 'api\.dns\.rollback', 'serviceApplyStatus'])
    assert.match(source, new RegExp(rpc), rpc);
});

test('Telegram first screen answers install/provider/runtime/health/version/update and keeps lifecycle ownership', () => {
  const source = fs.readFileSync(TG, 'utf8');
  for (const marker of ['ProductUX', 'Установлен', 'Provider', 'Работает', 'Health', 'Версия', 'Обновление', 'Настройки'])
    assert.match(source, new RegExp(marker, 'i'), marker);
  for (const marker of ['tg\.product\.switch', 'tg\.product\.start', 'tg\.product\.stop', 'tg\.product\.restart', 'tg\.product\.checkUpdates', 'tg\.product\.operationStatus', 'z2m-tg-operation-running'])
    assert.match(source, new RegExp(marker), marker);
  assert.match(source, /ProductUX\.errorMessage/);
  assert.doesNotMatch(source, /new\s+.*installer|generic.*proxy.*backend/i);
});

test('Telegram operation polling is cleaned on unmount', () => {
  const source = fs.readFileSync(TG, 'utf8');
  const unmount = source.match(/function unmount\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(unmount, 'unmount function');
  assert.match(unmount[0], /clearTimeout\(state\.tgOperationTimer\)/);
  assert.match(unmount[0], /state\.tgPollGeneration\+\+/);
  assert.match(unmount[0], /tgViewportLock\(false\)/);
  assert.match(source, /var generation = state\.tgPollGeneration/);
});

test('DNS async apply polling is cleaned on unmount', () => {
  const source = fs.readFileSync(DNS, 'utf8');
  const unmount = source.match(/function unmount\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(unmount, 'unmount function');
  assert.match(unmount[0], /clearTimeout\(state\.serviceOperationTimer\)/);
  assert.match(unmount[0], /state\.serviceOperationInFlight\s*=\s*false/);
});

test('System Updates hands Telegram update checks to the canonical Telegram owner', () => {
  const source = fs.readFileSync(UPDATES, 'utf8');
  assert.match(source, /telegram-tunnel/);
  assert.match(source, /Проверить обновление|Обновление TG Proxy|Telegram Proxy/i);
  assert.doesNotMatch(source, /tg\.product\.(install|update|switch)\(/);
});
