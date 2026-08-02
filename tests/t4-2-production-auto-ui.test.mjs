import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js';
const VIEW_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';
const CSS_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const UI_SOURCE = readFileSync(UI_PATH, 'utf8');
const VIEW_SOURCE = readFileSync(VIEW_PATH, 'utf8');
const CSS_SOURCE = readFileSync(CSS_PATH, 'utf8');

function node(tag, attrs, children) {
	const out = {
		tag,
		attrs: attrs || {},
		children: Array.isArray(children) ? children.map(child => Array.isArray(child) ? String(child) : child) : children == null ? [] : [children],
		appendChild(child) { this.children.push(child); return child; },
		addEventListener() {},
		setAttribute(key, value) { this.attrs[key] = value; },
		removeAttribute() {}
	};
	out.toString = () => '[object HTMLDivElement]';
	return out;
}

function loadView() {
	const baseclass = { extend(properties) { function Module() {} Module.prototype = Object.assign({}, properties); return Module; } };
	const ui = new (new Function('E', '_', 'baseclass', UI_SOURCE)(node, value => value, baseclass));
	const rpc = { declare() { return () => Promise.resolve({ ok: true }); } };
	return new Function('L', 'rpc', '_', 'E', 'Z2M', VIEW_SOURCE)({ view: { extend: value => value }, resource: value => value }, rpc, value => value, node, ui);
}

function luCIText(value) {
	if (value == null) return '';
	if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' && !Array.isArray(item) ? (item.tag ? luCIText(item) : String(item)) : luCIText(item)).join('');
	if (typeof value !== 'object') return String(value);
	return (value.children || []).map(luCIText).join('');
}

function baseState() {
	return {
		autoLoading: false,
		autoReadOnly: false,
		autoPending: null,
		autoOutcome: null,
		auto: {
			enabled: true,
			phase: 'cooldown',
			serviceIds: ['discord', 'youtube'],
			health: { lastCheckAt: 1785700000000, lastSuccessAt: null, lastFailureAt: null },
			lastGood: { available: false },
			activeRun: { runId: 'run-stale', generation: 4, phase: 'interrupted', startedAt: 1785690000000, finishedAt: 1785690100000 },
			admissionReasons: { runNow: { allowed: true }, disable: { allowed: true } },
			capabilities: { runNow: true, stop: false, restoreLastGood: false },
			infrastructure: { status: 'ready' }
		},
		catalogList: { services: [
			{ id: 'discord', name: 'Discord', category: 'messaging' },
			{ id: 'youtube', name: 'YouTube', category: 'video' }
		] },
		adaptive: null,
		caps: null,
		legacyEvents: null,
		legacyHistory: null,
		runHistory: []
	};
}

function journalRun() {
	return {
		runId: 'run-1',
		generation: 7,
		phase: 'completed',
		startedAt: 1785699000000,
		finishedAt: 1785699060000,
		candidateJournal: [
			{ runId: 'run-1', generation: 7, candidateId: 'c-fail', displayName: 'TLS Split', techniqueLabels: ['TLS', 'TCP'], status: 'failed', statusLabel: 'Не прошла', attemptsCompleted: 2, attemptsTotal: 2, targetsPassed: 0, targetsTotal: 1, durationMs: 2300, failureClass: 'target-fail', failureReason: 'Сервис не ответил', rank: 2 },
			{ runId: 'run-1', generation: 7, candidateId: 'c-ok', displayName: 'TLS Disorder', techniqueLabels: ['TLS'], status: 'confirmed', statusLabel: 'Подтверждена', attemptsCompleted: 2, attemptsTotal: 2, targetsPassed: 1, targetsTotal: 1, durationMs: 1800, rank: 1, applied: false, lastGood: false, technical: { evidenceIds: ['ev-1'], argv: '--filter-tcp=443', hash: 'abc' } }
		],
		selectedWinner: { candidateId: 'c-ok' }
	};
}

test('candidate journal inserts DOM nodes as nodes, never string-coerces nested children', () => {
	const view = loadView();
	const text = luCIText(view._candidateJournal(journalRun()));
	assert.doesNotMatch(text, /\[object HTMLDivElement\]/);
	assert.doesNotMatch(text, /\[object Object\]|undefined|null/);
});

test('candidate journal renders failed rows, backend rank and all user-facing evidence fields', () => {
	const view = loadView();
	const text = luCIText(view._candidateJournal(journalRun()));
	for (const label of ['Проверено 2 из 2', 'TLS Split', 'Не прошла', '2 / 2', '1 / 1', '2300 мс', 'Причина сбоя', 'Ранг', 'TLS']) assert.match(text, new RegExp(label));
});

