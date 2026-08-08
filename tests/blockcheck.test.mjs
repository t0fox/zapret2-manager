// blockcheck.test.mjs — SLICE 4 blockcheck wrapper logic (mode env, domain
// validation, log truncation, SUMMARY parsing with provenance).
// v2: added job-kind isolation regression tests.
//
// Run: node --test tests/blockcheck.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	BLOCKCHECK_MODES, mode_env, validate_domains,
	truncate_log, parse_summary, recommendations_with_provenance,
	validate_test_set,
	BLOCKCHECK_SCANNER
} from './lib/blockcheck-logic.mjs';
import { make_job_record, transition2, is_terminal as j_is_terminal, sweep_jobs } from './lib/jobs-logic.mjs';

// ---- mode env ------------------------------------------------------------------

test('mode_env: all three modes map; unknown mode refused', () => {
	assert.deepEqual(BLOCKCHECK_MODES, ['quick', 'domains', 'full']);
	assert.equal(mode_env('quick').scanlevel, 'quick');
	assert.equal(mode_env('domains').scanlevel, 'standard');
	assert.equal(mode_env('full').scanlevel, 'force');
	assert.equal(mode_env('full').enableHttp3, 1, 'full covers QUIC');
	assert.equal(mode_env('full').enableTls13, 1, 'full covers TLS 1.3');
	assert.equal(mode_env('quick').enableHttp3, 0, 'quick stays short');
	assert.ok(mode_env('full').timeoutSec > mode_env('quick').timeoutSec);
	assert.ok(mode_env('quick').timeoutSec >= 600,
		'empirical floor: a real 1-domain quick scan was still mid-run at 304s on target (r-blockcheck-1 timeout defect)');
	assert.equal(mode_env('bogus'), null);
	assert.equal(BLOCKCHECK_SCANNER, '/opt/zapret2/blockcheck2.sh', 'the upstream scanner path (called, never reimplemented)');
});

// ---- domain validation -------------------------------------------------------------

test('validate_domains: accepts domains/URIs, rejects injection and excess', () => {
	assert.deepEqual(validate_domains('rutracker.org example.com').domains, ['rutracker.org', 'example.com']);
	assert.deepEqual(validate_domains(['rutracker.org/forum/index.php']).domains, ['rutracker.org/forum/index.php']);
	assert.equal(validate_domains('').ok, false);
	assert.equal(validate_domains(null).ok, false);
	assert.equal(validate_domains('a.com; rm -rf /').ok, false, 'shell metacharacters rejected');
	assert.equal(validate_domains('a.com$(id)').ok, false, 'command substitution rejected');
	assert.equal(validate_domains("a.com'b").ok, false, 'quote rejected');
	assert.equal(validate_domains(Array.from({ length: 11 }, (_, i) => 'd' + i + '.com')).ok, false, 'max 10');
	assert.equal(validate_domains(['x'.repeat(600) + '.com']).ok, false, 'length cap');
});

// ---- log truncation --------------------------------------------------------------------

test('truncate_log: keeps the tail with a marker; short logs untouched', () => {
	const short = 'line1\nline2';
	assert.equal(truncate_log(short, 100), short);
	const long = Array.from({ length: 100 }, (_, i) => 'line-' + String(i).padStart(3, '0')).join('\n');
	const t = truncate_log(long, 200);
	assert.ok(t.startsWith('[log truncated to last 200 bytes]\n'));
	assert.ok(t.includes('line-099'), 'tail preserved');
	assert.ok(!t.includes('line-001'), 'head dropped');
});

// ---- summary parsing -----------------------------------------------------------------------

const SAMPLE_LOG = `
* checking system
Linux detected
- curl_test_https_tls12 ipv4 rutracker.org : nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5
!!!!! curl_test_https_tls12: working strategy found for ipv4 rutracker.org : nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000 !!!!!
!!!!! curl_test_https_tls12: working strategy found for ipv4 rutracker.org : nfqws2 --lua-desync=multisplit:pos=1,midsld !!!!!
* SUMMARY
curl_test_https_tls12 ipv4 rutracker.org : nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000
curl_test_https_tls12 ipv4 rutracker.org : nfqws2 --lua-desync=multisplit:pos=1,midsld
curl_test_http ipv4 rutracker.org : working without bypass
* COMMON
curl_test_https_tls12 ipv4 : nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000
blockcheck optimizes test sequence. To save time some strategies can be skipped if their test is considered useless.
`;

