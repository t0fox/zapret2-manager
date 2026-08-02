import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js';
const ORCHESTRA_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';
const CSS_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const DOC_PATH = 'docs/ui-remastered-v2.md';
const UI_SOURCE = readFileSync(UI_PATH, 'utf8');
const VIEW_SOURCE = readFileSync(ORCHESTRA_PATH, 'utf8');
const CSS_SOURCE = readFileSync(CSS_PATH, 'utf8');

function node(tag, attrs, children) {
	return { tag, attrs: attrs || {}, children: Array.isArray(children) ? children : children == null ? [] : [children], appendChild(child) { this.children.push(child); return child; }, addEventListener() {}, setAttribute(key, value) { this.attrs[key] = value; } };
}
function loadUi() {
	const baseclass = { extend(properties) { function Module() {} Module.prototype = Object.assign({}, properties); return Module; } };
	return new (new Function('E', '_', 'baseclass', UI_SOURCE)(node, value => value, baseclass));
}
function loadView() {
	const ui = loadUi();
	const rpc = { declare() { return () => Promise.resolve({ ok: true }); } };
	return new Function('L', 'rpc', '_', 'E', 'Z2M', VIEW_SOURCE)({ view: { extend: value => value }, resource: value => value }, rpc, value => value, node, ui);
}
function textTree(value) {
	if (value == null) return '';
	if (typeof value !== 'object') return String(value);
	return (value.children || []).map(textTree).join(' ');
}

test('T4 navigation exposes Auto Strategy and maps the legacy adaptive hash', () => {
	const ui = loadUi().ui;
	assert.deepEqual(ui.visibleNavigation().map(entry => entry.key), ['overview', 'auto']);
	assert.equal(ui.activeNavigation('orchestra-auto').implemented, true);
	assert.equal(ui.activeNavigation('orchestra-adaptive').route, 'orchestra-auto');
	assert.ok(ui.orchestraNavigation.filter(entry => !entry.available).every(entry => entry.implemented === false));
});

test('timestamp normalization distinguishes Unix seconds, milliseconds, ISO, and bounded stale values', () => {
	const ui = loadUi().ui;
	const nowMs = 1785700000000;
	const seconds = ui.normalizeTimestamp(1780598058, { nowMs });
	assert.equal(seconds.atMs, 1780598058000);
	assert.doesNotMatch(seconds.label, /495532/);
	assert.equal(ui.normalizeTimestamp(1780598058000, { nowMs }).atMs, 1780598058000);
	assert.equal(ui.normalizeTimestamp('2026-08-02T09:00:00Z', { nowMs }).valid, true);
	assert.match(ui.formatTimestamp(null), /Время не указано/);
	assert.match(ui.formatTimestamp(0), /Время неизвестно|давно/);
	assert.match(ui.formatTimestamp('not-a-date'), /Время неизвестно/);
	assert.match(ui.formatTimestamp(nowMs + 3600000, { nowMs }), /будущ/);
});

test('active-run truth requires identity, generation, active phase, owner, and fresh deadline/heartbeat', () => {
	const ui = loadUi().ui;
	const nowMs = 1785700000000;
	const valid = { runId: 'run-1', generation: 2, phase: 'scanning', startedAt: nowMs - 10000, heartbeatAt: nowMs - 1000, deadlineAt: nowMs + 60000, ownerConfirmed: true };
	assert.equal(ui.activeRunTruth({ phase: 'scanning', activeRun: valid }, nowMs).active, true);
	for (const run of [
		Object.assign({}, valid, { runId: null }),
		Object.assign({}, valid, { generation: null }),
		Object.assign({}, valid, { phase: 'completed' }),
		Object.assign({}, valid, { deadlineAt: nowMs - 1 }),
		Object.assign({}, valid, { heartbeatAt: nowMs - 3600000 }),
		Object.assign({}, valid, { ownerConfirmed: false })
	]) assert.equal(ui.activeRunTruth({ phase: 'scanning', activeRun: run }, nowMs).active, false);
	assert.equal(ui.activeRunTruth({ phase: 'scanning', activeRun: Object.assign({}, valid, { startedAt: 'unknown', heartbeatAt: null }) }, nowMs).active, true);
	assert.equal(ui.activeRunTruth({ phase: 'scanning', activeRun: Object.assign({}, valid, { lease: { active: true, owner: 'router' } }) }, nowMs).active, true);
	assert.equal(ui.activeRunTruth({ phase: 'scanning', activeRun: Object.assign({}, valid, { lease: { active: null } }) }, nowMs).active, false);
});

