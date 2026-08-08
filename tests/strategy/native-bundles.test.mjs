// native-bundles.test.mjs — bundle evidence verification, coverage-aware
// native results, document/expression scoping, trusted-Lua policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from './lib/parse.mjs';
import {
	loadBundle, validateBundleForTarget,
	buildNativeValidationPlan, applyNativeResult, unavailableNativeValidation,
	NATIVE_ENTRY_POINTS, DEFAULT_LUA_POLICY,
	makeNativeValidationShell, computeEvidenceHash,
} from './lib/native.mjs';
import { TARGET_LUA_COMPAT_VER } from './lib/catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLES = join(REPO_ROOT, 'tests', 'strategy', 'native-bundles');
const loadV5 = () => loadBundle(join(BUNDLES, 'v5-target.json'), { repoRoot: REPO_ROOT });
const loadV6 = () => loadBundle(join(BUNDLES, 'v6-legacy.json'), { repoRoot: REPO_ROOT });

// ---------------------------------------------------------------------------
// Bundle evidence verification.
// ---------------------------------------------------------------------------

test('v5 bundle: Lua hashes verified; binary hash NOT claimed; sameReleaseProven stays false', () => {
	const r = loadV5();
	assert.equal(r.sameLuaReleaseVerified, true, JSON.stringify(r.diagnostics));
	assert.equal(r.usable, true);
	assert.equal(r.binaryHashVerified, false); // no binarySha256 on record
	assert.equal(r.sameReleaseProven, false);  // never absolute without binary hash
	assert.equal(r.binaryCommitSelfReported, 'd3b3011000f103c5af161cc4e3167e80fd6928a2');
	assert.equal(r.bundleConfidence, 'high');
	assert.equal(r.fixtureCompat, 5);
});

test('v6 legacy bundle: Lua hashes verified vs pinned commit; same-release still unproven', () => {
	const r = loadV6();
	assert.equal(r.sameLuaReleaseVerified, true, JSON.stringify(r.diagnostics));
	assert.equal(r.sameReleaseProven, false);
	assert.equal(r.binaryCommitSelfReported, null);
	assert.equal(r.bundleConfidence, 'medium');
	assert.equal(r.fixtureCompat, 6);
});

// Mandatory check #15: legacy v6 and target v5 are never mixed.
test('v6 bundle against v5 target → NATIVE_BINARY_LUA_MISMATCH', () => {
	const { bundle } = loadV6();
	const ds = validateBundleForTarget(bundle, TARGET_LUA_COMPAT_VER);
	assert.ok(ds.some((d) => d.code === 'NATIVE_BINARY_LUA_MISMATCH'));
	assert.equal(validateBundleForTarget(loadV5().bundle, TARGET_LUA_COMPAT_VER).length, 0);
});

