// corpus.mjs — corpus runner: a directory of strategy files → per-file
// results + aggregate summary. One file's failure never stops the others.
//
// CLI:  node tests/strategy/lib/corpus.mjs <dir> [--bundle=<manifest.json>]
// Lib:  runCorpus(dir, { bundle, readDir, readFile })
//
// The runner performs MANAGER-level checks only (tokenize → parse → preserve
// round-trip → manager diagnostics). Native validation is reported as
// recorded in the model (default: not_checked) — the runner never claims
// native verdicts without a native oracle result.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from './parse.mjs';
import { serializePreserve } from './serialize.mjs';
import { allDiagnostics, hasErrors } from './validate.mjs';
import { loadBundle, validateBundleForTarget } from './native.mjs';
import { TARGET_LUA_COMPAT_VER } from './catalog.mjs';

export function runCorpus(dir, { bundle = null, readDir, readFile } = {}) {
	const ls = readDir ?? ((d) => readdirSync(d));
	const read = readFile ?? ((p) => readFileSync(p, 'utf8'));

	const bundleDiags = [];
	if (bundle) {
		bundleDiags.push(...validateBundleForTarget(bundle, TARGET_LUA_COMPAT_VER));
	}

	const files = [];
	const totals = {
		files: 0,
		profiles: 0,
		managerParseSuccess: 0,
		managerParseFailure: 0,
		preserveRoundtripSuccess: 0,
		preserveRoundtripFailure: 0,
		catalogWarnings: 0,
		nativePartial: 0,
		nativeRejected: 0,
		nativeUnavailable: 0,
		nativeNotChecked: 0,
		bundleMismatches: bundleDiags.length,
		diagnosticsByCode: {},
	};

	const names = ls(dir).filter((f) => typeof f === 'string' && f.endsWith('.txt')).sort();

	for (const name of names) {
		totals.files++;
		const filePath = join(dir, name);
		const rec = {
			file: basename(name),
			profiles: 0,
			managerParse: 'failure',
			preserveRoundtrip: false,
			errors: 0,
			warnings: 0,
			diagnosticCodes: [],
			catalogWarnings: 0,
			nativeStatus: 'not_checked',
			error: null,
		};
		try {
			const text = read(filePath);
			const model = parse(text, { source: rec.file });
			const diags = [...allDiagnostics(model), ...bundleDiags];
			rec.profiles = model.profiles.length;
			rec.errors = diags.filter((d) => d.severity === 'error').length;
			rec.warnings = diags.filter((d) => d.severity === 'warning').length;
			rec.diagnosticCodes = [...new Set(diags.map((d) => d.code))].sort();
			rec.catalogWarnings = diags.filter((d) => d.code === 'MANAGER_NOT_IN_CATALOG').length;
			rec.managerParse = hasErrors(diags) ? 'partial' : 'success';

			const pres = serializePreserve(model);
			rec.preserveRoundtrip = pres.text === text
				&& !pres.diagnostics.some((d) => d.code === 'MANAGER_LOSSY_ROUNDTRIP');

			const first = model.profiles.flatMap((p) => p.luaDesync)[0];
			rec.nativeStatus = first ? first.nativeValidation.status : 'not_checked';

			totals.profiles += rec.profiles;
			if (rec.managerParse === 'success') totals.managerParseSuccess++;
			else totals.managerParseFailure++;
			if (rec.preserveRoundtrip) totals.preserveRoundtripSuccess++;
			else totals.preserveRoundtripFailure++;
			totals.catalogWarnings += rec.catalogWarnings;
			if (rec.nativeStatus === 'partial') totals.nativePartial++;
			else if (rec.nativeStatus === 'rejected') totals.nativeRejected++;
			else if (rec.nativeStatus === 'unavailable') totals.nativeUnavailable++;
			else totals.nativeNotChecked++;
			for (const c of rec.diagnosticCodes) {
				totals.diagnosticsByCode[c] = (totals.diagnosticsByCode[c] ?? 0) + 1;
			}
		} catch (err) {
			rec.error = String(err && err.message ? err.message : err);
			totals.managerParseFailure++;
			totals.preserveRoundtripFailure++;
		}
		files.push(rec);
	}

	return { files, totals, bundle: bundle ? { id: bundle.id, luaCompatVer: bundle.luaCompatVer } : null };
}

// CLI entry: node corpus.mjs <dir> [--bundle=<path>]
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
	const args = process.argv.slice(2);
	const dir = args.find((a) => !a.startsWith('--'));
	const bundleArg = args.find((a) => a.startsWith('--bundle='));
	let bundle = null;
	if (bundleArg) {
		const { bundle: b } = loadBundle(bundleArg.slice('--bundle='.length), { repoRoot: process.cwd() });
		bundle = b;
	}
	if (!dir) {
		console.error('usage: node corpus.mjs <dir> [--bundle=<manifest.json>]');
		process.exit(2);
	}
	const result = runCorpus(dir, { bundle });
	console.log(JSON.stringify(result.totals, null, 2));
}
