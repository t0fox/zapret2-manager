import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Task 5/6/7 — stock Engine authority contract:
//   * official bol-van releases are FIRST-CLASS installable candidates
//     (requirement-based compatibility: zero mandatory native deltas);
//   * legacy z2m-compatible builds remain visible during migration but are
//     normalized as legacy-compatibility-build truth (never "official");
//   * update availability is computed against upstream releases only and a
//     legacy build ALWAYS reports update-available;
//   * state records are normalized without rewriting stored bytes.
//
// Commit boundaries note: the z2m-compatible feed still exists until the
// post-cutover producer retirement; nothing here depends on it for stock
// installability.

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

// ---------------------------------------------------------------- normalize

test('ENGINE C matrix — legacy r77-z2m build normalizes to legacy-compatibility-build', () => {
	const saved = {
		schema: 'engine-state.v2',
		installedOrigin: 'OFFICIAL',
		installedRelease: 'r77-z2m-202608232258',
		baseCommit: 'a0be7cbb40a4230e4b60fc33b7ea06102eb8ec15',
		patchSeries: [
			{ id: '001-z2k-tls-mod', sha256: 'a'.repeat(64) },
			{ id: '002-z2k-antidpi-repeats-loop', sha256: 'b'.repeat(64) },
			{ id: '003-z2k-auto-family-split', sha256: 'c'.repeat(64) },
		],
	};
	const truth = invoke('normalize_state_record', JSON.stringify(saved));
	assert.equal(truth.schema, 'engine-truth.v1');
	assert.equal(truth.artifactKind, 'legacy-compatibility-build');
	assert.equal(truth.producer, 'zapret2-manager');
	assert.equal(truth.artifactVersion, 'r77-z2m-202608232258');
	assert.equal(truth.upstreamRepository, 'bol-van/zapret2');
	assert.equal(truth.baseCommit, 'a0be7cbb40a4230e4b60fc33b7ea06102eb8ec15');
	assert.equal(truth.upstreamRelease, null,
		'a build id must never be reported as an upstream release');
});

test('ENGINE A/B matrix — canonical vanilla state keeps true upstream identity', () => {
	const saved = {
		schema: 'engine-state.v2',
		installedOrigin: 'OFFICIAL',
		artifactKind: 'vanilla-bol-van-release',
		installedRelease: 'v1.0.4',
		upstreamRepository: 'bol-van/zapret2',
		patchSeries: [],
	};
	const truth = invoke('normalize_state_record', JSON.stringify(saved));
	assert.equal(truth.artifactKind, 'vanilla-bol-van-release');
	assert.equal(truth.producer, null);
	assert.equal(truth.upstreamRelease, 'v1.0.4');
	assert.equal(truth.artifactVersion, 'v1.0.4');

	// without explicit kind marker there is NO proven upstream identity
	const ambiguous = invoke('normalize_state_record', JSON.stringify({
		schema: 'engine-state.v2', installedOrigin: 'OFFICIAL',
		installedRelease: 'some-custom-string', patchSeries: [],
	}));
	assert.equal(ambiguous.artifactKind, null);
	assert.equal(ambiguous.upstreamRelease, null);
});

test('update_required semantics cover ENGINE A/B/C', () => {
	assert.equal(invoke('update_required', `null,false,null`), false);
	assert.equal(invoke('update_required', `'v1.0.4',false,'1.0.5'`), true, 'ENGINE B: newer stock available');
	assert.equal(invoke('update_required', `'v1.0.4',false,'1.0.4'`), false, 'ENGINE A: current');
	assert.equal(invoke('update_required', `'r77-z2m-202608232258',true,'1.0.4'`), true, 'ENGINE C: legacy always migrates');
	assert.equal(invoke('update_required', `null,true,null`), false);
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

test('merged_candidates prefers official upstream releases over legacy feed entries', () => {
	const src = fs.readFileSync(MODULE, 'utf8');
	const fn = src.slice(src.indexOf('// Canonical ordering'), src.indexOf('export const engine_releases ='));
	assert.ok(fn.length > 100 && fn.includes('releases'), 'ordering comment + code present');
	assert.match(fn, /for \(let i = 0; i < length\(result\.releases \|\| \[\]\); i\+\+\)/,
		'upstream first');
	const relIdx = fn.indexOf('result.releases || []');
	const z2mIdx = fn.indexOf('result.z2mReleases || []');
	assert.ok(relIdx !== -1 && z2mIdx !== -1 && relIdx < z2mIdx,
		'vanilla list must be pushed before the legacy z2m list');
});

test('load_checked_candidate accepts both canonical artifact kinds only', () => {
	const src = fs.readFileSync(MODULE, 'utf8');
	const fn = src.slice(src.indexOf('export const load_checked_candidate ='),
		src.indexOf('export const save_engine_state ='));
	assert.match(fn, /VANILLA_ARTIFACT/);
	assert.match(fn, /Z2M_ENGINE_ARTIFACT/);
	assert.match(fn, /compatible !== true/);
});

// -------------------------------------------------------------- worker pins

test('worker preflight gate admits vanilla + legacy kinds, never others', () => {
	const src = fs.readFileSync(WORKER, 'utf8');
	const idx = src.indexOf("ARTIFACT_SCHEMA\" = 'zapret2-manager.engine-artifact.v1'");
	const block = src.slice(idx - 200, idx + 400);
	assert.match(block, /'z2m-compatible-engine'/);
	assert.match(block, /'vanilla-bol-van-release'/);
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
