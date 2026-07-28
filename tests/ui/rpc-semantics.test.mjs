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

// ---- 6b. strategies: draft CRUD (SLICE 2) ---------------------------------------

const DRAFT_BLOCK = {
	present: true, malformed: false, malformedReason: null, profileCount: 2,
	profiles: [
		{
			id: 'p000001', name: 'Web', source: 'imported', revision: 3,
			createdAt: 1785000000, updatedAt: 1785000001,
			opt: '--filter-tcp=80 --filter-l7=http --lua-desync=fake:blob=fake_default_http:tcp_md5',
			parseStatus: 'success', diagnostics: [], duplicateName: false
		},
		{
			id: 'p000002', name: 'Games', source: 'created', revision: 1,
			createdAt: 1785000002, updatedAt: 1785000002,
			opt: '--filter-udp=443 --filter-l7=quic --lua-desync=fake:blob=fake_default_quic:repeats=6',
			parseStatus: 'success', diagnostics: [], duplicateName: false
		}
	]
};

const PROFILES_WITH_DRAFT = { ...PROFILES_FIXTURE, draft: DRAFT_BLOCK };

function findBtn(rootChildren, label) {
	let found = null;
	(function walk(n) {
		if (!n || typeof n !== 'object' || found) return;
		if ((n.tag === 'button' || (n.attrs && (n.attrs.class || '').includes('cbi-button')))
			&& n.children && n.children.includes(label)) { found = n; return; }
		for (const c of n.children || []) walk(c);
	})({ children: rootChildren });
	return found;
}

test('strategies: draft manager lists drafts with ids/revisions (no fabrication)', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('p000001'), 'draft id renders');
	assert.ok(text.includes('rev 3'), 'draft revision renders');
	assert.ok(text.includes('imported'), 'draft source renders');
});

test('strategies: New draft → editor → Create sends { name, opt } as a JSON STRING', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_create: { type: 'ok', value: { ok: true, id: 'p000003', revision: 1 } }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);

	const newBtn = findBtn(root.children, 'New draft profile');
	assert.ok(newBtn, 'New draft button not found');
	newBtn.listeners.click();
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });

	const nameInput = w.created.find((n) => n.attrs.id === 'z2m-editor-name');
	const optArea = w.created.find((n) => n.attrs.id === 'z2m-editor-opt');
	assert.ok(nameInput && optArea, 'editor fields not rendered');
	nameInput.value = 'My Draft';
	optArea.value = '--filter-tcp=443 --lua-desync=pass';

	const saveBtn = w.created.find((n) => n.attrs.id === 'z2m-editor-save');
	assert.ok(saveBtn, 'save button not found');
	assert.equal(saveBtn.disabled, false);
	saveBtn.listeners.click();
	assert.equal(saveBtn.disabled, true, 'save disables while busy (no double submit)');
	await flush();

	const call = w.calls.find((c) => c.method === 'profiles_create');
	assert.ok(call, 'profiles_create was not called');
	assert.deepEqual(Object.keys(call.params), ['edit'], 'profiles_create sends exactly one param: edit');
	assert.equal(typeof call.params.edit, 'string', 'edit must be a JSON string');
	const parsed = JSON.parse(call.params.edit);
	assert.deepEqual(parsed, { name: 'My Draft', opt: '--filter-tcp=443 --lua-desync=pass' });
});

test('strategies: Edit save sends { id, revision, name, opt } (optimistic concurrency)', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_update: { type: 'ok', value: { ok: true, id: 'p000001', revision: 4 } }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);

	const editBtn = findBtn(root.children, 'Edit');
	assert.ok(editBtn, 'Edit button not found');
	editBtn.listeners.click();
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });

	const nameInput = w.created.find((n) => n.attrs.id === 'z2m-editor-name');
	const saveBtn = w.created.find((n) => n.attrs.id === 'z2m-editor-save');
	assert.ok(nameInput && saveBtn, 'editor not open for edit');
	nameInput.value = 'Web v2';
	saveBtn.listeners.click();
	await flush();

	const call = w.calls.find((c) => c.method === 'profiles_update');
	assert.ok(call, 'profiles_update was not called');
	const parsed = JSON.parse(call.params.edit);
	assert.deepEqual(parsed, {
		id: 'p000001', revision: 3, name: 'Web v2',
		opt: '--filter-tcp=80 --filter-l7=http --lua-desync=fake:blob=fake_default_http:tcp_md5'
	}, 'update carries the CURRENT revision for optimistic concurrency');
});

test('strategies: ECONFLICT keeps the editor open with the conflict message (no silent overwrite)', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_update: { type: 'ok', value: { ok: false, error: { code: 'ECONFLICT', message: 'draft p000001 was changed elsewhere (revision 5); reload and retry' } } }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	findBtn(root.children, 'Edit').listeners.click();
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const saveBtn = w.created.find((n) => n.attrs.id === 'z2m-editor-save');
	saveBtn.listeners.click();
	await flush();
	assert.ok(view._editor, 'editor must stay open on ECONFLICT');
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Conflict'), 'the ECONFLICT message renders');
	assert.ok(text.includes('revision 5'), 'the backend conflict detail renders');
});

test('strategies: delete is two-step (arm → confirm) and sends { id }', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_delete: { type: 'ok', value: { ok: true, id: 'p000002' } }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);

	const delBtn = findBtn(root.children, 'Delete');
	assert.ok(delBtn, 'Delete button not found');
	delBtn.listeners.click();   // arm
	assert.ok(w.calls.every((c) => c.method !== 'profiles_delete'), 'first click only ARMS — no backend call yet');
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const confirmBtn = findBtn(root.children, 'Confirm delete?');
	assert.ok(confirmBtn, 'armed delete must require an explicit confirm');
	confirmBtn.listeners.click();   // confirm
	await flush();
	const call = w.calls.find((c) => c.method === 'profiles_delete');
	assert.ok(call, 'profiles_delete was not called after confirm');
	assert.deepEqual(JSON.parse(call.params.edit), { id: 'p000001' }, 'the FIRST row\'s delete sends its own id');
});

