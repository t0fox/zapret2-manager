// blockcheck.test.mjs — SLICE 4 blockcheck wrapper logic (mode env, domain
// validation, log truncation, SUMMARY parsing with provenance).
//
// Run: node --test tests/blockcheck.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	BLOCKCHECK_MODES, mode_env, validate_domains,
	truncate_log, parse_summary, recommendations_with_provenance,
	BLOCKCHECK_SCANNER
} from './lib/blockcheck-logic.mjs';

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
