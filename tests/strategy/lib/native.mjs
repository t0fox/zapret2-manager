// native.mjs — native bundle manifests + native validation adapter.
//
// NATIVE VALIDATION BELONGS TO UPSTREAM. This module:
//   - loads versioned bundle manifests (tests/strategy/native-bundles/*.json);
//   - verifies bundle evidence with SHA-256 (machine-checkable, not words);
//   - describes the statically-proven side-effect-free native entry points;
//   - maps a native run RESULT onto COVERAGE-AWARE validation records.
//
// Hard rules implemented here:
//   - the word "valid" is never produced: runtime semantics (method
//     arguments, execution plan) are never covered without packets, so the
//     best achievable status is 'partial';
//   - a process exit is a DOCUMENT-level result; expression-level errors are
//     assigned only when stderr unambiguously names the function;
//   - `--intercept=0` executes Lua init code: it is gated by an explicit
//     trust policy and NEVER forwards untrusted candidate --lua-init;
//   - this module never executes anything itself and never fabricates a
//     verdict.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Entry points (pinned bol-van/zapret2; see docs/contracts/strategy-model.md).
// ---------------------------------------------------------------------------

export const NATIVE_ENTRY_POINTS = Object.freeze([
	{
		id: 'dry-run',
		command: 'nfqws2 --dry-run <options>',
		parsesCli: true,
		loadsLua: false,
		bindsNfqueue: false,
		sendsTraffic: false,
		changesState: false,
		needsRoot: false,
		safe: 'yes — safe for UNTRUSTED options: argv-only, no Lua, exits before nfq_main',
		coverage: ['cliSyntax'],
		source: 'nfq2/nfqws.c IDX_DRY_RUN/bDry @d3b3011:1717,2259,3202; @8a0f53f:2081,2357,3304',
	},
	{
		id: 'intercept-zero',
		command: 'nfqws2 --intercept=0 <options>',
		parsesCli: true,
		loadsLua: true,
		bindsNfqueue: false,
		sendsTraffic: false,
		changesState: 'transient raw sockets (rawsend_preinit) + lua-init execution; no NFQUEUE, no packets, no firewall',
		needsRoot: true,
		safe: 'conditional — EXECUTES Lua init code: safe only for a trusted immutable NativeBundle under an explicit policy; UNSAFE for untrusted candidate --lua-init',
		caveats: [
			'run under a timeout (a lua-init script may register timers → NoInterceptLoop waits)',
			'lua-init paths must come from the selected NativeBundle allowlist, never from the candidate document',
			'per-method argument semantics, orchestrator plans and runtime blob resolution happen at packet time and are NOT covered',
		],
		coverage: ['cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence'],
		source: 'nfq2/nfqws.c:455-496 @8a0f53f; lua.c lua_desync_functions_exist @d3b3011:3891,4481; @8a0f53f:4023,4619',
	},
	{
		id: 'fuzz',
		excluded: true,
		reason: 'feeds random packets through the real desync path; rawsend would emit traffic',
		source: 'nfq2/nfqws.c fuzzPacketData→processPacketData @8a0f53f:167-199',
	},
]);

// ---------------------------------------------------------------------------
// Coverage-aware native validation records.
// status: 'not_checked' | 'partial' | 'rejected' | 'unavailable'
// ('valid' is intentionally NOT in the vocabulary: runtime semantics is
// never covered without packets.)
// ---------------------------------------------------------------------------

export function makeCoverageShell() {
	return {
		cliSyntax: 'not_checked',
		luaLoad: 'not_checked',
		luaCompatibility: 'not_checked',
		functionExistence: 'not_checked',
		runtimeArguments: 'not_checked', // always: needs packet context
		executionPlan: 'not_checked',    // always: needs packet context
	};
}

