// native-bundles.test.mjs — bundle manifests, consistency, oracle adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from './lib/parse.mjs';
import {
	loadBundle, checkBundleConsistency, validateBundleForTarget,
	buildNativeValidationPlan, applyNativeResult, unavailableNativeValidation,
	NATIVE_ENTRY_POINTS,
} from './lib/native.mjs';
import { TARGET_LUA_COMPAT_VER } from './lib/catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLES = join(REPO_ROOT, 'tests', 'strategy', 'native-bundles');

test('v5 target bundle: loads, usable, sameReleaseProven with hash evidence', () => {
	const { bundle, usable, diagnostics } = loadBundle(join(BUNDLES, 'v5-target.json'), { repoRoot: REPO_ROOT });
	assert.equal(usable, true, JSON.stringify(diagnostics));
	assert.equal(bundle.luaCompatVer, 5);
	assert.equal(bundle.sameReleaseProven, true);
	// proven=true is backed by byte-exact evidence, not co-location
	assert.equal(bundle.sameReleaseEvidence.luaFileMatches['zapret-lib.lua'], 'byte-exact');
	assert.equal(bundle.binaryCommit, 'd3b3011000f103c5af161cc4e3167e80fd6928a2');
});

test('v6 legacy bundle: loads but is marked legacy, sameReleaseProven false', () => {
	const { bundle, usable } = loadBundle(join(BUNDLES, 'v6-legacy.json'), { repoRoot: REPO_ROOT });
	assert.equal(bundle.luaCompatVer, 6);
	assert.equal(bundle.role, 'legacy');
	assert.equal(bundle.sameReleaseProven, false);
	assert.equal(bundle.binaryCommit, null);
	// still internally consistent (fixture really requires 6)
	assert.equal(usable, true);
});

// Mandatory check #15: legacy v6 and target v5 are never mixed.
test('v6 bundle against v5 target → NATIVE_BINARY_LUA_MISMATCH', () => {
	const { bundle } = loadBundle(join(BUNDLES, 'v6-legacy.json'), { repoRoot: REPO_ROOT });
	const ds = validateBundleForTarget(bundle, TARGET_LUA_COMPAT_VER);
	assert.ok(ds.some((d) => d.code === 'NATIVE_BINARY_LUA_MISMATCH'));
	const { bundle: v5 } = loadBundle(join(BUNDLES, 'v5-target.json'), { repoRoot: REPO_ROOT });
	assert.equal(validateBundleForTarget(v5, TARGET_LUA_COMPAT_VER).length, 0);
});

