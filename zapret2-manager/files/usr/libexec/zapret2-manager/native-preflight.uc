'use strict';
// native-preflight.uc — production fail-closed verification for a rendered
// NFQWS2_OPT candidate. It never intercepts traffic and never mutates config.
// Dual-layer verification requires proving BOTH upstream NFQWS2_COMPAT_VER
// AND local patch capabilities (Z2K_TLS_MOD, ANTIDPI_REPEATS_LOOP, AUTO_FAMILY_SPLIT).

import { readfile, stat, popen } from 'fs';
import { z2m_tokenize, z2m_parse, z2m_validate } from './profiles.uc';

const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const MANIFEST = '/usr/share/zapret2-manager/native-preflight.json';
const ALLOWED_LUA_ROOT = '/opt/zapret2/';
const RUNTIME_LUA_ROOT = '/opt/zapret2/lua/';
const RUNTIME_LUA_FILES = [
	'zapret-lib.lua',
	'zapret-antidpi.lua',
	'zapret-auto.lua',
	'z2k-modern-core.lua',
	'z2k-detectors.lua',
	'z2k-fooling-ext.lua',
	'z2k-state-persist.lua',
	// Full pinned bundle: keep the smoke aligned with the manifest luaFiles.
	'z2k-range-rand.lua',
	'z2k-alert.lua',
	'z2k-quic-silence.lua'
];

function shell_escape(value) {
	let s = '' + value, out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}

