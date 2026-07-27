// rpc.js wire-semantics tests — model the REAL declare() from the router's
// /www/luci-static/resources/rpc.js and prove the views call it correctly.
//
// Router rpc.js (verified by reading the file):
//   params ARRAY  → positional: params[options.params[i]] = args[i].
//                   fn({domain: d}) with params:['domain'] therefore sends
//                   {domain: {domain: d}} — the double-nesting defect.
//   reject        → req.raise = options.reject. Default false: a ubus error
//                   reply RESOLVES (msg.result[1], else the numeric code),
//                   so .catch() never runs and the number can be mistaken
//                   for data (unlocks editing, kills the stale path).
//
// Run: node --test tests/ui/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE_VIEWS, readViewSource, stripComments, checkPositionalCalls, checkRejectTrue } from './lib/checks.mjs';

// ---- the rpc.js model (positional params + reject semantics) ----------------

function makeWorld(responses) {
	const world = {
		responses: responses || {},
		calls: [],          // every formed ubus message: {method, params}
		declarations: []    // every rpc.declare spec the view made
	};

	const created = [];

	function makeNode(tag) {
		const node = {
			tag: tag || 'div',
			attrs: {},
			children: [],
			listeners: {},
			style: {},
			value: '',
			readOnly: false,
			disabled: false,
			_tc: '',
			appendChild(c) { node.children.push(c); return c; },
			addEventListener(t, f) { node.listeners[t] = f; },
			setAttribute(k, v) { node.attrs[k] = v; },
			getAttribute(k) { return node.attrs[k]; },
			querySelector() { return makeNode(); },
			querySelectorAll() { return []; }
		};
		Object.defineProperty(node, 'textContent', {
			get() { return node._tc; },
			set(v) { node._tc = String(v); }
		});
		created.push(node);
		return node;
	}

	function E(tag, attrs, children) {
		const node = makeNode(tag);
		if (attrs && typeof attrs === 'object') Object.assign(node.attrs, attrs);
		const kids = Array.isArray(children) ? children : (children !== undefined ? [children] : []);
		for (const c of kids) node.children.push(c);
		return node;
	}

	const intervals = [];

	world.created = created;
	world.intervals = intervals;
	world.E = E;
	world.documentStub = {
		querySelector() { return null; },
		querySelectorAll(sel) {
			if (sel === 'textarea[data-list-key]')
				return created.filter((n) => n.attrs && n.attrs['data-list-key'] !== undefined);
			return [];
		},
		getElementById(id) {
			return created.find((n) => n.attrs && n.attrs.id === id) || null;
		},
		body: { contains() { return true; } }
	};
	world.windowStub = { addEventListener() { } };
	world.setIntervalStub = (cb) => { intervals.push(cb); return intervals.length; };
	world.clearIntervalStub = () => { };

	// rpc.declare honoring the router semantics: positional params mapping and
	// reject-gated error handling.
	world.rpcStub = {
		declare(spec) {
			world.declarations.push(spec);
			return function (...args) {
				const params = {};
				if (Array.isArray(spec.params))
					spec.params.forEach((p, i) => { params[p] = args[i]; });
				world.calls.push({ method: spec.method, params });
				const r = world.responses[spec.method];
				if (r && r.type === 'ubusError') {
					if (spec.reject === true)
						return Promise.reject(new Error('RPC call failed with ubus code ' + r.code));
					return Promise.resolve(r.code);   // reject:false — the defect form
				}
				return Promise.resolve(r && Object.prototype.hasOwnProperty.call(r, 'value') ? r.value : {});
			};
		}
	};
	return world;
}

function loadView(src, name, world) {
	const stubs = {
		L: { view: { extend: (o) => o }, resolveDefault: (p, d) => Promise.resolve(d) },
		view: {}, rpc: world.rpcStub, ui: {}, dom: {}, form: {},
		poll: { add: () => { }, remove: () => { }, start: () => { }, stop: () => { } },
		_: (s) => s, E: world.E
	};
	const fn = new Function(
		'L', 'view', 'rpc', 'ui', 'dom', 'form', 'poll', '_', 'E',
		'document', 'window', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
		'"use strict";' + src
	);
	const view = fn(
		stubs.L, stubs.view, stubs.rpc, stubs.ui, stubs.dom, stubs.form,
		stubs.poll, stubs._, stubs.E,
		world.documentStub, world.windowStub,
		world.setIntervalStub, world.clearIntervalStub,
		() => 1, () => { }
	);
	assert.ok(view && typeof view === 'object', `${name}: module did not export a view`);
	return view;
}

