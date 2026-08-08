import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidencePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-evidence.uc';
const workerPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-worker-control.uc';
const runSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc';

function ucodeAvailable() {
	try { execSync('command -v ucode', { stdio: 'ignore' }); return true; } catch { return false; }
}

function evaluate(expression, results) {
	const dir = mkdtempSync(join(tmpdir(), 'z2m-confirm-'));
	try {
		const driver = join(dir, 'driver.uc');
		const payload = join(dir, 'payload.json');
		writeFileSync(payload, JSON.stringify(results));
		writeFileSync(driver, [
			"import { confirmation_state, winner_record, distinct_positive_evidence_ids, evidence_id } from '" + process.cwd() + '/' + evidencePath + "';",
			"import { readfile } from 'fs';",
			"let results = json(readfile('" + payload + "'));",
			'print(sprintf(\'%J\', ' + expression + '));'
		].join('\n'));
		return JSON.parse(execFileSync('ucode', ['-R', driver], { encoding: 'utf8' }));
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

function attempt(overrides) {
	return Object.assign({
		domain: 'discord.com', candidateId: 'z2g-001', protocol: 'tcp_https',
		attempt: 1, startedAt: 1000, passed: true, positiveEvidence: true,
		evidenceId: 'or-aaaaaaaa-bbbb-e-00001-z2g-001-tcp_https'
	}, overrides);
}

test('worker asks for a second live attempt and only then confirms a winner', () => {
	const worker = readFileSync(workerPath, 'utf8');
	assert.match(worker, /perform_attempt\(id,scope,c,proto,r\.repeats\+attempt\)/, 'confirmation must be a real second live attempt');
	assert.match(worker, /provisionalWinner/);
	assert.match(worker, /winner-confirmed/);
	assert.match(worker, /confirmation_state|winner_record/);
	assert.match(worker, /t\.winner&&t\.winner\.confirmed/, 'early stop requires a confirmed winner');
	assert.doesNotMatch(worker, /for\(let a in r\.results\)if\(a\.domain==scope\.domain&&a\.candidateId==r\.currentCandidate&&a\.passed\)\{p\.winner=/);
});

test('every attempt carries a unique machine-derived evidence id', () => {
	const runSource = readFileSync(runSourcePath, 'utf8');
	assert.match(runSource, /evidenceSeq/);
	assert.match(runSource, /evidenceId:/);
	assert.match(runSource, /evidence_id\(/);
});

test('one PASS is provisional, two distinct evidence ids confirm', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const single = evaluate("confirmation_state(results,'discord.com','z2g-001','tcp_https')", [attempt({})]);
	assert.equal(single.provisional, true);
	assert.equal(single.confirmed, false);

	const duplicate = evaluate("confirmation_state(results,'discord.com','z2g-001','tcp_https')", [attempt({}), attempt({})]);
	assert.equal(duplicate.confirmed, false, 'the same evidence id must never confirm itself');

	const confirmed = evaluate("confirmation_state(results,'discord.com','z2g-001','tcp_https')", [
		attempt({}),
		attempt({ attempt: 3, startedAt: 1200, evidenceId: 'or-aaaaaaaa-bbbb-e-00002-z2g-001-tcp_https' })
	]);
	assert.equal(confirmed.confirmed, true);
	assert.equal(confirmed.positiveEvidenceIds.length, 2);
});

test('a failed second attempt leaves the candidate unconfirmed', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const state = evaluate("winner_record(results,'discord.com','z2g-001','tcp_https')", [
		attempt({}),
		attempt({ attempt: 3, startedAt: 1200, passed: false, positiveEvidence: false, evidenceId: 'or-aaaaaaaa-bbbb-e-00002-z2g-001-tcp_https' })
	]);
	assert.equal(state, null);
});

test('evidence from another target or protocol never confirms this one', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const state = evaluate("confirmation_state(results,'discord.com','z2g-001','tcp_https')", [
		attempt({}),
		attempt({ domain: 'cdn.discordapp.com', evidenceId: 'or-aaaaaaaa-bbbb-e-00002-z2g-001-tcp_https' }),
		attempt({ protocol: 'quic_udp', evidenceId: 'or-aaaaaaaa-bbbb-e-00003-z2g-001-quic_udp' })
	]);
	assert.equal(state.confirmed, false);
});