// Mandatory check #16: bundle without a Lua fixture → native unavailable.
test('bundle with luaContentsFixture=null → unusable, NATIVE_UNAVAILABLE', () => {
	const manifest = {
		id: 'synthetic-no-lua', luaCompatVer: 5,
		binaryVersionFixture: null, luaContentsFixture: null,
	};
	const r = checkBundleConsistency(manifest, { readFile: () => { throw new Error('should not be called'); } });
	assert.equal(r.consistent, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE'));
});

// Mandatory check #17: co-location never flips sameReleaseProven to true.
test('co-located fixtures without evidence do NOT become sameReleaseProven', () => {
	// A synthetic manifest claiming nothing: loader must not "upgrade" it.
	const manifest = {
		id: 'synthetic-colocated', luaCompatVer: 5,
		luaContentsFixture: 'tests/fixtures-postinstall/opt-zapret2-lua-contents.out',
		sameReleaseProven: false,
	};
	const r = checkBundleConsistency(manifest);
	assert.equal(r.consistent, true); // compat matches (5 = 5)
	assert.equal(manifest.sameReleaseProven, false); // untouched by the loader
});

// Negative-control-D probe (positive side): a manifest mixing v5 id with the
// v6 legacy Lua fixture MUST be caught by the consistency cross-check.
test('mixing v5 manifest with v6 Lua fixture → NATIVE_LUA_COMPAT_MISMATCH', () => {
	const mixed = {
		id: 'mixed-evil', luaCompatVer: 5,
		luaContentsFixture: 'tests/fixtures/opt-zapret2-lua-contents.out', // v6!
	};
	const r = checkBundleConsistency(mixed, {
		readFile: (p) => {
			if (p.includes('opt-zapret2-lua-contents')) return 'NFQWS2_COMPAT_VER_REQUIRED=6\nif NFQWS2_COMPAT_VER~=NFQWS2_COMPAT_VER_REQUIRED then';
			throw new Error('nope');
		},
	});
	assert.equal(r.consistent, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_LUA_COMPAT_MISMATCH'));
});

test('safe native entry points table: dry-run and intercept=0 proven; fuzz excluded', () => {
	const dry = NATIVE_ENTRY_POINTS.find((e) => e.id === 'dry-run');
	assert.equal(dry.safe, true);
	assert.equal(dry.sendsTraffic, false);
	assert.equal(dry.bindsNfqueue, false);
	assert.equal(dry.loadsLua, false);
	const iz = NATIVE_ENTRY_POINTS.find((e) => e.id === 'intercept-zero');
	assert.equal(iz.sendsTraffic, false);
	assert.equal(iz.bindsNfqueue, false);
	assert.equal(iz.loadsLua, true);
	assert.ok(iz.coverage.some((c) => c.includes('function-existence')));
	const fuzz = NATIVE_ENTRY_POINTS.find((e) => e.id === 'fuzz');
	assert.equal(fuzz.excluded, true);
});

test('buildNativeValidationPlan produces argv (never a shell string)', () => {
	const m = parse('--filter-tcp=443\n--lua-desync=fake:blob=fake_default_tls');
	const plan = buildNativeValidationPlan(m, null, { mode: 'dry-run' });
	assert.equal(plan.command, '/opt/zapret2/nfq2/nfqws2');
	assert.deepEqual(plan.args, ['--dry-run', '--filter-tcp=443', '--lua-desync=fake:blob=fake_default_tls']);
	assert.ok(Array.isArray(plan.args));
	assert.match(plan.safety, /no shell/);
});

// Mandatory: native accepted → valid regardless of manager catalog.
test('applyNativeResult(exit 0) marks expressions valid even when NOT in catalog', () => {
	const m = parse('--lua-desync=totally_custom_fn:z=1');
	const { bundle } = loadBundle(join(BUNDLES, 'v5-target.json'), { repoRoot: REPO_ROOT });
	const r = applyNativeResult(m, bundle, { exitCode: 0, stderr: '' });
	assert.equal(r.accepted, true);
	assert.equal(m.profiles[0].luaDesync[0].nativeValidation.status, 'valid');
	assert.equal(m.profiles[0].luaDesync[0].nativeValidation.luaCompatVer, 5);
});

test('applyNativeResult: function-not-found maps to NATIVE_FUNCTION_NOT_FOUND', () => {
	const m = parse('--lua-desync=zzz_nonexistent_desync:pos=2');
	const r = applyNativeResult(m, null, { exitCode: 1, stderr: "desync function 'zzz_nonexistent_desync' does not exist\n" });
	assert.equal(r.accepted, false);
	assert.equal(m.profiles[0].luaDesync[0].nativeValidation.status, 'invalid');
	assert.equal(r.diagnostics[0].code, 'NATIVE_FUNCTION_NOT_FOUND');
	// the raw expression is untouched by the verdict
	assert.equal(m.profiles[0].luaDesync[0].raw, 'zzz_nonexistent_desync:pos=2');
});

test('applyNativeResult: compat error maps to NATIVE_LUA_COMPAT_MISMATCH', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	const r = applyNativeResult(m, null, { exitCode: 1, stderr: 'LUA ERROR: Incompatible NFQWS2_COMPAT_VER. Use pktws and lua scripts from the same release !' });
	assert.equal(r.diagnostics[0].code, 'NATIVE_LUA_COMPAT_MISMATCH');
});

// Mandatory: without an oracle result, nothing may claim native-valid.
test('unavailableNativeValidation marks unavailable — never valid', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls\n--lua-desync=multisplit:pos=2');
	const n = unavailableNativeValidation(m, null);
	assert.equal(n, 2);
	for (const p of m.profiles) {
		for (const e of p.luaDesync) {
			assert.equal(e.nativeValidation.status, 'unavailable');
			assert.ok(e.nativeValidation.diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE'));
		}
	}
});

test('applyNativeResult refuses to run without an actual result object', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	assert.throws(() => applyNativeResult(m, null, null));
	assert.throws(() => applyNativeResult(m, null, { stderr: '' }));
	// and the model was not upgraded to valid by the attempts
	assert.equal(m.profiles[0].luaDesync[0].nativeValidation.status, 'not_checked');
});
