'use strict';
// native-preflight.uc — production fail-closed verification for a rendered
// NFQWS2_OPT candidate. It never intercepts traffic and never mutates config.
// Verification proves the exact selected runtime composition.  Static engine
// capability evidence is read from native-preflight.json; dynamic Z2K
// runtimeAssets/luaInit are supplied by the canonical resolver and are never
// reconstructed from a package directory or a hand-copied list.

import { readfile, stat, popen } from 'fs';
import { z2m_tokenize, z2m_parse, z2m_validate } from './profiles.uc';
import { resolveInstalled } from './runtime-composition.uc';
import { runtime_target_path, runtime_argument_token } from './runtime-asset-paths.uc';

const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const MANIFEST = '/usr/share/zapret2-manager/native-preflight.json';
const ALLOWED_LUA_ROOT = '/opt/zapret2/';
const RUNTIME_LUA_ROOT = '/opt/zapret2/lua/';

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

function sha256_files(paths) {
	if (type(paths) != 'array' || length(paths) == 0) return {};
	let quoted = [];
	for (let path in paths) {
		if (type(path) != 'string' || !stat(path)) return null;
		push(quoted, shell_escape(path));
	}
	let answer = run('sha256sum ' + join(' ', quoted));
	if (answer.rc != 0) return null;
	let lines = split(trim(answer.out), /\r?\n/);
	if (length(lines) != length(paths)) return null;
	let digests = {};
	for (let i = 0; i < length(paths); i++) {
		let line = lines[i];
		if (length(line) < 66) return null;
		let digest = substr(line, 0, 64), reportedPath = substr(line, 66);
		if (!match(digest, /^[a-f0-9]{64}$/) || reportedPath != paths[i]) return null;
		digests[paths[i]] = digest;
	}
	return digests;
}

function sha256_file(path) {
	let digests = sha256_files([path]);
	return digests == null ? null : digests[path];
}

function load_manifest() {
	let raw = readfile(MANIFEST);
	if (!raw) return { ok: false, reason: 'native preflight manifest is missing' };
	let value = null;
	try { value = json(raw); } catch (e) { return { ok: false, reason: 'native preflight manifest is malformed' }; }
	if (type(value) != 'object' || value == null)
		return { ok: false, reason: 'native preflight manifest schema is unsupported' };
	if (value.schema != 'zapret2-manager.native-preflight.v1'
		&& value.schema != 'zapret2-manager.native-preflight.v2'
		&& value.schema != 'zapret2-manager.native-preflight.v3'
		&& value.schema != 'zapret2-manager.native-preflight.v4')
		return { ok: false, reason: 'native preflight manifest schema is unsupported' };
	if (value.schema == 'zapret2-manager.native-preflight.v1') {
		if (type(value.expectedNfqws2Sha256) != 'string' || length(value.expectedNfqws2Sha256) != 64)
			return { ok: false, reason: 'expectedNfqws2Sha256 is not pinned' };
		if (type(value.expectedLuaBundleSha256) != 'string' || length(value.expectedLuaBundleSha256) != 64)
			return { ok: false, reason: 'expectedLuaBundleSha256 is not pinned' };
	}
	if (type(value.minNfqws2CompatVer) != 'int' || value.minNfqws2CompatVer < 1)
		return { ok: false, reason: 'minimum nfqws2 compatibility is not pinned' };
	return { ok: true, value: value };
}