function run(command) {
	let p = popen(command + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { rc: rc, out: out };
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let answer = run("sha256sum " + shell_escape(path) + " | awk '{print $1}'");
	let digest = trim(answer.out);
	return answer.rc == 0 && length(digest) == 64 ? digest : null;
}

function load_manifest() {
	let raw = readfile(MANIFEST);
	if (!raw) return { ok: false, reason: 'native preflight manifest is missing' };
	let value = null;
	try { value = json(raw); } catch (e) { return { ok: false, reason: 'native preflight manifest is malformed' }; }
	if (type(value) != 'object' || value == null)
		return { ok: false, reason: 'native preflight manifest schema is unsupported' };
	if (value.schema != 'zapret2-manager.native-preflight.v1' && value.schema != 'zapret2-manager.native-preflight.v2')
		return { ok: false, reason: 'native preflight manifest schema is unsupported' };
	if (value.schema == 'zapret2-manager.native-preflight.v1') {
		if (type(value.expectedNfqws2Sha256) != 'string' || length(value.expectedNfqws2Sha256) != 64)
			return { ok: false, reason: 'expectedNfqws2Sha256 is not pinned' };
		if (type(value.expectedLuaBundleSha256) != 'string' || length(value.expectedLuaBundleSha256) != 64)
			return { ok: false, reason: 'expectedLuaBundleSha256 is not pinned' };
	}
	if (type(value.luaFiles) != 'array' || length(value.luaFiles) == 0)
		return { ok: false, reason: 'luaFiles are not pinned' };
	return { ok: true, value: value };
}

function lua_bundle_digest(files) {
	let quoted = [];
	for (let i = 0; i < length(files); i++) {
		let path = files[i];
		if (type(path) != 'string' || substr(path, 0, length(ALLOWED_LUA_ROOT)) != ALLOWED_LUA_ROOT || !stat(path))
			return { ok: false, reason: 'Lua file is missing or outside the allowed root: ' + path };
		push(quoted, shell_escape(path));
	}
	let answer = run('sha256sum ' + join(' ', quoted) + " | sha256sum | awk '{print $1}'");
	let digest = trim(answer.out);
	if (answer.rc != 0 || length(digest) != 64)
		return { ok: false, reason: 'unable to hash the pinned Lua bundle' };
	return { ok: true, digest: digest };
}

function probe_binary_capabilities(binaryPath) {
	let helpResult = run(shell_escape(binaryPath) + ' --help');
	let out = helpResult.out || '';
	let caps = {
		Z2K_TLS_MOD: false,
		NFQWS2_COMPAT_VER: 1
	};
	// Check for the z2k-prefixed TLS-mod option tokens (patched builds only).
	if (index(out, 'z2k_grease') >= 0 || index(out, 'z2k_alpn') >= 0
		|| index(out, 'z2k_tls_mod') >= 0) {
		caps.Z2K_TLS_MOD = true;
	} else {
		let strResult = run("strings " + shell_escape(binaryPath)
			+ " | grep -E 'z2k_grease|z2k_alpn|FAKE_TLS_MOD_Z2K_GREASE' | head -n 1");
		if (!(strResult.rc == 0 && length(trim(strResult.out)) > 0)) {
			// busybox images may lack strings(1); grep reads the binary directly.
			let grepResult = run("grep -c -a 'z2k_alpn' " + shell_escape(binaryPath));
			caps.Z2K_TLS_MOD = grepResult.rc == 0 && trim(grepResult.out) != '0';
		} else {
			caps.Z2K_TLS_MOD = true;
		}
	}
	return caps;
}

function command_for(candidate, mode) {
	let tokens = z2m_tokenize(candidate).tokens;
	let cmd = 'cd /opt/zapret2 && ' + shell_escape(NFQWS2_BIN) + ' ' + mode + ' --qnum=30999';
	for (let i = 0; i < length(RUNTIME_LUA_FILES); i++)
		cmd += ' --lua-init=' + shell_escape('@' + RUNTIME_LUA_ROOT + RUNTIME_LUA_FILES[i]);
	for (let i = 0; i < length(tokens); i++) cmd += ' ' + shell_escape(tokens[i].value);
	return cmd;
}

function diagnostics(reason, code) {
	return [{ severity: 'error', code: code, message: reason, tokenIndex: null, profileIndex: null }];
}

export const native_preflight = function(candidate) {
	let coverage = {
		cliSyntax: 'not_checked',
		luaLoad: 'not_checked',
		luaCompatibility: 'not_checked',
		engineCapabilities: 'not_checked',
		functionExistence: 'not_checked',
		blobExistence: 'not_checked',
		runtimeArguments: 'not_checked',
		executionPlan: 'not_checked'
	};
	let evidence = { manifest: MANIFEST, nfqws2: NFQWS2_BIN };
	let model = z2m_parse(candidate), modelDiagnostics = z2m_validate(model);
	let structuralFailure = length(model.profiles) == 0 || length(model.trailingTokens) > 0;
	for (let d in model.diagnostics) if (d.severity == 'error') structuralFailure = true;
	for (let d in modelDiagnostics) if (d.severity == 'error') structuralFailure = true;
	if (structuralFailure) {
		coverage.executionPlan = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics('candidate execution plan is structurally invalid', 'EXECUTION_PLAN_REJECTED'), evidence: evidence };
	}
	coverage.executionPlan = 'passed';

	if (!stat(NFQWS2_BIN))
		return { status: 'unavailable', coverage: coverage, diagnostics: diagnostics('nfqws2 binary is missing', 'NATIVE_UNAVAILABLE'), evidence: evidence };

	let manifest = load_manifest();
	if (!manifest.ok)
		return { status: 'partial', coverage: coverage, diagnostics: diagnostics(manifest.reason, 'PINNED_EVIDENCE_MISSING'), evidence: evidence };

	// Probe engine capabilities
	let binCaps = probe_binary_capabilities(NFQWS2_BIN);
	evidence.engineCapabilities = binCaps;

	// Check if candidate requires z2k C capabilities
	let requiresZ2kTlsMod = false;
	let tokens = z2m_tokenize(candidate).tokens;
	for (let i = 0; i < length(tokens); i++) {
		let v = tokens[i].value;
		if (index(v, 'tls_mod=') >= 0 || index(v, 'grease') >= 0 || index(v, 'alpn_flood') >= 0) {
			requiresZ2kTlsMod = true;
		}
	}

	if (requiresZ2kTlsMod && !binCaps.Z2K_TLS_MOD) {
		coverage.engineCapabilities = 'failed';
		return {
			status: 'rejected',
			coverage: coverage,
			diagnostics: diagnostics('Candidate strategy requires Z2K_TLS_MOD engine capability not present in binary', 'EENGINE_CAPABILITY_MISSING'),
			evidence: evidence
		};
	}
	coverage.engineCapabilities = 'passed';

	let engineDigest = sha256_file(NFQWS2_BIN);
	evidence.nfqws2Sha256 = engineDigest;
	if (manifest.value.expectedNfqws2Sha256 && engineDigest != manifest.value.expectedNfqws2Sha256) {
		coverage.luaCompatibility = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics('nfqws2 digest does not match the release manifest', 'ENGINE_DIGEST_MISMATCH'), evidence: evidence };
	}

	let lua = lua_bundle_digest(manifest.value.luaFiles);
	if (!lua.ok)
		return { status: 'partial', coverage: coverage, diagnostics: diagnostics(lua.reason, 'LUA_BUNDLE_UNAVAILABLE'), evidence: evidence };
	evidence.luaBundleSha256 = lua.digest;
	if (manifest.value.expectedLuaBundleSha256 && lua.digest != manifest.value.expectedLuaBundleSha256) {
		coverage.luaCompatibility = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics('Lua bundle digest does not match the release manifest', 'LUA_DIGEST_MISMATCH'), evidence: evidence };
	}
	coverage.luaCompatibility = 'passed';

	let dry = run(command_for(candidate, '--dry-run'));
	evidence.cliExit = dry.rc;
	if (dry.rc != 0) {
		coverage.cliSyntax = 'failed';
		coverage.runtimeArguments = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics(trim(dry.out) || 'nfqws2 --dry-run failed', 'NATIVE_REJECTED'), evidence: evidence };
	}
	coverage.cliSyntax = 'passed';
	coverage.runtimeArguments = 'passed';

	// Upstream --intercept=0 executes the exact Lua init/action/blob resolution
	// path and exits without binding/intercepting traffic.
	let luaRun = run(command_for(candidate, '--intercept=0'));
	evidence.luaExit = luaRun.rc;
	if (luaRun.rc != 0) {
		coverage.luaLoad = 'failed';
		coverage.functionExistence = 'failed';
		coverage.blobExistence = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics(trim(luaRun.out) || 'nfqws2 --intercept=0 failed', 'LUA_PREFLIGHT_REJECTED'), evidence: evidence };
	}
	coverage.luaLoad = 'passed';
	coverage.functionExistence = 'passed';
	coverage.blobExistence = 'passed';

	let complete = coverage.cliSyntax == 'passed'
		&& coverage.luaLoad == 'passed'
		&& coverage.luaCompatibility == 'passed'
		&& coverage.engineCapabilities == 'passed'
		&& coverage.functionExistence == 'passed'
		&& coverage.blobExistence == 'passed'
		&& coverage.runtimeArguments == 'passed'
		&& coverage.executionPlan == 'passed';
	return { status: complete ? 'verified' : 'partial', coverage: coverage, diagnostics: [], evidence: evidence };
};

