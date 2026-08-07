// negative-controls.test.mjs — proves every gate can go RED.
//
// Each control:
//   1. copies tests/strategy/lib into a temp dir;
//   2. applies a realistic mutation (asserted to apply — a control that
//      cannot mutate is itself broken and fails loudly);
//   3. runs a probe against the MUTATED copy → MUST exit nonzero (RED);
//   4. runs the same probe against the ORIGINAL lib → MUST exit 0 (GREEN).
//
// Working files are never touched: mutations live in os.tmpdir() copies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB_DIR = fileURLToPath(new URL('./lib/', import.meta.url));
const LIB_FILES = readdirSync(LIB_DIR).filter((f) => f.endsWith('.mjs'));

function copyLib() {
	const dst = mkdtempSync(join(tmpdir(), 'z2m-neg-'));
	const libDst = join(dst, 'lib');
	mkdirSync(libDst, { recursive: true });
	for (const f of LIB_FILES) {
		writeFileSync(join(libDst, f), readFileSync(join(LIB_DIR, f), 'utf8'));
	}
	return { dst, libDst };
}

function mutate(libDst, file, find, replace) {
	const p = join(libDst, file);
	const src = readFileSync(p, 'utf8');
	assert.ok(src.includes(find), `CONTROL BROKEN: pattern not found in ${file}: ${find.slice(0, 80)}`);
	writeFileSync(p, src.replace(find, replace));
}

function runProbe(probeSrc) {
	const r = spawnSync(process.execPath, ['--input-type=module', '--eval', probeSrc], {
		encoding: 'utf8',
		timeout: 30000,
	});
	return r.status;
}

function libUrl(libDst, file) {
	return pathToFileURL(join(libDst, file)).href;
}

const controls = [];
function control(id, title, fn) {
	controls.push({ id, title, fn });
}

