import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const UI_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.js';
const VIEW_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js';
const CSS_PATH = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const UI_SOURCE = readFileSync(UI_PATH, 'utf8');
const VIEW_SOURCE = readFileSync(VIEW_PATH, 'utf8');
const CSS_SOURCE = readFileSync(CSS_PATH, 'utf8');

function node(tag, attrs, children) {
	const out = { tag, attrs: attrs || {}, children: Array.isArray(children) ? children.map(x => Array.isArray(x) ? String(x) : x) : children == null ? [] : [children], appendChild(x) { this.children.push(x); return x; }, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; } };
	out.toString = () => '[object HTMLDivElement]';
	return out;
}

function loadView() {
	const baseclass = { extend(properties) { function Module() {} Module.prototype = Object.assign({}, properties); return Module; } };
	const ui = new (new Function('E', '_', 'baseclass', UI_SOURCE)(node, value => value, baseclass));
	const rpc = { declare() { return () => Promise.resolve({ ok: true }); } };
	return new Function('L', 'rpc', '_', 'E', 'Z2M', VIEW_SOURCE)({ view: { extend: value => value }, resource: value => value }, rpc, value => value, node, ui);
}

function state() {
	return { autoLoading: false, autoReadOnly: false, autoPending: null, autoOutcome: null, auto: { enabled: true, phase: 'scanning', serviceIds: ['discord', 'youtube'], health: { lastCheckAt: 1785700000000 }, lastGood: { available: false }, activeRun: { runId: 'run-active', generation: 2, phase: 'scanning', serviceId: 'discord', completedCount: 2, totalCount: 4, attemptsCompleted: 3, attemptsTotal: 8, elapsedSec: 12, remainingTimeSec: 120 }, capabilities: { runNow: true, stop: true }, admissionReasons: { runNow: { allowed: true }, disable: { allowed: true }, stop: { allowed: true } } }, catalogList: { services: [{ id: 'discord', name: 'Discord', category: 'messaging' }, { id: 'youtube', name: 'YouTube', category: 'video' }] }, selectedRun: null, runHistory: [], adaptive: null, caps: null, legacyEvents: null, legacyHistory: null };
}

function text(value) {
	if (value == null) return '';
	if (Array.isArray(value)) return value.map(text).join('');
	if (typeof value !== 'object') return String(value);
	return (value.children || []).map(text).join('');
}

function descendants(root) {
	const out = [];
	(function visit(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return; out.push(value); (value.children || []).forEach(visit); })(root);
	return out;
}

test('T4.3: Auto summary is compact and does not create a column per status fragment', () => {
	const view = loadView(); view._state = state();
	const root = view._autoStrategySection();
	const grid = descendants(root).find(x => String(x.attrs.class || '').split(/\s+/).includes('z2m-auto-status-grid'));
	assert.ok(grid, 'status summary exists');
	assert.ok(grid.children.length <= 4, 'summary has at most four fields');
	assert.match(CSS_SOURCE, /z2m-auto-status-grid[^}]*grid-template-columns:\s*repeat\(2/);
	assert.doesNotMatch(CSS_SOURCE, /z2m-auto-status-grid[^}]*repeat\(6/);
	assert.doesNotMatch(text(grid), /\[object HTMLDivElement\]|undefined|null/);
});

test('T4.3: selector is secondary and journal follows current operation', () => {
	const view = loadView(); view._state = state();
	const root = view._autoStrategySection();
	const all = descendants(root);
	const selector = all.findIndex(x => x.attrs.class === 'z2m-remastered-details');
	const operation = all.findIndex(x => x.attrs.class === 'z2m-auto-current-operation');
	const journal = all.findIndex(x => x.attrs.class === 'z2m-auto-tested-strategies');
	assert.ok(operation >= 0 && journal > operation, 'journal follows operation');
	assert.ok(selector > journal, 'selector does not push journal below it');
});

test('T4.3: selector disclosure is closed and mobile/desktop category layout is bounded', () => {
	const view = loadView(); view._state = state();
	const selector = view._autoServiceSelector(view._state.auto);
	assert.equal(selector.attrs.open, undefined);
	assert.match(text(selector), /Discord|YouTube|Изменить выбор сервисов/);
	assert.match(CSS_SOURCE, /z2m-auto-service-selector[^}]*grid-template-columns:\s*repeat\(3/);
	assert.match(CSS_SOURCE, /@media \(max-width: 767px\)[\s\S]*z2m-auto-service-selector[\s\S]*grid-template-columns:\s*1fr/);
});

test('T4.3: journal has bounded responsive cards and no raw candidate id in the primary row', () => {
	assert.match(CSS_SOURCE, /z2m-orchestra-ranking-table[^}]*table-layout:\s*fixed/);
	assert.match(CSS_SOURCE, /z2m-candidate-details/);
	assert.match(CSS_SOURCE, /@media \(max-width: 767px\)[\s\S]*z2m-orchestra-candidate-journal[\s\S]*display:\s*block/);
	assert.doesNotMatch(VIEW_SOURCE, /Открыть workflow/);
	assert.match(VIEW_SOURCE, /Открыть автоподбор/);
});

test('T4.3: active operation exposes bounded attempt/time fields', () => {
	assert.match(VIEW_SOURCE, /Попытки/);
	assert.match(VIEW_SOURCE, /Прошло|Прошедшее время/);
	assert.match(VIEW_SOURCE, /Осталось/);
});
