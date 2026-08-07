import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWinnerChange, targetVerificationDisposition } from './lib/orchestra-apply.mjs';

const candidate = { id: 'winner', protocol: 'tcp_https', sanitizedParameterHash: 'abc', opt: '--payload=tls_client_hello --lua-desync=multidisorder:pos=100,midsld,sniext+1,endhost-2,-10' };
const run = { phase: 'completed', target: 'youtube.com', selectedWinner: { candidateId: 'winner' }, results: [
	{ candidateId: 'winner', protocol: 'tcp_https', verdict: 'pass', positiveEvidence: true },
	{ candidateId: 'winner', protocol: 'tcp_https', verdict: 'pass', positiveEvidence: true }
] };
const current = '--filter-tcp=443 --filter-l7=tls <HOSTLIST> --payload=tls_client_hello --lua-desync=old --new --filter-udp=443 --payload=quic_initial --lua-desync=quic';

test('buildWinnerChange creates a deterministic HTTPS-only youtube profile and preserves QUIC', () => {
	const a = buildWinnerChange(run, candidate, current), b = buildWinnerChange(run, candidate, current);
	assert.equal(a.changeHash, b.changeHash);
	assert.match(a.proposedConfiguration, /--hostlist-domains=youtube\.com/);
	assert.doesNotMatch(a.proposedConfiguration, /--new\s+--new=/);
	assert.match(a.proposedConfiguration, /--hostlist-exclude-domains=youtube\.com/);
	assert.match(a.proposedConfiguration, /--filter-udp=443 --payload=quic_initial/);
	assert.deepEqual(a.unchangedComponents, ['UDP/QUIC', 'DNS', 'Service DNS', 'Proxy']);
});

test('buildWinnerChange rejects incomplete or unproven winner data', () => {
	assert.throws(() => buildWinnerChange({ ...run, phase: 'testing' }, candidate, current), /completed winner/);
	assert.throws(() => buildWinnerChange({ ...run, results: run.results.slice(0, 1) }, candidate, current), /two positive/);
});

test('buildWinnerChange exposes a typed target-scoped transaction contract', () => {
	const change = buildWinnerChange({ ...run, catalogRevision: 'catalog-r1' }, {
		...candidate, source: 'zapret2gui', revision: 'source-r1'
	}, current);
	assert.equal(change.targetScope.domain, 'youtube.com');
	assert.deepEqual(change.targetScope, { domain: 'youtube.com', protocol: 'tcp_https', port: 443, l7: 'tls' });
	assert.equal(change.sourceRevision, 'source-r1');
	assert.equal(change.catalogRevision, 'catalog-r1');
	assert.equal(change.operations[0].tcpPort, 443);
	assert.equal(change.operations[0].tlsScope, true);
	assert.ok(change.currentProfile);
	assert.ok(change.proposedProfile);
});

test('non-YouTube preview is immutable, scoped, and collision-safe', () => {
	const nonYoutube = { ...run, target: 'twitter.com' };
	const change = buildWinnerChange(nonYoutube, candidate, current);
	assert.equal(change.target, 'twitter.com');
	assert.equal(change.proposedProfile.name, 'Orchestra_twitter_com_tcp443');
	assert.match(change.proposedConfiguration, /--hostlist-domains=twitter\.com/);
	assert.doesNotMatch(change.proposedConfiguration, /hostlist-domains=youtube\.com/);
	assert.equal(change.targetScope.protocol, 'tcp_https');
	assert.throws(() => buildWinnerChange({ ...nonYoutube, targetType: 'service' }, candidate, current), /domain runs only/);
	assert.throws(() => buildWinnerChange(nonYoutube, { ...candidate, protocol: 'quic_udp' }, current), /tcp_https only/);
});

test('target verification treats an uncovered router-local probe as not-applicable and requires LAN evidence', () => {
	const result = targetVerificationDisposition({ probePathCovered: false, router: { ok: false }, lan: { attempts: 2, successes: 2 } });
	assert.equal(result.ok, true);
	assert.equal(result.router.state, 'not-applicable');
	assert.equal(result.rollback, false);
	assert.equal(result.lan.attempts, 2);
});

test('target verification rolls back covered probe failure and never passes without two LAN successes', () => {
	assert.equal(targetVerificationDisposition({ probePathCovered: true, router: { ok: false }, lan: { attempts: 2, successes: 2 } }).rollback, true);
	assert.equal(targetVerificationDisposition({ probePathCovered: false, router: { ok: false }, lan: { attempts: 2, successes: 1 } }).ok, false);
});
