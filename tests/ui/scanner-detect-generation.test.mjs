import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VIEW = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const source = fs.readFileSync(path.join(VIEW, 'z2m-scanner.js'), 'utf8');

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function unrefSetTimeout(callback, delay) {
	const timer = setTimeout(callback, delay);
	if (timer && typeof timer.unref === 'function') timer.unref();
	return timer;
}

function node(tag, attrs, children) {
	if (typeof attrs === 'string' || Array.isArray(attrs)) {
		children = attrs;
		attrs = {};
	}
	const listeners = {};
	return {
		tag,
		attrs: attrs || {},
		children: Array.isArray(children) ? children.filter(Boolean) : children == null ? [] : [children],
		value: attrs && attrs.value != null ? attrs.value : '',
		addEventListener(type, callback) { listeners[type] = callback; },
		appendChild(child) { this.children.push(child); },
		listeners
	};
}

function makeStorage() {
	const values = new Map();
	return {
		getItem(key) { return values.has(key) ? values.get(key) : null; },
		setItem(key, value) { values.set(key, String(value)); },
		removeItem(key) { values.delete(key); }
	};
}

function makeScanner(storage, gates, statusGates) {
	const buttons = [];
	const calls = { status: 0, probe: 0, refresh: 0 };
	const statusQueue = (statusGates || []).slice();
	const api = {
		z2kDetectStatus() {
			calls.status++;
			const statusGate = statusQueue.shift();
			if (statusGate) return statusGate.promise;
			return Promise.resolve({ ok: true, coherent: true, installed: { version: '2.0' }, service: { running: true } });
		},
		z2kDetectProbe() {
			calls.probe++;
			const gate = deferred();
			gates.push(gate);
			return gate.promise;
		},
		normalizeError(error) { return { message: String(error && error.message || error) }; }
	};
	const ctx = {
		api,
		refresh() { calls.refresh++; return Promise.resolve(); },
		shell: {
			button(label, className, callback) {
				const button = node('button', { label, className });
				button.callback = callback;
				buttons.push(button);
				return button;
			},
			statePanel() { return node('state-panel'); }
		}
	};
	const Icons = { wrappedNode: () => node('icon') };
	const module = loadLuCIModule(source, 'view.zapret2-manager.z2m-scanner', { baseclass, 'view.zapret2-manager.z2m-icons': Icons }, {
		globals: { E: node, sessionStorage: storage },
		window: { setTimeout: unrefSetTimeout, clearTimeout }
	});
	return { module, ctx, calls, buttons };
}

function flush() { return new Promise(resolve => setTimeout(resolve, 0)); }

function startButton(buttons) {
	const button = buttons.find(candidate => candidate.attrs.label === 'Начать сканирование');
	assert.ok(button, 'render must expose the typed Detect start action');
	return button;
}

function history(storage) {
	return JSON.parse(storage.getItem('z2m.detect.history.v1') || '[]');
}

function hasTag(value, tag) {
	if (!value || typeof value !== 'object') return false;
	if (value.tag === tag) return true;
	return Array.isArray(value.children) && value.children.some(child => hasTag(child, tag));
}

function hasClass(value, className) {
	if (!value || typeof value !== 'object') return false;
	if (String(value.attrs && value.attrs.class || '').split(/\s+/).includes(className)) return true;
	return Array.isArray(value.children) && value.children.some(child => hasClass(child, className));
}

function detectStatus(overrides) {
	return Object.assign({ ok: true, coherent: true, installed: { version: '2.0' }, service: { running: true } }, overrides || {});
}

test('Scanner does not render legacy-shaped evidence without a typed Detect envelope', () => {
	const storage = makeStorage();
	const gates = [];
	const { module, ctx } = makeScanner(storage, gates);
	module.mount(ctx);
	const root = module.render(ctx, {
		status: { status: 'completed' },
		report: { ranked: [{ candidateId: 'legacy-success', verdict: 'working' }], summary: { tested: 1 } }
	});

	assert.equal(hasTag(root, 'state-panel'), true,
		'non-typed scanner-shaped evidence must resolve to the unavailable state panel');
});

test('Scanner ignores out-of-order Detect completion from an older generation', async () => {
	const storage = makeStorage();
	const gates = [];
	const { module, ctx, calls, buttons } = makeScanner(storage, gates);
	module.mount(ctx);
	module.render(ctx, { status: { status: 'ready' } });
	const start = startButton(buttons);

	start.callback();
	await flush();
	assert.equal(calls.probe, 1, 'first scan must reach the typed probe RPC');
	start.callback();
	await flush();
	assert.equal(calls.probe, 2, 'new scan must supersede an in-flight scan');

	gates[1].resolve({ ok: true, data: { stdout: '{"verdict":"new"}' } });
	await flush();
	gates[0].resolve({ ok: true, data: { stdout: '{"verdict":"old"}' } });
	await flush();

	const entries = history(storage);
	assert.equal(entries.length, 1, 'only the current generation may publish history');
	assert.equal(entries[0].report.data.verdict, 'new', 'older completion must not overwrite current evidence');
	assert.equal(entries[0].report.typedDetect, true, 'history must retain the typed Detect envelope');
	assert.equal(entries[0].provenance.source, 'z2k-detect', 'history must retain Detect provenance');
	assert.equal(calls.refresh, 3, 'stale completion must not trigger a repaint');
});

test('Scanner discards a typed Detect completion after unmount', async () => {
	const storage = makeStorage();
	const gates = [];
	const { module, ctx, calls, buttons } = makeScanner(storage, gates);
	module.mount(ctx);
	module.render(ctx, { status: { status: 'ready' } });
	startButton(buttons).callback();
	await flush();
	assert.equal(calls.probe, 1);

	module.unmount();
	gates[0].resolve({ ok: true, data: { stdout: '{"verdict":"late"}' } });
	await flush();

	assert.deepEqual(history(storage), [], 'unmounted Scanner must not publish late history');
	assert.equal(calls.refresh, 1, 'unmounted Scanner must not repaint from late Detect completion');
});

test('Scanner discards an older status load after a newer load completes', async () => {
	const storage = makeStorage();
	const statusGates = [deferred(), deferred()];
	const { module, ctx, calls } = makeScanner(storage, [], statusGates);

	const first = module.load(ctx);
	await flush();
	const second = module.load(ctx);
	await flush();
	statusGates[1].resolve(detectStatus());
	const ready = await second;
	assert.equal(ready.status.status, 'ready');
	assert.equal(ready.status.authority.ok, true);
	statusGates[0].resolve(detectStatus({ ok: false, coherent: false }));
	const stale = await first;

	assert.equal(stale.discarded, true, 'older load must resolve as discarded');
	assert.equal(calls.status, 2);
	const root = module.render(ctx, {});
	assert.equal(hasClass(root, 'z2m-scanner-error-card'), false,
		'older load must not overwrite the newer ready state with an error');
});

test('Scanner discards a status load that resolves after unmount', async () => {
	const storage = makeStorage();
	const statusGates = [deferred()];
	const { module, ctx } = makeScanner(storage, [], statusGates);

	const pending = module.load(ctx);
	await flush();
	module.unmount();
	statusGates[0].resolve(detectStatus({ ok: false, coherent: false }));
	const stale = await pending;

	assert.equal(stale.discarded, true, 'unmounted load must resolve as discarded');
	const root = module.render(ctx, {});
	assert.equal(hasClass(root, 'z2m-scanner-error-card'), false,
		'unmounted load must not publish an error state');
});
