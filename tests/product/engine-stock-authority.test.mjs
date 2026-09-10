import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Current Engine authority contract:
//   * official bol-van releases are the only installable candidates;
//   * runtime truth never invents an upstream release;
//   * update availability is computed against the official catalog.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'engine-catalog.uc');
const WORKER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'engine-operation-worker.sh');
const MANAGER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'engine-manager.uc');
const PREFLIGHT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
	'zapret2-manager', 'native-preflight.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

function invoke(functionName, argsLiteral) {
	const source = `import * as catalogModule from ${JSON.stringify(MODULE)}; `
		+ `print(sprintf('%J', catalogModule.${functionName}(${argsLiteral})));`;
	const result = spawnSync(UCODE_BIN, ['-e', source], {
		cwd: ROOT,
		env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
		encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
	});
	assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode diagnostic for ${functionName}`);
	return JSON.parse(result.stdout);
}

test('ENGINE A/B matrix — canonical vanilla state keeps true upstream identity', () => {
	const saved = {
		schema: 'engine-state.v2',
		installedOrigin: 'OFFICIAL',
		artifactKind: 'vanilla-bol-van-release',
		installedRelease: 'v1.0.4',
		upstreamRepository: 'bol-van/zapret2',
	};
	const truth = invoke('normalize_state_record', JSON.stringify(saved));
	assert.equal(truth.artifactKind, 'vanilla-bol-van-release');
	assert.equal(truth.producer, null);
	assert.equal(truth.upstreamRelease, 'v1.0.4');
	assert.equal(truth.artifactVersion, 'v1.0.4');

	// without explicit kind marker there is NO proven upstream identity
	const ambiguous = invoke('normalize_state_record', JSON.stringify({
		schema: 'engine-state.v2', installedOrigin: 'OFFICIAL',
		installedRelease: 'some-custom-string',
	}));
	assert.equal(ambiguous.artifactKind, null);
	assert.equal(ambiguous.upstreamRelease, null);
});

test('update_required semantics cover missing, current, and newer official releases', () => {
	assert.equal(invoke('update_required', `null,null`), false);
	assert.equal(invoke('update_required', `'v1.0.4','1.0.5'`), true, 'newer stock available');
	assert.equal(invoke('update_required', `'v1.0.4','1.0.4'`), false, 'current');
	assert.equal(invoke('update_required', `null,'1.0.4'`), true, 'missing Engine installs the release');
});

// ----------------------------------------------------------- catalog wiring

test('release_record emits compatible vanilla candidates with requirement-based caps', () => {
	const src = fs.readFileSync(MODULE, 'utf8');
	const tail = src.slice(src.indexOf('return { schema: ENGINE_ARTIFACT_SCHEMA, artifactKind: VANILLA_ARTIFACT'),
		src.indexOf('function metadata_allowed'));
	assert.match(tail, /compatible: true/, 'vanilla must be installable now');
	assert.match(tail, /compatibilityState: 'compatible'/);
	assert.match(tail, /requiredCapabilities: \[\]/, 'zero mandatory native capabilities');
	assert.doesNotMatch(tail, /EENGINE_INTEGRATION_REQUIRED/,
		'the integration-required block is retired for vanilla records');
});

test('catalog exposes only official upstream candidates', () => {
	const src = fs.readFileSync(MODULE, 'utf8');
	assert.doesNotMatch(src, /z2mReleases|merged_candidates|legacy-compatibility-build/);
	assert.match(src, /return \{ ok: true, releases: releases, remoteAvailable: true/);
});

test('load_checked_candidate admits only official stock releases', () => {
	const src = fs.readFileSync(MODULE, 'utf8');
	const fn = src.slice(src.indexOf('export const load_checked_candidate ='),
		src.indexOf('export const save_engine_state ='));
	assert.match(fn, /VANILLA_ARTIFACT/);
	assert.doesNotMatch(fn, /Z2M_ENGINE_ARTIFACT/, 'legacy kind no longer admissible');
	assert.match(fn, /compatible !== true/);
});

// -------------------------------------------------------------- worker pins

test('worker preflight gate admits only the official stock artifact kind', () => {
	const src = fs.readFileSync(WORKER, 'utf8');
	const idx = src.indexOf("ARTIFACT_SCHEMA\" = 'zapret2-manager.engine-artifact.v1'");
	const block = src.slice(idx - 200, idx + 400);
	assert.match(block, /'vanilla-bol-van-release'/);
	assert.doesNotMatch(block, /'z2m-compatible-engine'/,
		'the legacy compatibility kind is retired from production admission');
});

test('worker proving phase derives required capabilities from the candidate', () => {
	const src = fs.readFileSync(WORKER, 'utf8');
	assert.match(src, /REQUIRED_CAPS="\$\(jsonfilter -i "\$JOB" -e '@\.candidate\.requiredCapabilities\[\*\]'/);
	assert.match(src, /Z2M_REQUIRED_CAPABILITIES="\$REQUIRED_CAPS"/);
	assert.match(src, /for capability in \$REQUIRED_CAPS; do/);
	assert.doesNotMatch(src, /for capability in Z2K_TLS_MOD ANTIDPI_REPEATS_LOOP AUTO_FAMILY_SPLIT/,
		'the hardcoded 3/3 loop is retired');
});

test('commit-state defaults to zero required caps instead of the historical trio', () => {
	const src = fs.readFileSync(MANAGER, 'utf8');
	const block = src.slice(src.indexOf('let required = type(candidate.requiredCapabilities)'),
		src.indexOf('let nfq2sha = caps.nfqws2Sha256'));
	assert.doesNotMatch(block, /Z2K_TLS_MOD/);
	assert.match(block, /\[\]/);
	assert.match(src, /artifactKind: candidate\.artifactKind/,
		'saved engine-state now carries its artifact identity');
	assert.match(src, /upstreamRepository: 'bol-van\/zapret2'/);
});

test('install_proof is requirement-driven and ok-gates only luaSmoke plus required caps', () => {
	const src = fs.readFileSync(PREFLIGHT, 'utf8');
	assert.match(src, /Z2M_REQUIRED_CAPABILITIES/);
	assert.match(src, /caps\.ok = caps\.luaSmoke;/);
	assert.match(src, /requiredCapabilities/);
	assert.doesNotMatch(src, /caps\.ok = caps\.Z2K_TLS_MOD && caps\.ANTIDPI_REPEATS_LOOP && caps\.AUTO_FAMILY_SPLIT/,
		'unconditional three-cap ok computation retired');
});
