import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const readJson = (name) => JSON.parse(readFileSync(join(REPO, name), 'utf8'));
const menu = readJson('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json');
const acl = readJson('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');

function entriesOf(obj) {
  return Object.entries(obj).filter(([, value]) => value.action && value.action.path)
    .map(([key, value]) => ({ key, title: value.title, path: value.action.path, order: value.order, hidden: value.hidden === true }));
}
function viewFile(path) {
  return join(REPO, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager', path.split('/').pop() + '.js');
}
const entries = entriesOf(menu);

test('menu and ACL JSON parse', () => {
  assert.ok(menu['admin/services/zapret2-manager']);
  assert.ok(acl['zapret2-manager']);
});

test('one visible menu entry opens the single app view', () => {
  const visible = entries.filter((entry) => !entry.hidden);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].key, 'admin/services/zapret2-manager');
  assert.equal(visible[0].path, 'zapret2-manager/app');
});

test('all menu routes resolve to shipped view modules', () => {
  const missing = entries.filter((entry) => !existsSync(viewFile(entry.path)));
  assert.deepEqual(missing, []);
});

test('single-view runtime modules and stylesheet exist', () => {
  const base = join(REPO, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
  for (const name of ['app.js','z2m-api.js','z2m-store.js','z2m-shell.js','z2m-ui.css'])
    assert.ok(existsSync(join(base, name)), `${name} exists`);
});

test('compatibility routes remain hidden', () => {
  const expected = ['orchestra-strategy','orchestra','strategies','lists','dns','service-dns','proxy','monitor','maintenance'];
  for (const name of expected) {
    const route = menu[`admin/services/zapret2-manager/${name}`];
    assert.ok(route, `${name} route exists`);
    assert.equal(route.hidden, true, `${name} route is hidden`);
    assert.equal(route.action.path, `zapret2-manager/${name}`);
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
