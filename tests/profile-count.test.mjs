// Self-test for profile_count (ПУНКТ ЧЕТВЁРТОЕ).
//
// profile_count is counted from the APPLIED options string (NFQWS2_OPT), NOT
// from the nft table dump (list_table). The real options string splits
// profiles with the `--new` SEPARATOR (not the ':strategy=N' marker the
// pre-reset sample used — the real default config has no :strategy=). The
// number of profiles = the number of `--new` separators + 1 (the first profile
// has no --new before it). A profile with a separator but no --comment= name still
// counts as a profile (profiles are counted, not names). A string with NO --new
// is ONE profile; profile_count is null ONLY when the value itself is null.
//
// FIXTURE: tests/fixtures-postinstall/opt-zapret2-config.out is a snapshot of
// confirmed origin (see ORIGIN.txt in that directory). FORMAT sample for the
// real post-install config.
//
// Run: node --test tests/profile-count.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { read_var } from './lib/apply-writer.mjs';
import { count_profiles } from './lib/profile-count.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, 'fixtures-postinstall/opt-zapret2-config.out'), 'utf8');
const REAL_OPT = read_var(FIXTURE, 'NFQWS2_OPT');

test('profile_count counts profiles by --new separators in the real NFQWS2_OPT', () => {
	const n = count_profiles(REAL_OPT);
	assert.ok(n != null, 'count is non-null (real OPT has --new separators)');
	// the real default config has 3 profiles: HTTP, TLS, QUIC, split by 2 --new
	const newCount = (REAL_OPT.match(/--new/g) || []).length;
	assert.equal(n, newCount + 1, 'profiles = --new separators + 1');
	assert.equal(newCount, 2, 'the real default OPT has 2 --new separators (3 profiles)');
});

test('profile_count: a string with NO --new is ONE profile', () => {
	assert.equal(count_profiles('--filter-tcp=80 --payload=all'), 1);
});

test('profile_count: null value returns null', () => {
	assert.equal(count_profiles(null), null);
});

test('profile_count counts several --new separators on one line (arg-based)', () => {
	const v = '--comment=A --filter-tcp=80 --lua-desync=a  --new --filter-tcp=443 --lua-desync=b  --new --filter-udp=443 --lua-desync=c';
	// 2 --new separators → 3 profiles
	assert.equal(count_profiles(v), 3);
});

test('profile_count: a profile with a separator but NO --comment= name still counts', () => {
	// --new present, but no --comment= after it (unnamed profile). It is still
	// a profile — profiles are counted, not names.
	const v = '--filter-tcp=80 --lua-desync=a  --new --filter-tcp=443';
	assert.equal(count_profiles(v), 2);
});

test('profile_count: only the --new separator matters, not :strategy= (real format)', () => {
	// the real default config has NO :strategy=; a value with :strategy= but no --new
	// is still ONE profile (the separator is --new, not :strategy=).
	const v = '--lua-desync=a:strategy=1 --lua-desync=b:strategy=2';
	assert.equal(count_profiles(v), 1);
});