export function makeNativeValidationShell() {
	return {
		status: 'not_checked',
		entryPoint: null, // 'dry-run' | 'intercept-zero' | null
		coverage: makeCoverageShell(),
		diagnostics: [],
		bundleId: null,
		nativeVersion: null,
		luaCompatVer: null,
	};
}

function ndiag(code, message) {
	return { severity: 'error', code, message, tokenIndex: null, profileIndex: null, span: null, related: [] };
}

// ---------------------------------------------------------------------------
// SHA-256 bundle evidence (machine-verifiable).
// ---------------------------------------------------------------------------

export function sha256hex(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Splits a captured lua-contents fixture into { fileName: content }.
// Capture format: `===FILE:<path>===\n<content>\n===END:<path>===` blocks;
// line endings are normalized to LF before hashing (git may store CRLF on
// some checkouts; the capture was LF).
export function extractLuaSections(fixtureText) {
	const text = fixtureText.replace(/\r\n/g, '\n');
	const out = {};
	const re = /===FILE:\/opt\/zapret2\/lua\/([\w.-]+)===\n/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const name = m[1];
		const start = m.index + m[0].length;
		let end = text.indexOf('===FILE:', start);
		if (end < 0) end = text.length;
		let content = text.slice(start, end);
		const endMarker = content.indexOf('\n===END:');
		if (endMarker >= 0) content = content.slice(0, endMarker + 1); // keep the file's own trailing newline
		out[name] = content;
	}
	return out;
}

// Stable hash of the evidence fields themselves: any edit of the recorded
// commit, compat, or file hashes breaks this hash (tamper evidence).
export function computeEvidenceHash(evidence) {
	const stable = {
		upstreamCommit: evidence.upstreamCommit ?? null,
		luaCompatVer: evidence.luaCompatVer ?? null,
		files: Object.fromEntries(Object.entries(evidence.files ?? {}).sort(([a], [b]) => a.localeCompare(b))),
	};
	return sha256hex(JSON.stringify(stable));
}

// ---------------------------------------------------------------------------
// Bundle loading + verification.
// ---------------------------------------------------------------------------

const COMPAT_RE = /NFQWS2_COMPAT_VER_REQUIRED=(\d+)/;