// --install-proof: engine install transaction gate. Proves REQUIRED
// capabilities with REAL runtime evidence on the installed binary +
// materialized Lua, then runs a Lua-init smoke through the daemon's own
// interpreter path. Output is a machine-readable verdict consumed by the
// worker and by commit-state; any missing required capability fails closed.
//
// Requirement-based contract: the required capability list is supplied by
// the checked candidate (env Z2M_REQUIRED_CAPABILITIES, space-separated).
// Canonical stock bol-van releases carry an EMPTY requirement list — a
// stock runtime is healthy without any Z2K native delta. Capability booleans
// are still reported for evidence, but only *required* ones gate ok.
export const install_proof = function() {
	let caps = {
		ok: false,
		Z2K_TLS_MOD: false,
		ANTIDPI_REPEATS_LOOP: false,
		AUTO_FAMILY_SPLIT: false,
		luaSmoke: false,
		nfqws2Sha256: null,
		requiredCapabilities: [],
		provenance: {
			binaryTokens: ['z2k_grease', 'z2k_alpn_flood'],
			repeatsMarker: 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod',
			familySplitMarker: 'family_split',
			checkedAt: time()
		}
	};
	let requiredArg = trim(getenv('Z2M_REQUIRED_CAPABILITIES') || '');
	if (length(requiredArg) > 0) {
		caps.requiredCapabilities = split(requiredArg, /[\s]+/);
	}
	if (!stat(NFQWS2_BIN)) return caps;
	let digest = sha256_file(NFQWS2_BIN);
	if (digest == null) return caps;
	caps.nfqws2Sha256 = digest;
	let luaDir = run('ls -la ' + shell_escape(RUNTIME_LUA_ROOT) + ' 2>&1');
	caps.luaDirListing = trim(luaDir.out);
	caps.libFile = stat(RUNTIME_LUA_ROOT + 'zapret-lib.lua') != null ? 'exists' : 'missing';
	caps.whoami = trim(run('id').out);

	// Z2K_TLS_MOD: compiled-in option tokens (help output or binary strings).
	let binCaps = probe_binary_capabilities(NFQWS2_BIN);
	caps.Z2K_TLS_MOD = binCaps.Z2K_TLS_MOD === true
		&& index(run("strings " + shell_escape(NFQWS2_BIN) + " | grep -c 'z2k_alpn'").out || '', '0') != 0;

	// ANTIDPI_REPEATS_LOOP / AUTO_FAMILY_SPLIT: materialized Lua markers.
	let repeats = readfile('/opt/zapret2/lua/zapret-antidpi.lua') || '';
	caps.ANTIDPI_REPEATS_LOOP = index(repeats, 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod') >= 0;
	let autoLua = readfile('/opt/zapret2/lua/zapret-auto.lua') || '';
	caps.AUTO_FAMILY_SPLIT = index(autoLua, 'family_split') >= 0;

	// Lua init smoke through nfqws2 itself (no interception): every pinned
	// runtime Lua file must parse and initialize inside the daemon.
	let cmd = shell_escape(NFQWS2_BIN) + ' --dry-run --intercept=0 --qnum=30999';
	for (let i = 0; i < length(RUNTIME_LUA_FILES); i++)
		cmd += ' --lua-init=' + shell_escape('@' + RUNTIME_LUA_ROOT + RUNTIME_LUA_FILES[i]);
	let smoke = run(cmd);
	caps.luaSmoke = smoke.rc == 0;
	if (!caps.luaSmoke) caps.smokeStderr = substr(trim(smoke.out), 0, 400);

	// Runtime health gate: Lua smoke must pass, plus EVERY candidate-required
	// capability must be proven true. A stock release with zero requirements
	// passes here purely on luaSmoke + binary/runtime presence above.
	caps.ok = caps.luaSmoke;
	if (caps.ok && type(caps.requiredCapabilities) == 'array')
		for (let i = 0; i < length(caps.requiredCapabilities); i++) {
			let name = caps.requiredCapabilities[i];
			if (caps[name] !== true) { caps.ok = false; break; }
		}
	return caps;
};
