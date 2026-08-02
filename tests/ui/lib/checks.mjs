// Shared checker functions for the LuCI frontend gates (tests/ui/).
//
// Pure functions over file contents — the same checkers run against the real
// views/menu (ui-gates.test.mjs) and against deliberately broken copies
// (negative-controls.test.mjs) to prove each gate has teeth.
//
// Scope notes:
// - ZONE_VIEWS are the seven pages maintained by the UI agent. overview.js is
//   the backend agent's zone: only the global safety invariants (no L.ubus,
//   exports a view, known RPC object) are applied to it.
// - Comment stripping for the forbidden-pattern scans is deliberately naive
//   (line + block comments). It is used ONLY for pattern scans, never for the
//   syntax gate, which always runs on the original source.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const VIEW_DIR_REL = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
export const MENU_REL = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';

export const EXPECTED_VIEWS = [
	'overview', 'strategies', 'blockcheck', 'catalog', 'orchestra', 'lists', 'dns', 'monitor', 'proxy', 'maintenance'
];

// These are shipped JavaScript modules, not LuCI menu views. Keep them in the
// directory and package glob, but exclude them from the ten-page view contract.
export const VIEW_SUPPORT_MODULES = ['z2m-ui', 'service-dns'];

// The nine pages in the UI agent's zone (overview is the backend agent's).
export const ZONE_VIEWS = [
	'strategies', 'blockcheck', 'catalog', 'orchestra', 'lists', 'dns', 'monitor', 'proxy', 'maintenance'
];

export const EXPECTED_MENU_KEYS = [
	'admin/services/zapret2-manager',
	'admin/services/zapret2-manager/strategies',
	'admin/services/zapret2-manager/orchestra',
	'admin/services/zapret2-manager/lists',
	'admin/services/zapret2-manager/dns',
	'admin/services/zapret2-manager/monitor',
	'admin/services/zapret2-manager/proxy',
	'admin/services/zapret2-manager/maintenance'
];

export const ALLOWED_RPC_OBJECTS = ['zapret2-manager'];

export function viewDirAbs() {
	return path.join(REPO_ROOT, VIEW_DIR_REL);
}

export function menuAbs() {
	return path.join(REPO_ROOT, MENU_REL);
}

export function listViewFiles(dirAbs) {
	if (!fs.existsSync(dirAbs)) return [];
	return fs.readdirSync(dirAbs)
		.filter((f) => f.endsWith('.js'))
		.map((f) => f.replace(/\.js$/, ''))
		.filter((name) => !VIEW_SUPPORT_MODULES.includes(name))
		.sort();
}

export function readViewSource(name) {
	const p = path.join(viewDirAbs(), name + '.js');
	if (!fs.existsSync(p)) return null;
	return fs.readFileSync(p, 'utf8');
}

