import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const expectedRpc = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8');
const components = readFileSync(`${root}/z2m-components.css`, 'utf8');
const shell = readFileSync(`${root}/z2m-shell.js`, 'utf8');
const app = readFileSync(`${root}/app.js`, 'utf8');
const menu = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'));

const tabs = {
  overview: 'z2m-overview.js',
  strategy: 'z2m-strategy.js',
  services: 'z2m-services.js',
  lists: 'z2m-lists.js',
  dns: 'z2m-dns.js',
  proxy: 'z2m-proxy.js',
  monitor: 'z2m-monitor.js',
  maintenance: 'z2m-maintenance.js'
};

test('frontend RPC method sets remain unchanged', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});

test('single-view app owns all eight reference tabs', () => {
  const exported = evaluateLuciModule(`${root}/app.js`);
  assert.equal(typeof exported.load, 'function');
  assert.equal(typeof exported.render, 'function');
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
  for (const [id, file] of Object.entries(tabs)) {
    assert.equal(existsSync(`${root}/${file}`), true, `${id} module missing`);
    assert.match(app, new RegExp(`['"]${id}['"]`));
    const mod = evaluateLuciModule(`${root}/${file}`);
    assert.equal(mod.id, id);
    for (const method of ['load','render','mount','unmount'])
      assert.equal(typeof mod[method], 'function', `${file}: ${method}`);
  }
});

test('approved visual system stays local and covers the new application components', () => {
  for (const token of ['#17181a','#1f2124','#25282c','#2c3035','#4b9fd5','#5cb98b','#e0a33b','#e2695a'])
    assert.match(css.toLowerCase(), new RegExp(token));
  for (const cls of [
    '.z2m-apptop','.z2m-tabs','.z2m-subtabs','.z2m-panel','.z2m-btn',
    '.z2m-kpis','.z2m-applybar','.z2m-modal','.z2m-toasts','.z2m-qr'
  ]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
  for (const cls of [
    '.z2m-advanced-toggle','.z2m-fieldline','.z2m-rule','.z2m-profile-row',
    '.z2m-proxy-hero','.z2m-backup-row','.z2m-draft-preview'
  ]) assert.match(components, new RegExp(cls.replace('.', '\\.')));
  assert.match(shell, /z2m-components\.css/);
  assert.doesNotMatch(css + components, /@import|https?:\/\//);
});

test('LuCI menu exposes one app entry and only hidden compatibility routes', () => {
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/app');
  const actionable = Object.values(menu).filter((entry) => entry.action);
  assert.equal(actionable.filter((entry) => entry.hidden !== true).length, 1);
  for (const entry of actionable.filter((item) => item.hidden === true)) {
    assert.deepEqual(entry.depends.acl, ['zapret2-manager']);
    assert.match(entry.action.path, /^zapret2-manager\//);
  }
});

test('reference-critical Proxy, DNS and Backup Preview features are present', () => {
  const proxy = readFileSync(`${root}/z2m-proxy.js`, 'utf8');
  for (const label of ['Открыть в Telegram','Копировать ссылку','QR-код','Новая ссылка','Самопроверка','Собрать диагностику'])
    assert.match(proxy, new RegExp(label));
  assert.match(proxy, /ctx\.setDraft\(['"]proxy/);
  assert.doesNotMatch(proxy, /children\.forEach|window\.confirm/);

  const dns = readFileSync(`${root}/z2m-dns.js`, 'utf8');
  for (const pane of ['setup','check','access','adv','hist'])
    assert.match(dns, new RegExp(`['"]${pane}['"]`));

  const maintenance = readFileSync(`${root}/z2m-maintenance.js`, 'utf8');
  assert.match(maintenance, /id:\s*['"]z2m-backup-preview['"]/);
  assert.match(maintenance, /shell\.openModal/);
  assert.doesNotMatch(maintenance, /\.cbi-map|window\.confirm/);
});

test('legacy runtime and obsolete style fragments are not shipped', () => {
  for (const file of readdirSync(root))
    assert.equal(file.endsWith('-legacy.js'), false, `legacy runtime file shipped: ${file}`);
  for (const file of ['z2m-ui-core.css','z2m-ui-v1.css','z2m-shell.css','z2m-orchestra.css','orchestra-strategy.css'])
    assert.equal(existsSync(`${root}/${file}`), false, `obsolete CSS shipped: ${file}`);
  assert.equal(existsSync(`${root}/combo-presets.js`), false);
  assert.equal(existsSync('tests/ui/combo-presets.test.mjs'), false);
});
