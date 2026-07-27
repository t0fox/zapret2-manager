// native.mjs — native bundle manifests + native validation adapter.
//
// NATIVE VALIDATION BELONGS TO UPSTREAM. This module:
//   - loads versioned bundle manifests (tests/strategy/native-bundles/*.json);
//   - verifies manifest↔fixture consistency (compat version cross-check);
//   - describes the statically-proven side-effect-free native entry points;
//   - maps a native run RESULT (obtained by an integrator's runner, on the
//     target) onto nativeValidation fields.
//
// It NEVER executes nfqws2 itself in this deliverable, NEVER fabricates a
// verdict: without an actual native result the status is 'unavailable' or
// 'not_checked' — never 'valid'.
//
// Statically proven safe entry points (pinned bol-van/zapret2):
//   --dry-run     : nfq2/nfqws.c bDry → "command line parameters verified",
//                   exit(0) BEFORE nfq_main — no Lua, no sockets, no NFQUEUE,
//                   no traffic. (@d3b3011:1717 help, :3202 exit; @8a0f53f:3304)
//   --intercept=0 : full CLI parse + lua-init + NFQWS2_COMPAT_VER check +
//                   lua_desync_functions_exist() oracle
//                   (lua.c @d3b3011:3891/4481; @8a0f53f:4023/4619), then
//                   "no intercept quit". No NFQUEUE bind, no packets.
//                   Caveats: needs CAP_NET_RAW (transient raw sockets),
//                   executes the config's lua-init (same trust as the
//                   running daemon), run under a timeout.
//   --fuzz=N      : EXCLUDED — feeds packets through the real desync path;
//                   rawsend would emit traffic (nfq2/nfqws.c:167-199).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
		safe: true,
		coverage: ['cli-syntax', 'port-grammar', 'range-grammar', 'lua-desync-call-shape', 'unknown-option'],
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
		safe: 'yes-with-caveats',
		caveats: [
			'run under a timeout (a lua-init script may register timers → NoInterceptLoop waits)',
			'trust level equals the target config (lua-init code executes)',
			'per-method argument semantics, orchestrator plans and runtime blob resolution happen at packet time and are NOT covered',
		],
		coverage: ['cli-syntax', 'lua-load', 'NFQWS2_COMPAT_VER', 'function-existence (lua_desync_functions_exist)'],
		source: 'nfq2/nfqws.c:455-496 @8a0f53f; lua.c lua_desync_functions_exist @d3b3011:3891,4481; @8a0f53f:4023,4619',
	},
	{
		id: 'fuzz',
		excluded: true,
		reason: 'feeds random packets through the real desync path; rawsend would emit traffic',
		source: 'nfq2/nfqws.c fuzzPacketData→processPacketData @8a0f53f:167-199',
	},
]);

function ndiag(code, message) {
	return { severity: 'error', code, message, tokenIndex: null, profileIndex: null, span: null, related: [] };
}

// ---------------------------------------------------------------------------
// Bundle loading.
// ---------------------------------------------------------------------------

const COMPAT_RE = /NFQWS2_COMPAT_VER_REQUIRED=(\d+)/;

// Cross-checks manifest.luaCompatVer against the Lua fixture's own
// NFQWS2_COMPAT_VER_REQUIRED. Never derives truth from co-location:
// sameReleaseProven is a manifest CLAIM backed by its evidence fields
// (byte-exact hash matches), not something this loader computes from two
// files sitting in one directory.
export function checkBundleConsistency(manifest, { readFile } = {}) {
	const diagnostics = [];
	const result = { consistent: null, manifestCompat: manifest.luaCompatVer ?? null, fixtureCompat: null, diagnostics };
	if (manifest.luaContentsFixture == null) {
		result.consistent = false;
		result.reason = manifest.provenance?.notes?.length
			? 'luaContentsFixture is null — current target Lua bundle not captured'
			: 'luaContentsFixture is null';
		diagnostics.push(ndiag('NATIVE_UNAVAILABLE',
			`bundle '${manifest.id}': no Lua contents fixture — ${result.reason}`));
		return result;
	}
	const read = readFile ?? ((p) => readFileSync(p, 'utf8'));
	let text;
	try {
		text = read(manifest.luaContentsFixture);
	} catch {
		result.consistent = false;
		result.reason = `lua fixture unreadable: ${manifest.luaContentsFixture}`;
		diagnostics.push(ndiag('NATIVE_UNAVAILABLE', `bundle '${manifest.id}': ${result.reason}`));
		return result;
	}
	const m = COMPAT_RE.exec(text);
	if (m) {
		result.fixtureCompat = Number(m[1]);
		if (result.manifestCompat !== null && result.fixtureCompat !== result.manifestCompat) {
			result.consistent = false;
			diagnostics.push(ndiag('NATIVE_LUA_COMPAT_MISMATCH',
				`bundle '${manifest.id}': manifest luaCompatVer=${result.manifestCompat} but Lua fixture requires ${result.fixtureCompat} — a bundle mixing releases must never be treated as target-valid`));
			return result;
		}
	}
	result.consistent = true;
	return result;
}

