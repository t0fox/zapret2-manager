import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const tg = fs.readFileSync(`${ROOT}/z2m-proxy-page-core.js`, 'utf8');
const overview = fs.readFileSync(`${ROOT}/z2m-overview.js`, 'utf8');
const dashboard = fs.readFileSync(`${ROOT}/z2m-avatar-dashboard.js`, 'utf8');

test('Telegram Proxy exposes the service-first information architecture', () => {
  for (const label of ['Обзор', 'Компонент', 'Настройки', 'Журнал'])
    assert.match(tg, new RegExp(`label: _\\('${label}'\\)`), label);
  assert.match(tg, /providerInstalled\(pstatus\.installed\) \? 'overview' : 'component'/);
  assert.match(tg, /PANE_ALIASES|paneAliases|legacy.*status/i);
  assert.match(tg, /Проверить/);
  assert.match(tg, /Ещё/);
  assert.match(tg, /Технические сведения/);
});

test('Telegram Proxy status is represented by the shared main dashboard card pattern', () => {
  // The staged overview loader owns the secondary TG RPCs.
  const loading = fs.readFileSync(`${ROOT}/z2m-overview-loading.js`, 'utf8');
  assert.match(loading, /ctx\.api\.tg\.product\.status\(\)|tg\.product\.status\(\)/);
  assert.match(overview, /tgHealth/);
  assert.match(overview, /tgStatus/);
  assert.match(overview, /card-telegram/);
  assert.match(overview, /Telegram Proxy/);
  assert.match(overview, /Провайдер/);
  assert.match(dashboard, /status-card-value/);
  assert.match(dashboard, /card-telegram/);
});

test('Telegram Proxy keeps package revisions out of the normal version label and allows Rust rollback', () => {
  assert.match(tg, /function installedVersionDisplay/);
  assert.match(tg, /version !== null && version !== undefined && version !== ''/);
  // CTA follows the selected version immediately (label + availability).
  assert.match(tg, /function actionKindFor/);
  assert.match(tg, /ctx\.root\.replaceChildren\(render\(ctx\)\)/);
  assert.match(tg, /Откатить версию/);
  assert.match(tg, /function providerCatalog\(data\)/);
  assert.match(tg, /providerVersions\(data\)\.map/);
});

test('Telegram Proxy read-only load cannot remain on the initial skeleton forever', () => {
  const core = fs.readFileSync(`${ROOT}/z2m-proxy-page-core.js`, 'utf8');
  for (const call of [
    'ctx.api.proxy.capabilities()',
    'ctx.api.proxy.status()',
    'ctx.api.proxy.configGet()',
    'ctx.api.tg.product.status()',
    'ctx.api.tg.product.versions()',
    'ctx.api.tg.product.operationStatus({})'
  ]) assert.ok(core.includes(`boundedLoad(${call}`), call);
  assert.match(core, /boundedLoad\(ctx\.api\.tg\.product\.checkUpdates/);
});
