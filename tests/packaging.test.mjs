import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const readJson = (name) => JSON.parse(readFileSync(join(REPO, name), 'utf8'));
const menu = readJson('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json');
const acl = readJson('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const viewRoot = join(REPO, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');

function entriesOf(obj) {
  return Object.entries(obj).filter(([, value]) => value.action && value.action.path)
    .map(([key, value]) => ({ key, title: value.title, path: value.action.path, order: value.order, hidden: value.hidden === true }));
}
function viewFile(path) {
  return join(viewRoot, path.split('/').pop() + '.js');
}
const entries = entriesOf(menu);
const compatibilityRedirects = [
  'orchestra-strategy','orchestra','strategies','lists','dns',
  'service-dns','proxy','monitor','maintenance'
];

test('menu and ACL JSON parse', () => {
  assert.ok(menu['admin/services/zapret2-manager']);
  assert.ok(acl['zapret2-manager']);
});

test('menu publishes exactly one single-view application route', () => {
  assert.deepEqual(Object.keys(menu), ['admin/services/zapret2-manager']);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'zapret2-manager/app');
});

test('all published menu routes resolve to shipped view modules', () => {
  const missing = entries.filter((entry) => !existsSync(viewFile(entry.path)));
  assert.deepEqual(missing, []);
});

test('single-view runtime modules and local stylesheets exist', () => {
  for (const name of [
    'app.js','z2m-api.js','z2m-store.js','z2m-shell.js','z2m-ui.css','z2m-components.css',
    'z2m-overview.js','z2m-overview-model.js','z2m-draft-model.js','z2m-strategy.js','z2m-services.js',
    'z2m-services-model.js','z2m-lists.js','z2m-dns.js',
    'z2m-proxy.js','z2m-qr.js','z2m-monitor.js','z2m-maintenance.js'
  ]) assert.ok(existsSync(join(viewRoot, name)), `${name} exists`);
});

test('r143 package ships no legacy runtime and only the two authoritative local stylesheets', () => {
  const makefile = readFileSync(join(REPO, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /^PKG_RELEASE:=143$/m);
  const files = readdirSync(viewRoot).sort();
  assert.deepEqual(files.filter((name) => name.endsWith('.css')), ['z2m-components.css', 'z2m-ui.css']);
  assert.deepEqual(files.filter((name) => name.endsWith('-legacy.js')), []);
  for (const obsolete of ['overview.js', 'catalog.js', 'blockcheck.js'])
    assert.equal(files.includes(obsolete), false, `${obsolete} is not shipped`);
  for (const obsolete of ['z2m-ui-core.css','z2m-ui-v1.css','z2m-shell.css','z2m-orchestra.css'])
    assert.equal(files.includes(obsolete), false, `${obsolete} is not shipped`);
  for (const stylesheet of ['z2m-components.css', 'z2m-ui.css']) {
    const source = readFileSync(join(viewRoot, stylesheet), 'utf8');
    assert.doesNotMatch(source, /@import|https?:\/\//, `${stylesheet} stays self-contained`);
  }
});

test('shipped LuCI sources contain no countdown, fake catalogue or demo secrets', () => {
  const source = readdirSync(viewRoot).filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(viewRoot, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /rollback_ttl|z2m-countdown|automatic[- ]rollback/i);
  assert.doesNotMatch(source, /Flowseal ALT11|\bdemo\b/i);
  assert.doesNotMatch(source, /(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"]+['"]/i);
});

test('backend and full-stack meta-package releases advance together to r137', () => {
  const backend = readFileSync(join(REPO, 'zapret2-manager/Makefile'), 'utf8');
  const full = readFileSync(join(REPO, 'zapret2-manager-full/Makefile'), 'utf8');
  assert.match(backend, /^PKG_RELEASE:=137$/m);
  assert.match(full, /^PKG_RELEASE:=137$/m);
});

test('compatibility redirects remain shipped but are not registered as LuCI child tabs', () => {
  for (const name of compatibilityRedirects) {
    assert.ok(existsSync(join(viewRoot, `${name}.js`)), `${name}.js redirect exists`);
    assert.equal(menu[`admin/services/zapret2-manager/${name}`], undefined, `${name} menu route is absent`);
  }
});

test('critical RPC methods remain covered by ACL', () => {
  const read = new Set(acl['zapret2-manager'].read.ubus['zapret2-manager']);
  const write = new Set(acl['zapret2-manager'].write.ubus['zapret2-manager']);
  const requiredRead = [
    'service_dns_providers','service_dns_status','service_dns_check','service_dns_preview',
    'catalog_list','catalog_status','catalog_preview','orchestra_capabilities','orchestra_status','health_matrix_get'
  ];
  const requiredWrite = [
    'service_dns_set','service_dns_apply','service_dns_rollback','catalog_apply','health_matrix_start','health_matrix_job_cancel'
  ];
  assert.deepEqual(requiredRead.filter((method) => !read.has(method)), []);
  assert.deepEqual(requiredWrite.filter((method) => !write.has(method)), []);
});