function runtime_composition_snapshot(input) {
	let value = input;
	if (type(value) != 'object' || value == null) {
		try { value = resolveInstalled({}); } catch (e) { value = null; }
	}
	if (type(value) != 'object' || value == null || value.ok != true
		|| value.lifecycleState != 'installed' || value.compositionStatus != 'canonical'
		|| type(value.snapshotId) != 'string' || type(value.compositionSnapshotId) != 'string'
		|| type(value.membershipDigest) != 'string' || type(value.runtimeAssets) != 'array'
		|| type(value.luaInit) != 'array' || type(value.dependencyIndex) != 'object')
		return { ok: false, reason: 'canonical installed runtime composition is unavailable' };
	let runtime = [], runtimePaths = [], lua = [], seen = {};
	for (let entry in value.runtimeAssets) {
		if (type(entry) != 'object' || entry == null || type(entry.id) != 'string' || seen[entry.id])
			return { ok: false, reason: 'runtime composition contains an invalid or duplicate entry' };
		let path = runtime_target_path(entry.runtimeTarget);
		if (path == null || type(entry.contentSha256) != 'string' || length(entry.contentSha256) != 64
			|| type(entry.byteSize) != 'int' || !stat(path))
			return { ok: false, reason: 'selected runtime asset is missing: ' + entry.id };
		push(runtimePaths, path);
		let metadata = stat(path);
		if (metadata == null || metadata.size != entry.byteSize)
			return { ok: false, reason: 'selected runtime asset identity does not match: ' + entry.id };
		seen[entry.id] = true; push(runtime, { id: entry.id, kind: entry.kind, type: entry.type,
			path: path, contentSha256: entry.contentSha256, byteSize: entry.byteSize });
	}
	for (let entry in value.luaInit) {
		if (type(entry) != 'object' || entry == null || entry.kind != 'lua' || entry.role != 'lua-init'
			|| type(entry.runtimeOrder) != 'int' || !seen[entry.id])
			return { ok: false, reason: 'ordered Lua closure is not a subset of runtimeAssets' };
		let path = runtime_target_path(entry.runtimeTarget);
		if (path == null || substr(path, -4) != '.lua') return { ok: false, reason: 'ordered Lua target is invalid' };
		push(lua, { id: entry.id, path: path, runtimeOrder: entry.runtimeOrder,
			contentSha256: entry.contentSha256, byteSize: entry.byteSize });
	}
	if (length(lua) == 0) return { ok: false, reason: 'canonical runtime composition has no ordered Lua closure' };
	let runtimeDigests = sha256_files(runtimePaths);
	if (runtimeDigests == null) return { ok: false, reason: 'selected runtime asset digests could not be verified' };
	for (let entry in runtime) {
		if (runtimeDigests[entry.path] != entry.contentSha256)
			return { ok: false, reason: 'selected runtime asset identity does not match: ' + entry.id };
	}
	let luaPaths = [];
	for (let entry in lua) push(luaPaths, entry.path);
	let luaDigests = sha256_files(luaPaths);
	if (luaDigests == null) return { ok: false, reason: 'ordered Lua digests could not be verified' };
	for (let entry in lua)
		if (luaDigests[entry.path] != entry.contentSha256)
			return { ok: false, reason: 'selected Lua identity does not match: ' + entry.id };
	return { ok: true, value: value, runtime: runtime, lua: lua };
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

function command_for(candidate, mode, luaFiles) {
	let tokens = z2m_tokenize(candidate).tokens;
	let cmd = 'cd /opt/zapret2 && ' + shell_escape(NFQWS2_BIN) + ' ' + mode + ' --qnum=30999';
	for (let i = 0; i < length(luaFiles); i++)
		cmd += ' --lua-init=' + shell_escape('@' + luaFiles[i]);
	for (let i = 0; i < length(tokens); i++) cmd += ' ' + shell_escape(runtime_argument_token(tokens[i].value));
	return cmd;
}

function diagnostics(reason, code) {
	return [{ severity: 'error', code: code, message: reason, tokenIndex: null, profileIndex: null }];
}

// Only the z2k_* TLS modifier family requires the retired/native Z2K TLS
// capability. Stock nfqws2 modifiers such as rnd, rndsni, sni, and dupsid
// are supported by the vanilla engine and must not be gated by this check.
function requires_z2k_tls_mod(candidate) {
	let tokenized = z2m_tokenize(candidate), tokens = tokenized && tokenized.tokens || [];
	for (let i = 0; i < length(tokens); i++) {
		let parts = split(tokens[i].value, ':');
		for (let j = 0; j < length(parts); j++) {
			if (substr(parts[j], 0, 8) == 'tls_mod=' && index(substr(parts[j], 8), 'z2k_') >= 0)
				return true;
		}
	}
	return false;
}

export { requires_z2k_tls_mod };

export const native_preflight = function(candidate, runtimeComposition, strategyDependencies) {
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
	let composition = runtime_composition_snapshot(runtimeComposition);
	if (!composition.ok)
		return { status: 'unavailable', coverage: coverage,
			diagnostics: diagnostics(composition.reason, 'RUNTIME_COMPOSITION_UNAVAILABLE'), evidence: evidence };
	evidence.snapshotId = composition.value.snapshotId;
	evidence.compositionSnapshotId = composition.value.compositionSnapshotId;
	evidence.membershipDigest = composition.value.membershipDigest;
	evidence.runtimeAssetIds = [];
	for (let entry in composition.runtime) push(evidence.runtimeAssetIds, entry.id);
	if (type(strategyDependencies) == 'object' && strategyDependencies != null) {
		evidence.dependencyIndex = composition.value.dependencyIndex;
		if (strategyDependencies.available != true) return { status: 'rejected', coverage: coverage,
			diagnostics: diagnostics('Strategy dependency closure is unavailable', 'EDEPENDENCY'), evidence: evidence };
	}

	if (!stat(NFQWS2_BIN))
		return { status: 'unavailable', coverage: coverage, diagnostics: diagnostics('nfqws2 binary is missing', 'NATIVE_UNAVAILABLE'), evidence: evidence };

	let manifest = load_manifest();
	if (!manifest.ok)
		return { status: 'partial', coverage: coverage, diagnostics: diagnostics(manifest.reason, 'PINNED_EVIDENCE_MISSING'), evidence: evidence };

	// Probe engine capabilities
	let binCaps = probe_binary_capabilities(NFQWS2_BIN);
	evidence.engineCapabilities = binCaps;

	// Check if candidate requires the z2k-prefixed TLS modifier family.
	let requiresZ2kTlsMod = requires_z2k_tls_mod(candidate);

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

	let luaPaths = [];
	for (let entry in composition.lua) {
		push(luaPaths, entry.path);
	}
	let luaDigests = sha256_files(luaPaths);
	if (luaDigests == null) return { status: 'rejected', coverage: coverage,
		diagnostics: diagnostics('selected Lua content identity could not be verified', 'LUA_RUNTIME_MISMATCH'), evidence: evidence };
	for (let entry in composition.lua)
		if (luaDigests[entry.path] != entry.contentSha256 || stat(entry.path).size != entry.byteSize)
			return { status: 'rejected', coverage: coverage,
				diagnostics: diagnostics('selected Lua content identity does not match the runtime snapshot', 'LUA_RUNTIME_MISMATCH'), evidence: evidence };
	let lua = lua_bundle_digest(luaPaths);
	if (!lua.ok)
		return { status: 'partial', coverage: coverage, diagnostics: diagnostics(lua.reason, 'LUA_BUNDLE_UNAVAILABLE'), evidence: evidence };
	evidence.luaBundleSha256 = lua.digest;
	if (manifest.value.expectedLuaBundleSha256 && lua.digest != manifest.value.expectedLuaBundleSha256) {
		coverage.luaCompatibility = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics('Lua bundle digest does not match the release manifest', 'LUA_DIGEST_MISMATCH'), evidence: evidence };
	}
	coverage.luaCompatibility = 'passed';

	let dry = run(command_for(candidate, '--dry-run', luaPaths));
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
	let luaRun = run(command_for(candidate, '--intercept=0', luaPaths));
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
export const install_proof = function(runtimeComposition) {
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
	let composition = runtime_composition_snapshot(runtimeComposition);
	if (!composition.ok) {
		caps.compositionStatus = 'unavailable';
		caps.compositionError = composition.reason;
		return caps;
	}
	caps.compositionStatus = 'canonical';
	caps.snapshotId = composition.value.snapshotId;
	caps.compositionSnapshotId = composition.value.compositionSnapshotId;
	caps.membershipDigest = composition.value.membershipDigest;
	if (!stat(NFQWS2_BIN)) return caps;
	let digest = sha256_file(NFQWS2_BIN);
	if (digest == null) return caps;
	caps.nfqws2Sha256 = digest;
	let luaDir = run('ls -la ' + shell_escape(RUNTIME_LUA_ROOT) + ' 2>&1');
	caps.luaDirListing = trim(luaDir.out);
	caps.libFile = 'missing';
	let luaPaths = [];
	for (let entry in composition.lua) {
		push(luaPaths, entry.path);
		if (substr(entry.path, -length('/zapret-lib.lua')) == '/zapret-lib.lua') caps.libFile = 'exists';
	}
	caps.whoami = trim(run('id').out);

	// Z2K_TLS_MOD: compiled-in option tokens (help output or binary strings).
	let binCaps = probe_binary_capabilities(NFQWS2_BIN);
	caps.Z2K_TLS_MOD = binCaps.Z2K_TLS_MOD === true
		&& index(run("strings " + shell_escape(NFQWS2_BIN) + " | grep -c 'z2k_alpn'").out || '', '0') != 0;

	// ANTIDPI_REPEATS_LOOP / AUTO_FAMILY_SPLIT: materialized Lua markers.
	let repeats = '';
	let autoLua = '';
	for (let path in luaPaths) {
		let body = readfile(path) || '';
		if (substr(path, -length('/zapret-antidpi.lua')) == '/zapret-antidpi.lua') repeats = body;
		if (substr(path, -length('/zapret-auto.lua')) == '/zapret-auto.lua') autoLua = body;
	}
	caps.ANTIDPI_REPEATS_LOOP = index(repeats, 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod') >= 0;
	caps.AUTO_FAMILY_SPLIT = index(autoLua, 'family_split') >= 0;

	// Lua init smoke through nfqws2 itself (no interception): every pinned
	// runtime Lua file must parse and initialize inside the daemon.
	let cmd = shell_escape(NFQWS2_BIN) + ' --dry-run --intercept=0 --qnum=30999';
	for (let i = 0; i < length(luaPaths); i++)
		cmd += ' --lua-init=' + shell_escape('@' + luaPaths[i]);
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
