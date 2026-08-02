import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js';
const ORCHESTRA_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';

function node(tag, attrs, children) {
	return { tag, attrs: attrs || {}, children: Array.isArray(children) ? children : children == null ? [] : [children], appendChild(child) { this.children.push(child); return child; }, addEventListener(type, listener) { this.attrs['on' + type] = listener; }, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; } };
}
function loadView() {
	const baseclass = { extend(properties) { function SharedUiModule() {} SharedUiModule.prototype = Object.assign({}, properties); return SharedUiModule; } };
	const SharedUiModule = new Function('E', '_', 'baseclass', readFileSync(UI_PATH, 'utf8'))(node, value => value, baseclass);
	const ui = new SharedUiModule();
	const rpc = { declare() { return () => Promise.resolve({ ok: true }); } };
	return new Function('L', 'rpc', '_', 'E', 'Z2M', readFileSync(ORCHESTRA_PATH, 'utf8'))({ view: { extend: value => value }, resource: value => value }, rpc, value => value, node, ui);
}
function textTree(value) {
	if (value == null) return '';
	if (typeof value !== 'object') return String(value);
	return (value.children || []).map(textTree).join(' ');
}
function state(overrides) {
	return Object.assign({
		managerStatus: { runtimeSummary: { status: 'running', reasonCode: null, serviceRunning: true, process: { found: true, identityVerified: true }, runtime: { verification: 'verified', appliedMatch: true }, nfqueue: { registered: true, ownerMatches: true, inboundRule: true, outboundRule: true } }, runtime: { present: true, profileCount: 3 }, applied: { configPresent: true }, drift: { divergent: false } },
		managerStatusError: null,
		auto: { ok: true, enabled: true, phase: 'healthy', serviceIds: ['youtube', 'discord'], activeRun: { runId: null, progress: null, startedAt: null }, health: { status: 'healthy', lastCheckAt: '2026-08-02T09:00:00Z' }, lastGood: { available: true }, cooldownUntil: null, infrastructure: { status: 'ready' }, capabilities: { runNow: true }, admissionReasons: { runNow: { allowed: true, reasonCode: null }, enable: { allowed: false, reasonCode: 'already-enabled' } } },
		autoError: null,
		catalogList: { ok: true, services: [{ id: 'youtube', name: 'YouTube' }, { id: 'discord', name: 'Discord' }, { id: 'chatgpt', name: 'ChatGPT' }] },
		catalogStatus: { ok: true, ledger: { enabled: ['youtube', 'discord'] } },
		activeRun: null,
		operation: null,
		autoReadOnly: false,
		overviewRefreshing: false
	}, overrides || {});
}

test('T3 registry exposes Overview while later remastered destinations remain hidden', () => {
	const baseclass = { extend(properties) { function SharedUiModule() {} SharedUiModule.prototype = Object.assign({}, properties); return SharedUiModule; } };
	const SharedUiModule = new Function('E', '_', 'baseclass', readFileSync(UI_PATH, 'utf8'))(node, value => value, baseclass);
	const ui = new SharedUiModule();
	const overview = ui.ui.activeNavigation('orchestra-overview');
	assert.equal(overview.available, true);
	assert.equal(overview.implemented, true);
	assert.deepEqual(ui.ui.visibleNavigation().map(entry => entry.key), ['overview']);
	assert.equal(ui.ui.activeNavigation('orchestra-services').legacyRoute, 'orchestra-services');
	assert.equal(ui.ui.activeNavigation('orchestra-results').legacyRoute, 'orchestra-results');
});

test('Overview presentation model reports verified runtime without inventing a health score', () => {
	const view = loadView();
	assert.equal(typeof view._overviewModel, 'function');
	const model = view._overviewModel(state());
	assert.equal(model.overall.status, 'healthy');
	assert.equal(model.runtime.nfqws2.label, 'Работает');
	assert.equal(model.runtime.nfqueue.label, 'Подключена');
	assert.equal(model.runtime.configuration.label, 'Runtime совпадает с сохранённой');
	assert.equal(model.services.selectedLabel, 'YouTube, Discord');
	assert.doesNotMatch(model.warnings.join(' '), /Не работает/);
});

