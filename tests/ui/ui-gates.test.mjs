// UI gates — static guarantees for the LuCI frontend of zapret2-manager.
//
// Run: node --test tests/ui/
//
// Gates 1-8, 12 apply to ALL views (global safety invariants). The RPC-
// semantics gates 9 (catch), 14 (positional params), 15 (reject:true) also
// apply to ALL views including overview.js (it is no longer excluded from the
// RPC gate — its service/passthrough calls must reject+catch too). Gates 10-11
// (busy/unavailable rendering) apply to the seven UI-agent zone views.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	EXPECTED_VIEWS, ZONE_VIEWS,
	listViewFiles, readViewSource, readMenu, viewDirAbs,
	checkExactlyEightViews, checkMenuEntries, checkMenuAclIsArray,
	checkNoLubus, checkRpcDeclare, checkExportsView, checkMenuViewFilesMatch,
	checkRpcObjects, checkCatchPath, checkBusyPath, checkUnavailableLabel,
	checkSyntax, moduleLoadHarness, checkNoStringFormat,
	checkPositionalCalls, checkRejectTrue
} from './lib/checks.mjs';
import { REPO_ROOT } from './lib/checks.mjs';

const LUCI_MAKEFILE = join(REPO_ROOT, 'luci-app-zapret2-manager/Makefile');

function assertNoErrors(errs) {
	assert.deepEqual(errs, [], errs.join('\n'));
}

// Gate 1 — exactly eight view files exist.
test('gate 1: exactly eight view files exist', () => {
	assertNoErrors(checkExactlyEightViews(listViewFiles(viewDirAbs())));
});

// Gate 2 — menu contains exactly the eight expected pages.
test('gate 2: menu contains exactly the eight expected entries', () => {
	assertNoErrors(checkMenuEntries(readMenu()));
});

// Gate 3 — depends.acl is an array in every entry (the HTTP-500 defect).
test('gate 3: depends.acl is an array in every menu entry', () => {
	assertNoErrors(checkMenuAclIsArray(readMenu()));
});

// Gate 4 — no view uses L.ubus (absent in luci.js 26.x).
test('gate 4: no view contains L.ubus', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkNoLubus(src, v));
	}
});

// Gate 5 — RPC calls use rpc.declare.
test('gate 5: RPC access goes through rpc.declare', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkRpcDeclare(src, v));
	}
});

// Gate 6 — every view exports an L.view.
test('gate 6: every view exports L.view.extend', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkExportsView(src, v));
	}
});

// Gate 7 — no menu entry references a missing JS file (and shape matches).
test('gate 7: menu action paths map to existing view files', () => {
	assertNoErrors(checkMenuViewFilesMatch(readMenu(), listViewFiles(viewDirAbs())));
});

// Gate 8 — only the zapret2-manager RPC object is declared.
test('gate 8: only the zapret2-manager RPC object is used', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkRpcObjects(src, v));
	}
});

// Gate 9 — promise rejection has a visible error path (ALL views, incl overview).
test('gate 9: rejected promises are caught (all views)', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkCatchPath(src, v));
	}
});

// Gate 10 — action buttons have a disabled/busy path (zone views).
test('gate 10: action buttons disable while busy and re-enable (zone views)', () => {
	for (const v of ZONE_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkBusyPath(src, v));
	}
});

// Gate 11 — null/unavailable is rendered, never faked as 0 (zone views).
test('gate 11: an "Unavailable" rendering path exists (zone views)', () => {
	for (const v of ZONE_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkUnavailableLabel(src, v));
	}
});

// Gate 12 — every view passes the static syntax gate (LuCI function-body
// semantics: top-level return is legal).
test('gate 12: all views parse as LuCI view modules', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkSyntax(src, v));
	}
});

// Gate 13 — no view relies on String.prototype.format (it lives in cbi.js,
// which these views do not require; overview.js concatenates).
test('gate 13: no String.prototype.format reliance', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkNoStringFormat(src, v));
	}
});

// Gate 14 — rpc.declare with a params ARRAY is invoked positionally, never
// with an object (router rpc.js: params[i] = args[i]; an object nests).
test('gate 14: params-array declarations are called positionally (all views)', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkPositionalCalls(src, v));
	}
});

// Gate 15 — every rpc.declare in ALL views (incl overview) has reject: true,
// so ubus errors reject into .catch() instead of resolving as numeric codes.
test('gate 15: all rpc.declare have reject: true (all views)', () => {
	for (const v of EXPECTED_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(checkRejectTrue(src, v));
	}
});

// Bonus gate — module-load harness: every zone view executes at module scope
// against stubbed LuCI modules without throwing (catches the blank-page
// console-exception class without a browser) and declares only allowed
// RPC objects.
test('module harness: zone views load under stubbed LuCI modules', () => {
	for (const v of ZONE_VIEWS) {
		const src = readViewSource(v);
		assert.ok(src !== null, `${v}.js missing`);
		assertNoErrors(moduleLoadHarness(src, v));
	}
});

// Gate 16 — the official luci-app Makefile installs ALL shipped views
// automatically (no hardcoded per-file list that silently drops pages).
test('gate 16: luci Makefile auto-installs every .js view (no hardcoded list)', () => {
	const mk = readFileSync(LUCI_MAKEFILE, 'utf8');
	// MUST glob the view dir, NOT hardcode overview.js (the old defect installed
	// only overview.js while 8 views shipped).
	assert.ok(/\$\(wildcard [^)]*view\/zapret2-manager\/\*\.js\)/.test(mk),
		'luci Makefile must use $(wildcard .../view/zapret2-manager/*.js) to install views');
	assert.ok(!/INSTALL_DATA.*view\/zapret2-manager\/overview\.js/.test(mk),
		'luci Makefile must NOT hardcode overview.js (drops the other views)');
	// the glob covers exactly the shipped views
	const dir = viewDirAbs();
	const shipped = listViewFiles(dir);
	assert.equal(shipped.length, EXPECTED_VIEWS.length, 'shipped view count matches EXPECTED_VIEWS');
});

// Gate 16 negative/positive control: a 9th fixture view is automatically
// picked up by the glob (positive), then removed (no leftover).
test('gate 16 control: a 9th fixture view is auto-covered by the Makefile glob', () => {
	const dir = viewDirAbs();
	const fixture = join(dir, 'zz-fixture-gate16.js');
	const before = listViewFiles(dir).length;
	try {
		writeFileSync(fixture, "/* fixture for gate 16: the Makefile glob must cover me */\n");
		const after = listViewFiles(dir).length;
		assert.equal(after, before + 1, 'fixture view added');
		// the Makefile glob pattern matches the fixture (it ends in .js under the dir)
		assert.ok(/\$\(wildcard [^)]*view\/zapret2-manager\/\*\.js\)/.test(readFileSync(LUCI_MAKEFILE, 'utf8')),
			'glob covers any .js in the dir, including the fixture');
	} finally {
		try { unlinkSync(fixture); } catch {}
	}
	assert.ok(!existsSync(fixture), 'fixture removed after the control');
	assert.equal(listViewFiles(dir).length, before,
		'view count restored after fixture removal');
});