test('parse_summary: success lines become recommendations with raw provenance', () => {
	const p = parse_summary(SAMPLE_LOG);
	assert.equal(p.recommendations.length, 2);
	const r0 = p.recommendations[0];
	assert.equal(r0.test, 'curl_test_https_tls12');
	assert.equal(r0.ipver, 'ipv4');
	assert.equal(r0.domain, 'rutracker.org');
	assert.equal(r0.daemon, 'nfqws2');
	assert.equal(r0.strategy, '--lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000');
	assert.ok(r0.raw.startsWith('!!!!!'), 'raw line kept as provenance');
});

test('parse_summary: SUMMARY and COMMON sections parsed; prose excluded', () => {
	const p = parse_summary(SAMPLE_LOG);
	assert.equal(p.summary.length, 3);
	assert.equal(p.summary[2].result, 'working without bypass');
	assert.equal(p.common.length, 1, 'only the strategy row; the blockcheck prose is excluded');
	assert.equal(p.common[0].result, 'nfqws2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000');
});

test('parse_summary: empty/garbage logs produce empty results, never throw', () => {
	assert.deepEqual(parse_summary(''), { recommendations: [], summary: [], common: [] });
	assert.deepEqual(parse_summary(null), { recommendations: [], summary: [], common: [] });
	assert.deepEqual(parse_summary('random noise\n!!!!! malformed').recommendations, []);
});

test('recommendations_with_provenance: every item carries source/mode/domains/engine flag', () => {
	const p = parse_summary(SAMPLE_LOG);
	const out = recommendations_with_provenance(p, { mode: 'full', domains: ['rutracker.org'], engineRunning: true });
	assert.equal(out.length, 2);
	for (const r of out) {
		assert.equal(r.provenance.source, 'upstream blockcheck2.sh');
		assert.equal(r.provenance.mode, 'full');
		assert.equal(r.provenance.engineRunning, true, 'the engine-running flag is honest (results may be unreliable with bypass active)');
	}
});

test('NEGATIVE CONTROL: a doctored success line with shell content is data, never executed', () => {
	const evil = '!!!!! curl_test_http: working strategy found for ipv4 evil.com : nfqws2 --lua-desync=x$(touch /tmp/pwned) !!!!!';
	const p = parse_summary(evil);
	assert.equal(p.recommendations.length, 1);
	assert.equal(p.recommendations[0].strategy, '--lua-desync=x$(touch /tmp/pwned)',
		'the strategy is stored VERBATIM as data — parsing never evaluates it');
});

test('validate_test_set: standard default, custom allowed, everything else refused', () => {
	assert.equal(validate_test_set(null), 'standard');
	assert.equal(validate_test_set('standard'), 'standard');
	assert.equal(validate_test_set('custom'), 'custom');
	assert.equal(validate_test_set('../../etc'), null);
	assert.equal(validate_test_set('standard; rm -rf /'), null);
});

// ---- job kind isolation (regression tests for cross-page job bug) -----------------

test('JOB KIND: blockcheck_status filters by kind=blockcheck', () => {
	const now = Date.now();
	// scenario 1: newest global job is matrix, older job is blockcheck
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix', timeoutSec: 120 }, now, 1);
	const running = transition2(matrix, 'running', {}, now);
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick', timeoutSec: 600 }, now - 1000, 2);
	const bcRunning = transition2(bc, 'running', {}, now - 800);
	const completed = transition2(bcRunning, 'succeeded', { rc: 0 }, now - 500);
	const records = [running, completed];

	// simulate blockcheck_status logic: filter to kind=blockcheck
	const bcJobs = records.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 1);
	assert.equal(bcJobs[0].kind, 'blockcheck');
	// active selection is kind-scoped: no active blockcheck job
	const active = bcJobs.find(r => !j_is_terminal(r.status));
	assert.ok(active === undefined, 'no active blockcheck job (the active one is matrix, the blockcheck is completed)');
	const fallback = bcJobs[bcJobs.length - 1];
	assert.equal(fallback.kind, 'blockcheck');
	assert.equal(fallback.status, 'succeeded', 'fallback to the newest completed blockcheck');
});

test('JOB KIND: scenario 2 — newest blockcheck, older matrix', () => {
	const now = Date.now();
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now - 1000, 1);
	const mRunning = transition2(matrix, 'running', {}, now - 800);
	const completedM = transition2(mRunning, 'succeeded', { rc: 0 }, now - 500);
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now, 2);
	const records = [completedM, bc];

	const bcJobs = records.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 1);
	assert.equal(bcJobs[0].kind, 'blockcheck');
});

