// Self-test for the lists-page logic (ЦЕЛЬ ДВА — ui/07-lists-page).
//
// Two load-bearing pieces of logic that MUST be test-first:
// 1. CONFLICT DETECTION: a domain that appears in BOTH the include list and
//    the exclude list is an ERROR reported BEFORE apply, not after. The user
//    adds a domain to include, but it's also in exclude (or vice versa) —
//    applying would produce contradictory rules; refuse and name the conflict.
// 2. DOMAIN-CHECK: "does this domain fall under the automatically-formed
//    list?" — the main source of user confusion (added a domain manually, but
//    the autohostlist covers it, or vice versa). Check_domain returns which
//    lists (user-include, user-exclude, autohostlist) the domain matches.
//
// ucode does not run locally; node self-test proves the ALGORITHM. The ucode
// lists.uc mirrors tests/lib/lists-logic.mjs; runtime confirmed on target.
//
// Run: node --test tests/lists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find_conflicts, check_domain, normalize_domain } from './lib/lists-logic.mjs';

// ---- normalize_domain -------------------------------------------------------

test('normalize_domain lowercases and trims, strips leading dot', () => {
	assert.equal(normalize_domain('  Example.COM '), 'example.com');
	assert.equal(normalize_domain('.example.com'), 'example.com');
	assert.equal(normalize_domain(''), '');
});

// ---- find_conflicts ---------------------------------------------------------

test('a domain in BOTH include and exclude is a conflict', () => {
	const conflicts = find_conflicts(
		['example.com', 'blocked.com'],
		['example.com', 'other.com']
	);
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0], 'example.com');
});

test('no overlap → no conflicts', () => {
	const conflicts = find_conflicts(
		['a.com', 'b.com'],
		['c.com', 'd.com']
	);
	assert.equal(conflicts.length, 0);
});

test('conflict detection is case-insensitive and normalized', () => {
	const conflicts = find_conflicts(
		['Example.COM', 'b.com'],
		['example.com']
	);
	assert.equal(conflicts.length, 1);
	assert.equal(conflicts[0], 'example.com');
});

test('a subdomain of an excluded domain is NOT a conflict with the parent', () => {
	// sub.example.com in include, example.com in exclude — these are DIFFERENT
	// entries; the conflict check is exact-match on the normalized domain, not
	// a suffix check (the engine's own matching handles subdomains; we only
	// flag the EXACT contradiction).
	const conflicts = find_conflicts(['sub.example.com'], ['example.com']);
	assert.equal(conflicts.length, 0);
});

test('multiple conflicts are all reported', () => {
	const conflicts = find_conflicts(
		['a.com', 'b.com', 'c.com'],
		['b.com', 'c.com', 'd.com']
	);
	assert.deepEqual(conflicts, ['b.com', 'c.com']);
});

test('empty lists → no conflicts', () => {
	assert.equal(find_conflicts([], []).length, 0);
	assert.equal(find_conflicts(['a.com'], []).length, 0);
	assert.equal(find_conflicts([], ['a.com']).length, 0);
});

// ---- check_domain -----------------------------------------------------------

test('check_domain reports which lists a domain matches', () => {
	const result = check_domain('example.com', {
		userInclude: ['example.com', 'other.com'],
		userExclude: ['bad.com'],
		autohostlist: ['auto.com']
	});
	assert.equal(result.userInclude, true);
	assert.equal(result.userExclude, false);
	assert.equal(result.autohostlist, false);
});

test('check_domain: a domain in BOTH include and exclude flags both', () => {
	const result = check_domain('conflict.com', {
		userInclude: ['conflict.com'],
		userExclude: ['conflict.com'],
		autohostlist: []
	});
	assert.equal(result.userInclude, true);
	assert.equal(result.userExclude, true);
	assert.ok(result.conflict, 'conflict flag set when in both');
});

test('check_domain: a domain in autohostlist only', () => {
	const result = check_domain('auto.com', {
		userInclude: [],
		userExclude: [],
		autohostlist: ['auto.com']
	});
	assert.equal(result.userInclude, false);
	assert.equal(result.userExclude, false);
	assert.equal(result.autohostlist, true);
});

test('check_domain: a domain in no list', () => {
	const result = check_domain('unknown.com', {
		userInclude: [],
		userExclude: [],
		autohostlist: []
	});
	assert.equal(result.userInclude, false);
	assert.equal(result.userExclude, false);
	assert.equal(result.autohostlist, false);
});

test('check_domain is case-insensitive', () => {
	const result = check_domain('Example.COM', {
		userInclude: ['example.com'],
		userExclude: [],
		autohostlist: []
	});
	assert.equal(result.userInclude, true);
});
