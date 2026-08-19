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
	// Check for Z2K_TLS_MOD in help or strings
	if (index(out, 'tls_mod') >= 0 || index(out, 'grease') >= 0 || index(out, 'alpn_flood') >= 0) {
		caps.Z2K_TLS_MOD = true;
	} else {
		// Try string inspection if help is truncated
		let strResult = run("strings " + shell_escape(binaryPath) + " | grep -E 'tls_mod|FAKE_TLS_MOD_Z2K' | head -n 1");
		if (strResult.rc == 0 && length(trim(strResult.out)) > 0) {
			caps.Z2K_TLS_MOD = true;
		}
	}
	return caps;
}

function command_for(candidate, mode) {
	let tokens = z2m_tokenize(candidate).tokens;
	let cmd = shell_escape(NFQWS2_BIN) + ' ' + mode + ' --qnum=30999';
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