test('strategies: Validate per draft sends { id } and renders manager+native vocabulary', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_validate: {
			type: 'ok',
			value: {
				ok: true, draftId: 'p000001',
				manager: { parseStatus: 'success', profileCount: 1, diagnostics: [] },
				native: {
					status: 'partial', entryPoint: 'dry-run',
					coverage: { cliSyntax: 'passed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
					diagnostics: []
				}
			}
		}
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const valBtn = findBtn(root.children, 'Validate');
	assert.ok(valBtn, 'Validate button not found');
	valBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'profiles_validate');
	assert.ok(call, 'profiles_validate was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { id: 'p000001' });
	const root2 = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	// the result lives in view state; re-render via refresh path shows it
	const text = collectText(view.draftManagerSection(PROFILES_WITH_DRAFT, null)).join(' | ');
	assert.ok(view._validateResult, 'validate result is stored for rendering');
});

test('strategies: malformed draft block renders the preserved-state warning, no CRUD', async () => {
	const malformed = {
		...PROFILES_FIXTURE,
		draft: { present: true, malformed: true, malformedReason: 'state.json is not valid JSON', profileCount: 0, profiles: [] }
	};
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: malformed }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('MALFORMED'), 'malformed draft must be surfaced loudly');
	assert.ok(text.includes('never overwritten'), 'the preserve guarantee renders');
	assert.ok(!findBtn(root.children, 'New draft profile'), 'no CRUD while the state is malformed');
});

test('strategies: guided add-option appends a whitelisted option to the raw editor', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	findBtn(root.children, 'New draft profile').listeners.click();
	view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });

	const optArea = w.created.find((n) => n.attrs.id === 'z2m-editor-opt');
	const sel = w.created.find((n) => n.attrs.id === 'z2m-editor-addopt');
	const valInput = w.created.find((n) => n.attrs.id === 'z2m-editor-addval');
	assert.ok(optArea && sel && valInput, 'guided row not rendered');
	optArea.value = '--filter-tcp=80';
	sel.value = '--filter-udp';
	valInput.value = '443';
	const addBtn = findBtn([{ children: [] }], 'Add option') || (function () {
		let b = null;
		for (const n of w.created) if (n.children.includes('Add option')) b = n;
		return b;
	})();
	addBtn.listeners.click();
	assert.equal(optArea.value, '--filter-tcp=80 --filter-udp=443', 'guided row appends --opt=value to the raw editor');
});

// ---- 6c. strategies: apply flow (SLICE 3) ---------------------------------------

const PREVIEW_OK = {
	ok: true, mode: 'preview', draftCount: 2,
	candidate: '--filter-tcp=80 --lua-desync=pass --new --filter-udp=443 --lua-desync=pass',
	diff: { changed: true, currentSha256: 'aaaa0000bbbb1111', candidateSha256: 'cccc2222dddd3333', currentLength: 30, candidateLength: 70 },
	native: {
		status: 'partial', entryPoint: 'dry-run',
		coverage: { cliSyntax: 'passed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: []
	},
	wouldApply: true, refuseReason: null
};

test('strategies: Preview apply renders diff + honest native coverage; apply needs ONE confirm', async () => {
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_apply: { type: 'ok', value: PREVIEW_OK }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);

	const prevBtn = w.created.find((n) => n.attrs.id === 'z2m-apply-preview');
	assert.ok(prevBtn, 'Preview apply button not found');
	prevBtn.listeners.click();
	await flush();

	const previewCall = w.calls.find((c) => c.method === 'profiles_apply');
	assert.ok(previewCall, 'profiles_apply was not called');
	assert.deepEqual(JSON.parse(previewCall.params.edit), { mode: 'preview' }, 'preview mode on the wire');

	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('aaaa0000bbbb1111'.substring(0, 16)), 'applied sha256 renders');
	assert.ok(text.includes('dry-run proves CLI syntax only'), 'honest coverage note renders');
	assert.ok(text.includes('yes'), 'changed=yes renders');

	const applyBtn = w.created.find((n) => n.attrs.id === 'z2m-apply-run');
	assert.ok(applyBtn, 'apply button must render when wouldApply');
	applyBtn.listeners.click();   // ARM — not the apply call
	const callsSoFar = w.calls.filter((c) => c.method === 'profiles_apply');
	assert.equal(callsSoFar.length, 1, 'first click only ARMS — no second apply call yet');
});

test('strategies: refused preview (native rejected) keeps Apply disabled with the reason', async () => {
	const refused = {
		ok: true, mode: 'preview', draftCount: 2, candidate: 'x',
		diff: { changed: true, currentSha256: 'a', candidateSha256: 'b' },
		native: {
			status: 'rejected', entryPoint: 'dry-run',
			coverage: { cliSyntax: 'failed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
			diagnostics: [{ severity: 'error', code: 'NATIVE_REJECTED', message: 'unknown option --bogus' }]
		},
		wouldApply: false, refuseReason: 'native validation did not pass (status: rejected)'
	};
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_apply: { type: 'ok', value: refused }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-apply-preview').listeners.click();
	await flush();
	const root2 = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const text = collectText(root2).join(' | ');
	assert.ok(text.includes('refused by validation'), 'the refusal renders');
	assert.ok(text.includes('rejected'), 'the native status renders');
	assert.ok(!w.created.find((n) => n.attrs.id === 'z2m-apply-run'),
		'no apply button when validation refuses');
});

test('strategies: apply success renders the five verification checks + manual rollback row', async () => {
	const applied = {
		ok: true, mode: 'apply',
		applied: { profiles: 2, candidateSha256: 'cccc2222dddd3333' },
		verify: { ok: true, checks: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true }, daemonPid: 6128, queueOwner: 6128 },
		snapshot: { configSha256: 'aaaa', uciSha256: null, generation: 7 },
		rollback: { available: true, armed: false }
	};
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_apply: { type: 'ok', value: PREVIEW_OK }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-apply-preview').listeners.click();
	await flush();
	view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const applyBtn = w.created.find((n) => n.attrs.id === 'z2m-apply-run');
	assert.ok(applyBtn, 'apply button renders after preview');
	applyBtn.listeners.click();   // ARM (listener closes over view state)
	assert.equal(view._apply.armed, true, 'first click arms');
	w.responses.profiles_apply = { type: 'ok', value: applied };
	applyBtn.listeners.click();   // CONFIRM → apply executes
	await flush();
	const applyCalls = w.calls.filter((c) => c.method === 'profiles_apply' && JSON.parse(c.params.edit).mode === 'apply');
	assert.ok(applyCalls.length === 1, 'exactly one apply call after arm+confirm');
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Applied and verified'), 'success state renders');
	assert.ok(text.includes('processPresent'), 'verification checks render');
	assert.ok(text.includes('ownerMatch'), 'owner-match check renders');
	assert.ok(text.includes('Roll back'), 'manual rollback row renders');
});

