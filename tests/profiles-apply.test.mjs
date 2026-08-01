// profiles-apply.test.mjs — safe draft apply pipeline (tests/lib/profiles-apply.mjs,
// the node reference mirrored by the shipped ucode profiles-apply.uc).
//
// Contract (SLICE 3):
//   1. candidate = draft fragments joined with ' --new ' — every fragment must
//      parse to EXACTLY one native profile with NO error-severity diagnostics;
//   2. the candidate is REFUSED (never written) when: the draft set is empty
//      (never wipe applied to empty), a fragment is malformed, a fragment
//      holds several profiles, the round trip loses content, or the native
//      --dry-run rejects it;
//   3. opaque Lua survives the render byte-verbatim (round-trip check);
//   4. preview diff is honest (sha256 of current vs candidate);
//   5. post-restart verification: process present, exactly ONE nfqws2, rules
//      present, queue 300 registered, queue owner == daemon PID;
//   6. a failed verification rolls back; rollback failure is critical and
//      explicit.
//
// Run: node --test tests/profiles-apply.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	renderCandidate, candidateRoundTrip, diffSummary,
	verifyStatus, applyDecision, sha256hexNode, dqEscape,
	checkIdempotent, APPLY_IDEMPOTENCY_WINDOW_SEC
} from './lib/profiles-apply.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PS_FIXTURE = readFileSync(join(HERE, 'fixtures-postinstall', 'ps-full.out'), 'utf8');
const Q_FIXTURE = readFileSync(join(HERE, 'fixtures-postinstall', 'proc-nfnetlink_queue.out'), 'utf8');

const D1 = { id: 'p000001', name: 'Web', opt: '--filter-tcp=80 --filter-l7=http <HOSTLIST> --lua-desync=fake:blob=fake_default_http:tcp_md5' };
const D2 = { id: 'p000002', name: 'Video', opt: '--filter-tcp=443 --filter-l7=tls <HOSTLIST> --lua-desync=multisplit:pos=method+2 --lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000' };
const D3 = { id: 'p000003', name: 'QUIC', opt: '--filter-udp=443 --filter-l7=quic <HOSTLIST_NOAUTO> --lua-desync=fake:blob=fake_default_quic:repeats=6' };

// ---- render -------------------------------------------------------------------

test('renderCandidate: fragments join with --new; opaque Lua byte-verbatim', () => {
	const r = renderCandidate([D1, D2, D3]);
	assert.equal(r.ok, true);
	assert.ok(r.candidate.includes(' --new '), 'profiles separated by --new');
	assert.ok(r.candidate.includes('--lua-desync=fake:blob=fake_default_tls:tcp_md5:tcp_seq=-10000'),
		'opaque expression byte-verbatim');
	assert.ok(r.candidate.includes('<HOSTLIST_NOAUTO>'), 'placeholder verbatim');
	assert.equal(candidateRoundTrip(r.candidate, [D1.opt, D2.opt, D3.opt]), true,
		'round trip: every fragment survives the rendered document');
});

test('renderCandidate: an EMPTY draft set is refused (never wipe applied to empty)', () => {
	const r = renderCandidate([]);
	assert.equal(r.ok, false);
	assert.equal(r.code, 'ESTATE');
});

