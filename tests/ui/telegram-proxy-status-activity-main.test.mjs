import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const core = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js', 'utf8');
const avatarLog = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js', 'utf8');
const diagnostics = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-diagnostics-page.js', 'utf8');

test('Telegram Activity reads the canonical journal and filters by structured TG identity', () => {
  assert.match(core, /z2m-avatar-log as AvatarLog/);
  assert.match(core, /eventsTail/);
  assert.match(core, /component|subsystem|owner|source/);
  assert.match(core, /telegramEventRows|isTelegramEvent/);
  assert.doesNotMatch(core, /proxyLogsTail/);
  assert.doesNotMatch(core, /message\.toLowerCase|indexOf\([^)]*nfqws2|indexOf\([^)]*zapret2/);
});

test('Telegram Activity reuses Home and Diagnostics event presentation', () => {
  assert.match(core, /AvatarLog\.normalizeRows/);
  assert.match(core, /AvatarLog\.renderNormalized/);
  assert.match(core, /shell\.format\.timestamp/);
  assert.match(core, /compact:\s*true/);
  assert.match(avatarLog, /class.*log-row|log-entry/);
  assert.match(avatarLog, /severity-badge/);
});

test('Telegram Journal has a bounded preview, truthful empty state, refresh and full-journal link', () => {
  assert.match(core, /Журнал Telegram Proxy/);
  assert.match(core, /Событий Telegram Proxy пока нет/);
  assert.match(core, /Открыть все журналы/);
  assert.match(core, /ctx\.navigate\(['"]logs['"]\)/);
  assert.match(core, /normalizeRows\([^,]+,\s*8\)/);
  assert.match(diagnostics, /AvatarLog\.load\(ctx\)/);
});

test('Telegram Activity keeps raw fields only in technical details', () => {
  assert.match(core, /advanced:\s*true/);
  assert.match(core, /Технические детали/);
  assert.doesNotMatch(core, /Копировать диагностику/);
  assert.doesNotMatch(core, /z2m-proxy-log-table/);
});

test('Telegram Overview preserves the hero and removes the legacy KPI/status duplicates', () => {
  assert.match(core, /z2m-proxy-telegram-logo/);
  assert.match(core, /Работает с ограничениями/);
  assert.match(core, /z2m-proxy-lifecycle-actions/);
  assert.doesNotMatch(core, /z2m-product-health-grid/);
  assert.doesNotMatch(core, /stateRows|statusRows/);
  assert.doesNotMatch(core, /Состояние Telegram Proxy/);
  assert.doesNotMatch(core, /Подключение Telegram/);
});

test('Telegram Overview composes one service summary, compact chain and one technical disclosure', () => {
  const statusSource = core.slice(core.indexOf('function statusPane'), core.indexOf('function fieldNode'));
  assert.match(statusSource, /Сервис/);
  assert.doesNotMatch(statusSource, /Дополнительное состояние/);
  assert.match(statusSource, /z2m-proxy-health-chain/);
  assert.match(statusSource, /Провайдер/);
  assert.match(statusSource, /Telegram DC/);
  assert.equal((statusSource.match(/Технические сведения/g) || []).length, 1);
  assert.match(statusSource, /Состояние провайдера/);
  assert.match(core, /canonicalProjection\(pstatus, object\(data\.health/);
});

test('Telegram Status uses only backend-provided fields for additional and technical state', () => {
  const statusSource = core.slice(core.indexOf('function statusPane'), core.indexOf('function fieldNode'));
  assert.match(statusSource, /cfg\.autostart/);
  assert.match(statusSource, /cfg\.appliedRevision/);
  assert.match(statusSource, /raw\.health/);
  assert.match(statusSource, /pstatus\.activePackageVersion/);
  assert.doesNotMatch(statusSource, /fake|invent|synthetic/i);
});

test('Activity errors use the canonical events envelope', () => {
  assert.match(core, /['"]events['"]/);
  assert.doesNotMatch(core, /['"]logs['"]\s*\]|data\.logs/);
});