export function loadBundle(filePath, { repoRoot = '.', readFile } = {}) {
	const read = readFile ?? ((p) => readFileSync(p, 'utf8'));
	const manifest = JSON.parse(read(filePath));
	const diagnostics = [];

	for (const key of ['binaryVersionFixture', 'luaContentsFixture']) {
		const rel = manifest[key];
		if (rel == null) continue;
		if (!readFile && !existsSync(join(repoRoot, rel))) {
			diagnostics.push(ndiag('NATIVE_UNAVAILABLE',
				`bundle '${manifest.id}': referenced fixture missing: ${rel}`));
		}
	}

	const result = {
		bundle: manifest,
		usable: false,
		reason: null,
		sameLuaReleaseVerified: false,
		binaryCommitSelfReported: manifest.binaryCommitSelfReported ?? null,
		binaryHashVerified: false,
		bundleConfidence: manifest.bundleConfidence ?? 'low',
		fixtureCompat: null,
		diagnostics,
	};

	if (manifest.luaContentsFixture == null) {
		result.reason = 'luaContentsFixture is null — target Lua bundle not captured';
		diagnostics.push(ndiag('NATIVE_UNAVAILABLE', `bundle '${manifest.id}': ${result.reason}`));
		return result;
	}

	// (a) evidence self-integrity: recorded commit/compat/hashes untampered
	const evidence = manifest.sameReleaseEvidence ?? null;
	if (!evidence || !evidence.files || !evidence.evidenceHash) {
		result.reason = 'manifest carries no verifiable sameReleaseEvidence';
		diagnostics.push(ndiag('NATIVE_BUNDLE_EVIDENCE_MISMATCH',
			`bundle '${manifest.id}': ${result.reason}`));
		return result;
	}
	if (computeEvidenceHash(evidence) !== evidence.evidenceHash) {
		result.reason = 'evidence fields tampered (commit/compat/file hashes do not match evidenceHash)';
		diagnostics.push(ndiag('NATIVE_BUNDLE_EVIDENCE_MISMATCH',
			`bundle '${manifest.id}': ${result.reason}`));
		return result;
	}

	// (b) fixture bytes must hash exactly to the recorded per-file SHA-256
	let sections;
	try {
		sections = extractLuaSections(read(join(repoRoot, manifest.luaContentsFixture)));
	} catch {
		result.reason = `lua fixture unreadable: ${manifest.luaContentsFixture}`;
		diagnostics.push(ndiag('NATIVE_UNAVAILABLE', `bundle '${manifest.id}': ${result.reason}`));
		return result;
	}
	let hashOk = true;
	for (const [name, expected] of Object.entries(evidence.files)) {
		const actual = sections[name] !== undefined ? sha256hex(sections[name]) : null;
		if (actual !== expected) {
			hashOk = false;
			diagnostics.push(ndiag('NATIVE_BUNDLE_EVIDENCE_MISMATCH',
				`bundle '${manifest.id}': captured Lua file '${name}' hash ${actual ?? 'MISSING'} != recorded ${expected} — the fixture is not the recorded bundle`));
		}
	}

	// (c) compat: fixture's own REQUIRED == manifest.luaCompatVer == evidence
	const allText = Object.values(sections).join('\n');
	const cm = COMPAT_RE.exec(allText);
	result.fixtureCompat = cm ? Number(cm[1]) : null;
	const compatOk = result.fixtureCompat !== null
		&& result.fixtureCompat === manifest.luaCompatVer
		&& manifest.luaCompatVer === evidence.luaCompatVer;
	if (!compatOk) {
		diagnostics.push(ndiag('NATIVE_LUA_COMPAT_MISMATCH',
			`bundle '${manifest.id}': compat chain broken (fixture=${result.fixtureCompat}, manifest=${manifest.luaCompatVer}, evidence=${evidence.luaCompatVer})`));
	}

	// (d) binary hash: only if a binarySha256 is recorded can it be verified
	result.binaryHashVerified = typeof manifest.binarySha256 === 'string' && manifest.binarySha256.length === 64;

	// sameLuaReleaseVerified: hashes + compat all match.
	// compat match ALONE never substitutes a hash match.
	result.sameLuaReleaseVerified = hashOk && compatOk
		&& !diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE');

	// sameReleaseProven (computed, never a manifest claim): Lua verified AND
	// binary hash verified. With no binary hash on record it stays false.
	result.sameReleaseProven = result.sameLuaReleaseVerified && result.binaryHashVerified;

	result.usable = result.sameLuaReleaseVerified;
	if (!result.usable && result.reason == null) {
		result.reason = 'bundle verification failed (see diagnostics)';
	}
	return result;
}

// Guard against mixing releases: a bundle whose luaCompatVer differs from the
// target's must never be used to produce a target verdict.
export function validateBundleForTarget(bundle, targetCompatVer) {
	if (bundle.luaCompatVer !== targetCompatVer) {
		return [ndiag('NATIVE_BINARY_LUA_MISMATCH',
			`bundle '${bundle.id}' has luaCompatVer=${bundle.luaCompatVer} but the target is ${targetCompatVer} — refusing to mix releases`)];
	}
	return [];
}

// ---------------------------------------------------------------------------
// Native validation plans (built, never executed here).
// ---------------------------------------------------------------------------

export const DEFAULT_LUA_POLICY = Object.freeze({
	allowTrustedLuaExecution: false,
	trustedLuaInitPaths: [],
});

const TRUSTED_LUA_PREFIX = '/opt/zapret2/lua/';