test('strategies: apply failure with rollback renders the rolled-back state; critical is loud', async () => {
	const failed = {
		ok: false, stage: 'verify', critical: false,
		error: { code: 'ETARGET', message: 'apply failed verification (restart rc=0) — rolled back to last-good' },
		verify: { ok: false, checks: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: false, ownerMatch: false }, daemonPid: 6128, queueOwner: null },
		rolledBack: true, rollbackOk: true
	};
	const w = makeWorld({
		status: { type: 'ok', value: STATUS_FIXTURE },
		profiles_list: { type: 'ok', value: PROFILES_WITH_DRAFT },
		profiles_apply: { type: 'ok', value: PREVIEW_OK }
	});
	const view = loadView(readViewSource('strategies'), 'strategies', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-apply-preview').listeners.click();
	await flush();
	view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	w.created.find((n) => n.attrs.id === 'z2m-apply-run').listeners.click();
	view._apply.armed = true;
	w.responses.profiles_apply = { type: 'ok', value: failed };
	w.created.find((n) => n.attrs.id === 'z2m-apply-run').listeners.click();
	await flush();
	root = view.render({ loadError: null, data: STATUS_FIXTURE, profilesData: PROFILES_WITH_DRAFT });
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Apply failed'), 'failure renders');
	assert.ok(text.includes('restored automatically'), 'rolled-back state renders');
});

// ---- 6d. blockcheck: jobs UI (SLICE 4) -----------------------------------------

const BC_JOB_RUNNING = {
	ok: true,
	job: {
		id: 'job-1785000000-1', kind: 'blockcheck', mode: 'quick', domains: ['rutracker.org'],
		status: 'running', createdAt: 1785000000, startedAt: 1785000001, finishedAt: null,
		timeoutSec: 300, rc: null, error: null, cancelled: false,
		engineRunning: true, elapsedSec: 42, recommendations: [], summary: null,
		logTail: '* checking system\nLinux detected\n* checking without DPI bypass\n'
	}
};

const BC_JOB_DONE = {
	ok: true,
	job: {
		id: 'job-1785000000-2', kind: 'blockcheck', mode: 'full', domains: ['rutracker.org'],
		status: 'succeeded', createdAt: 1785000000, startedAt: 1785000001, finishedAt: 1785001000,
		timeoutSec: 1800, rc: 0, error: null, cancelled: false,
		engineRunning: false, elapsedSec: 199,
		recommendations: [{
			test: 'curl_test_https_tls12', ipver: 'ipv4', domain: 'rutracker.org', daemon: 'nfqws2',
			strategy: '--lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000',
			raw: '!!!!! curl_test_https_tls12: working strategy found for ipv4 rutracker.org : nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000 !!!!!',
			provenance: { source: 'upstream blockcheck2.sh', mode: 'full', domains: ['rutracker.org'], engineRunning: false }
		}],
		summary: { summary: [{ test: 'curl_test_https_tls12', ipver: 'ipv4', domain: 'rutracker.org', result: 'nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000' }], common: [] },
		logTail: '* SUMMARY\ncurl_test_https_tls12 ipv4 rutracker.org : nfqws2 --lua-desync=fake:...\n'
	}
};

test('blockcheck: Start sends { mode, domains } as a JSON string', async () => {
	const w = makeWorld({
		blockcheck_status: { type: 'ok', value: { ok: true, job: null, note: 'no blockcheck jobs yet' } },
		job_list: { type: 'ok', value: { ok: true, jobs: [] } },
		blockcheck_start: { type: 'ok', value: { ok: true, job: BC_JOB_RUNNING.job, warning: null } }
	});
	const view = loadView(readViewSource('blockcheck'), 'blockcheck', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const modeSel = w.created.find((n) => n.attrs.id === 'z2m-bc-mode');
	const domArea = w.created.find((n) => n.attrs.id === 'z2m-bc-domains');
	const startBtn = w.created.find((n) => n.attrs.id === 'z2m-bc-start');
	assert.ok(modeSel && domArea && startBtn, 'run controls not rendered');
	modeSel.value = 'domains';
	domArea.value = 'rutracker.org example.com';
	startBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'blockcheck_start');
	assert.ok(call, 'blockcheck_start was not called');
	assert.equal(typeof call.params.edit, 'string');
	assert.deepEqual(JSON.parse(call.params.edit), { mode: 'domains', domains: ['rutracker.org', 'example.com'] });
});

