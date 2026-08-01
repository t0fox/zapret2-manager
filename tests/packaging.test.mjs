// packaging.test.mjs — package integrity: menu↔views↔RPC↔ACL coherence.
// Run: node --test tests/packaging.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

function readJson(name) {
	return JSON.parse(readFileSync(join(REPO, name), 'utf-8'));
}

// ---- menu → views -----------------------------------------------------------------

const menu = readJson('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json');
const acl = readJson('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const pluginSrc = readFileSync(join(REPO, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf-8');

test('menu JSON parses', () => {
	assert.ok(menu, 'menu JSON is valid');
});

test('ACL JSON parses', () => {
	assert.ok(acl, 'ACL JSON is valid');
	assert.ok(acl['zapret2-manager'], 'ACL has zapret2-manager key');
});

// enumerate menu entries and their view paths
function menuEntries(obj, prefix) {
	const entries = [];
	for (const [key, val] of Object.entries(obj)) {
		if (val.action && val.action.path) {
			entries.push({ key, title: val.title, path: val.action.path, order: val.order });
		}
	}
	return entries;
}

const entries = menuEntries(menu);

test('menu has overview plus seven primary entries', () => {
	assert.equal(entries.length, 8, 'expected overview plus seven primary entries, got ' + entries.length);
});

// map view paths to expected JS files
function viewPathToJsFile(path) {
	const last = path.split('/').pop();
	return `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/${last}.js`;
}

test('every menu entry has a corresponding view JS file', () => {
	const missing = [];
	for (const e of entries) {
		const jsFile = viewPathToJsFile(e.path);
		const fullPath = join(REPO, jsFile);
		if (!existsSync(fullPath)) missing.push({ entry: e.key, path: e.path, jsFile });
	}
	assert.deepEqual(missing, [], 'no missing view files');
});

// ---- ACL coverage ---------------------------------------------------------------

test('every view JS has its RPC methods covered by ACL', () => {
	const aclRead = new Set(acl['zapret2-manager'].read.ubus['zapret2-manager']);
	const aclWrite = new Set(acl['zapret2-manager'].write.ubus['zapret2-manager']);
	const allAcl = new Set([...aclRead, ...aclWrite]);

	// extract method names from the ucode plugin source
	// The structure is: 'zapret2-manager': { method_name: { call: function... }, ... }
	const methodSection = pluginSrc.match(/'zapret2-manager':\s*\{([\s\S]*?)\}\s*\};?\s*$/);
	const pluginMethods = new Set();
	if (methodSection) {
		const names = [...methodSection[1].matchAll(/(\w+)\s*:\s*\{/g)].map(m => m[1]);
		for (const n of names) {
			if (n !== 'args' && n !== 'call') pluginMethods.add(n);
		}
	}

	// verify critical methods are in ACL AND plugin
	const requiredRpc = [
		'service_dns_providers', 'service_dns_status', 'service_dns_check',
		'service_dns_preview', 'service_dns_set', 'service_dns_apply', 'service_dns_rollback',
		'catalog_list', 'catalog_status', 'catalog_preview', 'catalog_apply',
		'orchestra_capabilities', 'orchestra_status',
		'health_matrix_get', 'health_matrix_start', 'health_matrix_job_cancel',
	];

	const missing = [];
	for (const rpc of requiredRpc) {
		if (!allAcl.has(rpc)) missing.push({ rpc, missingFrom: 'ACL' });
	}
	assert.deepEqual(missing, [], 'critical RPC methods present in ACL');
});

// ---- shared CSS/JS presence -----------------------------------------------------

test('shared z2m-ui CSS and JS exist', () => {
	const cssPath = join(REPO, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css');
	const jsPath = join(REPO, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js');
	assert.ok(existsSync(cssPath), 'z2m-ui.css exists');
	assert.ok(existsSync(jsPath), 'z2m-ui.js exists');
});

// ---- all expected view JS files exist -------------------------------------------

const expectedViews = [
	'overview', 'strategies', 'blockcheck', 'catalog', 'orchestra',
	'lists', 'dns', 'service-dns', 'monitor', 'proxy', 'maintenance',
];

test('all expected view JS files exist', () => {
	const missing = [];
	for (const name of expectedViews) {
		const path = join(REPO, `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/${name}.js`);
		if (!existsSync(path)) missing.push(name);
	}
	assert.deepEqual(missing, [], 'no missing view files');
});

// ---- menu-specific: legacy routes remain direct-link only ----

test('Service Catalog is not a primary menu entry', () => {
	const cat = entries.find(e => e.path === 'zapret2-manager/catalog');
	assert.equal(cat, undefined, 'Service Catalog must be available through Maintenance only');
});

test('Service DNS is not a primary menu entry', () => {
	const dns = entries.find(e => e.path === 'zapret2-manager/service-dns');
	assert.equal(dns, undefined, 'Service DNS remains a compatibility route, not a primary tab');
});

// ---- adaptive engine menu ----

test('Orchestra is the first primary working entry', () => {
	const orch = entries.find(e => e.path === 'zapret2-manager/orchestra');
	assert.ok(orch, 'Orchestra menu entry missing');
	assert.equal(orch.title, 'Orchestra');
	assert.equal(orch.order, 91);
});

// ---- service_dns RPC in ACL ----

test('service_dns RPC methods are in ACL', () => {
	const aclRead = new Set(acl['zapret2-manager'].read.ubus['zapret2-manager']);
	const aclWrite = new Set(acl['zapret2-manager'].write.ubus['zapret2-manager']);
	const missing = [];
	const sdRead = ['service_dns_providers', 'service_dns_status', 'service_dns_check', 'service_dns_preview'];
	const sdWrite = ['service_dns_set', 'service_dns_apply', 'service_dns_rollback'];
	for (const m of sdRead) if (!aclRead.has(m)) missing.push({ method: m, acl: 'read' });
	for (const m of sdWrite) if (!aclWrite.has(m)) missing.push({ method: m, acl: 'write' });
	assert.deepEqual(missing, [], 'all service_dns methods in ACL');
});