function flush() {
	return new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));
}

function findSection(rootChildren, title) {
	for (const c of rootChildren) {
		if (!c || typeof c !== 'object') continue;
		const stack = [c];
		while (stack.length) {
			const n = stack.pop();
			if (!n || typeof n !== 'object') continue;
			if (n.tag === 'h3' && n.children.includes(title)) return c;
			for (const k of n.children) if (k && typeof k === 'object') stack.push(k);
		}
	}
	return null;
}

function collectText(node, out) {
	out = out || [];
	if (node == null) return out;
	if (typeof node === 'string') { out.push(node); return out; }
	if (node._tc) out.push(node._tc);
	for (const c of node.children || []) collectText(c, out);
	return out;
}

const LISTS_FIXTURE = {
	schema: 2,
	lists: {
		domainInclude: { entries: ['example.com'], path: '/p/di.txt', type: 'domain', editable: true, engine: false, present: true, reason: null },
		domainExclude: { entries: [], path: '/p/de.txt', type: 'domain', editable: true, engine: false, present: true, reason: null },
		ipInclude: { entries: [], path: '/p/ii.txt', type: 'ip', editable: false, engine: false, present: true, reason: 'generated' },
		ipExclude: { entries: null, path: null, type: 'ip', editable: false, engine: false, present: false, reason: 'no entity' },
		ipBlock: { entries: [], path: '/p/ib.txt', type: 'ip', editable: false, engine: false, present: true, reason: 'generated' },
		autohostlist: { entries: [], path: '/p/auto.txt', type: 'domain', editable: false, engine: true, present: true, reason: 'engine-owned' }
	},
	provenance: 'fixture',
	conflicts: []
};

const STATUS_FIXTURE = {
	schema: 2, generatedAt: '2026-07-27T12:00:00Z', generation: 7, serviceState: 'running',
	runtime: { present: true, count: 1, profileCount: 2, strategies: null, rulesPresent: true, instances: [] },
	applied: {}, draft: {}, drift: { divergent: false },
	health: {
		qlenHealth: { state: 'nominal', threshold: 50, consecutiveOverThreshold: 0, critTurns: 3 },
		queue: { number: 300, registered: true, reason: null, queueTotal: 0, copyRange: 65535, queueDropped: 0, queueUserDropped: 0, updatedAt: null },
		checks: []
	},
	system: { autostart: { enabled: false, symlinks: [] }, upgradable: null },
	upstream: { nfqws2Version: null, autohostlist: null },
	jobs: [], warnings: []
};

// ---- 1. the rpc.js model itself ----------------------------------------------

test('rpc.js model: params array maps positionally; object call double-nests', () => {
	const w = makeWorld({});
	const fn = w.rpcStub.declare({ object: 'zapret2-manager', method: 'm', params: ['domain'] });

	fn('example.com');
	assert.deepEqual(w.calls[0].params, { domain: 'example.com' },
		'positional call must form { domain: "example.com" }');

	fn({ domain: 'example.com' });
	assert.deepEqual(w.calls[1].params, { domain: { domain: 'example.com' } },
		'object call double-nests — the defect form this gate exists to prevent');
});

// ---- 2. static gates over the real view sources -------------------------------

test('positional gate: no params-array declaration is called with an object', () => {
	for (const v of ZONE_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assert.deepEqual(checkPositionalCalls(src, v), []);
	}
});

test('reject gate: every rpc.declare in zone views has reject: true', () => {
	for (const v of ZONE_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assert.deepEqual(checkRejectTrue(src, v), []);
	}
});

// ---- 3. behavioral: the real lists.js forms the right wire messages ----------

test('lists domain check forms { domain: "example.com" } on the wire', async () => {
	const w = makeWorld({
		lists_get: { type: 'ok', value: LISTS_FIXTURE },
		lists_check_domain: { type: 'ok', value: { domain: 'example.com', userInclude: true, userExclude: false, autohostlist: false, conflict: false } }
	});
	const view = loadView(readViewSource('lists'), 'lists', w);
	const envelope = await view.load();
	const root = view.render(envelope);

	const input = w.created.find((n) => n.attrs.id === 'z2m-domain-check');
	assert.ok(input, 'domain input not rendered');
	input.value = 'example.com';

	const section = findSection(root.children, 'Domain check');
	assert.ok(section, 'Domain check section not found');
	let btn = null;
	(function walk(n) {
		if (!n || typeof n !== 'object' || btn) return;
		if (n.listeners && n.listeners.click) { btn = n; return; }
		for (const c of n.children || []) walk(c);
	})(section);
	assert.ok(btn, 'Check button not found');

	btn.listeners.click();
	await flush();

	const call = w.calls.find((c) => c.method === 'lists_check_domain');
	assert.ok(call, 'lists_check_domain was not called');
	assert.deepEqual(call.params, { domain: 'example.com' },
		'domain check must send { domain: "example.com" } — not a nested object');
});

