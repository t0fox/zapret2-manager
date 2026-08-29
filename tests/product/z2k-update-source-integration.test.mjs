import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeLib = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const transport = path.join(root, 'tests/fixtures/update-source-transport.sh');
const hasUcode = fs.existsSync(ucodeBin);

function sandbox() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-source-'));
	return { cache: path.join(dir, 'cache'), state: path.join(dir, 'state'), locks: path.join(dir, 'locks'), count: path.join(dir, 'requests.log') };
}

function invoke(s, expression, extra = {}) {
	const program = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
	const result = spawnSync(ucodeBin, ['-L', ucodeLib, '-e', program], {
		cwd: root,
		env: {
			...process.env,
			Z2M_UPDATE_SOURCE_CACHE_ROOT: s.cache,
			Z2M_UPDATE_SOURCE_STATE_ROOT: s.state,
			Z2M_UPDATE_SOURCE_LOCK_ROOT: s.locks,
			Z2M_UPDATE_SOURCE_TRANSPORT: transport,
			Z2M_FIXTURE_COUNT_FILE: s.count,
			Z2M_UPDATE_SOURCE_TEST: '1',
			LD_LIBRARY_PATH: ucodeLib,
			...extra,
		},
		encoding: 'utf8',
		timeout: 30_000,
	});
	assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode expression failed`);
	return JSON.parse(result.stdout);
}

function requestUrls(s) {
	return fs.existsSync(s.count) ? fs.readFileSync(s.count, 'utf8').trim().split('\n').filter(Boolean) : [];
}

test('Z2K catalog browse is cold-once, warm-zero, and stale LKG remains displayable', { skip: !hasUcode }, () => {
	const s = sandbox();
	const cold = invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'z2k_catalog', Z2M_UPDATE_SOURCE_NOW: '1000' });
	assert.equal(cold.ok, true, JSON.stringify(cold));
	assert.equal(cold.diagnostics.requestCount, 1, JSON.stringify(cold));
	assert.equal(cold.diagnostics.restRequestCount, 1, JSON.stringify(cold));
	assert.equal(cold.versions[0].version, 'r-80.3');

	const warm = invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'error', Z2M_UPDATE_SOURCE_NOW: '1100' });
	assert.equal(warm.ok, true, JSON.stringify(warm));
	assert.equal(warm.diagnostics.requestCount, 0, JSON.stringify(warm));
	assert.equal(warm.stale, false);

	const stale = invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'error', Z2M_UPDATE_SOURCE_NOW: '2000' });
	assert.equal(stale.ok, true, JSON.stringify(stale));
	assert.equal(stale.stale, true, JSON.stringify(stale));
	assert.equal(stale.diagnostics.requestCount, 0, JSON.stringify(stale));
	assert.deepEqual(stale.versions.map(row => row.version), ['r-80.3', 'r-79.7']);
	assert.equal(requestUrls(s).length, 1);
});

test('Z2K explicit catalog refresh makes one controlled request and keeps an LKG on failure', { skip: !hasUcode }, () => {
	const s = sandbox();
	invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'z2k_catalog', Z2M_UPDATE_SOURCE_NOW: '1000' });
	const refreshed = invoke(s, 'mod.z2k_versions({ refresh: true })', { Z2M_FIXTURE_MODE: 'error', Z2M_UPDATE_SOURCE_NOW: '2000' });
	assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
	assert.equal(refreshed.stale, true, JSON.stringify(refreshed));
	assert.equal(refreshed.diagnostics.requestCount, 1, JSON.stringify(refreshed));
	assert.equal(requestUrls(s).length, 2);
});

test('Z2K catalog without an LKG exposes remote unavailability without hiding local-release fields', { skip: !hasUcode }, () => {
	const s = sandbox();
	const unavailable = invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'error' });
	assert.equal(unavailable.ok, false, JSON.stringify(unavailable));
	assert.equal(unavailable.remoteUnavailable, true, JSON.stringify(unavailable));
	assert.ok(Array.isArray(unavailable.versions), JSON.stringify(unavailable));
	assert.ok(Object.prototype.hasOwnProperty.call(unavailable, 'installedRelease'), JSON.stringify(unavailable));
	assert.equal(unavailable.diagnostics.requestCount, 1, JSON.stringify(unavailable));
});

test('Z2K selected resolution uses one exact REST lookup plus one raw immutable manifest request', { skip: !hasUcode }, () => {
	const s = sandbox();
	const selected = invoke(s, 'mod.z2k_resolve_version("r-80.3")', { Z2M_FIXTURE_MODE: 'z2k_selected' });
	assert.equal(selected.ok, false, 'the fixture intentionally has no local classification for its path');
	assert.equal(selected.error.code, 'EZ2K_UNCLASSIFIED_UPSTREAM_FILE', JSON.stringify(selected));
	assert.ok(selected.error.diagnostics, JSON.stringify(selected));
	assert.equal(selected.error.diagnostics.requestCount, 2, JSON.stringify(selected));
	assert.equal(selected.error.diagnostics.restRequestCount, 1, JSON.stringify(selected));
	const urls = requestUrls(s);
	assert.equal(urls.length, 2);
	assert.match(urls[0], /\/git\/ref\/tags\/r-80\.3$/);
	assert.match(urls[1], new RegExp('/c{40}/UPDATES\\.json$'));
});

test('Z2K selected details resolves through the initialized exact-version export', { skip: !hasUcode }, () => {
	const s = sandbox();
	const details = invoke(s, 'mod.z2k_version_details("r-80.3")', { Z2M_FIXTURE_MODE: 'z2k_selected' });
	assert.equal(details.ok, true, JSON.stringify(details));
	assert.equal(details.version, 'r-80.3');
	assert.equal(details.installable, false);
	assert.equal(details.unavailableReason, 'EZ2K_UNCLASSIFIED_UPSTREAM_FILE');
});

test('Z2K Compare cold pair is one REST request and warm pair is zero', { skip: !hasUcode }, () => {
	const s = sandbox();
	const from = crypto.randomBytes(20).toString('hex');
	const to = crypto.randomBytes(20).toString('hex');
	const cold = invoke(s, `mod.z2k_compare_evidence("${from}", "${to}")`, { Z2M_FIXTURE_MODE: 'z2k_compare' });
	assert.equal(cold.ok, true, JSON.stringify(cold));
	assert.equal(cold.diagnostics.requestCount, 1, JSON.stringify(cold));
	assert.equal(cold.diagnostics.restRequestCount, 1, JSON.stringify(cold));
	assert.equal(cold.diagnostics.compareRequestCount, 1, JSON.stringify(cold));

	const warm = invoke(s, `mod.z2k_compare_evidence("${from}", "${to}")`, { Z2M_FIXTURE_MODE: 'error' });
	assert.equal(warm.ok, true, JSON.stringify(warm));
	assert.equal(warm.diagnostics.requestCount, 0, JSON.stringify(warm));
	assert.equal(warm.diagnostics.compareRequestCount, 0, JSON.stringify(warm));
	assert.equal(requestUrls(s).length, 1);
});
