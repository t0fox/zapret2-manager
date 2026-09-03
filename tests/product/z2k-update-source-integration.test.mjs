import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const resourceUpdatePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeLib = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const transport = path.join(root, 'tests/fixtures/update-source-transport.sh');
const classificationPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
const hasUcode = fs.existsSync(ucodeBin);

function sandbox() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-source-'));
	return { cache: path.join(dir, 'cache'), state: path.join(dir, 'state'), locks: path.join(dir, 'locks'), count: path.join(dir, 'requests.log'), registry: path.join(dir, 'asset-registry.json') };
}

function seedInstalledRelease(s) {
	const sourceCommit = 'd'.repeat(40);
	const sha256 = '1'.repeat(64);
	const asset = {
		schema: 1, type: 'lua', id: 'lua:z2k-alert', name: 'z2k-alert.lua', ownership: 'manager', mutable: true,
		provenance: { kind: 'catalog/upstream', source: 'fixture', sourceCommit, sourcePath: 'files/lua/z2k-alert.lua', bundleId: 'z2k-curated-lua', version: 'r-79.7' },
		contentSha256: sha256, byteSize: 1, revision: 1, path: '/tmp/z2m-fixture-z2k-alert.lua', legacyPath: null,
		references: [], validation: { status: 'passed', errors: [] },
	};
	fs.writeFileSync(s.registry, JSON.stringify({
		schema: 1, revision: 1, assets: [asset], activationReceipts: [{
			schema: 'asset-activation-receipt.v1', bundleId: 'z2k-curated-lua', version: 'r-79.7', source: 'fixture', sourceCommit,
			assets: [{ id: asset.id, type: asset.type, sha256, byteSize: 1, sourceCommit, sourcePath: 'files/lua/z2k-alert.lua', bundleId: 'z2k-curated-lua', version: 'r-79.7' }],
		}],
	}));
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
			Z2M_ASSET_REGISTRY_STATE: s.registry,
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

test('Z2K valid empty release metadata is explicit remote-empty', { skip: !hasUcode }, () => {
	const s = sandbox();
	const empty = invoke(s, 'mod.z2k_versions()', { Z2M_FIXTURE_MODE: 'z2k_no_releases', Z2M_UPDATE_SOURCE_NOW: '1000' });
	assert.equal(empty.ok, true, JSON.stringify(empty));
	assert.equal(empty.remoteAvailable, true);
	assert.equal(empty.remoteState, 'empty');
	assert.deepEqual(empty.versions, []);
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

test('Z2K selected details keeps unconsumed upstream files advisory and the target installable', { skip: !hasUcode }, () => {
	const s = sandbox();
	seedInstalledRelease(s);
	const details = invoke(s, 'mod.z2k_version_details("r-81.6")', presentationEnv(s, '1000', 'z2k_advisory_selected'));
	assert.equal(details.ok, true, JSON.stringify(details));
	assert.equal(details.version, 'r-81.6');
	assert.equal(details.installable, true, JSON.stringify(details));
	assert.equal(details.unavailableReason, null, JSON.stringify(details));
	assert.equal(details.targetCanApply, true, JSON.stringify(details));
	assert.notEqual(details.targetAttentionState, 'unknown');
	assert.deepEqual(details.targetBlockingReasons, []);
});

function comparablePresentation(value) {
	return {
		version: value.version,
		commitSha: value.commitSha,
		releaseBody: value.releaseBody,
		releaseChanges: value.releaseChanges,
		deviceChanges: value.deviceChanges,
		installChanges: value.installChanges,
		changes: value.changes,
		compareUrl: value.compareUrl,
		targetCanApply: value.targetCanApply,
		targetAttentionState: value.targetAttentionState,
		targetBlockingReasons: value.targetBlockingReasons,
		targetReviewDetails: value.targetReviewDetails,
		manifest: value.manifest,
		manifestSha256: value.manifestSha256,
		assets: value.assets,
		installedVersion: value.installedVersion,
		operation: value.operation,
	};
}

function presentationEnv(s, now, mode) {
	return { Z2M_FIXTURE_MODE: mode, Z2M_UPDATE_SOURCE_NOW: now, Z2M_Z2K_CLASSIFICATION_PATH: classificationPath };
}

test('Z2K version details cold presentation uses shared browse metadata and warm new invocation makes zero total upstream requests', { skip: !hasUcode }, () => {
	const s = sandbox();
	seedInstalledRelease(s);
	const cold = invoke(s, 'mod.z2k_version_details("r-80.3", { includeCompare: true })', presentationEnv(s, '1000', 'z2k_presentation'));
	assert.equal(cold.ok, true, JSON.stringify(cold));
	assert.equal(cold.installable, true, JSON.stringify(cold));
	assert.equal(cold.diagnostics.requestCount, 5, JSON.stringify(cold));
	assert.equal(cold.diagnostics.restRequestCount, 3, JSON.stringify(cold));
	assert.equal(cold.compareDiagnostics.requestCount, 1, JSON.stringify(cold));
	assert.equal(cold.deviceChanges.modifiedItems.length, 1, JSON.stringify(cold));
	assert.equal(cold.deviceChanges.modifiedItems[0].summarySource, 'repository-compare', JSON.stringify(cold));
	assert.ok(cold.deviceChanges.modifiedItems[0].summary, JSON.stringify(cold));
	assert.equal(cold.deviceChanges.compareContext.length, 1, JSON.stringify(cold));
	assert.equal(cold.releaseBody, 'Target release summary', JSON.stringify(cold));

	const coldUrls = requestUrls(s);
	assert.equal(coldUrls.length, 5, JSON.stringify(coldUrls));
	assert.equal(coldUrls.filter(url => url.includes('/git/tags/' + 'b'.repeat(40))).length, 1, JSON.stringify(coldUrls));

	const warm = invoke(s, 'mod.z2k_version_details("r-80.3", { includeCompare: true })', presentationEnv(s, '1100', 'error'));
	assert.equal(warm.ok, true, JSON.stringify(warm));
	assert.deepEqual(comparablePresentation(warm), comparablePresentation(cold));
	assert.equal(warm.diagnostics.requestCount, 0, JSON.stringify(warm));
	assert.equal(warm.diagnostics.restRequestCount, 0, JSON.stringify(warm));
	assert.equal(warm.compareDiagnostics.requestCount, 0, JSON.stringify(warm));
	assert.equal(warm.compareDiagnostics.cache, 'warm', JSON.stringify(warm));
	assert.equal(requestUrls(s).length, coldUrls.length, JSON.stringify(requestUrls(s)));
});

test('Z2K stale presentation remains readable without network, while mutation resolution stays FRESH', { skip: !hasUcode }, () => {
	const s = sandbox();
	seedInstalledRelease(s);
	const cold = invoke(s, 'mod.z2k_version_details("r-80.3", { includeCompare: true })', presentationEnv(s, '1000', 'z2k_presentation'));
	assert.equal(cold.ok, true, JSON.stringify(cold));
	const coldCount = requestUrls(s).length;

	const stale = invoke(s, 'mod.z2k_version_details("r-80.3", { includeCompare: true })', presentationEnv(s, '2000', 'error'));
	assert.equal(stale.ok, true, JSON.stringify(stale));
	assert.deepEqual(comparablePresentation(stale), comparablePresentation(cold));
	assert.equal(stale.diagnostics.requestCount, 0, JSON.stringify(stale));
	assert.equal(requestUrls(s).length, coldCount, JSON.stringify(requestUrls(s)));

	const mutation = invoke(s, 'mod.z2k_resolve_version("r-80.3")', { Z2M_FIXTURE_MODE: 'error', Z2M_UPDATE_SOURCE_NOW: '2000' });
	assert.equal(mutation.ok, false, JSON.stringify(mutation));
	assert.equal(mutation.error.diagnostics.requestCount, 1, JSON.stringify(mutation));
	assert.equal(mutation.error.diagnostics.restRequestCount, 1, JSON.stringify(mutation));
	assert.match(requestUrls(s)[coldCount], /\/git\/ref\/tags\/r-80\.3$/);
});

test('Z2K presentation and mutation entrypoints keep their explicit resolution boundaries', () => {
	const versions = fs.readFileSync(modulePath, 'utf8');
	const details = versions.slice(versions.indexOf('export const z2k_version_details'), versions.indexOf('export const z2k_compare_versions'));
	const resourceUpdate = fs.readFileSync(resourceUpdatePath, 'utf8');
	assert.match(versions, /export const z2k_resolve_version = function\(version, mode, catalog\)/);
	assert.match(versions, /return mode == 'browse' \? z2k_resolve_version_browse\(version, catalog\) : z2k_resolve_version_fresh\(version\)/);
	assert.match(details, /z2k_resolve_version\(version, 'browse', catalog\)/);
	assert.match(details, /release_manifest\(previous, 'browse'\)/);
	assert.match(details, /release_manifest\(installedRow, 'browse'\)/);
	assert.match(resourceUpdate, /let resolved = z2k_resolve_version\(version\)/);
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