test('lists apply forms { edit: "<JSON string>" } on the wire', async () => {
	const w = makeWorld({
		lists_get: { type: 'ok', value: LISTS_FIXTURE },
		lists_set: { type: 'ok', value: { ok: true, written: ['domainInclude'] } }
	});
	const view = loadView(readViewSource('lists'), 'lists', w);
	const envelope = await view.load();
	const root = view.render(envelope);

	const section = findSection(root.children, 'Apply');
	assert.ok(section, 'Apply section not found');
	let btn = null;
	(function walk(n) {
		if (!n || typeof n !== 'object' || btn) return;
		if (n.listeners && n.listeners.click) { btn = n; return; }
		for (const c of n.children || []) walk(c);
	})(section);
	assert.ok(btn, 'Apply button not found');

	btn.listeners.click();
	await flush();

	const call = w.calls.find((c) => c.method === 'lists_set');
	assert.ok(call, 'lists_set was not called');
	const keys = Object.keys(call.params);
	assert.deepEqual(keys, ['edit'], 'lists_set must send exactly one param: edit');
	assert.equal(typeof call.params.edit, 'string',
		'edit must be a JSON string (ubus signature declares edit:string), not an object');
	const parsed = JSON.parse(call.params.edit);
	assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'domainInclude'));
});

// ---- 4. anti-wipe: a ubus error must lock editing ------------------------------

test('anti-wipe: lists_get ubus error locks textareas and disables Apply', async () => {
	const w = makeWorld({ lists_get: { type: 'ubusError', code: 5 } });
	const view = loadView(readViewSource('lists'), 'lists', w);
	const envelope = await view.load();

	assert.ok(envelope.loadError !== null,
		'with reject: true the ubus error must reject into loadError (numeric resolution would leave it null)');
	const root = view.render(envelope);

	const tas = w.created.filter((n) => n.attrs['data-list-key'] !== undefined);
	assert.ok(tas.length > 0, 'no list textareas rendered');
	for (const ta of tas)
		assert.equal(ta.readOnly, true, 'textarea must be readOnly while the backend is errored');

	const section = findSection(root.children, 'Apply');
	assert.ok(section, 'Apply section not found');
	let applyBtn = null;
	(function walk(n) {
		if (!n || typeof n !== 'object' || applyBtn) return;
		if (n.tag === 'button' || (n.attrs.class || '').includes('cbi-button')) {
			if (n.disabled) { applyBtn = n; return; }
		}
		for (const c of n.children || []) walk(c);
	})(section);
	assert.ok(applyBtn && applyBtn.disabled === true,
		'Apply must be disabled while the backend is errored — empty textareas must never be applied');
});

test('anti-wipe negative control: stripping reject:true loses the visible error path (defect form)', async () => {
	const original = readViewSource('lists');
	assert.ok(/reject:\s*true/.test(original), 'lists.js must contain reject: true for this control');
	const mutated = original.replace(/,\s*reject:\s*true/g, '');
	assert.ok(!/reject:\s*true/.test(stripComments(mutated)), 'mutation failed to strip reject: true');

	const w = makeWorld({ lists_get: { type: 'ubusError', code: 5 } });
	const view = loadView(mutated, 'lists (mutated: no reject)', w);
	const envelope = await view.load();

	// the defect form, proven: without reject:true the ubus error RESOLVES as a
	// number, loadError stays null…
	assert.equal(envelope.loadError, null,
		'defect reproduction: without reject:true the numeric ubus error resolves');
	const root = view.render(envelope);
	// …and because the numeric resolution carries no list model, the page must
	// fail CLOSED (no unlocked editable textarea — empty content can never be
	// applied), while the explicit error banner+lock that reject:true wires up
	// is LOST. That loss is exactly why gate 15 requires reject: true.
	const tas = w.created.filter((n) => n.attrs['data-list-key'] !== undefined);
	const unlocked = tas.filter((ta) => ta.readOnly !== true);
	assert.equal(unlocked.length, 0,
		'fail-closed: without a loaded model no textarea may be editable');
	const banner = collectText(root).join(' | ');
	assert.ok(!banner.includes('List backend unavailable'),
		'without reject:true the explicit backend-error banner is lost (why reject:true is required)');
});