// ---------------------------------------------------------------------------
// A. Remove `--new=name` support → name-from-separator test goes red.
control('A', 'dropping --new=name support breaks naming', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'parse.mjs',
		`if (hasEquals) {
					current.nameRecords.push({ value, via: 'new', tokenIndex: token.index });
				}`,
		`if (hasEquals) {
					/* MUTATED: --new=name no longer names the profile */
				}`);
	const probe = (lib) => `
		import { parse } from '${lib}';
		const m = parse('--new=GamesTCP\\n--filter-tcp=443');
		if (m.profiles.length !== 1) throw new Error('profile count');
		if (m.profiles[0].name !== 'GamesTCP') throw new Error('name lost: ' + m.profiles[0].name);
		if (m.profiles[0].nameSource !== 'new') throw new Error('nameSource');
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'parse.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'parse.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// B. Reassemble the lua expression from catalog hints → byte round-trip red.
control('B', 'rebuilding lua-desync from hints breaks round-trip', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'parse.mjs',
		'raw: value,\n\t\toptionRaw,',
		"raw: value.split(':')[0], // MUTATED: expression rebuilt from hint\n\t\toptionRaw,");
	const probe = (libParse, libSer) => `
		import { parse } from '${libParse}';
		import { serializeCanonical, serializePreserve } from '${libSer}';
		const text = '--lua-desync=circular:fails=2:time=30:reset';
		const m = parse(text);
		if (m.profiles[0].luaDesync[0].raw !== 'circular:fails=2:time=30:reset') throw new Error('raw truncated');
		if (!serializeCanonical(m).text.includes('circular:fails=2:time=30:reset')) throw new Error('canonical lost fragments');
		if (serializePreserve(m).text !== text) throw new Error('preserve not byte-identical');
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'parse.mjs'), libUrl(libDst, 'serialize.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'parse.mjs'), libUrl(LIB_DIR, 'serialize.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// C. Make unknown method fatal → catalog-warning test goes red.
control('C', 'unknown-method-as-fatal breaks the warning contract', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'validate.mjs',
		"out.push(diag('warning', 'MANAGER_NOT_IN_CATALOG',",
		"out.push(diag('error', 'MANAGER_NOT_IN_CATALOG',");
	const probe = (libParse, libVal) => `
		import { parse } from '${libParse}';
		import { allDiagnostics, hasErrors } from '${libVal}';
		const ds = allDiagnostics(parse('--lua-desync=my_custom_orchestrator:x=1'));
		if (!ds.some((d) => d.code === 'MANAGER_NOT_IN_CATALOG')) throw new Error('warning missing');
		if (hasErrors(ds)) throw new Error('catalog warning became fatal');
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'parse.mjs'), libUrl(libDst, 'validate.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'parse.mjs'), libUrl(LIB_DIR, 'validate.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// D. Substitute v6 Lua into a v5 bundle → compatibility check goes red.
control('D', 'disabling the compat cross-check lets a mixed bundle through', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'native.mjs',
		'const compatOk = result.fixtureCompat !== null',
		'const compatOk = true || // MUTATED: compat cross-check disabled\n\t\tresult.fixtureCompat !== null');
	// tampered manifest: v6 evidence, but claims luaCompatVer=5
	const v6 = JSON.parse(readFileSync(join(LIB_DIR, '..', 'native-bundles', 'v6-legacy.json'), 'utf8'));
	v6.luaCompatVer = 5;
	const manifestJson = JSON.stringify(v6);
	const probe = (lib) => `
		import { loadBundle } from '${lib}';
		import { readFileSync } from 'node:fs';
		const manifest = JSON.parse(${JSON.stringify(manifestJson)});
		const r = loadBundle('x.json', {
			repoRoot: process.cwd(),
			readFile: (p) => p === 'x.json' ? ${JSON.stringify(manifestJson)} : readFileSync(p, 'utf8'),
		});
		if (r.sameLuaReleaseVerified !== false) throw new Error('mixed v5/v6 bundle verified');
		if (!r.diagnostics.some((d) => d.code === 'NATIVE_LUA_COMPAT_MISMATCH')) throw new Error('no mismatch diagnostic');
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'native.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'native.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// E. Lose an unknown option → round-trip goes red.
control('E', 'dropping unknown options breaks lossless transport', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'parse.mjs',
		'current.unknownOptions.push(baseEntry(',
		'/* MUTATED: unknown options dropped */ void(');
	const probe = (libParse, libSer) => `
		import { parse } from '${libParse}';
		import { serializePreserve } from '${libSer}';
		const text = '--dpi-desync-fooling=md5sig,badseq\\n--filter-tcp=443\\n';
		const m = parse(text);
		const out = serializePreserve(m);
		if (out.text !== text) throw new Error('unknown option lost from preserved text');
		if (out.diagnostics.some((d) => d.code === 'MANAGER_LOSSY_ROUNDTRIP')) throw new Error('lossy round-trip');
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'parse.mjs'), libUrl(libDst, 'serialize.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'parse.mjs'), libUrl(LIB_DIR, 'serialize.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// F. eval/Function/shell in the tokenizer → safety gate goes red.
const FORBIDDEN = [
	/\beval\s*\(/, /new\s+Function\s*\(/, /child_process/,
	/\bexecSync\b/, /\bspawnSync\b/, /\bspawn\s*\(/, /\bexecFile\b/,
];
function gateScan(dir) {
	const bad = [];
	for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
		const src = readFileSync(join(dir, f), 'utf8');
		for (const re of FORBIDDEN) {
			if (re.test(src)) bad.push(`${f}: ${re}`);
		}
	}
	return bad;
}

control('F', 'injecting eval into the tokenizer trips the safety gate', () => {
	// positive side first: the shipped lib is clean (mandatory check #19)
	assert.deepEqual(gateScan(LIB_DIR), [], 'strategy lib must never execute input');
	const { dst, libDst } = copyLib();
	mutate(libDst, 'tokenize.mjs',
		'export function tokenize(',
		'// MUTATED: eval("x") injected\nexport function tokenize(');
	const probe = (dir) => `
		import { readFileSync, readdirSync } from 'node:fs';
		import { join } from 'node:path';
		const FORBIDDEN = [${FORBIDDEN.map((r) => r.toString()).join(',')}];
		const bad = [];
		for (const f of readdirSync(${JSON.stringify(dir)}).filter((x) => x.endsWith('.mjs'))) {
			const src = readFileSync(join(${JSON.stringify(dir)}, f), 'utf8');
			for (const re of FORBIDDEN) if (re.test(src)) bad.push(f);
		}
		if (bad.length > 0) throw new Error('forbidden execution primitive found: ' + bad.join(','));
	`;
	assert.notEqual(runProbe(probe(libDst)), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(LIB_DIR)), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// G. Claim a check ran while the oracle is unavailable → goes red.
control('G', 'claiming coverage without an oracle run is caught', () => {
	const { dst, libDst } = copyLib();
	mutate(libDst, 'native.mjs',
		"rec.status = 'unavailable';",
		"rec.status = 'partial'; rec.coverage.cliSyntax = 'passed'; // MUTATED: faking a run");
	const probe = (libParse, libNat) => `
		import { parse } from '${libParse}';
		import { unavailableNativeValidation } from '${libNat}';
		const m = parse('--lua-desync=fake:blob=fake_default_tls');
		unavailableNativeValidation(m, null);
		const recs = [m.nativeValidation, ...m.profiles.flatMap((p) => p.luaDesync.map((e) => e.nativeValidation))];
		for (const rec of recs) {
			if (rec.status !== 'unavailable') throw new Error('unavailable masqueraded as ' + rec.status);
			if (Object.values(rec.coverage).includes('passed')) throw new Error('coverage passed without a run');
		}
	`;
	assert.notEqual(runProbe(probe(libUrl(libDst, 'parse.mjs'), libUrl(libDst, 'native.mjs'))), 0, 'mutated must be RED');
	assert.equal(runProbe(probe(libUrl(LIB_DIR, 'parse.mjs'), libUrl(LIB_DIR, 'native.mjs'))), 0, 'original must be GREEN');
	rmSync(dst, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
for (const c of controls) {
	test(`negative control ${c.id}: ${c.title}`, c.fn);
}

test('all 7 negative controls registered', () => {
	assert.equal(controls.length, 7);
});
