'use strict';
// native-preflight.uc — production fail-closed verification for a rendered
// NFQWS2_OPT candidate. It never intercepts traffic and never mutates config.
// Verification requires a release-pinned engine digest and Lua bundle digest.

import { readfile, stat, popen } from 'fs';
import { z2m_tokenize, z2m_parse, z2m_validate } from './profiles.uc';

const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const MANIFEST = '/usr/share/zapret2-manager/native-preflight.json';
const ALLOWED_LUA_ROOT = '/opt/zapret2/';
// The catalog contains z2k desync/detector names that are not part of the
// official three-file Lua base. Preflight must execute the same extension
// chain that the production init script loads, otherwise valid Strategies
// are rejected before Apply with a false missing-function diagnosis.
const CUSTOM_LUA_INIT = [
	'/opt/zapret2/lua/z2k-modern-core.lua',
	'/opt/zapret2/lua/z2k-detectors.lua',
	'/opt/zapret2/lua/z2k-fooling-ext.lua',
	'/opt/zapret2/lua/z2k-state-persist.lua'
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
	if (type(value) != 'object' || value == null || value.schema != 'zapret2-manager.native-preflight.v1')
		return { ok: false, reason: 'native preflight manifest schema is unsupported' };
	if (type(value.expectedNfqws2Sha256) != 'string' || length(value.expectedNfqws2Sha256) != 64)
		return { ok: false, reason: 'expectedNfqws2Sha256 is not pinned' };
	if (type(value.expectedLuaBundleSha256) != 'string' || length(value.expectedLuaBundleSha256) != 64)
		return { ok: false, reason: 'expectedLuaBundleSha256 is not pinned' };
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

function command_for(candidate, mode) {
	let tokens = z2m_tokenize(candidate).tokens;
	// A Lua desync option is resolved only for an active profile.  Keep this
	// probe self-contained and harmless: port 443 is a throwaway filter and
	// --intercept=0 exits before binding or intercepting traffic.
	let cmd = shell_escape(NFQWS2_BIN) + ' ' + mode + ' --qnum=30999 --filter-tcp=443'
		+ ' --lua-init=@/opt/zapret2/lua/zapret-lib.lua'
		+ ' --lua-init=@/opt/zapret2/lua/zapret-antidpi.lua'
		+ ' --lua-init=@/opt/zapret2/lua/zapret-auto.lua';
	for (let i = 0; i < length(CUSTOM_LUA_INIT); i++)
		cmd += ' --lua-init=@' + shell_escape(CUSTOM_LUA_INIT[i]);
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

	let engineDigest = sha256_file(NFQWS2_BIN);
	evidence.nfqws2Sha256 = engineDigest;
	if (engineDigest != manifest.value.expectedNfqws2Sha256) {
		coverage.luaCompatibility = 'failed';
		return { status: 'rejected', coverage: coverage, diagnostics: diagnostics('nfqws2 digest does not match the release manifest', 'ENGINE_DIGEST_MISMATCH'), evidence: evidence };
	}

	let lua = lua_bundle_digest(manifest.value.luaFiles);
	if (!lua.ok)
		return { status: 'partial', coverage: coverage, diagnostics: diagnostics(lua.reason, 'LUA_BUNDLE_UNAVAILABLE'), evidence: evidence };
	evidence.luaBundleSha256 = lua.digest;
	if (lua.digest != manifest.value.expectedLuaBundleSha256) {
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
	// path and exits without binding/intercepting traffic. With exact engine and
	// Lua digests pinned, rc=0 is evidence for load, compatibility and reference
	// existence; it is not application/service acceptance.
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
		&& coverage.functionExistence == 'passed'
		&& coverage.blobExistence == 'passed'
		&& coverage.runtimeArguments == 'passed'
		&& coverage.executionPlan == 'passed';
	return { status: complete ? 'verified' : 'partial', coverage: coverage, diagnostics: [], evidence: evidence };
};
