// Negative controls — prove the gates have teeth.
//
// Each control mutates a COPY of a real artifact in memory, asserts the
// checker goes RED on the mutation, then asserts the original artifact is
// GREEN. No repository file is modified by these tests.
//
// Run: node --test tests/ui/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	readViewSource, readMenu, stripComments,
	checkNoLubus, checkMenuAclIsArray,
	checkPositionalCalls, checkRejectTrue
} from './lib/checks.mjs';

// Negative control 1 — L.ubus.
// Inject `L.ubus.call(...)` into a copy of a real view: the checker MUST flag
// it (red). The unmodified view MUST pass (green).
test('negative control: L.ubus injection is caught, original is clean', () => {
	const original = readViewSource('lists');
	assert.ok(original !== null, 'lists.js missing');

	// red: poisoned copy
	const poisoned = original + "\nL.ubus.call('zapret2-manager', 'lists_get');\n";
	const errs = checkNoLubus(poisoned, 'lists (poisoned copy)');
	assert.ok(errs.length > 0, 'L.ubus injection was NOT caught — gate is broken');
	assert.match(errs[0], /L\.ubus/);

	// green: original
	assert.deepEqual(checkNoLubus(original, 'lists'), []);
});

// Also prove the comment-aware scan does not false-positive on documentation
// that merely NAMES the bad API (overview.js documents why L.ubus is absent).
test('negative control: comments naming L.ubus are not flagged as usage', () => {
	const src = readViewSource('overview');
	assert.ok(src !== null, 'overview.js missing');
	assert.deepEqual(checkNoLubus(src, 'overview'), []);
	// …but real usage appended even after a comment IS flagged.
	const poisoned = src + "\n// why not:\nL.ubus.call('a', 'b');\n";
	assert.ok(checkNoLubus(poisoned, 'overview (poisoned copy)').length > 0);
});

// Negative control 2 — object-form depends.acl (the HTTP-500 defect:
// "depends.acl object is not iterable"). Mutate a copy of the menu: the
// checker MUST go red. The real menu (array form) MUST be green.
test('negative control: object-form depends.acl is caught, array form is green', () => {
	const menu = readMenu();
	assert.ok(menu !== null, 'menu JSON missing');

	// red: object form on a deep copy
	const bad = JSON.parse(JSON.stringify(menu));
	const firstKey = Object.keys(bad)[0];
	bad[firstKey].depends = { acl: { 'zapret2-manager': ['read'] } };
	const errs = checkMenuAclIsArray(bad);
	assert.ok(errs.length > 0, 'object-form depends.acl was NOT caught — gate is broken');
	assert.match(errs[0], /not an array/);

	// green: original
	assert.deepEqual(checkMenuAclIsArray(menu), []);
});

// Negative control 3 — object-form call to a params-array declaration.
// Reintroduce `callFn({ ... })` into a copy of lists.js: the positional gate
// MUST go red. The real positional call MUST be green.
test('negative control: object RPC call is caught, positional call is green', () => {
	const original = readViewSource('lists');
	assert.ok(original !== null, 'lists.js missing');
	assert.ok(original.includes('callListsCheck(d)'),
		'lists.js must call callListsCheck positionally for this control to be meaningful');

	// red: reintroduce the defect form on a copy
	const poisoned = original.replace('callListsCheck(d)', 'callListsCheck({ domain: d })');
	const errs = checkPositionalCalls(poisoned, 'lists (poisoned copy)');
	assert.ok(errs.length > 0, 'object-form RPC call was NOT caught — gate is broken');
	assert.match(errs[0], /positionally/);

	// green: original
	assert.deepEqual(checkPositionalCalls(original, 'lists'), []);
});

// Negative control 4 — missing reject:true.
// Strip reject:true from a copy: the reject gate MUST go red (and the
// behavioral anti-wipe proof lives in rpc-semantics.test.mjs). The real
// declarations MUST be green.
test('negative control: missing reject:true is caught, declared views are green', () => {
	const original = readViewSource('lists');
	assert.ok(original !== null, 'lists.js missing');
	assert.ok(/reject:\s*true/.test(original), 'lists.js must declare reject: true');

	// red: strip on a copy (check code, not comments — the phrase "reject: true"
	// legitimately appears in the explanatory comment block)
	const poisoned = original.replace(/,\s*reject:\s*true/g, '');
	assert.ok(!/reject:\s*true/.test(stripComments(poisoned)), 'mutation failed to strip reject: true');
	const errs = checkRejectTrue(poisoned, 'lists (poisoned copy)');
	assert.ok(errs.length > 0, 'missing reject:true was NOT caught — gate is broken');
	assert.match(errs[0], /reject: true/);

	// green: original
	assert.deepEqual(checkRejectTrue(original, 'lists'), []);
});
