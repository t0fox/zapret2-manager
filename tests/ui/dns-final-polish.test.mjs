import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const DNS = fs.readFileSync(ROOT + 'z2m-dns.js', 'utf8');
const CSS = fs.readFileSync(ROOT + 'z2m-ui.css', 'utf8');

test('DNS keeps the accepted six-tab primitive and removes duplicate history empty states', () => {
  for (const label of ['Настройка', 'Проверка и выбор', 'Маршрутизация', 'Для сервисов', 'Дополнительно', 'История'])
    assert.match(DNS, new RegExp(label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(DNS, /ctx\.shell\.subTabs\(/);
  assert.match(DNS, /История пока пуста/);
  assert.doesNotMatch(DNS, /Событий пока нет|История DNS пуста/);
  assert.match(DNS, /z2m-dns-history-empty/);
});

test('DNS history maps existing operation fields to human timeline rows and technical details', () => {
  assert.match(DNS, /function eventKind\(event\)/);
  assert.match(DNS, /DNS изменён/);
  assert.match(DNS, /Правила для сервисов изменены/);
  assert.match(DNS, /Выполнен откат/);
  for (const field of ['finishedAt', 'startedAt', 'routeCount', 'appliedRevision', 'verified', 'error'])
    assert.match(DNS, new RegExp(field));
  assert.match(DNS, /Технические сведения/);
  assert.match(DNS, /JSON\.stringify\(event/);
});

test('DNS rollback presentation keeps the existing API contract without disabled empty buttons', () => {
  assert.match(DNS, /ctx\.api\.dns\.rollback\(\)/);
  assert.match(DNS, /ctx\.api\.dns\.serviceRollback\(\)/);
  assert.match(DNS, /rollbackAvailable === true/);
  assert.match(DNS, /DNS-переопределения/);
  assert.match(DNS, /Правила для сервисов/);
  assert.doesNotMatch(DNS, /DNS overrides|Service mappings|Откатить DNS overrides|Откатить DNS сервисов/);
});

test('DNS provider and TikTok primary states stay human and preserve measured latency semantics', () => {
  assert.match(DNS, /answered \+ ' ' \+ _\('из'\)/);
  assert.match(DNS, /durationSource === ['"]dns-query-monotonic['"]/);
  assert.match(DNS, /Работает штатно/);
  assert.match(DNS, /Исправление активно/);
  assert.match(DNS, /Ищем рабочий CDN…/);
  assert.match(DNS, /Не удалось найти рабочий CDN/);
  assert.match(DNS, /autoSwitch\.classList\.toggle\(['"]on['"], auto\.enabled === true\)/);
  assert.match(DNS, /autoSwitch\.setAttribute\(['"]data-state['"]/);
  assert.doesNotMatch(DNS, /display\(auto\.state/);
});

test('DNS final polish gives provider, history, rollback, and narrow layouts stable geometry', () => {
  assert.match(CSS, /z2m-provider-row\{grid-template-columns:40px/);
  assert.match(CSS, /z2m-provider-actions\{min-width:150px/);
  assert.match(CSS, /z2m-dns-history-event\{display:grid;grid-template-columns:36px/);
  assert.match(CSS, /z2m-dns-rollback-list\{display:grid/);
  assert.match(CSS, /@media\(max-width:760px\)[\s\S]*z2m-dns-history-event/);
});