test('Auto page is a presentation surface with a single hierarchical primary action', () => {
	assert.match(VIEW_SOURCE, /orchestra-auto/);
	assert.match(VIEW_SOURCE, /Автоматический подбор стратегий/);
	assert.match(VIEW_SOURCE, /_autoStrategySection/);
	assert.match(VIEW_SOURCE, /_testedStrategies/);
	assert.match(VIEW_SOURCE, /admissionReasons/);
	assert.doesNotMatch(VIEW_SOURCE, /\[VERIFY:ROUTER\]/);
	assert.doesNotMatch(VIEW_SOURCE, /Last-good hash|Applied hash|Applied revision/);
	assert.match(VIEW_SOURCE, /autoEnableRpc|autoDisableRpc|autoRunRpc|autoStopRpc|autoRestoreRpc/);
});

test('Auto selector and journal use backend catalog and run-scoped evidence', () => {
	assert.match(VIEW_SOURCE, /_autoServices\(\)/);
	assert.match(VIEW_SOURCE, /Search|Поиск/);
	assert.match(VIEW_SOURCE, /candidateJournal/);
	assert.match(VIEW_SOURCE, /runId/);
	assert.match(VIEW_SOURCE, /generation/);
	assert.match(VIEW_SOURCE, /ranking|rankedResults/);
	assert.match(VIEW_SOURCE, /infrastructure|timed-out|stopped/);
	assert.doesNotMatch(VIEW_SOURCE, /serviceCatalog\s*=|\{\s*youtube\s*:/);
});

test('Auto result states and advanced diagnostics are explicit and read-only', () => {
	for (const label of ['Подтверждённая рабочая стратегия не найдена', 'Проверка остановлена', 'Время проверки истекло', 'Инфраструктура недоступна']) assert.match(VIEW_SOURCE, new RegExp(label));
	assert.match(VIEW_SOURCE, /<details|DetailsDisclosure/);
	assert.match(VIEW_SOURCE, /Технические детали|Диагностика/);
});

test('Overview does not claim an operation from a stale or incomplete activeRun', () => {
	const view = loadView();
	const model = view._overviewModel({ auto: { enabled: true, phase: 'scanning', activeRun: { runId: 'run-1', generation: null, phase: 'scanning' } }, managerStatus: null });
	assert.notEqual(model.overall.status, 'running');
});

test('Auto page renders the user-facing hierarchy from backend-shaped state', () => {
	const view = loadView();
	view._state = { autoLoading: false, autoReadOnly: false, autoPending: null, autoOutcome: null, auto: { enabled: true, phase: 'healthy', serviceIds: ['youtube'], health: { lastCheckAt: 1780598058 }, lastGood: { available: true }, capabilities: { runNow: true }, admissionReasons: { runNow: { allowed: true } } }, catalogList: { services: [{ id: 'youtube', name: 'YouTube', category: 'Video' }] }, runHistory: [], selectedRun: null, adaptive: null, caps: null, legacyEvents: null, legacyHistory: null };
	const text = textTree(view._autoStrategySection());
	assert.match(text, /Автоматический подбор стратегий/);
	assert.match(text, /Изменить выбор сервисов/);
	assert.match(text, /Проверенные стратегии/);
	assert.doesNotMatch(text, /495532/);
});

test('desktop Overview remains a 2x2 grid and mobile content is safe', () => {
	assert.match(CSS_SOURCE, /@media \(min-width: 1366px\)[\s\S]*\.z2m-overview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
	assert.doesNotMatch(CSS_SOURCE, /@media \(min-width:1366px\)[\s\S]*repeat\(4/);
	assert.match(CSS_SOURCE, /overflow-wrap|word-break/);
});

test('T4 contract is documented', () => {
	const docs = readFileSync(DOC_PATH, 'utf8');
	assert.match(docs, /T4/);
	assert.match(docs, /orchestra-auto/);
	assert.match(docs, /active-run|active run/i);
});