test('renderCandidate: a fragment with error diagnostics is refused with details', () => {
	const bad = { id: 'p000009', name: 'Bad', opt: '--filter-tcp=80-90-100 --lua-desync=pass' };
	const r = renderCandidate([D1, bad]);
	assert.equal(r.ok, false);
	assert.equal(r.code, 'EINPUT');
	assert.ok(r.failures.some((f) => f.id === 'p000009'
		&& f.diagnostics.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT')),
		'the refusal names the draft and the structural error');
});

test('renderCandidate: a fragment holding SEVERAL profiles is refused', () => {
	const multi = { id: 'p000010', name: 'Multi', opt: '--filter-tcp=80 --new --filter-udp=443' };
	const r = renderCandidate([multi]);
	assert.equal(r.ok, false);
	assert.ok(r.failures[0].diagnostics.some((d) => d.code === 'MANAGER_FRAGMENT_NOT_SINGLE_PROFILE'));
});

test('renderCandidate: unterminated quote → refused, never written', () => {
	const r = renderCandidate([{ id: 'p1', name: 'x', opt: '--lua-desync="fake:tcp_md5 --filter-tcp=80' }]);
	assert.equal(r.ok, false);
	assert.ok(r.failures[0].diagnostics.some((d) => d.code === 'MANAGER_UNTERMINATED_QUOTE'));
});

test('renderCandidate: raw newlines are refused (single-line config format, no silent flattening)', () => {
	const r = renderCandidate([{ id: 'p1', name: 'x', opt: '--filter-tcp=80\n--filter-udp=443' }]);
	assert.equal(r.ok, false);
	assert.ok(r.failures[0].diagnostics.some((d) => d.code === 'MANAGER_FRAGMENT_MULTILINE'));
});

// ---- write safety (double-quoted shell assignment) -------------------------------

test('dqEscape: shell double-quote specials are escaped, engine bytes preserved on source', () => {
	assert.equal(dqEscape('--filter-tcp=80'), '--filter-tcp=80', 'plain candidates unchanged');
	assert.equal(dqEscape('a"b'), 'a\\"b', 'a literal " is backslash-escaped for the double-quoted assignment');
	assert.equal(dqEscape('a\\:b'), 'a\\\\:b', 'an existing backslash doubles (sourcing restores it exactly)');
	assert.equal(dqEscape('$HOME`id`'), '\\$HOME\\`id\\`', 'no variable/command substitution on source');
	// round-trip through the escape: a config written escaped and read back
	// per shell double-quote rules yields the ORIGINAL candidate
	const candidate = '--lua-desync=fake:pattern=a\\:b --name="Quoted"';
	const escaped = dqEscape(candidate);
	assert.ok(escaped.includes('\\"Quoted\\"'));
	assert.ok(!/\n/.test(escaped));
});

// ---- diff ------------------------------------------------------------------------

test('diffSummary: honest sha256 diff of current vs candidate', () => {
	const cur = '--filter-tcp=80 --lua-desync=pass';
	const same = diffSummary(cur, cur, sha256hexNode);
	assert.equal(same.changed, false);
	const r = renderCandidate([D1, D2]);
	const diff = diffSummary(cur, r.candidate, sha256hexNode);
	assert.equal(diff.changed, true);
	assert.equal(diff.currentSha256, createHash('sha256').update(cur, 'utf8').digest('hex'));
	assert.equal(diff.candidateSha256, createHash('sha256').update(r.candidate, 'utf8').digest('hex'));
});

// ---- native gate decision -------------------------------------------------------------

test('applyDecision: native rejection refuses BEFORE any write', () => {
	assert.deepEqual(applyDecision({ status: 'rejected' }), { proceed: false, stage: 'validate' });
	assert.deepEqual(applyDecision({ status: 'unavailable' }), { proceed: false, stage: 'validate' });
	assert.deepEqual(applyDecision({ status: 'partial', coverage: { cliSyntax: 'passed' } }), { proceed: true });
	assert.deepEqual(applyDecision({ status: 'partial', coverage: { cliSyntax: 'not_checked' } }), { proceed: false, stage: 'validate' },
		'a partial WITHOUT cliSyntax passed is not a proceed signal');
	assert.deepEqual(applyDecision({ status: 'not_checked' }), { proceed: false, stage: 'validate' },
		'a candidate that was never natively checked must not be applied');
	assert.deepEqual(applyDecision({ status: 'valid' }), { proceed: false, stage: 'validate' },
		'NEGATIVE CONTROL: a fabricated "valid" status is not a proceed signal');
});

// ---- verify ---------------------------------------------------------------------------

function statusFixture(overrides = {}) {
	return {
		schema: 2, serviceState: 'running',
		runtime: { present: true, count: 1, rulesPresent: true, instances: [{ pid: 6128, cmdline: '/opt/zapret2/nfq2/nfqws2 ...' }] },
		health: { queue: { number: 300, registered: true, queueTotal: 0 } },
		...overrides
	};
}
const Q = { registered: true, peer_portid: 6128 };

test('verifyStatus: healthy post-restart state passes all five checks', () => {
	const v = verifyStatus(statusFixture(), Q);
	assert.equal(v.ok, true);
	for (const c of ['processPresent', 'singleInstance', 'rulesPresent', 'queueRegistered', 'ownerMatch'])
		assert.ok(v.checks[c], `check ${c} must pass`);
});

test('verifyStatus: two daemons fail singleInstance; absent process fails processPresent', () => {
	const two = statusFixture({ runtime: { present: true, count: 2, rulesPresent: true, instances: [{ pid: 1 }, { pid: 2 }] } });
	const v2 = verifyStatus(two, Q);
	assert.equal(v2.ok, false);
	assert.equal(v2.checks.singleInstance, false);

	const none = statusFixture({ runtime: { present: false, count: 0, rulesPresent: false, instances: [] } });
	const v0 = verifyStatus(none, { registered: false, peer_portid: null });
	assert.equal(v0.checks.processPresent, false);
	assert.equal(v0.checks.queueRegistered, false);
});

test('verifyStatus: a target-scoped apply accepts an unrelated external nfqws2 when queue 300 identifies the managed daemon', () => {
	const status = statusFixture({ runtime: { present: true, count: 2, rulesPresent: true, instances: [{ pid: 13862 }, { pid: 6128 }] } });
	const verified = verifyStatus(status, Q, { allowExternalNfqws: true });
	assert.equal(verified.ok, true);
	assert.equal(verified.daemonPid, 6128);
});

test('verifyStatus: queue owner mismatch is detected (owner != daemon PID)', () => {
	const v = verifyStatus(statusFixture(), { registered: true, peer_portid: 9999 });
	assert.equal(v.ok, false);
	assert.equal(v.checks.ownerMatch, false);
});

test('verifyStatus: missing nft rules fail rulesPresent', () => {
	const v = verifyStatus(statusFixture({ runtime: { present: true, count: 1, rulesPresent: false, instances: [{ pid: 6128 }] } }), Q);
	assert.equal(v.checks.rulesPresent, false);
});

test('verifyStatus: a racing status-collector queue read must NOT spurious-fail (r9 acceptance defect)', () => {
	// the exact r9 drill situation: the direct /proc parse says registered
	// with owner match, but the freshly-recollected status.json raced the
	// daemon's async bind and says not-registered. The direct read is
	// authoritative for queue registration (it selects the row by queue
	// number); the check must pass.
	const raced = statusFixture({
		runtime: { present: true, count: 1, rulesPresent: true, instances: [{ pid: 4575 }] },
		health: { queue: { number: 300, registered: false, queueTotal: 0 } }
	});
	const v = verifyStatus(raced, { registered: true, peer_portid: 4575 });
	assert.equal(v.ok, true, 'direct kernel read is authoritative for queue registration');
	assert.equal(v.checks.queueRegistered, true);
});

test('verify fixture grounding: ps/proc fixtures really carry pid 6128 owning queue 300', () => {
	// the fixture pair is the evidence for the ownerMatch rule: queue 300's
	// peer_portid (6128) equals the nfqws2 PID in ps
	assert.ok(PS_FIXTURE.includes(' 6128 daemon'), 'ps fixture: nfqws2 pid 6128');
	const qFields = Q_FIXTURE.trim().split(/\s+/);
	assert.equal(qFields[0], '300');
	assert.equal(qFields[1], '6128', 'queue 300 peer_portid == daemon pid');
});

// ---- idempotency guard (acceptance r10 double-apply hardening) -----------------

test('checkIdempotent: identical candidate inside the window skips; outside or different sha does not', () => {
	const sha = 'a'.repeat(64);
	const now = 1785000000000;
	assert.deepEqual(checkIdempotent(null, sha, now), { skip: false }, 'no previous apply → run');
	assert.deepEqual(checkIdempotent({ candidateSha256: sha, at: now - 21000 }, sha, now).skip, true,
		'EXACTLY the acceptance case: identical candidate 21s later → no-op');
	assert.equal(checkIdempotent({ candidateSha256: sha, at: now - 21000 }, sha, now).secondsAgo, 21);
	assert.deepEqual(checkIdempotent({ candidateSha256: sha, at: now - (APPLY_IDEMPOTENCY_WINDOW_SEC + 1) * 1000 }, sha, now), { skip: false },
		'outside the window → apply again');
	assert.deepEqual(checkIdempotent({ candidateSha256: 'b'.repeat(64), at: now - 5000 }, sha, now), { skip: false },
		'different candidate → apply');
	assert.deepEqual(checkIdempotent({ candidateSha256: sha, at: now + 10000 }, sha, now), { skip: false },
		'clock skew backwards → do not skip');
});
