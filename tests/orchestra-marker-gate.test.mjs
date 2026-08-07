import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidencePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-evidence.uc';
const runSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc';

function ucodeAvailable() {
	try { execSync('command -v ucode', { stdio: 'ignore' }); return true; } catch { return false; }
}

function gate({ text, testName = 'curl_test_https_tls12', domain = 'discord.com', resolved = '--dpi-desync=fake --payload=tls_client_hello' }) {
	const dir = mkdtempSync(join(tmpdir(), 'z2m-gate-'));
	try {
		const driver = join(dir, 'driver.uc');
		const payload = join(dir, 'payload.json');
		writeFileSync(payload, JSON.stringify({ text, testName, domain, resolved }));
		writeFileSync(driver, [
			"import { marker_gate } from '" + process.cwd() + '/' + evidencePath + "';",
			"import { readfile } from 'fs';",
			"let input = json(readfile('" + payload + "'));",
			"print(sprintf('%J', marker_gate(input.text, input.testName, input.domain, input.resolved)));"
		].join('\n'));
		return JSON.parse(execFileSync('ucode', ['-R', driver], { encoding: 'utf8' }));
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

const PASS_LINE = '!!!!! curl_test_https_tls12: working strategy found for ipv4 discord.com : nfqws2 --dpi-desync=fake --dpi-desync-ttl=6 --payload=tls_client_hello !!!!!';

test('evidence module owns the PASS gate and never compares whole strategy strings', () => {
	const source = readFileSync(evidencePath, 'utf8');
	assert.match(source, /export const marker_gate/);
	assert.match(source, /EXPECTED_DAEMON = 'nfqws2'/);
	assert.match(source, /no upstream working-strategy marker/);
	assert.doesNotMatch(source, /lower\(params\)\s*==\s*wantLow/);
	const runSource = readFileSync(runSourcePath, 'utf8');
	assert.match(runSource, /marker_gate\(text,testName,domain,resolved\)/);
	assert.doesNotMatch(runSource, /if\(!want\|\|lower\(params\)==wantLow\)return true/);
});

test('a normalized upstream marker with extra parameters still passes', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const result = gate({ text: ['curl_test_https_tls12 ipv4 discord.com', PASS_LINE].join('\n') });
	assert.equal(result.ok, true, JSON.stringify(result.reasons));
	assert.equal(result.reportedDaemon, 'nfqws2');
	assert.equal(result.reportedDomain, 'discord.com');
	assert.deepEqual(result.missingParameters, []);
});

test('a marker for another domain or another daemon is not a PASS', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const otherDomain = gate({ text: PASS_LINE.replace('discord.com', 'youtube.com') });
	assert.equal(otherDomain.ok, false);
	const otherDaemon = gate({ text: PASS_LINE.replace('nfqws2', 'tpws2') });
	assert.equal(otherDaemon.ok, false);
	assert.match(JSON.stringify(otherDaemon.reasons), /daemon/);
});

test('missing candidate parameters, timeouts and infrastructure noise block a PASS', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const missing = gate({ text: PASS_LINE, resolved: '--dpi-desync=fakeddisorder --payload=tls_client_hello' });
	assert.equal(missing.ok, false);
	assert.ok(missing.missingParameters.length > 0);

	const timedOut = gate({ text: [PASS_LINE, 'operation timed out after 20 seconds'].join('\n') });
	assert.equal(timedOut.ok, false);

	const infra = gate({ text: ['INFRA_ERROR suitable netcat not found', PASS_LINE].join('\n') });
	assert.equal(infra.ok, false);

	const probeFail = gate({ text: ['PROBE_FAIL', PASS_LINE].join('\n') });
	assert.equal(probeFail.ok, false);
});

test('a run without the terminal upstream marker is never a PASS', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const result = gate({ text: 'curl_test_https_tls12 ipv4 discord.com\nstrategy for ipv4 discord.com not found' });
	assert.equal(result.ok, false);
	assert.match(JSON.stringify(result.reasons), /no upstream working-strategy marker/);
});