test('Overview preserves stopped, unknown, partial, and divergent runtime truth', () => {
	const view = loadView();
	const stopped = view._overviewModel(state({ managerStatus: { runtimeSummary: { status: 'stopped', reasonCode: 'process-absent', serviceRunning: false, process: { found: false }, runtime: { verification: 'failed', appliedMatch: null }, nfqueue: { registered: false, ownerMatches: false } }, runtime: {}, applied: {}, drift: { divergent: false } } }));
	assert.equal(stopped.overall.status, 'failed');
	assert.equal(stopped.runtime.nfqws2.label, 'Не работает');
	assert.match(stopped.warnings.map(warning => warning.title).join(' '), /NFQUEUE/);
	const unknown = view._overviewModel(state({ managerStatus: null, managerStatusError: 'rpc: secret stderr that must not leak', auto: { runtimeSummary: { status: 'running' } } }));
	assert.equal(unknown.overall.status, 'unknown');
	assert.equal(unknown.runtime.nfqws2.label, 'Состояние не подтверждено');
	assert.doesNotMatch(JSON.stringify(unknown), /secret stderr/);
	const divergent = view._overviewModel(state({ managerStatus: { runtimeSummary: { status: 'mismatch', reasonCode: 'runtime-applied-mismatch', process: { found: true }, runtime: { verification: 'failed', appliedMatch: false }, nfqueue: { registered: true, ownerMatches: true } }, runtime: {}, applied: {}, drift: { divergent: true } } }));
	assert.equal(divergent.overall.status, 'degraded');
	assert.equal(divergent.runtime.configuration.label, 'Обнаружено расхождение');
});

test('Overview uses backend catalog labels, bounds service lists, and never derives missing health', () => {
	const view = loadView();
	const model = view._overviewModel(state({ auto: Object.assign({}, state().auto, { serviceIds: ['youtube', 'discord', 'chatgpt', 'unknown-id', 'other'] }) }));
	assert.equal(model.services.selectedLabel, 'YouTube, Discord, ChatGPT и ещё 2');
	assert.equal(model.services.healthLabel, null);
	assert.doesNotMatch(model.services.selectedLabel, /unknown-id/);
});

test('Overview prioritizes recovery and active work over normal Auto navigation without mutation', () => {
	const view = loadView();
	const active = view._overviewModel(state({ auto: Object.assign({}, state().auto, { phase: 'scanning', activeRun: { runId: 'or-123', progress: 45, startedAt: '2026-08-02T09:00:00Z' } }) }));
	assert.equal(active.overall.status, 'running');
	assert.equal(active.primary.kind, 'open-run');
	assert.equal(active.operation.progress, 45);
	const recovery = view._overviewModel(state({ auto: Object.assign({}, state().auto, { phase: 'recovering', infrastructure: { status: 'failed', reason: 'recovery-required' }, admissionReasons: { restoreLastGood: { allowed: false, reasonCode: 'recovery-required' } } }) }));
	assert.equal(recovery.overall.status, 'failed');
	assert.equal(recovery.primary, null);
	assert.equal(recovery.admissionReason, 'recovery-required');
});

test('Overview presents an applying transaction as active instead of completed', () => {
	const view = loadView();
	const model = view._overviewModel(state({ operation: { operationId: 'op-123', phase: 'applying', startedAt: '2026-08-02T09:00:00Z', progress: 35 } }));
	assert.equal(model.overall.status, 'running');
	assert.equal(model.operation.phase, 'Применяется стратегия');
	assert.equal(model.operation.progress, 35);
});

test('Overview keeps cooldown informational and surfaces backend recovery or failed-operation reasons', () => {
	const view = loadView();
	const cooldownState = state({ auto: Object.assign({}, state().auto, { cooldownUntil: '2026-08-02T11:00:00Z', phase: 'cooldown' }) });
	assert.equal(view._overviewModel(cooldownState).overall.status, 'healthy');
	view._state = cooldownState;
	assert.match(textTree(view._overviewSection()), /Повторная проверка отложена/);
	const corrupt = view._overviewModel(state({ auto: Object.assign({}, state().auto, { phase: 'failed', infrastructure: { status: 'failed', reason: 'state-corrupt' } }) }));
	assert.equal(corrupt.overall.status, 'failed');
	assert.match(corrupt.warnings.map(warning => warning.title).join(' '), /состояние/i);
	const failed = view._overviewModel(state({ operation: { operationId: 'op-456', phase: 'failed', error: { code: 'EVERIFY' } } }));
	assert.match(failed.warnings.map(warning => warning.title).join(' '), /операция/i);
});

test('Overview renders a read-only shell with one navigation action, refresh, disclosures, and no raw hashes', () => {
	const view = loadView();
	view._state = state({ autoReadOnly: true });
	view._panel = 'orchestra-overview';
	const page = view._overviewSection();
	const rendered = textTree(page);
	const header = view._overviewHeader(view._overviewModel());
	assert.match(rendered, /Состояние системы/);
	assert.match(rendered, /Автоматический подбор/);
	assert.match(rendered, /Текущая стратегия/);
	assert.match(rendered, /Недостаточно прав/);
	assert.doesNotMatch(rendered, /[a-f0-9]{32}/);
	assert.match(textTree(header), /Refresh|Обновить/);
});