export function readMenu() {
	const p = menuAbs();
	if (!fs.existsSync(p)) return null;
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Naive comment stripper — line and block comments only. Used exclusively for
// forbidden-pattern scans so that documentation comments mentioning the bad
// API (e.g. overview.js explaining why L.ubus is absent) are not flagged.
export function stripComments(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
}

// ---- gate checkers (each returns an array of error strings; [] = pass) -----

export function checkExactlyEightViews(filesOnDisk) {
	// (name kept for history — the count comes from EXPECTED_VIEWS, currently 9)
	const errs = [];
	const actual = [...filesOnDisk].sort();
	const expected = [...EXPECTED_VIEWS].sort();
	if (actual.length !== expected.length)
		errs.push(`expected ${expected.length} view files, found ${actual.length}: ${actual.join(', ') || '(none)'}`);
	for (const v of expected)
		if (!actual.includes(v)) errs.push(`missing view file: ${v}.js`);
	for (const v of actual)
		if (!expected.includes(v)) errs.push(`unexpected view file: ${v}.js`);
	return errs;
}

export function checkMenuEntries(menu) {
	const errs = [];
	if (!menu || typeof menu !== 'object') return ['menu JSON is not an object'];
	const keys = Object.keys(menu);
	if (keys.length !== EXPECTED_MENU_KEYS.length)
		errs.push(`expected ${EXPECTED_MENU_KEYS.length} menu entries, found ${keys.length}`);
	for (const k of EXPECTED_MENU_KEYS) {
		const node = menu[k];
		if (!node) { errs.push(`missing menu entry: ${k}`); continue; }
		const leaf = k.split('/').pop();
		const expectedView = leaf === 'zapret2-manager' ? 'orchestra' : leaf;
		if (!node.action || node.action.type !== 'view')
			errs.push(`menu ${k}: action.type is not "view"`);
		if (!node.action || node.action.path !== `zapret2-manager/${expectedView}`)
			errs.push(`menu ${k}: action.path must be "zapret2-manager/${expectedView}", got ${JSON.stringify(node.action && node.action.path)}`);
		if (typeof node.order !== 'number')
			errs.push(`menu ${k}: missing numeric order`);
	}
	for (const k of keys)
		if (!EXPECTED_MENU_KEYS.includes(k)) errs.push(`unexpected menu entry: ${k}`);
	return errs;
}

export function checkMenuAclIsArray(menu) {
	const errs = [];
	if (!menu || typeof menu !== 'object') return ['menu JSON is not an object'];
	for (const [k, node] of Object.entries(menu)) {
		const acl = node && node.depends ? node.depends.acl : undefined;
		if (!Array.isArray(acl)) {
			errs.push(`menu ${k}: depends.acl is ${acl === undefined ? 'missing' : typeof acl}, not an array`);
			continue;
		}
		for (const g of acl)
			if (g !== 'zapret2-manager')
				errs.push(`menu ${k}: depends.acl element ${JSON.stringify(g)} != "zapret2-manager"`);
	}
	return errs;
}

export function checkNoLubus(src, name) {
	const errs = [];
	const clean = stripComments(src);
	if (/L\.ubus/.test(clean))
		errs.push(`${name}: uses L.ubus (absent in luci.js 26.x — use rpc.declare)`);
	if (/(^|[^.\w])ubus\.call\s*\(/.test(clean))
		errs.push(`${name}: uses ubus.call directly (use rpc.declare)`);
	return errs;
}

export function checkRpcDeclare(src, name) {
	const errs = [];
	const clean = stripComments(src);
	if (clean.includes("'zapret2-manager'") && !/rpc\.declare\s*\(/.test(clean))
		errs.push(`${name}: references the ubus object without rpc.declare`);
	return errs;
}

export function checkExportsView(src, name) {
	const errs = [];
	if (!/return\s+L\.view\.extend\s*\(\s*\{/.test(src))
		errs.push(`${name}: does not export an L.view (missing "return L.view.extend({")`);
	return errs;
}

export function checkMenuViewFilesMatch(menu, filesOnDisk) {
	const errs = checkMenuEntries(menu);
	if (!menu || typeof menu !== 'object') return errs;
	for (const node of Object.values(menu)) {
		const p = node && node.action ? node.action.path : null;
		if (typeof p !== 'string') continue;
		const leaf = p.split('/').pop();
		if (!filesOnDisk.includes(leaf))
			errs.push(`menu action.path "${p}" has no matching view file ${leaf}.js`);
	}
	return errs;
}

export function checkRpcObjects(src, name) {
	const errs = [];
	const clean = stripComments(src);
	const re = /object:\s*'([^']+)'/g;
	let m;
	while ((m = re.exec(clean)) !== null) {
		if (!ALLOWED_RPC_OBJECTS.includes(m[1]))
			errs.push(`${name}: declares unknown RPC object "${m[1]}" (allowed: ${ALLOWED_RPC_OBJECTS.join(', ')})`);
	}
	return errs;
}

export function checkCatchPath(src, name) {
	const errs = [];
	if (!src.includes('.catch('))
		errs.push(`${name}: no .catch( — a rejected promise must have a visible error path`);
	return errs;
}

export function checkBusyPath(src, name) {
	const errs = [];
	const hasClick = /addEventListener\(\s*'click'/.test(src);
	if (!hasClick) return errs;   // no action buttons on this page
	if (!/\.disabled\s*=\s*true/.test(src))
		errs.push(`${name}: action button never sets .disabled = true (no busy path)`);
	if (!/\.disabled\s*=\s*false/.test(src))
		errs.push(`${name}: action button never re-enables (.disabled = false missing)`);
	return errs;
}

export function checkUnavailableLabel(src, name) {
	const errs = [];
	if (!src.includes('Unavailable'))
		errs.push(`${name}: no "Unavailable" rendering path — unknown values must not be faked as 0/empty`);
	return errs;
}

// String.prototype.format is defined in cbi.js, which these views do NOT
// require — overview.js (the proven-working page) builds strings by plain
// concatenation. Relying on .format() would throw at render time in the
// browser. Concatenation is the house style.
export function checkNoStringFormat(src, name) {
	const errs = [];
	const clean = stripComments(src);
	if (/\.format\s*\(\s*\{/.test(clean))
		errs.push(`${name}: uses String.prototype.format (defined in cbi.js, which this view does not require — use concatenation like overview.js)`);
	return errs;
}

// ---- rpc.js wire-semantics gates --------------------------------------------
//
// Verified against /www/luci-static/resources/rpc.js on the router:
//   declare(options): if options.params is an ARRAY, the formed ubus message
//   is params[options.params[i]] = args[i] — POSITIONAL. Calling the declared
//   function with an object nests it: fn({domain: d}) with params:['domain']
//   sends {domain: {domain: d}}. (The object-call form only matches a params
//   OBJECT declaration.)
//   options.reject defaults to false: req.raise = options.reject; a ubus
//   error reply then RESOLVES (msg.result[1], else the numeric code) instead
//   of rejecting — .catch() never fires and the resolved number can be
//   mistaken for data (breaks unavailable/anti-wipe/stale paths).

// Every `const <name> = rpc.declare({...})` with a params ARRAY must be
// invoked positionally: forbid `<name>( {` call sites.
export function checkPositionalCalls(src, name) {
	const errs = [];
	const clean = stripComments(src);
	const declRe = /const\s+(\w+)\s*=\s*rpc\.declare\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;/g;
	let m;
	while ((m = declRe.exec(clean)) !== null) {
		const fnName = m[1];
		const body = m[2];
		if (!/params\s*:\s*\[/.test(body)) continue;
		const method = (body.match(/method:\s*'([^']+)'/) || [null, '?'])[1];
		const callRe = new RegExp('\\b' + fnName + '\\s*\\(\\s*\\{');
		if (callRe.test(clean))
			errs.push(`${name}: ${fnName} ("${method}") is declared with a params ARRAY — call it positionally (e.g. ${fnName}(value)), not with an object; rpc.js maps args[i] → params[i] and an object argument nests`);
	}
	return errs;
}

// Every rpc.declare in the zone views is part of a flow that relies on
// .catch() for its error/unavailable path (load envelopes, busy buttons,
// stale polling). Without reject: true a ubus error RESOLVES (numeric code)
// and those paths go dead — so each declaration must opt in explicitly.
export function checkRejectTrue(src, name) {
	const errs = [];
	const clean = stripComments(src);
	const declRe = /rpc\.declare\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
	let m;
	while ((m = declRe.exec(clean)) !== null) {
		const body = m[1];
		const method = (body.match(/method:\s*'([^']+)'/) || [null, '?'])[1];
		if (!/reject\s*:\s*true/.test(body))
			errs.push(`${name}: rpc.declare ("${method}") lacks reject: true — a ubus error would RESOLVE (numeric code) and bypass .catch()`);
	}
	return errs;
}

export function checkSyntax(src, name) {
	const errs = [];
	try {
		// LuCI wraps view files in a function body, so a top-level `return` is
		// legal there. new Function() reproduces that exact environment for a
		// syntax check (it does not execute the body).
		new Function(src);
	} catch (e) {
		errs.push(`${name}: syntax error: ${e.message}`);
	}
	return errs;
}

// Module-load harness: execute the view file the way LuCI does — as a function
// body with the LuCI modules in scope — against stubs. Catches module-scope
// reference errors (the classic blank-page console exception) without a
// browser, and records every rpc.declare spec for object-name verification.
export function moduleLoadHarness(src, name) {
	const errs = [];
	const declared = [];
	const rpcStub = {
		declare: (spec) => {
			declared.push(spec);
			return () => Promise.resolve({});
		}
	};
	const stubs = {
		L: {
			view: { extend: (o) => o },
			resolveDefault: (p, d) => Promise.resolve(d)
		},
		view: {},
		rpc: rpcStub,
		ui: {},
		dom: {},
		form: {},
		poll: { add: () => { }, remove: () => { }, start: () => { }, stop: () => { } },
		_: (s) => s,
		E: () => ({ appendChild() { }, addEventListener() { }, querySelector() { return null; }, style: {} })
	};
	try {
		const fn = new Function(
			'L', 'view', 'rpc', 'ui', 'dom', 'form', 'poll', '_', 'E',
			'"use strict";' + src
		);
		const exported = fn(
			stubs.L, stubs.view, stubs.rpc, stubs.ui, stubs.dom, stubs.form,
			stubs.poll, stubs._, stubs.E
		);
		if (!exported || typeof exported !== 'object')
			errs.push(`${name}: module did not return a view object under stubs`);
	} catch (e) {
		errs.push(`${name}: module-load threw under stubbed LuCI modules: ${e.message}`);
		return errs;
	}
	for (const spec of declared) {
		if (!spec || !ALLOWED_RPC_OBJECTS.includes(spec.object))
			errs.push(`${name}: rpc.declare with disallowed object ${JSON.stringify(spec && spec.object)}`);
	}
	return errs;
}