// Mandatory check #16: bundle without a Lua fixture → unavailable.
test('bundle with luaContentsFixture=null → unusable, NATIVE_UNAVAILABLE', () => {
	const dir = join(BUNDLES, '_synthetic.json');
	const manifest = { id: 'synthetic-no-lua', luaCompatVer: 5, luaContentsFixture: null };
	const r = loadBundle(dir, {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === dir ? JSON.stringify(manifest) : readFileSync(p, 'utf8'),
	});
	assert.equal(r.usable, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE'));
});

// Mandatory check #17: co-location never becomes verification.
test('fixtures present but no verifiable evidence → NOT verified', () => {
	const manifest = {
		id: 'synthetic-colocated', luaCompatVer: 5,
		luaContentsFixture: 'tests/fixtures-postinstall/opt-zapret2-lua-contents.out',
	};
	const r = loadBundle('x.json', {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === 'x.json' ? JSON.stringify(manifest) : readFileSync(p, 'utf8'),
	});
	assert.equal(r.sameLuaReleaseVerified, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_BUNDLE_EVIDENCE_MISMATCH'));
});

// Negative control: one mutated byte in the Lua fixture breaks verification.
test('1-byte Lua fixture mutation → hash mismatch → not verified', () => {
	const real = readFileSync(join(REPO_ROOT, 'tests/fixtures-postinstall/opt-zapret2-lua-contents.out'), 'utf8');
	const mutated = real.replace('NFQWS2_COMPAT_VER_REQUIRED=5', 'NFQWS2_COMPAT_VER_REQUIRED=5\0'); // 1 char added
	const manifest = JSON.parse(readFileSync(join(BUNDLES, 'v5-target.json'), 'utf8'));
	const r = loadBundle('x.json', {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === 'x.json' ? JSON.stringify(manifest) : mutated,
	});
	assert.equal(r.sameLuaReleaseVerified, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_BUNDLE_EVIDENCE_MISMATCH' && d.message.includes('zapret-lib.lua')));
});

// Negative control: editing the recorded commit breaks evidenceHash.
test('commit mismatch in manifest → evidence tamper detected', () => {
	const manifest = JSON.parse(readFileSync(join(BUNDLES, 'v5-target.json'), 'utf8'));
	manifest.sameReleaseEvidence.upstreamCommit = '8a0f53f3cf2c92ddeaa66995ee63a35c1210c410'; // tampered
	const r = loadBundle('x.json', {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === 'x.json' ? JSON.stringify(manifest) : readFileSync(p, 'utf8'),
	});
	assert.equal(r.sameLuaReleaseVerified, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_BUNDLE_EVIDENCE_MISMATCH' && d.message.includes('tampered')));
});

// Negative control: matching compat never substitutes a hash match.
test('compat match with wrong file hashes → NOT verified', () => {
	const manifest = JSON.parse(readFileSync(join(BUNDLES, 'v5-target.json'), 'utf8'));
	const files = { ...manifest.sameReleaseEvidence.files };
	files['zapret-lib.lua'] = '0'.repeat(64); // wrong hash
	manifest.sameReleaseEvidence.files = files;
	// re-seal the evidence so evidenceHash matches the tampered content —
	// this isolates the per-file fixture check as the failing layer
	manifest.sameReleaseEvidence.evidenceHash = computeEvidenceHash(manifest.sameReleaseEvidence);
	const r = loadBundle('x.json', {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === 'x.json' ? JSON.stringify(manifest) : readFileSync(p, 'utf8'),
	});
	assert.equal(r.fixtureCompat, 5); // compat DOES match…
	assert.equal(r.sameLuaReleaseVerified, false); // …but hash does not → not verified
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_BUNDLE_EVIDENCE_MISMATCH'));
});

// Compat chain: manifest claiming 5 against a v6 bundle → mismatch.
test('manifest luaCompatVer=5 over v6 evidence → NATIVE_LUA_COMPAT_MISMATCH', () => {
	const manifest = JSON.parse(readFileSync(join(BUNDLES, 'v6-legacy.json'), 'utf8'));
	manifest.luaCompatVer = 5; // lie
	const r = loadBundle('x.json', {
		repoRoot: REPO_ROOT,
		readFile: (p) => p === 'x.json' ? JSON.stringify(manifest) : readFileSync(p, 'utf8'),
	});
	assert.equal(r.sameLuaReleaseVerified, false);
	assert.ok(r.diagnostics.some((d) => d.code === 'NATIVE_LUA_COMPAT_MISMATCH'));
});

// ---------------------------------------------------------------------------
// Entry points table.
// ---------------------------------------------------------------------------

test('entry points: dry-run safe for untrusted; intercept-zero gated; fuzz excluded', () => {
	const dry = NATIVE_ENTRY_POINTS.find((e) => e.id === 'dry-run');
	assert.match(dry.safe, /untrusted/i);
	assert.equal(dry.loadsLua, false);
	const iz = NATIVE_ENTRY_POINTS.find((e) => e.id === 'intercept-zero');
	assert.match(iz.safe, /trusted immutable NativeBundle/i);
	assert.match(iz.safe, /unsafe for untrusted/i);
	assert.deepEqual(iz.coverage, ['cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence']);
	assert.equal(NATIVE_ENTRY_POINTS.find((e) => e.id === 'fuzz').excluded, true);
});

// ---------------------------------------------------------------------------
// buildNativeValidationPlan: dry-run + trusted-Lua policy.
// ---------------------------------------------------------------------------

test('dry-run plan: argv only, safe for untrusted options', () => {
	const m = parse('--filter-tcp=443\n--lua-desync=fake:blob=fake_default_tls');
	const r = buildNativeValidationPlan(m, null, { mode: 'dry-run' });
	assert.equal(r.refused, false);
	assert.deepEqual(r.plan.args, ['--dry-run', '--filter-tcp=443', '--lua-desync=fake:blob=fake_default_tls']);
	assert.match(r.plan.safety, /no Lua/);
});

test('intercept-zero: DEFAULT policy REFUSES (executes Lua init code)', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	const r = buildNativeValidationPlan(m, loadV5().bundle, { mode: 'intercept-zero' });
	assert.equal(r.refused, true);
	assert.equal(r.plan, null);
	assert.equal(r.validation.status, 'unavailable');
	assert.ok(r.validation.diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE'));
});

// Negative control: --lua-init=@/tmp/evil.lua never reaches argv.
test('untrusted candidate lua-init (@/tmp/evil.lua) → UNTRUSTED refusal, never in argv', () => {
	const m = parse('--lua-init=@/tmp/evil.lua\n--lua-desync=fake:blob=fake_default_tls');
	const { bundle } = loadV5();
	const policy = { allowTrustedLuaExecution: true, trustedLuaInitPaths: bundle.trustedLuaInitPaths };
	const r = buildNativeValidationPlan(m, bundle, { mode: 'intercept-zero', policy });
	assert.equal(r.refused, true);
	assert.equal(r.plan, null);
	assert.ok(r.validation.diagnostics.some((d) => d.code === 'UNTRUSTED_LUA_INIT_REQUIRES_SANDBOX' && d.message.includes('/tmp/evil.lua')));
});

test('inline candidate lua-init → UNTRUSTED refusal', () => {
	const m = parse('--lua-init=print(1)\n--lua-desync=fake:blob=fake_default_tls');
	const { bundle } = loadV5();
	const policy = { allowTrustedLuaExecution: true, trustedLuaInitPaths: bundle.trustedLuaInitPaths };
	const r = buildNativeValidationPlan(m, bundle, { mode: 'intercept-zero', policy });
	assert.equal(r.refused, true);
	assert.ok(r.validation.diagnostics.some((d) => d.code === 'UNTRUSTED_LUA_INIT_REQUIRES_SANDBOX'));
});

test('allowed run: argv uses ONLY bundle trusted lua-init; candidate trusted paths recorded, not forwarded', () => {
	const m = parse('--lua-init=@/opt/zapret2/lua/zapret-lib.lua\n--lua-desync=fake:blob=fake_default_tls');
	const { bundle } = loadV5();
	const policy = { allowTrustedLuaExecution: true, trustedLuaInitPaths: bundle.trustedLuaInitPaths };
	const r = buildNativeValidationPlan(m, bundle, { mode: 'intercept-zero', policy });
	assert.equal(r.refused, false, JSON.stringify(r.validation));
	const args = r.plan.args;
	assert.equal(args[0], '--intercept=0');
	// exactly the trusted set, no candidate as-is, no /tmp, no duplicates beyond bundle set
	const luaInitArgs = args.filter((a) => a.startsWith('--lua-init='));
	assert.equal(luaInitArgs.length, bundle.trustedLuaInitPaths.length);
	for (const a of luaInitArgs) {
		assert.ok(bundle.trustedLuaInitPaths.includes(a.slice('--lua-init=@'.length)));
	}
	assert.ok(!args.some((a) => a.includes('/tmp/')));
	assert.equal(r.plan.luaInit.candidatePaths[0], '/opt/zapret2/lua/zapret-lib.lua');
});

test('policy allowlist narrower than bundle set → refusal', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	const { bundle } = loadV5();
	const policy = { allowTrustedLuaExecution: true, trustedLuaInitPaths: [bundle.trustedLuaInitPaths[0]] };
	const r = buildNativeValidationPlan(m, bundle, { mode: 'intercept-zero', policy });
	assert.equal(r.refused, true);
});

// ---------------------------------------------------------------------------
// applyNativeResult: coverage-aware, document vs expression scoping.
// ---------------------------------------------------------------------------

test('dry-run exit 0 → partial; ONLY cliSyntax passed; the word valid never appears', () => {
	const m = parse('--lua-desync=totally_custom_fn:z=1');
	const r = applyNativeResult(m, null, { exitCode: 0, stderr: '', mode: 'dry-run' });
	assert.equal(r.accepted, true);
	const doc = m.nativeValidation;
	assert.equal(doc.status, 'partial');
	assert.equal(doc.entryPoint, 'dry-run');
	assert.equal(doc.coverage.cliSyntax, 'passed');
	assert.equal(doc.coverage.functionExistence, 'not_checked');
	assert.equal(doc.coverage.luaLoad, 'not_checked');
	assert.notEqual(doc.status, 'valid');
	// expression level: partial, cliSyntax only — custom fn is NOT function-proven
	const e = m.profiles[0].luaDesync[0].nativeValidation;
	assert.equal(e.status, 'partial');
	assert.equal(e.coverage.cliSyntax, 'passed');
	assert.equal(e.coverage.functionExistence, 'not_checked');
});

// Negative control: nonexistent function + dry-run exit 0 ≠ function-valid.
test('nonexistent function passes dry-run with functionExistence NOT checked (never passed)', () => {
	const m = parse('--lua-desync=zzz_nonexistent_desync:pos=2');
	applyNativeResult(m, null, { exitCode: 0, stderr: '', mode: 'dry-run' });
	const e = m.profiles[0].luaDesync[0].nativeValidation;
	assert.equal(e.status, 'partial');
	assert.notEqual(e.coverage.functionExistence, 'passed');
	assert.notEqual(e.status, 'valid');
});

test('intercept-zero exit 0 → partial with 4 coverage fields passed; runtime never covered', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	applyNativeResult(m, loadV5().bundle, { exitCode: 0, stderr: '', mode: 'intercept-zero' });
	const doc = m.nativeValidation;
	assert.equal(doc.status, 'partial');
	assert.equal(doc.coverage.cliSyntax, 'passed');
	assert.equal(doc.coverage.luaLoad, 'passed');
	assert.equal(doc.coverage.luaCompatibility, 'passed');
	assert.equal(doc.coverage.functionExistence, 'passed');
	assert.equal(doc.coverage.runtimeArguments, 'not_checked');
	assert.equal(doc.coverage.executionPlan, 'not_checked');
	assert.notEqual(doc.status, 'valid');
});

// Mandatory: document vs expression scoping fixture.
test('3 expressions, one unknown: only it is rejected; others stay not_checked; doc is rejected', () => {
	const m = parse([
		'--lua-desync=fake:blob=fake_default_tls',
		'--lua-desync=zzz_nonexistent_desync:pos=2',
		'--lua-desync=multisplit:pos=2:seqovl=681',
	].join('\n'));
	const r = applyNativeResult(m, loadV5().bundle, {
		exitCode: 1,
		stderr: "desync function 'zzz_nonexistent_desync' does not exist\n",
		mode: 'intercept-zero',
	});
	assert.equal(r.accepted, false);
	const doc = m.nativeValidation;
	assert.equal(doc.status, 'rejected');
	assert.equal(doc.coverage.functionExistence, 'failed');
	assert.equal(doc.coverage.cliSyntax, 'passed');
	const [a, b, c] = m.profiles[0].luaDesync.map((e) => e.nativeValidation);
	assert.equal(b.status, 'rejected');
	assert.equal(b.coverage.functionExistence, 'failed');
	assert.ok(b.diagnostics.some((d) => d.code === 'NATIVE_FUNCTION_NOT_FOUND'));
	// the other two are NOT dragged down
	assert.equal(a.status, 'not_checked');
	assert.equal(c.status, 'not_checked');
	// and their raw expressions are untouched
	assert.equal(m.profiles[0].luaDesync[0].raw, 'fake:blob=fake_default_tls');
});

test('CLI-level rejection → document rejected, cliSyntax failed, expressions untouched', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	applyNativeResult(m, null, { exitCode: 1, stderr: 'invalid packet range value : !!!bad\n', mode: 'dry-run' });
	const doc = m.nativeValidation;
	assert.equal(doc.status, 'rejected');
	assert.equal(doc.coverage.cliSyntax, 'failed');
	assert.ok(doc.diagnostics.some((d) => d.code === 'NATIVE_REJECTED'));
	assert.equal(m.profiles[0].luaDesync[0].nativeValidation.status, 'not_checked');
});

test('compat rejection → document rejected, luaLoad + luaCompatibility failed', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	applyNativeResult(m, null, { exitCode: 1, stderr: 'LUA ERROR: Incompatible NFQWS2_COMPAT_VER. Use pktws and lua scripts from the same release !', mode: 'intercept-zero' });
	const doc = m.nativeValidation;
	assert.equal(doc.coverage.luaLoad, 'failed');
	assert.equal(doc.coverage.luaCompatibility, 'failed');
	assert.equal(doc.coverage.functionExistence, 'not_checked');
	assert.ok(doc.diagnostics.some((d) => d.code === 'NATIVE_LUA_COMPAT_MISMATCH'));
});

