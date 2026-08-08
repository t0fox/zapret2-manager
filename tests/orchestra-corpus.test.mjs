import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildTrustedCorpus, stableCandidateId, normalizeStrategyLine,
	selectCandidates, compatibility
} from './lib/orchestra-corpus.mjs';

const sources = [
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'tcp_https', line: '--payload=tls_client_hello --lua-desync=multisplit:pos=2' },
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'tcp_https', line: '# comment' },
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'tcp_https', line: '' },
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'tcp_https', line: '--payload=tls_client_hello --lua-desync=multisplit:pos=2' },
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'quic_udp', line: '--payload=quic_initial --lua-desync=fake:blob=fake_default_quic:repeats=2' },
	{ source: 'manager-profile', revision: 'state-1', protocol: 'tcp_https', line: '--filter-tcp=443 <HOSTLIST> --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls' },
	{ source: 'upstream-standard', revision: 'd3b3011', protocol: 'tcp_https', line: '--payload=tls_client_hello <UNRESOLVED> --lua-desync=multisplit:pos=1' },
];

test('bundled upstream lines ignore comments, empty lines and deduplicate normalized parameters', () => {
	const result = buildTrustedCorpus(sources);
	assert.equal(result.rejected.length, 1);
	assert.equal(result.candidates.length, 3);
	assert.equal(result.rejected[0].reason, 'unresolved placeholder');
});

test('candidate ID is stable from source, protocol and normalized parameter hash', () => {
	const line = '--payload=tls_client_hello   --lua-desync=multisplit:pos=2';
	assert.equal(stableCandidateId('upstream-standard', 'tcp_https', line, 'd3b3011'), stableCandidateId('upstream-standard', 'tcp_https', line, 'd3b3011'));
	assert.notEqual(stableCandidateId('upstream-standard', 'tcp_https', line, 'd3b3011'), stableCandidateId('upstream-standard', 'quic_udp', line, 'd3b3011'));
	assert.notEqual(stableCandidateId('upstream-standard', 'tcp_https', line, 'd3b3011'), stableCandidateId('upstream-standard', 'tcp_https', line, 'd3b3012'));
	assert.equal(normalizeStrategyLine(line), '--payload=tls_client_hello --lua-desync=multisplit:pos=2');
});

test('compatibility separates HTTPS and QUIC and rejects unresolved parameters', () => {
	assert.equal(compatibility('--payload=tls_client_hello --lua-desync=multisplit:pos=2', 'tcp_https').ok, true);
	assert.equal(compatibility('--payload=tls_client_hello --lua-desync=multisplit:pos=2', 'quic_udp').ok, false);
	assert.equal(compatibility('--payload=quic_initial --lua-desync=fake:blob=fake_default_quic', 'quic_udp').ok, true);
	assert.equal(compatibility('--payload=tls_client_hello <HOSTLIST>', 'tcp_https').reason, 'unresolved placeholder');
	assert.equal(compatibility('--payload=tls_client_hello --lua-desync=fake;echo=pwned', 'tcp_https').reason, 'shell syntax');
});

test('manager filters are removed while payload and lua-desync remain', () => {
	const result = buildTrustedCorpus([{ source: 'manager-profile', revision: '1', protocol: 'tcp_https', line: '--filter-tcp=443 <HOSTLIST> --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls' }]);
	assert.equal(result.candidates[0].line, '--payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls');
	assert.deepEqual(result.candidates[0].removedManagerOnlyOptions, ['--filter-tcp=443', '<HOSTLIST>']);
});

test('recommended ordering is deterministic and selected preserves valid requested IDs', () => {
	const corpus = buildTrustedCorpus(sources).candidates;
	const rec1 = selectCandidates(corpus, { mode: 'recommended', protocol: 'tcp_https', limit: 10 });
	const rec2 = selectCandidates([...corpus].reverse(), { mode: 'recommended', protocol: 'tcp_https', limit: 10 });
	assert.deepEqual(rec1.map(c => c.candidateId), rec2.map(c => c.candidateId));
	const selected = selectCandidates(corpus, { mode: 'selected', protocol: 'tcp_https', candidateIds: [rec1[0].candidateId] });
	assert.deepEqual(selected.map(c => c.candidateId), [rec1[0].candidateId]);
});
