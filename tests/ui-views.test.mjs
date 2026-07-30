// tests/ui-views.test.mjs — JS syntax check + menu coherence for all Z2M views (r38)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const VIEW_DIR = resolve(__dirname, '..', 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');
const MENU_JSON = resolve(__dirname, '..', 'luci-app-zapret2-manager', 'files', 'usr', 'share', 'luci', 'menu.d', 'luci-app-zapret2-manager.json');
const Z2M_CSS = resolve(VIEW_DIR, 'z2m-ui.css');
const SERVICE_DNS_JS = resolve(VIEW_DIR, 'service-dns.js');

function syntaxCheck(filePath) {
	try { execSync('node --check ' + JSON.stringify(filePath), { stdio: 'pipe' }); return null; }
	catch (e) { return String(e.stderr || e.message); }
}

describe('View JS syntax checks', () => {
	const files = readdirSync(VIEW_DIR).filter(f => f.endsWith('.js'));
	files.forEach(f => {
		const path = join(VIEW_DIR, f);
		it(f + ' passes node --check', () => {
			const err = syntaxCheck(path);
			assert.strictEqual(err, null, err || 'syntax OK');
		});
	});
});

describe('DNS consolidation', () => {
	it('menu JSON has exactly one DNS menu entry among sub-pages', () => {
		const raw = JSON.parse(readFileSync(MENU_JSON, 'utf-8'));
		const subKeys = Object.keys(raw).filter(k => k.startsWith('admin/services/zapret2-manager/'));
		const dnsKeys = subKeys.filter(k => k === 'admin/services/zapret2-manager/dns');
		assert.strictEqual(dnsKeys.length, 1, 'exactly one DNS tab: ' + JSON.stringify(dnsKeys));
	});

	it('no Service DNS menu entry remains', () => {
		const raw = JSON.parse(readFileSync(MENU_JSON, 'utf-8'));
		const subKeys = Object.keys(raw).filter(k => k.startsWith('admin/services/zapret2-manager/'));
		assert.ok(!subKeys.includes('admin/services/zapret2-manager/service-dns'),
			'service-dns menu entry must be absent');
	});

	it('all menu orders are integers', () => {
		const raw = JSON.parse(readFileSync(MENU_JSON, 'utf-8'));
		const subKeys = Object.keys(raw).filter(k => k.startsWith('admin/services/zapret2-manager/'));
		subKeys.forEach(k => {
			const entry = raw[k];
			if (entry.order != null) {
				assert.ok(Number.isInteger(entry.order),
					k + ' has non-integer order: ' + entry.order);
			}
		});
	});

	it('exactly 9 visible product sub-tabs (overview included)', () => {
		const raw = JSON.parse(readFileSync(MENU_JSON, 'utf-8'));
		const subKeys = Object.keys(raw).filter(k => k.startsWith('admin/services/zapret2-manager/'));
		assert.strictEqual(subKeys.length, 9,
			'expected 9 sub-tabs: ' + JSON.stringify(subKeys.sort()));
	});

	it('old service-dns.js still exists as a JS file (compatibility route)', () => {
		assert.ok(existsSync(SERVICE_DNS_JS), 'service-dns.js must exist as a compatibility route');
	});

	it('service-dns.js passes syntax check', () => {
		const err = syntaxCheck(SERVICE_DNS_JS);
		assert.strictEqual(err, null, err || 'syntax OK');
	});
});

describe('Dark-theme regression in shared CSS', () => {
	it('z2m-ui.css contains dark mode z2m-mono override', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		assert.ok(css.includes('.z2m-mono') && css.includes('background'),
			'z2m-mono must have a background in dark mode');
	});

	it('z2m-ui.css contains z2m-tabs styles', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		assert.ok(css.includes('.z2m-tabs'), 'z2m-tabs CSS class must exist');
	});

	it('no hardcoded white backgrounds (#fff, #ffffff, white) in z2m-ui dark section', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
		if (darkStart === -1) return;
		const darkSection = css.substring(darkStart);
		assert.ok(!darkSection.includes('#fff') && !darkSection.includes('#ffffff') && !darkSection.includes('background: white'),
			'dark section must not use hardcoded white backgrounds');
	});
});

describe('LuCI view file coherence', () => {
	it('all view files return L.view.extend or define a module', () => {
		const files = readdirSync(VIEW_DIR).filter(f => f.endsWith('.js') && f !== 'z2m-ui.js');
		files.forEach(f => {
			const content = readFileSync(join(VIEW_DIR, f), 'utf-8');
			assert.ok(content.includes('.extend({') || content.includes('return {'),
				f + ' does not appear to define a view module');
		});
	});

	it('no ucode-style type() calls remain in any view', () => {
		const files = readdirSync(VIEW_DIR).filter(f => f.endsWith('.js'));
		files.forEach(f => {
			const content = readFileSync(join(VIEW_DIR, f), 'utf-8');
			// should NOT have bare type(...) == 'int'
			const matches = content.match(/type\([^)]+\)\s*==\s*'int'/g);
			assert.strictEqual(matches, null, f + ' contains ucode-style type() type-check');
		});
	});

	it('no ucode-style length() calls remain in any view', () => {
		const files = readdirSync(VIEW_DIR).filter(f => f.endsWith('.js'));
		files.forEach(f => {
			const content = readFileSync(join(VIEW_DIR, f), 'utf-8');
			const matches = content.match(/length\(Object\.keys/g);
			assert.strictEqual(matches, null, f + ' contains ucode-style length()');
		});
	});
});
