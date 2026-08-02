import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js';
const CSS_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const ORCHESTRA_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';

function node(tag, attrs, children) {
	return { tag: tag, attrs: attrs || {}, children: Array.isArray(children) ? children : children == null ? [] : [children], appendChild(child) { this.children.push(child); return child; }, addEventListener(type, listener) { this.attrs['on' + type] = listener; }, setAttribute(key, value) { this.attrs[key] = value; } };
}
const baseclass = { extend(properties) { function SharedUiModule() {} SharedUiModule.prototype = Object.assign({}, properties); return SharedUiModule; } };
function loadUi() {
	const source = readFileSync(UI_PATH, 'utf8');
	const SharedUiModule = new Function('E', '_', 'baseclass', source)(node, value => value, baseclass);
	return new SharedUiModule();
}

test('shared UI is a LuCI module constructor, not a plain factory object', () => {
	const source = readFileSync(UI_PATH, 'utf8');
	const fixture = JSON.parse(readFileSync('tests/fixtures/t3-target-luci-module-error.json', 'utf8'));
	assert.match(fixture.error, /factory yields invalid constructor/);
	assert.match(source, /^'require baseclass';$/m);
	assert.match(source, /return baseclass\.extend\(Z2M\);/);
	assert.equal(typeof loadUi().ui.PageShell, 'function');
});
function textTree(value) {
	if (value == null) return '';
	if (typeof value !== 'object') return String(value);
	return (value.children || []).map(textTree).join(' ');
}

test('shared UI preserves the public Z2M API while adding a namespaced foundation', () => {
	const ui = loadUi();
	for (const name of ['escapeHtml', 'sanitize', 'attrEscape', 'page', 'hero', 'cardGrid', 'card', 'badge', 'kvRow', 'callout', 'collapsible', 'empty', 'actions', 'tableWrap', 'mono', 'loading', 'error', 'sectionH3', 'section', 'desc']) assert.equal(typeof ui[name], 'function', name);
	assert.equal(typeof ui.ui.PageShell, 'function');
	assert.equal(typeof ui.ui.SafeText, 'function');
});

test('navigation registry is ordered, unique, keeps legacy aliases, and hides unavailable destinations', () => {
	const ui = loadUi(), entries = ui.ui.orchestraNavigation;
	assert.deepEqual(entries.map(entry => entry.key), ['overview', 'auto', 'services', 'rating', 'strategies', 'runs', 'diagnostics']);
	assert.equal(new Set(entries.map(entry => entry.key)).size, entries.length);
	assert.equal(new Set(entries.map(entry => entry.route)).size, entries.length);
	assert.equal(ui.ui.activeNavigation('orchestra-results').key, 'runs');
	assert.equal(ui.ui.activeNavigation('orchestra-adaptive').key, 'auto');
	assert.deepEqual(ui.ui.visibleNavigation().map(entry => entry.key), ['overview', 'auto']);
	assert.equal(entries.find(entry => entry.key === 'auto').available, true);
	assert.equal(entries.find(entry => entry.key === 'auto').implemented, true);
	assert.ok(entries.filter(entry => entry.key !== 'overview' && entry.key !== 'auto').every(entry => entry.available === false && entry.implemented === false));
});

test('shared presentation primitives preserve unknown and partial semantics and bound untrusted data', () => {
	const ui = loadUi();
	assert.match(textTree(ui.ui.StatusBadge({ status: 'unknown' })), /Проверка ещё не выполнялась/);
	assert.doesNotMatch(textTree(ui.ui.StatusBadge({ status: 'unknown' })), /healthy/i);
	assert.match(textTree(ui.ui.StatusBadge({ status: 'partial' })), /не полностью/);
	assert.doesNotMatch(textTree(ui.ui.StatusBadge({ status: 'partial' })), /verified/i);
	assert.equal(ui.ui.SafeText('<script>x</script>', 40), '<script>x</script>');
	assert.equal(ui.ui.SafeText('x'.repeat(200), 12), 'xxxxxxxxxxx…');
	assert.equal(ui.ui.formatStatusLabel('runtime-not-confirmed'), 'Состояние runtime не подтверждено');
	assert.match(textTree(ui.ui.AdmissionReason({ reasonCode: 'unlisted-code' })), /Недоступно/);
});