test('applyNativeResult refuses to run without an actual result object', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls');
	assert.throws(() => applyNativeResult(m, null, null));
	assert.throws(() => applyNativeResult(m, null, { stderr: '' }));
	assert.equal(m.nativeValidation.status, 'not_checked');
});

// Mandatory: unavailable never masquerades as a run result.
test('unavailableNativeValidation: unavailable everywhere, zero passed coverage', () => {
	const m = parse('--lua-desync=fake:blob=fake_default_tls\n--lua-desync=multisplit:pos=2');
	unavailableNativeValidation(m, null);
	const check = (rec) => {
		assert.equal(rec.status, 'unavailable');
		assert.ok(!Object.values(rec.coverage).includes('passed'));
		assert.ok(rec.diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE'));
	};
	check(m.nativeValidation);
	for (const p of m.profiles) for (const e of p.luaDesync) check(e.nativeValidation);
});

test('validation vocabulary has no valid: shells start not_checked with entryPoint null', () => {
	const s = makeNativeValidationShell();
	assert.equal(s.status, 'not_checked');
	assert.equal(s.entryPoint, null);
	assert.deepEqual(Object.keys(s.coverage).sort(), ['cliSyntax', 'executionPlan', 'functionExistence', 'luaCompatibility', 'luaLoad', 'runtimeArguments'].sort());
});

test('DEFAULT_LUA_POLICY is locked off', () => {
	assert.equal(DEFAULT_LUA_POLICY.allowTrustedLuaExecution, false);
	assert.deepEqual(DEFAULT_LUA_POLICY.trustedLuaInitPaths, []);
});
