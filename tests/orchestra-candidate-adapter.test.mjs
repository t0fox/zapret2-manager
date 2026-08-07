import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateEnvironment, parseCandidateOutput, resolveCandidate, classifyAttempt } from './lib/orchestra-candidate-adapter.mjs';

test('adapter only maps trusted candidate text into the matching upstream custom list', () => {
	const env = buildCandidateEnvironment({ runId: 'or-1234abcd-0001', candidate: { id: 'p-1', opt: '--payload tls_client_hello' }, protocol: 'tcp_https' });
	assert.equal(env.TEST, 'custom');
	assert.equal(env.LIST_HTTPS_TLS12, '/tmp/zapret2-manager/orchestra-runs/or-1234abcd-0001/p-1.tls12');
	assert.equal(env.LIST_QUIC, '/dev/null');
	assert.equal(env.strategy, '--payload tls_client_hello');
});

test('adapter turns upstream exit and bounded output into an honest structured attempt', () => {
	const r = parseCandidateOutput({ candidateId: 'p-1', protocol: 'tcp_https', attempt: 1, startedAt: 100, finishedAt: 102, exitCode: 0, output: '!!!!! curl_test_https_tls12: working strategy found for ipv4 youtube.com : nfqws2 --payload tls_client_hello !!!!!\n'.repeat(2000) });
	assert.equal(r.passed, true);
	assert.equal(r.supported, true);
	assert.equal(r.boundedLog.length, 8192);
	assert.equal(r.cleanup.status, 'completed');
});

test('rc zero with strategy not found is target-fail, not candidate-invalid', () => {
	const r = classifyAttempt({ candidateResolved: true, resolvedStrategyReference: 'p000009@1', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 0, output: '* curl_test_https_tls12 ipv4 youtube.com\nnfqws2 strategy for ipv4 youtube.com not found\n' });
	assert.equal(r.verdict, 'target-fail');
	assert.equal(r.passed, false);
});

test('rc zero without a positive marker is indeterminate', () => {
	const r = classifyAttempt({ candidateResolved: true, resolvedStrategyReference: 'p000009@1', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 0, output: '* curl_test_https_tls12 ipv4 youtube.com\nchecking target youtube.com\n' });
	assert.equal(r.verdict, 'indeterminate');
	assert.equal(r.passed, false);
});

test('nonzero rc is target-fail only when upstream emitted a target result', () => {
	assert.equal(classifyAttempt({ candidateResolved: true, resolvedStrategyReference: 'p000009@1', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 7, output: '* curl_test_https_tls12 ipv4 youtube.com\nyoutube.com not working\n' }).verdict, 'target-fail');
	assert.equal(classifyAttempt({ candidateResolved: true, resolvedStrategyReference: 'p000009@1', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 7, output: 'runner crashed\n' }).verdict, 'runner-error');
});

test('candidate invalidity is limited to resolution and parameter errors', () => {
	assert.equal(classifyAttempt({ candidateResolved: false, protocol: 'tcp_https', attempt: 1, executionRc: 0, output: '' }).verdict, 'candidate-invalid');
	assert.equal(resolveCandidate([{ managerId: 'p000009', canonicalStrategyId: 'tls-video', catalogRevision: 7, upstreamStrategyReference: 'tls-video@7', opt: '--payload=tls <UNRESOLVED>' }], 'p000009', 7), null);
});

test('positive marker must bind to the expected domain and protocol', () => {
	const base = { candidateResolved: true, resolvedStrategyReference: 'p000009@1', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 0 };
	assert.equal(classifyAttempt({ ...base, output: '* curl_test_https_tls12 ipv4 youtube.com\n!!!!! curl_test_https_tls12: working strategy found for ipv4 example.com : nfqws2 --payload tls !!!!!' }).verdict, 'indeterminate');
	assert.equal(classifyAttempt({ ...base, output: '* curl_test_https_tls12 ipv4 youtube.com\n!!!!! curl_test_http3: working strategy found for ipv4 youtube.com : nfqws2 --payload quic !!!!!' }).verdict, 'indeterminate');
	assert.equal(classifyAttempt({ ...base, output: '* curl_test_https_tls12 ipv4 youtube.com\n!!!!! curl_test_https_tls12: working strategy found for ipv4 youtube.com : nfqws2 --payload tls !!!!!' }).verdict, 'pass');
});

test('positive marker for another sanitized strategy does not pass this candidate', () => {
	const r = classifyAttempt({ candidateResolved: true, resolvedStrategyReference: 'p000009@1', resolvedStrategyParameters: '--payload=tls_client_hello --lua-desync=multisplit:pos=2', protocol: 'tcp_https', attempt: 1, startedAt: 1, finishedAt: 2, executionRc: 0, output: '* curl_test_https_tls12 ipv4 youtube.com\n!!!!! curl_test_https_tls12: working strategy found for ipv4 youtube.com : nfqws2 --payload=tls_client_hello --lua-desync=multisplit:pos=1 !!!!!' });
	assert.equal(r.verdict, 'indeterminate');
	assert.equal(r.passed, false);
});

test('test-start without a result is indeterminate and infrastructure errors are runner-error', () => {
	assert.equal(classifyAttempt({ candidateResolved: true, protocol: 'tcp_https', attempt: 1, executionRc: 0, output: '* curl_test_https_tls12 ipv4 youtube.com\n' }).verdict, 'indeterminate');
	assert.equal(classifyAttempt({ candidateResolved: true, protocol: 'tcp_https', attempt: 1, executionRc: 127, output: '* curl_test_https_tls12 ipv4 youtube.com\ncommand not found\n' }).verdict, 'runner-error');
	assert.equal(classifyAttempt({ candidateResolved: true, protocol: 'tcp_https', attempt: 1, executionRc: 2, output: '* curl_test_https_tls12 ipv4 youtube.com\nunknown option --bad\n' }).verdict, 'candidate-invalid');
	assert.equal(classifyAttempt({ candidateResolved: true, protocol: 'tcp_https', attempt: 1, executionRc: 66, output: '' }).verdict, 'runner-error');
});

test('trusted manager ID resolves only at the pinned catalog revision and translates placeholders', () => {
	const r = resolveCandidate([{ managerId: 'p000009', canonicalStrategyId: 'tls-video', catalogRevision: 7, upstreamStrategyReference: 'tls-video@7', opt: '--filter-tcp=443 <HOSTLIST> --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls:tcp_md5 --lua-desync=multidisorder:pos=1,midsld' }], 'p000009', 7);
	assert.equal(r.upstreamStrategyReference, 'tls-video@7');
	assert.equal(r.upstreamInput, '--payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls:tcp_md5 --lua-desync=multidisorder:pos=1,midsld');
	assert.equal(resolveCandidate([{ managerId: 'p000009', canonicalStrategyId: 'tls-video', catalogRevision: 7, upstreamStrategyReference: 'tls-video@7', opt: '--x' }], 'p000010', 7), null);
	assert.equal(resolveCandidate([{ managerId: 'p000009', canonicalStrategyId: 'tls-video', catalogRevision: 7, upstreamStrategyReference: 'tls-video@7', opt: '--x' }], 'p000009', 8), null);
});