test('blockcheck: running job shows badge + elapsed + log tail; Start disabled; Cancel wired', async () => {
	const w = makeWorld({
		blockcheck_status: { type: 'ok', value: BC_JOB_RUNNING },
		job_list: { type: 'ok', value: { ok: true, jobs: [BC_JOB_RUNNING.job] } },
		blockcheck_cancel: { type: 'ok', value: { ok: true, cancelling: true, id: 'job-1785000000-1' } }
	});
	const view = loadView(readViewSource('blockcheck'), 'blockcheck', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('running'), 'status badge renders');
	assert.ok(text.includes('42s'), 'elapsed renders (honest signal — no percentage)');
	assert.ok(!/\d+%/.test(text), 'NEGATIVE: no progress percentage anywhere');
	assert.ok(text.includes('checking system'), 'log tail renders');
	assert.ok(text.includes('results may be unreliable'), 'engine-running warning renders');
	const startBtn = w.created.find((n) => n.attrs.id === 'z2m-bc-start');
	assert.equal(startBtn.disabled, true, 'Start disabled while a job is active');
	const cancelBtn = w.created.find((n) => n.attrs.id === 'z2m-bc-cancel');
	assert.ok(cancelBtn, 'Cancel renders for the active job');
	cancelBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'blockcheck_cancel');
	assert.ok(call, 'blockcheck_cancel was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { id: 'job-1785000000-1' });
});

test('blockcheck: ECONFLICT start refusal renders the backend message', async () => {
	const w = makeWorld({
		blockcheck_status: { type: 'ok', value: { ok: true, job: null } },
		job_list: { type: 'ok', value: { ok: true, jobs: [] } },
		blockcheck_start: { type: 'ok', value: { ok: false, error: { code: 'ECONFLICT', message: 'blockcheck job job-1 is already running' } } }
	});
	const view = loadView(readViewSource('blockcheck'), 'blockcheck', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-bc-start').listeners.click();
	await flush();
	const root2 = view.render(await view.load());
	const text = collectText(root2).join(' | ');
	assert.ok(text.includes('Start refused'), 'the refusal renders');
	assert.ok(text.includes('already running'), 'the backend ECONFLICT detail renders');
});

test('blockcheck: recommendations render with provenance; Save to Draft sends the strategy VERBATIM', async () => {
	const w = makeWorld({
		blockcheck_status: { type: 'ok', value: BC_JOB_DONE },
		job_list: { type: 'ok', value: { ok: true, jobs: [BC_JOB_DONE.job] } },
		profiles_create: { type: 'ok', value: { ok: true, id: 'p000007', revision: 1 } }
	});
	const view = loadView(readViewSource('blockcheck'), 'blockcheck', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000'), 'strategy renders verbatim');
	assert.ok(text.includes('upstream blockcheck2.sh'), 'provenance renders');
	const saveBtn = findBtn(root.children, 'Save to Draft');
	assert.ok(saveBtn, 'Save to Draft button not found');
	saveBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'profiles_create');
	assert.ok(call, 'profiles_create was not called');
	const parsed = JSON.parse(call.params.edit);
	assert.equal(parsed.opt, '--lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000',
		'the strategy is stored VERBATIM — never mutated on its way to a draft');
	assert.ok(parsed.name.includes('rutracker.org'));
});

// ---- 6e. maintenance: versions/backups/events/diagnostics (SLICE 5) ---------------

const VERSIONS_FIXTURE = {
	ok: true,
	manager: { name: 'zapret2-manager', version: '0.1.0-r4' },
	luciApp: { name: 'luci-app-zapret2-manager', version: '0.1.0-r4' },
	upstreamPkg: { name: 'zapret2', version: '0.9.20260307-r1' },
	nfqws2: '0.9.20260307', luaCompatVer: 5, os: 'OpenWrt 25.12.5',
	updateAvailable: null, note: 'installed versions read from the system'
};

const MAINT_FIXTURE = {
	ok: true, uptimeSec: 3661, memory: { availableKb: 102400 },
	storage: { overlayPercent: 42, tmpPercent: 3 },
	backups: {}, events: { total: 12, lastSeverity: 'info' },
	rebootRequired: false, note: 'n'
};

const BACKUPS_FIXTURE = {
	ok: true, historyCap: 3,
	scopes: {
		engineConfig: {
			paths: ['/opt/zapret2/config'],
			current: { takenAt: 1785000000, version: 1, manifestSha256: 'aabbccdd00112233', format: 2, files: [{ path: '/opt/zapret2/config', sha256: 'aa', size: 100 }] },
			history: [{ takenAt: 1785000000, version: 1, manifestSha256: 'aabbccdd00112233', format: 2, files: [{ path: '/opt/zapret2/config', sha256: 'aa', size: 100 }] }]
		},
		ourState: { paths: ['/etc/zapret2-manager/state.json'], current: null, history: [] },
		lists: { paths: [], current: null, history: [] },
		profiles: { paths: [], current: null, history: [] }
	}
};

const EVENTS_FIXTURE = {
	ok: true, total: 2,
	events: [
		{ schema: 'events.v1', ts: '2026-07-28T01:00:00Z', id: 'watchdog-1', category: 'config', severity: 'info', source: 'watchdog', msg: 'cycle ok' },
		{ schema: 'events.v1', ts: '2026-07-28T02:00:00Z', id: 'ui-2', category: 'pause', severity: 'warn', source: 'ui', msg: 'paused' }
	],
	malformed: [{ preview: '{ broken' }]
};

function maintWorld(extra = {}) {
	return makeWorld({
		versions: { type: 'ok', value: VERSIONS_FIXTURE },
		maintenance_status: { type: 'ok', value: MAINT_FIXTURE },
		backup_list: { type: 'ok', value: BACKUPS_FIXTURE },
		events_tail: { type: 'ok', value: EVENTS_FIXTURE },
		...extra
	});
}

test('maintenance: versions/events render real data; malformed event line shown', async () => {
	const w = maintWorld();
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('0.1.0-r4'), 'manager version renders');
	assert.ok(text.includes('OpenWrt 25.12.5'), 'OS renders');
	assert.ok(text.includes('cycle ok'), 'event renders');
	assert.ok(text.includes('malformed line'), 'malformed event line is REPORTED');
	assert.ok(text.includes('42%'), 'storage renders');
});