// ---- 5. monitor: stale path on ubus error --------------------------------------

test('monitor: failed poll keeps last-good data, shows STALE, never hangs', async () => {
	const w = makeWorld({ status: { type: 'ok', value: STATUS_FIXTURE } });
	const view = loadView(readViewSource('monitor'), 'monitor', w);

	const envelope = await view.load();
	assert.equal(envelope.loadError, null);
	const root = view.render(envelope);
	assert.ok(root, 'initial render failed');
	assert.ok(w.intervals.length === 1, 'poller must register exactly one interval');

	// capture re-renders (replaceRoot is called by the poller)
	let lastContainer = null;
	view.replaceRoot = function (node) { lastContainer = node; };

	// backend starts failing (ubus error; reject:true turns it into a rejection)
	w.responses.status = { type: 'ubusError', code: 5 };
	w.intervals[0]();
	await flush();

	assert.equal(view._inflight, false, '_inflight must return to false after a failed poll');
	assert.ok(lastContainer, 'stale re-render did not happen');
	const staleText = collectText(lastContainer).join(' | ');
	assert.ok(staleText.includes('STALE'), 'STALE marker must be shown after a failed poll');
	assert.ok(staleText.includes('running'),
		'last-good snapshot must stay on screen (serviceState "running" from the first poll)');

	// backend recovers — polling must not be hung by the earlier rejection
	w.responses.status = { type: 'ok', value: STATUS_FIXTURE };
	w.intervals[0]();
	await flush();

	assert.equal(view._inflight, false, '_inflight must return to false after recovery');
	const freshText = collectText(lastContainer).join(' | ');
	assert.ok(!freshText.includes('STALE'), 'STALE marker must clear after a successful poll');

	const statusCalls = w.calls.filter((c) => c.method === 'status').length;
	assert.ok(statusCalls >= 3, 'expected load + two poll ticks to each issue one status call');
});

// ---- 6. strategies: profiles_list read path ------------------------------------

const PROFILES_FIXTURE = {
	ok: true, schema: 1,
	source: { configPath: '/opt/zapret2/config', configPresent: true, optPresent: true, optVar: 'NFQWS2_OPT', configSha256: 'abcdef0123456789' },
	parseStatus: 'success', profileCount: 2,
	profiles: [
		{
			index: 0, name: null, nameSource: null, nameRecords: [], enabled: true, protocol: 'tcp',
			tcpPorts: [{ option: '--filter-tcp', value: '80', tokenIndex: 1 }], udpPorts: [],
			l7Filters: [{ option: '--filter-l7', value: 'http', tokenIndex: 2 }],
			payloads: [], outboundRanges: [], inboundRanges: [],
			hostlists: [], hostlistExcludes: [], ipsets: [], ipsetExcludes: [], blobs: [], luaInit: [],
			luaDesync: [{
				raw: 'fake:blob=fake_default_http:tcp_md5', tokenIndex: 5,
				catalogHints: { functionName: 'fake', referencedBlobs: ['fake_default_http'], fragmentCount: 3 },
				nativeValidation: { status: 'not_checked', entryPoint: null, coverage: {}, diagnostics: [] }
			}],
			passthroughOptions: [], unknownOptions: [{ option: null, value: '<HOSTLIST>', strayWord: true, tokenIndex: 3 }],
			sourceSpan: { start: 0, end: 100 }
		},
		{
			index: 1, name: 'Games', nameSource: 'new',
			nameRecords: [{ value: 'Games', via: 'new', tokenIndex: 6 }], enabled: true, protocol: 'udp',
			tcpPorts: [], udpPorts: [{ option: '--filter-udp', value: '443', tokenIndex: 7 }],
			l7Filters: [{ option: '--filter-l7', value: 'quic', tokenIndex: 8 }],
			payloads: [], outboundRanges: [], inboundRanges: [],
			hostlists: [], hostlistExcludes: [], ipsets: [], ipsetExcludes: [], blobs: [], luaInit: [],
			luaDesync: [{
				raw: 'fake:blob=fake_default_quic:repeats=6', tokenIndex: 10,
				catalogHints: { functionName: 'fake', referencedBlobs: ['fake_default_quic'], fragmentCount: 3 },
				nativeValidation: { status: 'not_checked', entryPoint: null, coverage: {}, diagnostics: [] }
			}],
			passthroughOptions: [], unknownOptions: [],
			sourceSpan: { start: 100, end: 200 }
		}
	],
	diagnostics: [],
	roundtrip: { preserve: 'identical', diagnostics: [] },
	nativeValidation: { status: 'not_checked', entryPoint: null, coverage: {}, diagnostics: [] },
	provenance: { source: 'applied', reader: 'apply.uc read_var', model: 'strategy-model.md v1', upstreamCommit: 'd3b3011', configPath: '/opt/zapret2/config' }
};