test('foundation exposes every T2 primitive and keeps technical data bounded', () => {
	const ui = loadUi();
	for (const name of ['PageShell', 'PageHeader', 'SectionHeader', 'StatusBadge', 'SummaryPanel', 'NoticeBanner', 'EmptyState', 'ErrorPanel', 'LoadingPanel', 'SkeletonLoader', 'DetailsDisclosure', 'TechnicalDetails', 'AdmissionReason', 'ActionBar', 'ConfirmationDialog', 'ProgressPanel', 'SafeText', 'formatStatusLabel', 'formatErrorCode', 'formatRelativeTime', 'FilterBar', 'SearchInput', 'NavigationTabs']) assert.equal(typeof ui.ui[name], 'function', name);
	assert.equal(ui.ui.formatErrorCode('bad code with spaces'), 'unknown-error');
	assert.equal(ui.ui.formatErrorCode('RUN_TIMEOUT'), 'RUN_TIMEOUT');
	assert.equal(ui.ui.ProgressPanel({ value: 900 }).children[0].attrs.value, '100');
	assert.equal(ui.ui.ProgressPanel({ value: -1 }).children[0].attrs.value, '0');
	assert.equal(ui.ui.DetailsDisclosure({ title: 'Evidence' }).tag, 'details');
	assert.equal(ui.ui.LoadingPanel({ label: 'Loading now' }).attrs['aria-live'], 'polite');
	assert.equal(ui.ui.ErrorPanel({ message: 'Request failed', code: 'server said: <secret>' }).children[1].children[0], 'unknown-error');
	assert.match(textTree(ui.ui.EmptyState({ title: 'No runs', explanation: 'Run a check first.' })), /No runs/);
});

test('shell renders content and accessible disabled actions without performing mutations', () => {
	const ui = loadUi(), content = node('div', { id: 'content' }, 'content');
	const shell = ui.ui.PageShell({ title: 'Orchestra', navigation: [], content: content, notice: ui.ui.NoticeBanner({ level: 'info', message: 'notice' }) });
	assert.match(shell.attrs.class, /z2m-remastered/);
	assert.ok(textTree(shell).includes('content'));
	let calls = 0;
	const action = ui.ui.ActionButton({ label: 'Apply', disabled: true, reason: { reasonCode: 'operation-active' }, onClick() { calls++; } });
	action.attrs.onclick();
	assert.equal(calls, 0);
	assert.match(String(action.attrs.title), /другая операция/);
});

test('Orchestra uses the shared shell without changing its existing RPC action surface', () => {
	const source = readFileSync(ORCHESTRA_PATH, 'utf8');
	for (const method of ['orchestra_run_start', 'orchestra_run_pause', 'orchestra_run_resume', 'orchestra_run_stop', 'orchestra_apply_best', 'orchestra_restore_previous', 'orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.match(source, new RegExp("method: '" + method + "'"));
	assert.match(source, /Z2M\.ui\.PageShell/);
	assert.match(source, /Z2M\.ui\.NavigationTabs/);
});

test('new foundation CSS is scoped and responsive instead of changing global LuCI controls', () => {
	const css = readFileSync(CSS_PATH, 'utf8');
	assert.match(css, /\.z2m-orchestra-shell\s+\.z2m-remastered-nav/);
	assert.match(css, /@media \(max-width: 767px\)/);
	assert.match(css, /overflow-x:\s*auto/);
	assert.doesNotMatch(css, /(^|\n)button\s*\{/);
	assert.doesNotMatch(css, /(^|\n)table\s*\{/);
});

test('shared foundation remains presentation-only and preserves legacy deep-link behavior', () => {
	const source = readFileSync(ORCHESTRA_PATH, 'utf8');
	const ui = readFileSync(UI_PATH, 'utf8');
	assert.doesNotMatch(ui, /rpc\.declare|fetch\s*\(/);
	assert.doesNotMatch(source, /location\.replace|location\.href/);
	assert.match(source, /activeNavigation\(hash\)/);
	assert.match(source, /entry\.legacyRoute/);
	assert.match(source, /'#' \+ panel/);
});