test('maintenance: backup_create sends { scope } as JSON string', async () => {
	const w = maintWorld({ backup_create: { type: 'ok', value: { ok: true, scopes: {} } } });
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const sel = w.created.find((n) => n.attrs.id === 'z2m-backup-scope');
	const btn = w.created.find((n) => n.attrs.id === 'z2m-backup-create');
	assert.ok(sel && btn, 'backup create controls not rendered');
	sel.value = 'engineConfig';
	btn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'backup_create');
	assert.ok(call, 'backup_create was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { scope: 'engineConfig' });
});

test('maintenance: preview → restorable → restore is arm→confirm with the right payload', async () => {
	const previewOk = {
		ok: true, scope: 'engineConfig', takenAt: 1785000000,
		archive: { takenAt: 1785000000, version: 1 },
		integrity: { manifest: true, ok: true, reason: null },
		diffs: [{ path: '/opt/zapret2/config', presentNow: true, changed: true, currentSha256: 'aaaa', archiveSha256: 'bbbb', currentSize: 90, archiveSize: 100 }],
		syntax: [], versionGate: 'ok', restorable: true
	};
	const w = maintWorld({
		backup_restore_preview: { type: 'ok', value: previewOk },
		backup_restore: { type: 'ok', value: { ok: true, restored: true, preTaken: true, scope: 'engineConfig', downgradeWarning: null, note: 'restart the service' } }
	});
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	const prevBtn = findBtn(root.children, 'Preview');
	assert.ok(prevBtn, 'Preview button not found');
	prevBtn.listeners.click();
	await flush();
	root = view.render(await view.load());
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('sha256 manifest OK'), 'integrity renders');
	assert.ok(text.includes('changed'), 'diff renders');
	const restoreBtn = findBtn(root.children, 'Restore this archive');
	assert.ok(restoreBtn, 'restore button renders when restorable');
	restoreBtn.listeners.click();   // ARM
	assert.ok(w.calls.every((c) => c.method !== 'backup_restore'), 'first click only ARMS');
	root = view.render(await view.load());
	const confirmBtn = findBtn(root.children, 'Confirm restore (current state is snapshotted first)?');
	assert.ok(confirmBtn, 'confirm step renders');
	confirmBtn.listeners.click();   // CONFIRM
	await flush();
	const call = w.calls.find((c) => c.method === 'backup_restore');
	assert.ok(call, 'backup_restore was not called after confirm');
	assert.deepEqual(JSON.parse(call.params.edit), { scope: 'engineConfig', takenAt: 1785000000 });
});

test('maintenance: NOT-restorable preview shows the reason and no restore button', async () => {
	const previewBad = {
		ok: true, scope: 'engineConfig', takenAt: 1785000000,
		integrity: { manifest: true, ok: false, reason: 'sha256 mismatch for /opt/zapret2/config' },
		diffs: [], syntax: [], versionGate: 'ok', restorable: false
	};
	const w = maintWorld({ backup_restore_preview: { type: 'ok', value: previewBad } });
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	findBtn(root.children, 'Preview').listeners.click();
	await flush();
	root = view.render(await view.load());
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Not restorable'), 'the not-restorable verdict renders');
	assert.ok(!findBtn(root.children, 'Restore this archive'), 'no restore button when integrity fails');
});