test('strategies: profiles_list renders backend profiles (names, opaque lua-desync, round trip)', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_FIXTURE }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	assert.equal(envelope.profilesError, null, 'profiles_list must load without error');
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Games'), 'backend profile name "Games" must render');
	assert.ok(text.includes('fake:blob=fake_default_http:tcp_md5'), 'opaque lua-desync raw must render verbatim');
	assert.ok(text.includes('identical'), 'preserve round-trip state must render');
	assert.ok(text.includes('<HOSTLIST>'), 'preserved upstream placeholder must render');
	const calls = w.calls.filter((c) => c.method === 'profiles_list');
	assert.ok(calls.length >= 1, 'the view must call profiles_list');
});

test('strategies: profiles_list ubus error → honest Unavailable, zero fabricated profiles', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ubusError', code: 5 }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	assert.ok(envelope.profilesError !== null,
		'with reject:true a profiles_list ubus error rejects into profilesError');
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Unavailable'), 'profiles section must render Unavailable on backend error');
	assert.ok(!text.includes('Games'), 'no fabricated profile names may appear on backend error');
});

test('strategies: ok:false (ETARGET) envelope → Unavailable, not an empty-profile fabrication', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: {
			type: 'ok',
			value: {
				ok: false, schema: 1,
				error: { code: 'ETARGET', message: 'applied config is unreadable or absent' },
				parseStatus: 'unavailable', profileCount: 0, profiles: [], diagnostics: [],
				roundtrip: { preserve: 'skipped', diagnostics: [] },
				nativeValidation: { status: 'not_checked' }, provenance: { source: 'applied' }
			}
		}
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Unavailable'), 'ETARGET envelope must render Unavailable');
	assert.ok(!text.includes('Games'), 'no fabricated profiles on ETARGET');
});

// ---- 7. overview: passthrough wire + reject gate (no longer excluded) --------

test('overview: callPassthrough is declared with params:[enabled] + reject:true (fixed → green)', () => {
	const src = readViewSource('overview');
	assert.ok(src !== null, 'overview.js missing');
	// the exact declaration the contract requires
	assert.ok(/callPassthrough\s*=\s*rpc\.declare\(\s*\{\s*object:\s*'zapret2-manager'\s*,\s*method:\s*'passthrough'\s*,\s*params:\s*\[\s*'enabled'\s*\]\s*,\s*reject:\s*true\s*\}\s*\)/.test(src),
		'callPassthrough must be rpc.declare({object,method,params:[enabled],reject:true})');
	assert.deepEqual(checkRejectTrue(src, 'overview'), [], 'every overview rpc.declare has reject:true');
	assert.deepEqual(checkPositionalCalls(src, 'overview'), [], 'overview params-array calls are positional');
});

test('NEGATIVE CONTROL: overview object-form passthrough call → gate 14 RED', () => {
	const original = readViewSource('overview');
	// mutate the fixed positional call back into the defect (object) form
	const mutated = original.replace(/callPassthrough\(on\)/, 'callPassthrough({ enabled: on })');
	assert.ok(mutated !== original, 'mutation applied — the defect call must be present');
	// the positional-call gate MUST flag the object-form call
	const errs = checkPositionalCalls(mutated, 'overview (mutated: object call)');
	assert.ok(errs.length > 0, 'object-form callPassthrough({enabled:on}) MUST redden the positional gate');
});

test('NEGATIVE CONTROL: overview without reject:true → gate 15 RED', () => {
	const original = readViewSource('overview');
	assert.ok(/reject:\s*true/.test(original), 'overview.js must contain reject:true for this control');
	const mutated = original.replace(/,\s*reject:\s*true/g, '');
	assert.ok(!/reject:\s*true/.test(stripComments(mutated)), 'mutation stripped reject:true');
	const errs = checkRejectTrue(mutated, 'overview (mutated: no reject)');
	assert.ok(errs.length > 0, 'overview without reject:true MUST redden the reject gate');
});