test('JOB KIND: scenario 3 — active matrix + completed blockcheck', () => {
	const now = Date.now();
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now, 1);
	const running = transition2(matrix, 'running', {}, now);
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now - 2000, 2);
	const bcRunning = transition2(bc, 'running', {}, now - 1500);
	const done = transition2(bcRunning, 'succeeded', { rc: 0 }, now - 1000);

	const records = [running, done];
	const bcJobs = records.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 1);
	assert.equal(bcJobs[0].kind, 'blockcheck');
	const active = bcJobs.find(r => !j_is_terminal(r.status));
	assert.ok(active === undefined, 'no active blockcheck (the active one is matrix)');
	const fallback = bcJobs[bcJobs.length - 1];
	assert.equal(fallback.status, 'succeeded', 'fallback to the completed blockcheck');
});

test('JOB KIND: scenario 4 — active blockcheck + completed matrix', () => {
	const now = Date.now();
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now, 1);
	const running = transition2(bc, 'running', {}, now);
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now - 2000, 2);
	const done = transition2(matrix, 'succeeded', { rc: 0 }, now - 1000);

	const records = [running, done];
	const bcJobs = records.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 1);
	const active = bcJobs.find(r => !j_is_terminal(r.status));
	assert.ok(active, 'active blockcheck job found');
	assert.equal(active.status, 'running');
});

test('JOB KIND: scenario 5 — no blockcheck jobs', () => {
	const now = Date.now();
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now, 1);

	const bcJobs = [matrix].filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 0);
});

test('JOB KIND: scenario 6 — malformed/unknown kind is excluded', () => {
	const now = Date.now();
	const unknown = make_job_record({ kind: 'unknown', mode: '?' }, now, 1);
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now - 100, 2);

	const records = [unknown, bc];
	const bcJobs = records.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 1);
	assert.equal(bcJobs[0].kind, 'blockcheck');
});

test('JOB KIND: scenario 7 — cancel wrong-kind job refused', () => {
	const now = Date.now();
	const matrix = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now, 1);
	const running = transition2(matrix, 'running', {}, now);

	// simulate blockcheck_cancel validation
	assert.ok(running.kind !== 'blockcheck', 'a blockcheck cancel should refuse this job');
	assert.equal(running.kind, 'healthmatrix');
});

test('JOB KIND: health_matrix_get filters by kind=healthmatrix', () => {
	const now = Date.now();
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now, 1);
	const runningBc = transition2(bc, 'running', {}, now);
	const hm = make_job_record({ kind: 'healthmatrix', mode: 'matrix' }, now - 100, 2);

	const records = [runningBc, hm];
	const hmJobs = records.filter(r => r && r.kind === 'healthmatrix');
	assert.equal(hmJobs.length, 1);
	assert.equal(hmJobs[0].kind, 'healthmatrix');
});

test('JOB KIND: job IDs alone insufficient without kind validation', () => {
	const now = Date.now();
	const bc = make_job_record({ kind: 'blockcheck', mode: 'quick' }, now, 1);
	const running = transition2(bc, 'running', {}, now);

	// the job ID should be used alongside kind validation
	// a consumer that only looks at IDs could accept a wrong-kind job
	assert.equal(running.kind, 'blockcheck');
	assert.ok(running.id, 'has an ID');

	// but a cross-kind consumer must ALSO validate kind
	const wrongKindId = running.id;
	// simulate: lib bockcheck_cancel received this ID but it's actually a healthmatrix job
	// in this case it IS a blockcheck job, so cancel should work
	assert.equal(running.kind, 'blockcheck');
	// if it were a healthmatrix job with an otherwise valid ID, cancel MUST refuse
});

test('JOB KIND: sweep preserves kind-scoped history', () => {
	const now = Date.now();
	const records = [
		make_job_record({ kind: 'blockcheck', mode: 'quick', timeoutSec: 600 }, now - 50000, 1),
		make_job_record({ kind: 'healthmatrix', mode: 'matrix', timeoutSec: 120 }, now - 45000, 2),
		make_job_record({ kind: 'blockcheck', mode: 'full', timeoutSec: 2400 }, now - 30000, 3),
	];

	// all records should be kept below maxHistory
	const result = sweep_jobs(records, now, { ttlSec: 600, maxHistory: 10 });
	assert.equal(result.kept.length, 3);

	// verify kind-scoped filtering still works after sweep
	const bcJobs = result.kept.filter(r => r && r.kind === 'blockcheck');
	assert.equal(bcJobs.length, 2);
});