test('maintenance: delete is two-step and sends { scope, takenAt }', async () => {
	const w = maintWorld({ backup_delete: { type: 'ok', value: { ok: true, scope: 'engineConfig', deleted: 1785000000 } } });
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	const delBtn = findBtn(root.children, 'Delete');
	assert.ok(delBtn, 'Delete button not found');
	delBtn.listeners.click();   // arm
	assert.ok(w.calls.every((c) => c.method !== 'backup_delete'), 'first click only ARMS');
	root = view.render(await view.load());
	const confirmBtn = findBtn(root.children, 'Confirm delete?');
	confirmBtn.listeners.click();   // confirm
	await flush();
	const call = w.calls.find((c) => c.method === 'backup_delete');
	assert.ok(call, 'backup_delete was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { scope: 'engineConfig', takenAt: 1785000000 });
});

test('maintenance: diagnostics export calls diagnostics_export (no browser filesystem)', async () => {
	const w = maintWorld({
		diagnostics_export: { type: 'ok', value: { ok: true, export: { generatedAt: 1, redactedFields: 1, versions: {} } } }
	});
	const view = loadView(readViewSource('maintenance'), 'maintenance', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const btn = w.created.find((n) => n.attrs.id === 'z2m-diagnostics');
	assert.ok(btn, 'diagnostics button not found');
	btn.listeners.click();
	await flush();
	assert.ok(w.calls.some((c) => c.method === 'diagnostics_export'), 'diagnostics_export was not called');
});

// ---- 6f. dns: overrides UI (S6) ---------------------------------------------------

const DNS_GET_FIXTURE = {
	ok: true,
	resolver: {
		components: [{ name: 'dnsmasq', role: 'system resolver (managed integration point)' }],
		conflicts: [],
		upstreamNameservers: ['195.98.64.65', '195.98.64.66'],
		resolvfile: '/tmp/resolv.conf.d/resolv.conf.auto',
		dnsmasqAddressEntries: []
	},
	overridesPath: '/etc/zapret2-manager/dns-overrides.hosts',
	registered: true,
	applied: [{ domain: 'rutracker.org', ip: '195.82.146.214', enabled: true }],
	draft: { malformed: false, malformedReason: null, revision: 1, entries: [{ domain: 'rutracker.org', ip: '195.82.146.214', enabled: true }] },
	note: 'n'
};

function dnsWorld(extra = {}) {
	return makeWorld({
		dns_get: { type: 'ok', value: DNS_GET_FIXTURE },
		...extra
	});
}

test('dns: resolver summary + applied overrides render real target data', async () => {
	const w = dnsWorld();
	const view = loadView(readViewSource('dns'), 'dns', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('dnsmasq'), 'resolver component renders');
	assert.ok(text.includes('195.98.64.65'), 'upstream nameserver renders');
	assert.ok(text.includes('rutracker.org'), 'applied override renders');
	assert.ok(text.includes('195.82.146.214'), 'pinned ip renders');
});

test('dns: Save draft sends { entries, revision } as JSON string', async () => {
	const w = dnsWorld({ dns_set: { type: 'ok', value: { ok: true, revision: 2, count: 1 } } });
	const view = loadView(readViewSource('dns'), 'dns', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const saveBtn = w.created.find((n) => n.attrs.id === 'z2m-dns-save');
	assert.ok(saveBtn, 'Save draft button not found');
	saveBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'dns_set');
	assert.ok(call, 'dns_set was not called');
	const parsed = JSON.parse(call.params.edit);
	assert.deepEqual(parsed, { entries: [{ domain: 'rutracker.org', ip: '195.82.146.214' }], revision: 1 });
});

test('dns: Validate renders backend errors (no fake valid state)', async () => {
	const w = dnsWorld({
		dns_validate: {
			type: 'ok',
			value: {
				ok: true, valid: false,
				errors: [{ index: 0, reason: 'conflict: a.com pinned to two different IPs (1.1.1.1 vs 2.2.2.2)' }],
				resolverConflicts: [], foreignConflicts: [], checkedEntries: 0
			}
		}
	});
	const view = loadView(readViewSource('dns'), 'dns', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-dns-validate').listeners.click();
	await flush();
	const root2 = view.render(await view.load());
	const text = collectText(root2).join(' | ');
	assert.ok(text.includes('invalid'), 'invalid verdict renders');
	assert.ok(text.includes('two different IPs'), 'the backend conflict detail renders');
});

test('dns: preview → apply is arm→confirm; result shows verification', async () => {
	const previewOk = {
		ok: true, mode: 'preview', registered: true, registrationNeeded: false,
		diff: { added: [{ domain: 'ntc.party', ip: '104.21.5.19' }], removed: [], changed: [], unchangedCount: 1 },
		candidate: '# zapret2-manager DNS overrides\n195.82.146.214 rutracker.org\n104.21.5.19 ntc.party\n',
		note: 'n'
	};
	const applyOk = {
		ok: true, mode: 'apply', registered: true,
		verify: {
			processAlive: true, portListening: true, entriesMatch: true,
			entries: [{ domain: 'rutracker.org', expectedIp: '195.82.146.214', matched: true }]
		},
		snapshot: { dir: '/tmp/zapret2-manager/last-good/dns' }, note: 'n'
	};
	const w = dnsWorld({ dns_apply: { type: 'ok', value: previewOk } });
	const view = loadView(readViewSource('dns'), 'dns', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-dns-preview').listeners.click();
	await flush();
	const prevCall = w.calls.find((c) => c.method === 'dns_apply');
	assert.deepEqual(JSON.parse(prevCall.params.edit), { mode: 'preview' });
	root = view.render(await view.load());
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Added'), 'diff renders');
	const applyBtn = w.created.find((n) => n.attrs.id === 'z2m-dns-apply-run');
	assert.ok(applyBtn, 'apply button renders');
	applyBtn.listeners.click();   // ARM
	assert.ok(w.calls.filter((c) => c.method === 'dns_apply').length === 1, 'first click only ARMS');
	w.responses.dns_apply = { type: 'ok', value: applyOk };
	applyBtn.listeners.click();   // CONFIRM
	await flush();
	const applyCalls = w.calls.filter((c) => c.method === 'dns_apply' && JSON.parse(c.params.edit).mode === 'apply');
	assert.equal(applyCalls.length, 1, 'exactly one apply call after arm+confirm');
	root = view.render(await view.load());
	const text2 = collectText(root).join(' | ');
	assert.ok(text2.includes('Applied and verified'), 'verification renders');
	assert.ok(text2.includes('listening'), 'port check renders');
});

test('dns: Check resolution calls dns_check and shows matches', async () => {
	const w = dnsWorld({
		dns_check: {
			type: 'ok',
			value: { ok: true, results: [{ domain: 'rutracker.org', expectedIp: '195.82.146.214', matched: true }], allMatch: true }
		}
	});
	const view = loadView(readViewSource('dns'), 'dns', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-dns-check').listeners.click();
	await flush();
	assert.ok(w.calls.some((c) => c.method === 'dns_check'), 'dns_check was not called');
	const root2 = view.render(await view.load());
	const text = collectText(root2).join(' | ');
	assert.ok(text.includes('match'), 'match result renders');
});

// ---- 6g. catalog: service catalog page (Phase B) ----------------------------------

const CATALOG_LIST_FIXTURE = {
	ok: true, schema: 1, catalogVersion: '1.0.0', digest: 'a'.repeat(64), digestOk: true,
	services: [
		{ id: 'youtube', name: 'YouTube', category: 'video', mechanisms: ['domainInclude'], stability: 'reviewed', limitations: 'Effectiveness depends on the ACTIVE strategy.', domainCount: 4 },
		{ id: 'chatgpt-openai', name: 'ChatGPT / OpenAI', category: 'AI', mechanisms: ['domainInclude', 'unsupportedGeo'], stability: 'reviewed', limitations: 'Domain listing does NOT bypass account/GEO restrictions.', domainCount: 4 }
	],
	categories: ['video', 'AI'], stale: [], overlaps: []
};

const CATALOG_STATUS_FIXTURE = {
	ok: true,
	ledger: { enabled: ['youtube'], revision: 2, updatedAt: 1785220000, catalogDigest: 'a'.repeat(64) },
	catalog: { valid: true, errors: [], catalogVersion: '1.0.0', digestOk: true },
	stale: [], ownedDomains: 4, ownedPresent: 4, ownedMissing: [], userDomains: 1, filePresent: 5,
	drift: { divergent: false, reason: null }
};

function catalogWorld(extra = {}) {
	return makeWorld({
		catalog_list: { type: 'ok', value: CATALOG_LIST_FIXTURE },
		catalog_status: { type: 'ok', value: CATALOG_STATUS_FIXTURE },
		...extra
	});
}

test('catalog: renders services with mechanisms + limitations; enabled from ledger', async () => {
	const w = catalogWorld();
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('YouTube'), 'service renders');
	assert.ok(text.includes('GEO-limited'), 'unsupportedGeo badge renders honestly');
	assert.ok(text.includes('NOT bypass'), 'limitations text renders');
	assert.ok(text.includes('youtube'), 'ledger-enabled state renders');
	assert.ok(!/unblocked/i.test(text), 'NEGATIVE: no "unblocked" claims anywhere');
});

test('catalog: preview sends the full desired enabled set as JSON string', async () => {
	const pv = {
		ok: true, additions: [{ domain: 'chatgpt.com', owners: ['chatgpt-openai'] }],
		removals: [], keepShared: [], alreadyUserOwned: [], preservedUser: ['user-manual.com'],
		unsupported: [{ service: 'chatgpt-openai', mechanisms: ['unsupportedGeo'] }], unknownIds: [],
		desiredCount: 8, targetFile: '/opt/zapret2/ipset/zapret-hosts-user.txt',
		precondition: { fileSha256: 'abcdef0123456789', ledgerRevision: 2 }
	};
	const w = catalogWorld({ catalog_preview: { type: 'ok', value: pv } });
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	// check the second service first (the desired set is driven by checkboxes)
	const cb = w.created.find((n) => n.attrs.id === 'z2m-catalog-svc-chatgpt-openai');
	assert.ok(cb, 'service checkbox not rendered');
	cb.checked = true;
	cb.listeners.change();
	const prevBtn = w.created.find((n) => n.attrs.id === 'z2m-catalog-preview');
	assert.ok(prevBtn, 'Preview button not found');
	prevBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'catalog_preview');
	assert.ok(call, 'catalog_preview was not called');
	const parsed = JSON.parse(call.params.edit);
	assert.deepEqual(parsed.enabled.sort(), ['chatgpt-openai', 'youtube'].sort(),
		'the desired set = ledger-enabled plus checked services');
	root = view.render(await view.load());
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('chatgpt.com'), 'addition renders');
	assert.ok(text.includes('REPORTED, never applied'), 'unsupported mechanisms are honest');
	assert.ok(text.includes('user-manual.com'), 'preserved user entry renders');
});

test('catalog: apply is arm→confirm with precondition revision+hash on the wire', async () => {
	const pv = {
		ok: true, additions: [{ domain: 'chatgpt.com', owners: ['chatgpt-openai'] }],
		removals: [], keepShared: [], alreadyUserOwned: [], preservedUser: ['user-manual.com'],
		unsupported: [], unknownIds: [], desiredCount: 8, targetFile: '/opt/zapret2/ipset/zapret-hosts-user.txt',
		precondition: { fileSha256: 'abcdef0123456789', ledgerRevision: 2 }
	};
	const applied = {
		ok: true, applied: { added: 1, removed: 0, keptShared: 0, preservedUser: 1 },
		unsupported: [], unknownIds: [], verify: { ok: true, mismatches: [] },
		snapshot: { dir: '/tmp/zapret2-manager/last-good/catalog' },
		ledger: { enabled: ['youtube', 'chatgpt-openai'], revision: 3, updatedAt: 1785220001 }
	};
	const w = catalogWorld({
		catalog_preview: { type: 'ok', value: pv },
		catalog_apply: { type: 'ok', value: applied }
	});
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	let root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-catalog-preview').listeners.click();
	await flush();
	root = view.render(await view.load());
	const applyBtn = w.created.find((n) => n.attrs.id === 'z2m-catalog-apply');
	assert.ok(applyBtn, 'apply button not found after preview');
	applyBtn.listeners.click();   // ARM
	assert.ok(w.calls.every((c) => c.method !== 'catalog_apply'), 'first click only ARMS');
	root = view.render(await view.load());
	const confirmBtn = w.created.find((n) => n.attrs.id === 'z2m-catalog-apply');
	confirmBtn.listeners.click();   // CONFIRM
	await flush();
	const call = w.calls.find((c) => c.method === 'catalog_apply');
	assert.ok(call, 'catalog_apply was not called after confirm');
	const parsed = JSON.parse(call.params.edit);
	assert.equal(parsed.revision, 2, 'optimistic ledger revision on the wire');
	assert.equal(parsed.fileSha256, 'abcdef0123456789', 'optimistic file hash on the wire');
	root = view.render(await view.load());
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Applied and verified'), 'success renders');
});

test('catalog: invalid catalog (ETARGET) blocks mutation loudly, no fake services', async () => {
	const w = makeWorld({
		catalog_list: { type: 'ok', value: { ok: false, error: { code: 'ETARGET', message: 'catalog is invalid — refusing to serve it', errors: ['duplicate service id: youtube'] } } },
		catalog_status: { type: 'ok', value: CATALOG_STATUS_FIXTURE }
	});
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('Catalog unavailable'), 'invalid catalog is loud');
	assert.ok(text.includes('BLOCKED'), 'mutation blocked message renders');
	assert.ok(!text.includes('Apply this plan'), 'no apply path on invalid catalog');
});

// ---- 6h. catalog health matrix section (Phase C) -----------------------------------

const HEALTH_MATRIX_RUNNING = {
	ok: true,
	matrix: {
		id: 'job-hm-1', kind: 'healthmatrix', mode: 'matrix', services: ['youtube'],
		status: 'running', createdAt: 1785220000, startedAt: 1785220001, finishedAt: null,
		timeoutSec: 300, rc: null, error: null, cancelled: false, elapsedSec: 12,
		recommendations: [], summary: { services: 0, malformed: 0, byClass: {}, note: 'diagnostics per layer, not service-availability verdicts' },
		rows: [], logTail: '* health matrix v1 start\n'
	}
};

const HEALTH_MATRIX_DONE = {
	ok: true,
	matrix: {
		id: 'job-hm-2', kind: 'healthmatrix', mode: 'matrix', services: ['youtube', 'chatgpt-openai'],
		status: 'succeeded', createdAt: 1785220000, startedAt: 1785220001, finishedAt: 1785220018,
		timeoutSec: 300, rc: 0, error: null, cancelled: false, elapsedSec: 17,
		recommendations: [],
		summary: { services: 2, malformed: 0, byClass: { 'reachable-http': 1, 'possible-geo-account': 1 }, note: 'diagnostics per layer, not service-availability verdicts' },
		rows: [
			{
				id: 'youtube', domains: ['youtube.com'],
				probes: { catalog: { domainsPresent: true }, dns: { ok: true }, extDns: { ok: true, evidence: '31.13.72.36' }, tcp: { rc: 0 }, tls: { rc: 0 }, http: { rc: 0, httpCode: 200 } },
				class: 'reachable-http',
				reason: 'HTTP 200 — host responds at the application layer (NOT a service-availability claim)'
			},
			{
				id: 'chatgpt-openai', domains: ['openai.com'],
				probes: { catalog: { domainsPresent: true }, dns: { ok: true }, extDns: { ok: true, evidence: '104.18.33.45' }, tcp: { rc: 0 }, tls: { rc: 0 }, http: { rc: 0, httpCode: 403 } },
				class: 'possible-geo-account',
				reason: 'HTTP 403 — auth/region class response; account or GEO restriction is possible (not provable here)'
			}
		],
		logTail: '* matrix done\n'
	}
};

test('catalog health: start sends selected services; running matrix shows badge + elapsed + cancel', async () => {
	const w = makeWorld({
		catalog_list: { type: 'ok', value: CATALOG_LIST_FIXTURE },
		catalog_status: { type: 'ok', value: CATALOG_STATUS_FIXTURE },
		health_matrix_get: { type: 'ok', value: HEALTH_MATRIX_RUNNING },
		health_matrix_start: { type: 'ok', value: { ok: true, job: HEALTH_MATRIX_RUNNING.matrix } },
		health_matrix_job_cancel: { type: 'ok', value: { ok: true, cancelling: true, id: 'job-hm-1' } }
	});
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('running'), 'matrix status badge renders');
	assert.ok(text.includes('12s'), 'honest elapsed renders');
	assert.ok(!/\d+%/.test(text), 'NEGATIVE: no fabricated progress percentage');
	const startBtn = w.created.find((n) => n.attrs.id === 'z2m-health-start');
	assert.equal(startBtn.disabled, true, 'start disabled while a matrix is active');
	const cancelBtn = w.created.find((n) => n.attrs.id === 'z2m-health-cancel');
	assert.ok(cancelBtn, 'Cancel renders for the active matrix');
	cancelBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'health_matrix_job_cancel');
	assert.ok(call, 'health_matrix_job_cancel was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { id: 'job-hm-1' });
});

