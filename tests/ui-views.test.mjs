import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLuciModule } from '../tools/luci-module-smoke.mjs';

const VIEW_DIR = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const MENU = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'));
const ACL = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];
const INTERNAL = {
  overview: 'z2m-overview.js', strategy: 'z2m-strategy-page.js', services: 'z2m-services.js',
  lists: 'z2m-lists.js', dns: 'z2m-dns.js', proxy: 'z2m-proxy.js',
  monitor: 'z2m-monitor.js', maintenance: 'z2m-maintenance.js'
};
const REDIRECTS = {
  'orchestra-strategy.js': 'overview', 'orchestra.js': 'strategy', 'strategies.js': 'strategy',
  'lists.js': 'lists', 'dns.js': 'dns', 'service-dns.js': 'dns', 'proxy.js': 'proxy',
  'monitor.js': 'monitor', 'maintenance.js': 'maintenance'
};

test('all shipped JavaScript files compile as LuCI function bodies', () => {
  for (const file of readdirSync(VIEW_DIR).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(VIEW_DIR, file), 'utf8');
    assert.doesNotThrow(() => new Function(source), file);
  }
});

test('app is the only visible LuCI entry and owns eight internal tabs', () => {
  const visible = Object.entries(MENU).filter(([, entry]) => entry.action && entry.hidden !== true);
  assert.equal(visible.length, 1);
  assert.equal(visible[0][1].action.path, 'zapret2-manager/app');
  const app = readFileSync(join(VIEW_DIR, 'app.js'), 'utf8');
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
  for (const id of Object.keys(INTERNAL)) assert.match(app, new RegExp(`['"]${id}['"]`));
});

test('all internal tab modules expose the lifecycle contract', () => {
  for (const [id, file] of Object.entries(INTERNAL)) {
    const mod = evaluateLuciModule(join(VIEW_DIR, file));
    assert.equal(mod.id, id);
    for (const method of ['load','render','mount','unmount']) assert.equal(typeof mod[method], 'function', `${file}: ${method}`);
  }
});

test('hidden compatibility routes resolve to standalone redirects', () => {
  for (const [file, tab] of Object.entries(REDIRECTS)) {
    assert.equal(existsSync(join(VIEW_DIR, file)), true);
    const source = readFileSync(join(VIEW_DIR, file), 'utf8');
    assert.match(source, /window\.location\.replace/);
    assert.match(source, new RegExp(`#/${tab}`));
    assert.doesNotMatch(source, /-legacy|return\s+Legacy/);
  }
});

test('every menu action resolves to a shipped view and has iterable ACL', () => {
  for (const entry of Object.values(MENU)) {
    if (!entry.action?.path) continue;
    const leaf = entry.action.path.split('/').pop();
    assert.equal(existsSync(join(VIEW_DIR, `${leaf}.js`)), true, entry.action.path);
    assert.equal(Array.isArray(entry.depends?.acl), true, entry.action.path);
  }
});

test('central ACL covers critical read and write actions', () => {
  const read = new Set(ACL.read.ubus['zapret2-manager']);
  const write = new Set(ACL.write.ubus['zapret2-manager']);
  for (const method of ['status','orchestra_run_status','orchestra_run_history','dns_get','proxy_status','backup_list']) assert.ok(read.has(method), method);
  for (const method of ['discord_profile_apply','orchestra_run_start','dns_apply','proxy_restart','backup_create']) assert.ok(write.has(method), method);
});

test('single-view module graph has no runtime legacy imports', () => {
  for (const file of ['app.js', ...Object.values(INTERNAL), 'z2m-api.js','z2m-store.js','z2m-shell.js','z2m-auto.js','z2m-runs.js','z2m-strategy.js']) {
    const source = readFileSync(join(VIEW_DIR, file), 'utf8');
    assert.doesNotMatch(source, /-legacy|return\s+Legacy/);
  }
});

test('local styles and QR encoder are shipped', () => {
  for (const file of ['z2m-ui.css','z2m-components.css','z2m-qr.js']) assert.equal(existsSync(join(VIEW_DIR, file)), true, file);
  const css = readFileSync(join(VIEW_DIR, 'z2m-ui.css'), 'utf8') + readFileSync(join(VIEW_DIR, 'z2m-components.css'), 'utf8');
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
