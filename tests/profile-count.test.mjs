// Self-test for profile_count (followup 5).
//
// profile_count is counted from the APPLIED options string (NFQWS2_OPT), NOT
// from the nft table dump (list_table). The profile/strategy separator in the
// options string is the strategy marker: each '--lua-desync=...:strategy=N'
// entry is one profile in the rotation. Counting ':strategy=' occurrences in
// the applied NFQWS2_OPT gives the number of profiles. If NFQWS2_OPT is absent
// or has no strategy markers, profile_count is null (not 0 — null = "checked,
// no value", distinct from the key being absent = "not checked").
//
// FIXTURE: tests/fixtures/opt-zapret2-config.out is a snapshot of UNCONFIRMED
// origin (see tests/apply-writer.test.mjs header). FORMAT sample only.
//
// Run: node --test tests/profile-count.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { read_var } from './lib/apply-writer.mjs';
import { count_strategy_markers } from './lib/profile-count.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, 'fixtures/opt-zapret2-config.out'), 'utf8');
const REAL_OPT = read_var(FIXTURE, 'NFQWS2_OPT');

test('profile_count counts :strategy= markers in the applied NFQWS2_OPT', () => {
	const n = count_strategy_markers(REAL_OPT);
	assert.ok(n != null, 'count is non-null when NFQWS2_OPT is present');
	assert.ok(n > 0, 'the real OPT has strategy markers');
	// The function counts ':strategy=' markers. Confirm it matches an
	// independent regex count (the controller arg circular_quality has no
	// :strategy=, so this is LESS than the --lua-desync= count — that is the
	// point: profiles are the STRATEGIES, not every --lua-desync arg).
	const regexCount = (REAL_OPT.match(/:strategy=/g) || []).length;
	assert.equal(n, regexCount, 'count matches independent :strategy= count');
});

test('profile_count is null when the value has no strategy markers', () => {
	// passthrough shape: no --lua-desync, no :strategy=
	assert.equal(count_strategy_markers('--filter-tcp=80\n--payload=all'), null);
});

test('profile_count is null when the value is null', () => {
	assert.equal(count_strategy_markers(null), null);
});

test('profile_count counts markers on one line (arg-based, not line-based)', () => {
	// several strategies inline, separated by spaces
	const v = '--lua-desync=a:strategy=1 --lua-desync=b:strategy=2 --lua-desync=c:strategy=3';
	assert.equal(count_strategy_markers(v), 3);
});

test('profile_count does NOT count a bare "strategy=" without the colon prefix', () => {
	// the marker is ':strategy=' (colon-prefixed inside the arg); a bare
	// 'strategy=' elsewhere must not inflate the count.
	const v = '--lua-desync=a:strategy=1\n--comment=strategy=foo';
	assert.equal(count_strategy_markers(v), 1);
});