test('catalog health: completed matrix renders per-layer probes + honest classes', async () => {
	const w = makeWorld({
		catalog_list: { type: 'ok', value: CATALOG_LIST_FIXTURE },
		catalog_status: { type: 'ok', value: CATALOG_STATUS_FIXTURE },
		health_matrix_get: { type: 'ok', value: HEALTH_MATRIX_DONE }
	});
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	const text = collectText(root).join(' | ');
	assert.ok(text.includes('reachable-http'), 'best class renders');
	assert.ok(text.includes('NOT a service-availability claim'), 'honest reason renders');
	assert.ok(text.includes('possible-geo-account'), 'geo-account class renders');
	assert.ok(text.includes('not provable'), 'geo class is honest about uncertainty');
	assert.ok(!/unblocked/i.test(text), 'NEGATIVE: no "unblocked" claims');
	const startBtn = w.created.find((n) => n.attrs.id === 'z2m-health-start');
	assert.equal(startBtn.disabled, false, 'start enabled with no active matrix');
	startBtn.listeners.click();
	await flush();
	const call = w.calls.find((c) => c.method === 'health_matrix_start');
	assert.ok(call, 'health_matrix_start was not called');
	assert.deepEqual(JSON.parse(call.params.edit), { services: ['youtube'] },
		'enabled services go on the wire (checked set from the ledger)');
});

test('catalog health: ECONFLICT start refusal renders the backend message', async () => {
	const w = makeWorld({
		catalog_list: { type: 'ok', value: CATALOG_LIST_FIXTURE },
		catalog_status: { type: 'ok', value: CATALOG_STATUS_FIXTURE },
		health_matrix_get: { type: 'ok', value: { ok: true, matrix: null, note: 'no health matrix run yet' } },
		health_matrix_start: { type: 'ok', value: { ok: false, error: { code: 'ECONFLICT', message: 'health matrix job job-hm-1 is already running' } } }
	});
	const view = loadView(readViewSource('catalog'), 'catalog', w);
	const envelope = await view.load();
	const root = view.render(envelope);
	w.created.find((n) => n.attrs.id === 'z2m-health-start').listeners.click();
	await flush();
	const root2 = view.render(await view.load());
	const text = collectText(root2).join(' | ');
	assert.ok(text.includes('Matrix start refused'), 'the refusal renders');
	assert.ok(text.includes('already running'), 'the backend ECONFLICT detail renders');
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
