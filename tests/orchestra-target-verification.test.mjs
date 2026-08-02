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

// The probe never talks to the network in tests: exec is injected and replays a
// recorded curl response, so the assertions are about the verdict logic only.
function verify(target, canned) {
	const dir = mkdtempSync(join(tmpdir(), 'z2m-verify-'));
	try {
		const driver = join(dir, 'driver.uc');
		const payload = join(dir, 'payload.json');
		writeFileSync(payload, JSON.stringify({ target, canned }));
		writeFileSync(driver, [
			"import { verify_target } from '" + process.cwd() + '/' + evidencePath + "';",
			"import { readfile } from 'fs';",
			"let input = json(readfile('" + payload + "'));",
			'let exec = function(cmd) { return { out: input.canned.out, rc: input.canned.rc, command: cmd }; };',
			"print(sprintf('%J', verify_target(input.target, exec)));"
		].join('\n'));
		return JSON.parse(execFileSync('ucode', ['-R', driver], { encoding: 'utf8' }));
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('Apply no longer hardcodes passed:true for Discord targets', () => {
	const runSource = readFileSync(runSourcePath, 'utf8');
	assert.doesNotMatch(runSource, /probe:'websocket',passed:true/);
	assert.doesNotMatch(runSource, /probe:'bounded_download',passed:true/);
	assert.doesNotMatch(runSource, /for d in discord\.com gateway\.discord\.gg cdn\.discordapp\.com/);
	assert.match(runSource, /verify_service_targets\(/);
	assert.match(runSource, /rollback_apply\(o,'Discord target verification failed'\)/);
});

test('web verification requires DNS, TLS and a real HTTP response', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const target = { id: 'web', domain: 'discord.com', probe: 'https', required: true };
	const ok = verify(target, { out: '200 0 162.159.128.233 0.412', rc: 0 });
	assert.equal(ok.passed, true, JSON.stringify(ok.reasons));
	assert.equal(ok.evidence.httpStatus, 200);

	const noDns = verify(target, { out: '000  0.000', rc: 6 });
	assert.equal(noDns.passed, false);

	const badTls = verify(target, { out: '200 1 162.159.128.233 0.412', rc: 0 });
	assert.equal(badTls.passed, false);
	assert.match(JSON.stringify(badTls.reasons), /TLS/);
});

test('gateway verification passes only on a real websocket upgrade', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const target = { id: 'gateway', domain: 'gateway.discord.gg', probe: 'websocket', required: true };
	const upgraded = verify(target, { out: 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLM+m==\r\n', rc: 0 });
	assert.equal(upgraded.passed, true, JSON.stringify(upgraded.reasons));

	const plain200 = verify(target, { out: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n', rc: 0 });
	assert.equal(plain200.passed, false, 'HTTP 200 must never count as a gateway PASS');

	const blocked = verify(target, { out: 'HTTP/1.1 400 Bad Request\r\n', rc: 0 });
	assert.equal(blocked.passed, false);
});

test('cdn verification is a bounded, typed asset download', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const target = { id: 'cdn', domain: 'cdn.discordapp.com', probe: 'bounded_download', required: true, verify: { path: '/embed/avatars/0.png', expectContentTypePrefix: 'image/', maxBytes: 262144 } };
	const ok = verify(target, { out: '200 image/png 4096', rc: 0 });
	assert.equal(ok.passed, true, JSON.stringify(ok.reasons));
	assert.equal(ok.evidence.bodyBytes, 4096);

	const empty = verify(target, { out: '200 image/png 0', rc: 0 });
	assert.equal(empty.passed, false);

	const html = verify(target, { out: '200 text/html 5120', rc: 0 });
	assert.equal(html.passed, false);

	const missingAsset = verify({ id: 'cdn', domain: 'cdn.discordapp.com', probe: 'bounded_download', required: true }, { out: '', rc: 0 });
	assert.equal(missingAsset.passed, false, 'the asset must come from the manifest, never from code');
});

test('run invalidation is generic and never hardcodes a runId or failure text', { skip: !ucodeAvailable() && 'ucode is not installed' }, () => {
	const runSource = readFileSync(runSourcePath, 'utf8');
	assert.doesNotMatch(runSource, /or-6a6e54c9-5795/);
	assert.doesNotMatch(runSource, /suitable netcat not found/);
	assert.match(runSource, /invalidation_patch\(/);
});
