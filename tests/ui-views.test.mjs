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

describe('DNS Centre — tab switching contract', () => {
	const DNS_JS = resolve(VIEW_DIR, 'dns.js');

	it('refresh does not use querySelector(".cbi-map")', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		const match = content.match(/querySelector\(['"]\.cbi-map['"]\)/);
		assert.strictEqual(match, null, 'dns.js must not use querySelector(".cbi-map") — uses view-owned root');
	});

	it('has switchTab method', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('switchTab:'), 'dns.js must define switchTab method');
	});

	it('has reload method distinct from refresh', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		assert.ok(content.includes('reload:'), 'dns.js must define reload method');
		assert.ok(content.includes('switchTab:'), 'dns.js must define switchTab method');
	});

	it('render stores envelope and root', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		// render should set this._envelope and this._root
		const hasEnvelope = content.includes('this._envelope') && content.includes('envelope');
		const hasRoot = content.includes('this._root');
		assert.ok(hasEnvelope, 'render must store this._envelope');
		assert.ok(hasRoot, 'render must store this._root');
	});

	it('tab click calls switchTab not refresh', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		// tab buttons should call switchTab, not do self._tab = ...; self.refresh()
		const tabClick = content.includes('switchTab(t.id)');
		assert.ok(tabClick, 'tab click handler must call switchTab, not refresh');
		const oldPattern = /self\._tab\s*=\s*t\.id\s*;\s*self\.refresh/.exec(content);
		assert.strictEqual(oldPattern, null, 'must not use old _tab + refresh pattern');
	});

	it('all five tabs defined', () => {
		const content = readFileSync(DNS_JS, 'utf-8');
		for (const id of ['overview', 'svc', 'manual', 'providers', 'history']) {
			assert.ok(content.includes("'" + id + "'") || content.includes('"' + id + '"'),
				'tab ' + id + ' must be defined in TABS array');
		}
	});
});

describe('DNS Centre — provider & rollback safety', () => {
	const DNS_JS = resolve(VIEW_DIR, 'dns.js');
	const dnsContent = readFileSync(DNS_JS, 'utf-8');

	it('provider RPCs are in load() not in providersTab lazy-load', () => {
		// load() must include callProvComp and callProvList in Promise.all
		assert.ok(dnsContent.includes('grab(callProvComp)'), 'load() must call callProvComp');
		assert.ok(dnsContent.includes('grab(callProvList)'), 'load() must call callProvList');
		// providersTab must NOT have the lazy-load infinite-loop pattern
		const provTabStart = dnsContent.indexOf('providersTab: function');
		const provTabBody = dnsContent.substring(provTabStart, dnsContent.indexOf('historyTab: function'));
		assert.ok(!provTabBody.includes('_provFetched'), 'providersTab must not have lazy-load state flag');
		// providersTab must not call RPC load functions directly (only diagnostics via handler)
		assert.ok(!provTabBody.includes('callProvComp()'), 'providersTab must not call RPC loading');
		assert.ok(!provTabBody.includes('callProvList()'), 'providersTab must not call RPC loading');
		// must not have promise-all pattern for loading
		assert.ok(!provTabBody.includes('Promise.all([grab('), 'providersTab must not have lazy Promise.all');
	});

	it('envelope carries provComp and provList from load()', () => {
		assert.ok(dnsContent.includes('provComp: r[3].data'), 'load() must store provComp');
		assert.ok(dnsContent.includes('provList: r[4].data'), 'load() must store provList');
	});

	it('rollback DNS button is disabled when no revision/snapshot', () => {
		const histStart = dnsContent.indexOf('historyTab: function');
		const histBody = dnsContent.substring(histStart);
		assert.ok(histBody.includes('dnsRbAvailable'), 'DNS rollback must have availability guard');
		assert.ok(histBody.includes('sdnsRbAvailable'), 'Service DNS rollback must have availability guard');
		assert.ok(histBody.includes("'disabled':"), 'rollback buttons must be conditionally disabled');
		assert.ok(histBody.includes('No rollback snapshot available'), 'must show reason when disabled');
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