export function loadBundle(filePath, { repoRoot = '.', readFile } = {}) {
	const read = readFile ?? ((p) => readFileSync(p, 'utf8'));
	const manifest = JSON.parse(read(filePath));
	const diagnostics = [];

	for (const key of ['binaryVersionFixture', 'luaContentsFixture']) {
		const rel = manifest[key];
		if (rel == null) continue;
		const abs = join(repoRoot, rel);
		const exists = readFile ? true : existsSync(abs);
		if (!exists) {
			diagnostics.push(ndiag('NATIVE_UNAVAILABLE',
				`bundle '${manifest.id}': referenced fixture missing: ${rel}`));
		}
	}

	const consistency = checkBundleConsistency(
		{ ...manifest, luaContentsFixture: manifest.luaContentsFixture ? join(repoRoot, manifest.luaContentsFixture) : null },
		{ readFile });
	diagnostics.push(...consistency.diagnostics);

	const usable = consistency.consistent === true
		&& !diagnostics.some((d) => d.code === 'NATIVE_UNAVAILABLE');

	return {
		bundle: manifest,
		usable,
		reason: usable ? null : (consistency.reason ?? 'bundle consistency check failed'),
		consistency,
		diagnostics,
	};
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
// Native validation adapter.
// ---------------------------------------------------------------------------

// Build the ARGV for a native validation run. The runner MUST spawn with an
// argv array (execve-style) — NEVER interpolate into a shell string.
export function buildNativeValidationPlan(model, bundle, { mode = 'dry-run', binary = '/opt/zapret2/nfq2/nfqws2' } = {}) {
	if (mode !== 'dry-run' && mode !== 'intercept-zero') {
		throw new Error(`unsupported native validation mode: ${mode}`);
	}
	const args = [];
	if (mode === 'dry-run') args.push('--dry-run');
	else args.push('--intercept=0');
	for (const t of model.tokens) args.push(t.value); // decoded values; argv, no shell
	return {
		command: binary,
		args,
		mode,
		bundleId: bundle?.id ?? null,
		safety: 'argv-array spawn only; no shell; no packets; no firewall changes; run under a timeout',
	};
}

// Mark every lua-desync entry as not natively verifiable here.
export function unavailableNativeValidation(model, bundle, reason = 'no proven side-effect-free native validation entry point executed in this environment') {
	let count = 0;
	for (const p of model.profiles) {
		for (const e of p.luaDesync) {
			e.nativeValidation = {
				status: 'unavailable',
				diagnostics: [ndiag('NATIVE_UNAVAILABLE', reason)],
				bundleId: bundle?.id ?? null,
				nativeVersion: bundle?.binaryVersion ?? null,
				luaCompatVer: bundle?.luaCompatVer ?? null,
			};
			count++;
		}
	}
	return count;
}

// Map an ACTUAL native run result onto the model. `result` must come from a
// real execution of buildNativeValidationPlan() on the target (by an
// integrator); this function never runs anything itself.
export function applyNativeResult(model, bundle, result) {
	if (!result || typeof result.exitCode !== 'number') {
		throw new Error('applyNativeResult requires an actual native result object { exitCode, stderr }');
	}
	const accepted = result.exitCode === 0;
	const diagnostics = [];
	if (!accepted) {
		const stderr = String(result.stderr ?? '');
		const fn = /desync function '([^']+)' does not exist/.exec(stderr);
		if (fn) {
			diagnostics.push(ndiag('NATIVE_FUNCTION_NOT_FOUND',
				`native parser: desync function '${fn[1]}' does not exist in the loaded Lua bundle`));
		} else if (/Incompatible NFQWS2_COMPAT_VER/.test(stderr)) {
			diagnostics.push(ndiag('NATIVE_LUA_COMPAT_MISMATCH',
				'native parser: NFQWS2_COMPAT_VER incompatible with the Lua bundle (binary/Lua release mismatch)'));
		} else {
			const firstLine = stderr.split('\n').map((l) => l.trim()).find(Boolean);
			diagnostics.push(ndiag('NATIVE_REJECTED',
				`native parser rejected the options (exit ${result.exitCode})${firstLine ? `: ${firstLine}` : ''}`));
		}
	}
	for (const p of model.profiles) {
		for (const e of p.luaDesync) {
			e.nativeValidation = {
				status: accepted ? 'valid' : 'invalid',
				diagnostics: diagnostics.map((d) => ({ ...d })),
				bundleId: bundle?.id ?? null,
				nativeVersion: result.nativeVersion ?? bundle?.binaryVersion ?? null,
				luaCompatVer: result.luaCompatVer ?? bundle?.luaCompatVer ?? null,
			};
		}
	}
	return { accepted, diagnostics };
}
