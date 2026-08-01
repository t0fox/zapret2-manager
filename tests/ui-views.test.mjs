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

	it('exactly 7 visible primary product tabs', () => {
		const raw = JSON.parse(readFileSync(MENU_JSON, 'utf-8'));
		const subKeys = Object.keys(raw).filter(k => k.startsWith('admin/services/zapret2-manager/'));
		assert.strictEqual(subKeys.length, 7,
			'expected 7 primary sub-tabs: ' + JSON.stringify(subKeys.sort()));
		assert.deepEqual(subKeys.map(k => raw[k]).sort((a, b) => a.order - b.order).map(v => v.title), ['Orchestra', 'Advanced', 'Lists', 'DNS', 'Monitor', 'Proxy', 'Maintenance']);
	});

	it('old service-dns.js still exists as a JS file (compatibility route)', () => {
		assert.ok(existsSync(SERVICE_DNS_JS), 'service-dns.js must exist as a compatibility route');
	});

	it('service-dns.js passes syntax check', () => {
		const err = syntaxCheck(SERVICE_DNS_JS);
		assert.strictEqual(err, null, err || 'syntax OK');
	});
});

describe('Orchestra panel navigation contract', () => {
	const ORCHESTRA_JS = readFileSync(join(VIEW_DIR, 'orchestra.js'), 'utf-8');
	const MAINTENANCE_JS = readFileSync(join(VIEW_DIR, 'maintenance.js'), 'utf-8');

	it('renders only the selected panel and persists it in the hash', () => {
		assert.ok(ORCHESTRA_JS.includes('_panelFromHash:'), 'hash parser missing');
		assert.ok(ORCHESTRA_JS.includes('pushState'), 'panel selection must use browser history');
		assert.ok(ORCHESTRA_JS.includes("if (this._panel === 'orchestra-find')"), 'find panel branch missing');
		assert.ok(ORCHESTRA_JS.includes("else if (this._panel === 'orchestra-results')"), 'results panel branch missing');
		assert.ok(ORCHESTRA_JS.includes('_stopPolling(); self._panel = self._panelFromHash()'), 'panel navigation must stop old polling');
	});

	it('keeps legacy tools accessible from Maintenance', () => {
		assert.ok(MAINTENANCE_JS.includes("L.url('admin/services/zapret2-manager/blockcheck')"));
		assert.ok(!MAINTENANCE_JS.includes("L.url('admin/services/zapret2-manager/catalog')"));
		assert.ok(MAINTENANCE_JS.includes("_('Legacy tools')"));
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

	it('z2m-tab hover/focus does not use invisible fallback color (#222, #000, black)', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		// collect all .z2m-tab* rules
		const tabRules = css.match(/\.z2m-tab[^{]*\{[^}]*\}/g) || [];
		tabRules.forEach(rule => {
			// reject hardcoded dark/black text on any tab state
			const colorMatch = rule.match(/color\s*:\s*(#[0-2][0-2][0-2]|black)/i);
			if (colorMatch) {
				// z2m-badge classes are allowed to use dark text (they set their own bg)
				// but tab text must NOT have invisible colors
				if (!/\.z2m-badge/.test(rule)) {
					assert.ok(false, 'z2m-tab rule uses invisible text color: ' + colorMatch[0] + ' in: ' + rule.trim());
				}
			}
		});
		// specifically: hover must not set color: #222
		const hoverMatch = css.match(/\.z2m-tab:hover[^{]*\{[^}]*color\s*:\s*#222/);
		assert.strictEqual(hoverMatch, null, 'z2m-tab:hover must not use color: #222 (invisible on dark themes)');
	});

	it('z2m-tab-active has explicit color not relying on fallback', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		assert.ok(css.includes('z2m-tab-active'), 'z2m-tab-active must exist');
		// must define its own color or inherit + opacity
		const rules = css.match(/\.z2m-tab-active[^{]*\{[^}]*\}/g) || [];
		const hasColor = rules.some(r => /color\s*:/.test(r));
		const hasOpacity = rules.some(r => /opacity\s*:/.test(r));
		assert.ok(hasColor || hasOpacity, 'z2m-tab-active must set color or opacity: ' + JSON.stringify(rules));
	});
});

describe('DNS Centre — section switching contract', () => {
	const DNS_JS = resolve(VIEW_DIR, 'dns.js');

	it('refresh does not use querySelector(".cbi-map")', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		const match = content.match(/querySelector\(['"]\.cbi-map['"]\)/);
		assert.strictEqual(match, null, 'dns.js must not use querySelector(".cbi-map")');
	});

	it('has switchSection method', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('switchSection:'), 'dns.js must define switchSection method');
	});

	it('has reload method', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('reload:'), 'dns.js must define reload method');
	});

	it('render stores envelope and shell', function () {
		var content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('this._envelope'), 'render must store this._envelope');
		assert.ok(content.includes('this._sectionHost'), 'render must store section host (shell arch)');
	});

	it('section click calls _renderSection', function () {
		var content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('switchSection') || content.includes('_renderSection'), 'section click must switch section');
	});

	it('all five sections defined', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		for (const id of ['setup', 'providers', 'services', 'advanced', 'history']) {
			assert.ok(content.includes("'" + id + "'") || content.includes('"' + id + '"'),
				'section ' + id + ' must be in SECTIONS array');
		}
	});
});

describe('DNS Centre — provider & rollback safety', () => {
	const DNS_JS = resolve(VIEW_DIR, 'dns.js');
	const dnsContent = readFileSync(DNS_JS, 'utf-8');

	it('provider RPCs are in load() not in render/buildDOM', () => {
		assert.ok(dnsContent.includes('grab(callProvComp)'), 'load() must call callProvComp');
		assert.ok(dnsContent.includes('grab(callProvList)'), 'load() must call callProvList');
		assert.ok(!dnsContent.includes('_provFetched'), 'must not have lazy-load state flag');
		assert.ok(!dnsContent.includes('Promise.all([grab(callProvComp)'), 'providers must not lazy-load in render');
	});

	it('envelope carries provComp and provList from load()', () => {
		assert.ok(dnsContent.includes('provComp: r[3].data') || dnsContent.includes('provComp:'), 'load() must store provComp');
		assert.ok(dnsContent.includes('provList: r[4].data') || dnsContent.includes('provList:'), 'load() must store provList');
	});

	it('rollback DNS button is disabled when no revision/snapshot', () => {
		const histStart = dnsContent.indexOf('historySection');
		const histBody = dnsContent.substring(histStart);
		assert.ok(histBody.includes('dnsRbAvailable'), 'DNS rollback must have availability guard');
		assert.ok(histBody.includes('sdnsRbAvailable'), 'Service DNS rollback must have availability guard');
		assert.ok(histBody.includes("'disabled':"), 'rollback buttons must be conditionally disabled');
	});

	it('tab scrollbar is hidden in CSS', () => {
		const css = readFileSync(Z2M_CSS, 'utf-8');
		const tabsStart = css.indexOf('.z2m-tabs {');
		const tabsEnd = css.indexOf('}', tabsStart);
		const tabsBlock = css.substring(tabsStart, tabsEnd);
		assert.ok(tabsBlock.includes('scrollbar-width') || tabsBlock.includes('::-webkit-scrollbar'), 'tabs must hide scrollbar');
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