function isPlausibleTrustedPath(p) {
	return typeof p === 'string'
		&& p.startsWith(TRUSTED_LUA_PREFIX)
		&& !p.includes('..')
		&& !/[\s'"$`\\]/.test(p);
}

// Candidate --lua-init values from the document: '@/abs/path' or inline Lua.
function candidateLuaInit(model) {
	const out = [];
	for (const g of model.globalOptions ?? []) {
		if (g.option !== '--lua-init') continue;
		const v = String(g.value ?? '');
		if (v.startsWith('@')) out.push({ kind: 'path', path: v.slice(1), tokenIndex: g.tokenIndex });
		else out.push({ kind: 'inline', tokenIndex: g.tokenIndex });
	}
	return out;
}

function refusal(reason, code = 'NATIVE_UNAVAILABLE') {
	return {
		plan: null,
		refused: true,
		validation: {
			...makeNativeValidationShell(),
			status: 'unavailable',
			diagnostics: [ndiag(code, reason)],
		},
	};
}

// Build the ARGV for a native validation run. The runner MUST spawn with an
// argv array (execve-style) — NEVER interpolate into a shell string.
//
// dry-run        : safe for untrusted options (no Lua is loaded).
// intercept-zero : executes Lua init code → gated by `policy`
//                  ({ allowTrustedLuaExecution, trustedLuaInitPaths }).
//                  Default policy REFUSES. When allowed, lua-init args come
//                  ONLY from the selected bundle's trusted paths; candidate
//                  --lua-init is never forwarded as-is and never silently
//                  dropped (mismatch → UNTRUSTED_LUA_INIT_REQUIRES_SANDBOX).
export function buildNativeValidationPlan(model, bundle, {
	mode = 'dry-run',
	binary = '/opt/zapret2/nfq2/nfqws2',
	policy = DEFAULT_LUA_POLICY,
} = {}) {
	if (mode !== 'dry-run' && mode !== 'intercept-zero') {
		throw new Error(`unsupported native validation mode: ${mode}`);
	}
	if (mode === 'dry-run') {
		const args = ['--dry-run', ...model.tokens.map((t) => t.value)];
		return {
			plan: {
				command: binary, args, mode,
				bundleId: bundle?.id ?? null,
				safety: 'argv-array spawn only; no shell; no Lua; no packets; no firewall changes',
			},
			refused: false,
			validation: null,
		};
	}

	// intercept-zero — Lua execution gate
	if (policy?.allowTrustedLuaExecution !== true) {
		return refusal(
			'intercept-zero refused: policy.allowTrustedLuaExecution is false — this entry point EXECUTES Lua init code; enable it only for a trusted immutable NativeBundle');
	}
	const trustedFromBundle = bundle?.trustedLuaInitPaths ?? null;
	if (!Array.isArray(trustedFromBundle) || trustedFromBundle.length === 0) {
		return refusal('intercept-zero refused: the selected NativeBundle declares no trustedLuaInitPaths');
	}
	for (const p of trustedFromBundle) {
		if (!isPlausibleTrustedPath(p)) {
			return refusal(`intercept-zero refused: bundle lua-init path '${p}' is not an absolute ${TRUSTED_LUA_PREFIX}* path`);
		}
		if (!(policy.trustedLuaInitPaths ?? []).includes(p)) {
			return refusal(`intercept-zero refused: bundle lua-init path '${p}' is not in the policy allowlist`);
		}
	}
	// candidate --lua-init: must be a subset of the trusted bundle paths;
	// inline Lua in a candidate can never be trusted here.
	const candidates = candidateLuaInit(model);
	for (const c of candidates) {
		if (c.kind === 'inline') {
			return refusal(
				'candidate document carries inline --lua-init Lua code — cannot be executed outside a sandbox',
				'UNTRUSTED_LUA_INIT_REQUIRES_SANDBOX');
		}
		if (!trustedFromBundle.includes(c.path)) {
			return refusal(
				`candidate --lua-init path '${c.path}' is outside the trusted bundle set — refusing to execute it (requires a sandbox)`,
				'UNTRUSTED_LUA_INIT_REQUIRES_SANDBOX');
		}
	}
	// argv: trusted bundle lua-init set (NOT the candidate's as-is), then all
	// candidate tokens EXCEPT --lua-init (handled above, recorded, not silent).
	const luaInitArgs = trustedFromBundle.map((p) => `--lua-init=@${p}`);
	const rest = [];
	for (let i = 0; i < model.tokens.length; i++) {
		const t = model.tokens[i];
		if (t.kind === 'option' && t.value.startsWith('--lua-init')) continue;
		rest.push(t.value);
	}
	return {
		plan: {
			command: binary,
			args: ['--intercept=0', ...luaInitArgs, ...rest],
			mode,
			bundleId: bundle?.id ?? null,
			luaInit: {
				trustedPaths: trustedFromBundle,
				candidatePaths: candidates.map((c) => c.path ?? '(inline)'),
				handling: 'candidate --lua-init verified ⊆ trusted bundle set; argv uses the trusted set only',
			},
			safety: 'argv-array spawn only; no shell; run under a timeout; trusted bundle lua-init only; no packets; no firewall changes',
		},
		refused: false,
		validation: null,
	};
}

// ---------------------------------------------------------------------------
// Applying a native run RESULT (document scope + identified-expression scope).
// ---------------------------------------------------------------------------

function forEachLuaDesync(model, fn) {
	for (const p of model.profiles) {
		for (const e of p.luaDesync) fn(e, p);
	}
}

function baseRecord(bundle, result, entryPoint) {
	return {
		...makeNativeValidationShell(),
		entryPoint,
		bundleId: bundle?.id ?? null,
		nativeVersion: result.nativeVersion ?? bundle?.binaryVersion ?? null,
		luaCompatVer: result.luaCompatVer ?? bundle?.luaCompatVer ?? null,
	};
}

function acceptedCoverage(mode) {
	const cov = makeCoverageShell();
	cov.cliSyntax = 'passed';
	if (mode === 'intercept-zero') {
		cov.luaLoad = 'passed';
		cov.luaCompatibility = 'passed';
		cov.functionExistence = 'passed';
	}
	return cov;
}

const CLI_ERROR_RES = [
	/invalid lua function call/i,
	/invalid packet range value/i,
	/bad value for/i,
	/unrecognized option/i,
	/invalid option/i,
];

// Map an ACTUAL native run result onto the model. `result` must come from a
// real execution of buildNativeValidationPlan() on the target (by an
// integrator); this function never runs anything itself.
//
// Scoping rules:
//   - the process exit is a DOCUMENT result (model.nativeValidation);
//   - expression-level records are changed only when stderr unambiguously
//     names the function (`desync function 'foo' does not exist` → only the
//     expressions whose function hint is 'foo').
export function applyNativeResult(model, bundle, result) {
	if (!result || typeof result.exitCode !== 'number') {
		throw new Error('applyNativeResult requires an actual native result object { exitCode, stderr, mode }');
	}
	const mode = result.mode ?? 'dry-run';
	if (mode !== 'dry-run' && mode !== 'intercept-zero') {
		throw new Error(`applyNativeResult: unknown mode '${mode}'`);
	}
	const stderr = String(result.stderr ?? '');
	const accepted = result.exitCode === 0;

	const doc = baseRecord(bundle, result, mode);
	const expressionDiagnostics = [];

	if (accepted) {
		doc.status = 'partial'; // never 'valid': runtime semantics uncovered
		doc.coverage = acceptedCoverage(mode);
		// exit 0 on intercept-zero: the oracle proved every function exists —
		// that fact IS expression-scoped. dry-run proves only call shape.
		forEachLuaDesync(model, (e) => {
			const rec = baseRecord(bundle, result, mode);
			rec.status = 'partial';
			rec.coverage = acceptedCoverage(mode);
			e.nativeValidation = rec;
		});
	} else {
		doc.status = 'rejected';
		const fn = /desync function '([^']+)' does not exist/.exec(stderr);
		if (fn && mode === 'intercept-zero') {
			doc.coverage.cliSyntax = 'passed';
			doc.coverage.luaLoad = 'passed';
			doc.coverage.luaCompatibility = 'passed';
			doc.coverage.functionExistence = 'failed';
			doc.diagnostics.push(ndiag('NATIVE_FUNCTION_NOT_FOUND',
				`native parser: desync function '${fn[1]}' does not exist in the loaded Lua bundle`));
			// expression scoping: only the named function's expressions
			forEachLuaDesync(model, (e) => {
				if (e.catalogHints.functionName !== fn[1]) return;
				const rec = baseRecord(bundle, result, mode);
				rec.status = 'rejected';
				rec.coverage.cliSyntax = 'passed';
				rec.coverage.luaLoad = 'passed';
				rec.coverage.luaCompatibility = 'passed';
				rec.coverage.functionExistence = 'failed';
				rec.diagnostics.push(ndiag('NATIVE_FUNCTION_NOT_FOUND',
					`native parser: desync function '${fn[1]}' does not exist in the loaded Lua bundle`));
				expressionDiagnostics.push(rec.diagnostics[0]);
				e.nativeValidation = rec;
			});
		} else if (/Incompatible NFQWS2_COMPAT_VER/.test(stderr)) {
			doc.coverage.cliSyntax = 'passed';
			doc.coverage.luaLoad = 'failed';
			doc.coverage.luaCompatibility = 'failed';
			doc.diagnostics.push(ndiag('NATIVE_LUA_COMPAT_MISMATCH',
				'native parser: NFQWS2_COMPAT_VER incompatible with the Lua bundle (binary/Lua release mismatch)'));
		} else if (CLI_ERROR_RES.some((re) => re.test(stderr))) {
			doc.coverage.cliSyntax = 'failed';
			const firstLine = stderr.split('\n').map((l) => l.trim()).find(Boolean);
			doc.diagnostics.push(ndiag('NATIVE_REJECTED',
				`native parser rejected the options at CLI level${firstLine ? `: ${firstLine}` : ''}`));
		} else {
			// unclassified native error: conservative coverage
			if (mode === 'intercept-zero' && /lua/i.test(stderr)) {
				doc.coverage.cliSyntax = 'passed';
				doc.coverage.luaLoad = 'failed';
			} else {
				doc.coverage.cliSyntax = 'failed';
			}
			const firstLine = stderr.split('\n').map((l) => l.trim()).find(Boolean);
			doc.diagnostics.push(ndiag('NATIVE_REJECTED',
				`native parser rejected the options (exit ${result.exitCode})${firstLine ? `: ${firstLine}` : ''}`));
		}
		// NOTE: no blanket copy into luaDesync entries — a document rejection
		// without an identifiable function stays at document scope.
	}

	model.nativeValidation = doc;
	return { accepted, document: doc, expressionDiagnostics };
}

// Mark the whole document + every lua-desync entry as not natively
// verifiable here. Never upgrades to 'partial' — no check was run.
export function unavailableNativeValidation(model, bundle, reason = 'no proven side-effect-free native validation entry point executed in this environment') {
	let count = 0;
	const stamp = (rec) => {
		rec.status = 'unavailable';
		rec.diagnostics.push(ndiag('NATIVE_UNAVAILABLE', reason));
		rec.bundleId = bundle?.id ?? null;
		rec.nativeVersion = bundle?.binaryVersion ?? null;
		rec.luaCompatVer = bundle?.luaCompatVer ?? null;
		return rec;
	};
	model.nativeValidation = stamp(makeNativeValidationShell());
	forEachLuaDesync(model, (e) => {
		e.nativeValidation = stamp(makeNativeValidationShell());
		count++;
	});
	return count;
}
