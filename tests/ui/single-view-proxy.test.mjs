import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-proxy.js', 'z2m-qr.js']) {
  test(`${name} is a valid internal LuCI module`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    assert.equal(typeof mod, 'object');
  });
}

test('proxy tab exposes lifecycle and every existing proxy workflow', () => {
  const mod = evaluateLuciModule(`${root}/z2m-proxy.js`);
  for (const key of ['id','title','subtitle','load','render','mount','unmount']) assert.ok(mod[key] != null, key);
  for (const key of ['load','render','mount','unmount']) assert.equal(typeof mod[key], 'function');
  const src = source('z2m-proxy.js');
  for (const token of [
    'api.proxy.capabilities','api.proxy.status','api.proxy.configGet','api.proxy.configValidate',
    'api.proxy.configPreview','api.proxy.start','api.proxy.stop','api.proxy.restart',
    'api.proxy.autostartSet','api.proxy.secretRotate','api.proxy.logsTail','api.proxy.health',
    'api.proxy.linkInfo','api.proxy.quickInstall'
  ]) assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  for (const label of [
    'Открыть в Telegram','Копировать ссылку','QR-код','Новая ссылка','Недавняя активность',
    'Настройки','Техническое','Перезапустить','Самопроверка','Собрать диагностику','Остановить службу'
  ]) assert.match(src, new RegExp(label));
  assert.match(src, /reveal:\s*true[\s\S]*confirm:\s*['"]REVEAL['"]/);
  assert.match(src, /ctx\.openSemanticDiff/);
  assert.match(src, /безопасный adapter отсутствует/);
  assert.match(src, /ctx\.root\.replaceChildren/);
  assert.doesNotMatch(src, /children\.forEach/);
  assert.doesNotMatch(src, /-legacy/);
});

test('proxy settings participate in shared draft state and remain blocked without a safe adapter', () => {
  const src = source('z2m-proxy.js');
  assert.match(src, /ctx\.setDraft\(['"]proxy['"]/);
  assert.doesNotMatch(src, /ctx\.clearDraft\(['"]proxy['"]/);
  assert.match(src, /changes:\s*\{\s*settings/);
  assert.doesNotMatch(src, /ctx\.api\.proxy\.configApply/);
});

test('proxy rotation uses shared modal and activity uses redacted backend logs', () => {
  const src = source('z2m-proxy.js');
  assert.match(src, /shell\.openModal/);
  assert.doesNotMatch(src, /window\.confirm/);
  assert.match(src, /data\.logs/);
  assert.match(src, /api\.proxy\.logsTail/);
  assert.match(src, /redacted/i);
});

test('QR encoder matches deterministic Telegram link oracle and keeps a four-module quiet zone', () => {
  const qr = evaluateLuciModule(`${root}/z2m-qr.js`);
  const text = 'https://t.me/proxy?server=192.168.1.1&port=1443&secret=ee0123456789abcdef0123456789abcdef';
  const result = qr.matrix(text);
  assert.equal(result.version, 6);
  assert.equal(result.mask, 7);
  const border = 4, n = result.modules.length;
  let bits = '';
  for (let row = -border; row < n + border; row++)
    for (let col = -border; col < n + border; col++)
      bits += row >= 0 && col >= 0 && row < n && col < n && result.modules[row][col] ? '1' : '0';
  assert.equal(n + border * 2, 49);
  assert.equal(crypto.createHash('sha256').update(bits).digest('hex'), '07c6fb83fff3cd5c10c3c4613351d4ef51334a2249aea513dcff83e6b0c37fa5');
  assert.match(source('z2m-qr.js'), /border\s*=\s*4/);
  assert.match(source('z2m-qr.js'), /#fff/);
  const long = qr.matrix('x'.repeat(1000));
  assert.equal(long.version, 26);
  assert.equal(long.mask, 2);
});

test('app registers Telegram Proxy as the proxy tab', () => {
  const app = source('app.js');
  assert.match(app, /z2m-proxy as Proxy/);
  assert.match(app, /proxy:\s*Proxy/);
});
