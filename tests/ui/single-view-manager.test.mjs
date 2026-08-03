import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';
import { collectFacadeMethods, collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const expected = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));

test('app.js yields a valid LuCI view', () => {
  const exported = evaluateLuciModule(`${root}/app.js`);
  assert.equal(typeof exported, 'object');
  assert.equal(typeof exported.load, 'function');
  assert.equal(typeof exported.render, 'function');
});

test('core modules never return a legacy view', () => {
  for (const file of ['app.js', 'z2m-api.js', 'z2m-store.js', 'z2m-shell.js']) {
    const src = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(src, /require\s+view\.zapret2-manager\..*-legacy/);
    assert.doesNotMatch(src, /return\s+Legacy\w*/);
  }
});

test('all internal modules satisfy LuCI baseclass loader contract', () => {
  const support = [
    'z2m-api.js', 'z2m-store.js', 'z2m-shell.js', 'z2m-qr.js',
    'z2m-auto.js', 'z2m-runs.js', 'z2m-strategy.js', 'z2m-strategy-page.js',
    'z2m-overview.js', 'z2m-services.js', 'z2m-lists.js', 'z2m-dns.js',
    'z2m-proxy.js', 'z2m-monitor.js', 'z2m-maintenance.js'
  ];
  for (const file of support) {
    const src = readFileSync(`${root}/${file}`, 'utf8');
    assert.match(src, /'require baseclass';/, `${file} must require LuCI baseclass`);
    assert.match(src, /return baseclass\.extend\(/, `${file} must export a baseclass subclass`);
  }
});

test('single API facade preserves the frozen RPC contract', () => {
  assert.deepEqual(collectUiContract(), expected);
  const flattened = [...new Set(Object.values(expected).flat())].sort();
  assert.deepEqual(collectFacadeMethods(), flattened);
});

const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';
const redirectMap = {
  'orchestra-strategy.js': 'overview',
  'orchestra.js': 'strategy',
  'strategies.js': 'strategy',
  'lists.js': 'lists',
  'dns.js': 'dns',
  'service-dns.js': 'dns',
  'proxy.js': 'proxy',
  'monitor.js': 'monitor',
  'maintenance.js': 'maintenance'
};

test('reference shell exposes eight hash tabs and exact visual tokens', () => {
  const app = readFileSync(`${root}/app.js`, 'utf8');
  const css = readFileSync(`${root}/z2m-ui.css`, 'utf8');
  for (const id of ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'])
    assert.match(app, new RegExp(`['"]${id}['"]`));
  for (const token of ['#17181a','#1f2124','#25282c','#2c3035','#4b9fd5','#5cb98b','#e0a33b','#e2695a'])
    assert.match(css.toLowerCase(), new RegExp(token));
  for (const selector of ['.z2m-apptop','.z2m-tabs','.z2m-applybar','.z2m-modal','.z2m-toasts'])
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  assert.doesNotMatch(css, /@import/);
});

test('hash navigation has one activation owner and unmount receives the active context', () => {
  const app = readFileSync(`${root}/app.js`, 'utf8');
  assert.match(app, /function\s+navigateTo\s*\(/);
  assert.match(app, /activeContext/);
  assert.match(app, /activeModule\.unmount\(activeContext\)/);
  assert.doesNotMatch(app, /setHash\(next\);\s*activate\(next\)/);
  assert.doesNotMatch(app, /setHash\(tab\);\s*activate\(tab\)/);
});

test('draft and confirmation bars expose safe scope-aware actions', () => {
  const app = readFileSync(`${root}/app.js`, 'utf8');
  const shell = readFileSync(`${root}/z2m-shell.js`, 'utf8');
  const store = readFileSync(`${root}/z2m-store.js`, 'utf8');
  for (const id of ['z2m-discard-drafts','z2m-preview-drafts','z2m-open-drafts','z2m-rollback-now','z2m-confirm-alive'])
    assert.match(shell, new RegExp(id));
  assert.match(shell, /renderConfirmBar/);
  assert.match(store, /clearAllDrafts/);
  assert.match(app, /DRAFT_TAB/);
  assert.match(app, /Api\.strategy\.confirmAlive/);
  assert.match(app, /Api\.strategy\.rollbackManager/);
  assert.match(app, /rollback_ttl/);
  assert.match(app, /setConfirmation/);
  assert.doesNotMatch(app, /rollback_ttl\s*\|\|\s*(?:60|90)/);
});

test('menu exposes one app entry and hidden compatibility routes', () => {
  const menu = JSON.parse(readFileSync(menuPath, 'utf8'));
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/app');
  assert.equal(Object.values(menu).filter((entry) => entry.hidden !== true && entry.action).length, 1);
  for (const entry of Object.values(menu).filter((item) => item.hidden === true))
    assert.deepEqual(entry.depends.acl, ['zapret2-manager']);
});

test('compatibility routes are standalone valid redirect views', () => {
  for (const [file, tab] of Object.entries(redirectMap)) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    const exported = evaluateLuciModule(`${root}/${file}`);
    assert.equal(typeof exported.load, 'function');
    assert.match(source, /window\.location\.replace/);
    assert.match(source, new RegExp(`#/${tab}`));
    assert.doesNotMatch(source, /return\s+Legacy/);
  }
});

test('packaged frontend contains no legacy runtime or obsolete stylesheet', () => {
  for (const file of readdirSync(root))
    assert.equal(file.endsWith('-legacy.js'), false, `legacy runtime file shipped: ${file}`);
  for (const file of ['z2m-ui-core.css','z2m-ui-v1.css','z2m-shell.css','z2m-orchestra.css'])
    assert.equal(existsSync(`${root}/${file}`), false, `obsolete CSS shipped: ${file}`);
  const app = readFileSync(`${root}/app.js`, 'utf8');
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
});