test('empty and malformed journals use bounded Russian fallbacks instead of a blank card or exception', () => {
	const view = loadView();
	assert.match(luCIText(view._candidateJournal({ candidateJournal: [] })), /Стратегии ещё не проверялись/);
	assert.match(luCIText(view._candidateJournal({ candidateJournal: { broken: true } })), /Результаты этого запуска пока недоступны/);
});

test('canonical runtime truth makes a confirmed process and NFQUEUE usable without raw unknown summary', () => {
	const view = loadView();
	const model = view._overviewModel({
		managerStatus: { runtimeSummary: { status: 'running', reasonCode: 'process-and-nfqueue-confirmed', process: { found: true, identityVerified: true }, nfqueue: { registered: true, ownerMatches: true }, runtime: { verification: 'unknown' } }, applied: { configPresent: true }, runtime: { present: true } },
		auto: { enabled: true, phase: 'healthy', serviceIds: [], health: {} }
	});
	assert.notEqual(model.overall.label, 'Состояние системы не подтверждено');
	assert.equal(model.runtime.nfqws2.label, 'Работает');
	assert.equal(model.runtime.nfqueue.label, 'Подключена');
});

test('timestamp model separates status refresh from terminal run timestamps', () => {
	const view = loadView();
	const state = baseState();
	const model = view._overviewModel({ managerStatus: null, auto: state.auto, activeRun: state.auto.activeRun });
	assert.equal(model.timestamps.lastRunAt, state.auto.activeRun.finishedAt);
	assert.equal(model.timestamps.lastStatusAt, state.auto.health.lastCheckAt);
	assert.match(model.timestamps.lastRunLabel, /Время завершения неизвестно|давно|мин назад|ч назад/);
	assert.doesNotMatch(model.timestamps.lastRunLabel, /только что/);
});

test('service selector is collapsed, summarizes selected brands, and localizes backend categories', () => {
	const view = loadView();
	view._state = baseState();
	const text = luCIText(view._autoServiceSelector(view._state.auto));
	assert.match(text, /Выбрано: Discord, YouTube/);
	assert.match(text, /Изменить выбор/);
	assert.match(text, /Мессенджеры|Видео/);
	assert.doesNotMatch(text, /messaging|video/);
});

test('Auto actions expose one primary action and map terminal, stale and infrastructure outcomes', () => {
	assert.match(VIEW_SOURCE, /Остановить проверку/);
	assert.match(VIEW_SOURCE, /Обновить состояние/);
	assert.match(VIEW_SOURCE, /Проверить снова/);
	const autoSource = VIEW_SOURCE.slice(VIEW_SOURCE.indexOf('_autoStrategySection:'), VIEW_SOURCE.indexOf('_adaptiveSection:'));
	for (const raw of ['Auto Strategy disabled.', 'Cancellation requested', 'No active scan remains to stop.', 'Technical details', 'Unknown target', 'No trusted candidates were admitted.']) assert.doesNotMatch(autoSource, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('candidate details and diagnostics are collapsed and raw RPC/argv are bounded', () => {
	const text = luCIText(loadView()._candidateJournal(journalRun()));
	assert.match(text, /Результаты целей|Попытки|Подтверждение|Причина сбоя|Изменение конфигурации/);
	assert.match(VIEW_SOURCE, /Технические сведения/);
	assert.doesNotMatch(text, /--filter-tcp=443/);
});

test('Overview and Auto layout use available width with 2x2 desktop and one-column mobile', () => {
	assert.match(CSS_SOURCE, /\.z2m-orchestra-shell\s*\{[\s\S]*max-width:\s*none/);
	assert.match(CSS_SOURCE, /\.z2m-overview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
	assert.match(CSS_SOURCE, /@media \(max-width: 767px\)[\s\S]*\.z2m-overview-grid\s*\{\s*grid-template-columns:\s*1fr/);
	assert.match(CSS_SOURCE, /z2m-auto-tested-strategies[\s\S]*grid-column:\s*1 \/ -1/);
});

test('production UI contains no raw mixed-language workflow labels', () => {
	const view = loadView();
	view._state = baseState();
	const autoText = luCIText(view._autoStrategySection());
	for (const raw of ['running', 'unavailable', 'not loaded', 'workflow', '[VERIFY:ROUTER]']) assert.doesNotMatch(autoText, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
	assert.match(autoText, /Искусственный интеллект|Социальные сети|Мессенджеры|Видео/);
});
