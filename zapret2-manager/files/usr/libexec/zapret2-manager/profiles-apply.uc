'use strict';
// profiles-apply.uc — SAFE draft apply (SLICE 3). Mirrors
// tests/lib/profiles-apply.mjs (the node algorithm spec).
//
// PIPELINE (mode=apply; mode=preview stops after step 5):
//   1. load drafts (malformed/empty → refuse; NEVER wipe applied to empty)
//   2. render candidate: fragments joined with ' --new ' — each fragment must
//      parse to exactly one native profile with zero error diagnostics
//   3. round-trip proof: every fragment must survive the rendered document
//      byte-for-byte (edge whitespace trimmed) or the apply refuses
//   4. complete pinned native/Lua gate: CLI dry-run plus intercept=0 init
//      pass. partial/unavailable/not_checked → REFUSE before any write.
//   5. preview diff (sha256 of current vs candidate)
//   6. snapshot last-good: config + UCI (if present) + draft state + hashes +
//      generation metadata
//   7. whole-config CAS and durable atomic NFQWS2_OPT write through apply.uc —
//      dqEscape makes the candidate safe for the double-quoted shell
//      assignment; no second writer exists
//   8. restart only through the upstream /etc/init.d/zapret2 owner
//   9. invalidate the status cache, re-collect
//  10. verify FIVE checks (process present, exactly one nfqws2, rules
//      present, queue 300 registered, queue owner == daemon PID). Failure →
//      exact-byte rollback through apply.uc; config and runtime restoration
//      must both verify or the result is a critical manual-recovery failure.

import { readfile, writefile, stat, readlink, unlink, popen, mkdir } from 'fs';
import { read_var, set_var_cas, restore_whole_file, read_config_bytes, config_sha256 } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_parse, z2m_validate, z2m_fragment, z2m_tokenize } from './profiles.uc';
import { load_state } from './profiles-draft.uc';
import { parse_queue } from './qlen.uc';
import { native_preflight } from './native-preflight.uc';
import { collect_observations } from './core/status-collector.uc';
import { state_read } from './core/state-store.uc';
import { strategy_selection_get_readonly } from './strategy-state.uc';

const LASTGOOD_DIR = '/tmp/zapret2-manager/last-good';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const OPT_VAR = 'NFQWS2_OPT';
const MAX_CANDIDATE_BYTES = 262144;
const CONFIG_LOCK = getenv('Z2M_STRATEGY_CONFIG_LOCK') || '/opt/zapret2/config.lock';
const PROFILE_APPLY_CLI = getenv('Z2M_STRATEGY_PROFILE_CLI') || '/usr/libexec/zapret2-manager/profiles-apply-cli.uc';
const UCODE_BIN = getenv('Z2M_STRATEGY_UCODE_BIN') || '/usr/bin/ucode';
const STRATEGY_STATE_MODULE = getenv('Z2M_STRATEGY_STATE_MODULE') || '/usr/libexec/zapret2-manager/strategy-state.uc';
const PROJECTION_MARKER = 'z2m-strategy-apply-projection.v1';
const SCANNER_RUNTIME_ADAPTER = '/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh';
const SCANNER_RUNTIME_ROOT = '/tmp/zapret2-manager/scanner';
let APPLY_HOOK = null, APPLY_HOOK_LOADED = false, APPLY_HOOK_CURSOR = {};

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function apply_hook() {
	if (APPLY_HOOK_LOADED) return APPLY_HOOK;
	APPLY_HOOK_LOADED = true;
	let raw = getenv('Z2M_STRATEGY_APPLY_HOOK');
	if (raw == null || length(raw) > 65536) return null;
	try { APPLY_HOOK = json(raw); } catch (e) { APPLY_HOOK = null; }
	return type(APPLY_HOOK) == 'object' && APPLY_HOOK != null ? APPLY_HOOK : null;
}

function hook_value(section, name) {
	let hook = apply_hook(), group = hook != null ? hook[section] : null;
	if (type(group) != 'object' || group == null || group[name] == null) return null;
	let value = group[name];
	if (type(value) != 'array') return value;
	let cursor = APPLY_HOOK_CURSOR[section + ':' + name];
	if (type(cursor) != 'int') cursor = 0;
	let index = cursor < length(value) ? cursor : length(value) - 1;
	APPLY_HOOK_CURSOR[section + ':' + name] = cursor + 1;
	return index >= 0 ? value[index] : null;
}

function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

function err(stage, code, message, extra) {
	let e = { ok: false, stage: stage, error: { code: code, message: message } };
	if (extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) e[ks[i]] = extra[ks[i]];
	}
	return e;
}

function strategy_state_call(name, input) {
	let injected = hook_value('state', name);
	if (injected != null) return injected;
	let source = 'import { ' + name + ' } from ' + sprintf('%J', STRATEGY_STATE_MODULE)
		+ '; print(sprintf("%J", ' + name + '(' + (input == null ? '' : sprintf('%J', input)) + ')));';
	let answer = run(shell_escape(UCODE_BIN) + ' -e ' + shell_escape(source));
	if (answer.rc != 0) return err('identity', 'EINTERNAL', 'Strategy state hook failed');
	try { return json(answer.out); } catch (e) { return err('identity', 'EINTERNAL', 'Strategy state hook response is malformed'); }
}

function trim_ws(s) {
	let a = 0;
	while (a < length(s)) {
		let c = substr(s, a, 1);
		if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
		a++;
	}
	let b = length(s);
	while (b > a) {
		let c = substr(s, b - 1, 1);
		if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
		b--;
	}
	return substr(s, a, b - a);
}

function secure_request() {
	let p = popen("umask 077; mktemp /tmp/z2m-profile-apply.XXXXXX 2>/dev/null", 'r');
	if (!p) return null;
	let path = trim(p.read('all'));
	let rc = p.close();
	if (rc != 0 || !length(path)) return null;
	let check = run('[ -f ' + shell_escape(path) + ' ] && [ ! -L ' + shell_escape(path) + ' ] && chmod 600 ' + shell_escape(path));
	if (check.rc != 0) { try { unlink(path); } catch (e) { } return null; }
	return path;
}

function sha256_text_via_file(text) {
	let tmppath = secure_request();
	if (tmppath == null) return null;
	try { writefile(tmppath, text); } catch (e) {
		try { unlink(tmppath); } catch (ignored) { }
		return null;
	}
	let r = run("sha256sum " + shell_escape(tmppath) + " 2>/dev/null | awk '{print $1}'");
	try { unlink(tmppath); } catch (e) { }
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

function native_preflight_for_apply(candidate) {
	let injected = hook_value('transaction', 'preflight');
	return injected != null ? injected : native_preflight(candidate);
}

function scanner_safe_id(value) {
	return type(value) == 'string' && length(value) > 0 && length(value) <= 128
		&& match(value, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
}

function scanner_runtime_call(operation, sessionId, candidateId, generation, nonce) {
	if (index(['lock-acquire', 'lock-release', 'activate', 'stabilize', 'cleanup', 'session-cleanup'], operation) < 0
		|| !scanner_safe_id(sessionId) || !scanner_safe_id(candidateId)
		|| type(generation) != 'int' || generation < 0)
		return err('runtime', 'EINPUT', 'fixed Scanner runtime binding is invalid');
	let command = shell_escape(SCANNER_RUNTIME_ADAPTER) + ' ' + operation + ' '
		+ shell_escape(sessionId) + ' ' + shell_escape(candidateId) + ' ' + generation
		+ (nonce != null ? ' ' + shell_escape(nonce) : '');
	let result = run(command), raw = trim(result.out), value = null;
	try { value = length(raw) ? json(raw) : null; } catch (e) { value = null; }
	if (result.rc != 0 || type(value) != 'object' || value == null)
		return err('runtime', result.rc != 0 && value != null ? value.code : 'EDEPENDENCY', 'fixed Scanner runtime adapter failed', { adapter: value, rc: result.rc });
	return value;
}

export const profiles_transient_lock = function(sessionId) {
	if (!scanner_safe_id(sessionId)) return err('lock', 'EINPUT', 'Scanner session identity is invalid');
	return scanner_runtime_call('lock-acquire', sessionId, 'session', 0);
};

export const profiles_transient_unlock = function(sessionId, supplied) {
	if (!scanner_safe_id(sessionId)) return err('lock', 'EINPUT', 'Scanner session identity is invalid');
	let injected = getenv('Z2M_SCANNER_SERVER_TEST') == '1' && supplied != null ? supplied : null;
	if (injected != null) return injected;
	return scanner_runtime_call('lock-release', sessionId, 'session', 0, supplied);
};

function scanner_runtime_id(value) {
	let id = replace(value, /[^A-Za-z0-9._-]/g, '-');
	return scanner_safe_id(id) ? id : null;
}

function scanner_candidate_tokens(candidate) {
	let tokens = type(candidate.compiledTokens) == 'array' ? candidate.compiledTokens : null;
	if (tokens == null) {
		let parsed = z2m_tokenize(candidate.compiledCandidate);
		if (parsed == null || parsed.ok != true || type(parsed.tokens) != 'array') return null;
		tokens = [];
		for (let token in parsed.tokens) push(tokens, token.value);
	}
	if (!length(tokens) || length(tokens) > 256) return null;
	for (let token in tokens)
		if (type(token) != 'string' || !length(token) || index(token, '\n') >= 0 || index(token, '\r') >= 0 || index(token, chr(0)) >= 0) return null;
	return tokens;
}

function scanner_stage_candidate(candidate, compiled) {
	let tokens = scanner_candidate_tokens({ compiledCandidate: compiled.candidate }), expected = scanner_candidate_tokens(candidate), sessionId = candidate.sessionId;
	let runtimeId = scanner_runtime_id(candidate.scannerId);
	if (tokens == null || !scanner_safe_id(sessionId) || runtimeId == null
		|| type(compiled) != 'object' || compiled == null || type(compiled.candidate) != 'string'
		|| expected == null || sprintf('%J', tokens) != sprintf('%J', expected)
		|| compiled.candidate != join(' ', tokens) || compiled.compiledDigest != candidate.compiledDigest
		|| type(candidate.generation) != 'int' || candidate.generation < 0
		|| type(candidate.argvNonce) != 'string' || !match(candidate.argvNonce, /^[a-f0-9]{32,128}$/)) return false;
	let dir = SCANNER_RUNTIME_ROOT + '/' + sessionId, path = dir + '/' + runtimeId + '.argv';
	try { mkdir(SCANNER_RUNTIME_ROOT); } catch (e) { }
	try { mkdir(dir); } catch (e) { }
	let text = '';
	for (let token in tokens) text += token + '\n';
	let stage = function(destination, content) {
		let tmp = secure_temp(destination + '.tmp.XXXXXX');
		if (tmp == null) return false;
		try { writefile(tmp, content); } catch (e) { cleanup(tmp); return false; }
		let moved = command('mv -f ' + shell_escape(tmp) + ' ' + shell_escape(destination));
		if (moved.rc != 0) { cleanup(tmp); return false; }
		let metadata = stat(destination);
		return metadata != null && metadata.type == 'file' && readlink(destination) == null;
	};
	let sidecar = sprintf('%J', { schema: 1, session: sessionId, candidate: runtimeId,
		generation: candidate.generation, nonce: candidate.argvNonce, compiledDigest: candidate.compiledDigest }) + '\n';
	if (!stage(path, text) || !stage(path + '.digest', candidate.compiledDigest + '\n') || !stage(path + '.meta', sidecar)) return false;
	return readfile(path) == text && readfile(path + '.digest') == candidate.compiledDigest + '\n'
		&& readfile(path + '.meta') == sidecar;
}

function scanner_process_identity(value, owner) {
	return type(value) == 'object' && type(value.pid) == 'int' && value.pid > 0
		&& type(value.startTime) == 'int' && value.startTime > 0
		&& type(value.exe) == 'string' && value.exe == '/opt/zapret2/nfq2/nfqws2'
		&& type(value.argvSha256) == 'string' && match(value.argvSha256, /^[a-f0-9]{64}$/)
		&& value.owner == owner && type(value.generation) == 'int' && value.generation >= 0;
}

function scanner_input_safe(candidate) {
	return type(candidate) == 'object' && candidate.command == null && candidate.argv == null
		&& candidate.args == null && candidate.executable == null && candidate.path == null
		&& candidate.rawCommand == null && candidate.rawPath == null;
}

function dq_escape(s) {
	let out = '';
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == '\\') out += '\\\\';
		else if (c == chr(34)) out += '\\' + chr(34);
		else if (c == '$') out += '\\$';
		else if (c == '`') out += '\\`';
		else out += c;
	}
	return out;
}

export const profiles_render_candidate = function(profiles) {
	if (type(profiles) != 'array' || length(profiles) == 0)
		return err('load', 'ESTATE', 'no draft profiles to apply (refusing to replace the applied config with an empty set)');
	let failures = [];
	let frags = [];
	for (let i = 0; i < length(profiles); i++) {
		let p = profiles[i];
		let frag = trim_ws(p.opt != null ? p.opt : '');
		let errs = [];
		if (frag == '') {
			push(errs, { severity: 'error', code: 'MANAGER_EMPTY_PROFILE', message: 'draft ' + p.id + ': empty options fragment', tokenIndex: null, profileIndex: null });
		} else if (index(frag, '\n') >= 0 || index(frag, '\r') >= 0) {
			push(errs, { severity: 'error', code: 'MANAGER_FRAGMENT_MULTILINE', message: 'draft ' + p.id + ': fragment contains a raw newline (single-line fragments only)', tokenIndex: null, profileIndex: null });
		} else {
			let model = z2m_parse(frag);
			for (let di = 0; di < length(model.diagnostics); di++)
				if (model.diagnostics[di].severity == 'error') push(errs, model.diagnostics[di]);
			let vdiags = z2m_validate(model);
			for (let di = 0; di < length(vdiags); di++)
				if (vdiags[di].severity == 'error') push(errs, vdiags[di]);
			if (length(model.profiles) != 1 || length(model.trailingTokens) > 0)
				push(errs, { severity: 'error', code: 'MANAGER_FRAGMENT_NOT_SINGLE_PROFILE', message: 'draft ' + p.id + ': fragment must parse to exactly one profile (found ' + length(model.profiles) + ')', tokenIndex: null, profileIndex: null });
		}
		if (length(errs) > 0) push(failures, { id: (p.id != null) ? p.id : ('#' + i), index: i, diagnostics: errs });
		push(frags, frag);
	}
	if (length(failures) > 0)
		return err('render', 'EINPUT', length(failures) + ' draft fragment(s) are structurally unfit — refusing to apply', { failures: failures });
	let candidate = join(' --new ', frags);
	if (length(candidate) > MAX_CANDIDATE_BYTES)
		return err('render', 'EINPUT', 'candidate exceeds ' + MAX_CANDIDATE_BYTES + ' bytes');
	return { ok: true, candidate: candidate, fragments: frags };
};

function candidate_round_trip(candidate, frags) {
	let model = z2m_parse(candidate);
	if (length(model.profiles) != length(frags)) return false;
	for (let i = 0; i < length(frags); i++)
		if (z2m_fragment(model, model.profiles[i], candidate) != trim_ws(frags[i])) return false;
	return true;
}

// Pure proof hook for adapters that render through this module. The apply
// pipeline below remains the only transaction owner.
export const profiles_candidate_round_trip = candidate_round_trip;

function apply_decision(nv) {
	if (type(nv) != 'object' || nv == null || nv.status != 'verified')
		return { proceed: false, stage: 'validate' };
	let c = nv.coverage;
	if (type(c) != 'object' || c == null) return { proceed: false, stage: 'validate' };
	let complete = c.cliSyntax == 'passed'
		&& c.luaLoad == 'passed'
		&& c.luaCompatibility == 'passed'
		&& c.functionExistence == 'passed'
		&& c.blobExistence == 'passed'
		&& c.runtimeArguments == 'passed'
		&& c.executionPlan == 'passed';
	return { proceed: complete, stage: complete ? null : 'validate' };
}

function diff_summary(currentOpt, candidate) {
	let curSha = sha256_text_via_file(currentOpt != null ? currentOpt : '');
	let candSha = sha256_text_via_file(candidate);
	return {
		changed: curSha != candSha,
		currentSha256: curSha,
		candidateSha256: candSha,
		currentLength: length(currentOpt != null ? currentOpt : ''),
		candidateLength: length(candidate)
	};
}

function basename(path) {
	let parts = split(path, '/');
	return parts[length(parts) - 1];
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let r = run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

function snapshot_apply() {
	try { mkdir(LASTGOOD_DIR); } catch (e) { }
	let configBytes = read_config_bytes();
	let uciBytes = readfile(PATHS.uci_conf);
	if (uciBytes == null) uciBytes = '';
	let draftBytes = readfile(PATHS.draft_state);
	if (draftBytes == null) draftBytes = '';
	let configSnapshot = LASTGOOD_DIR + '/' + basename(PATHS.applied_conf);
	let uciSnapshot = LASTGOOD_DIR + '/' + basename(PATHS.uci_conf);
	writefile(configSnapshot, configBytes);
	writefile(uciSnapshot, uciBytes);
	writefile(LASTGOOD_DIR + '/state.json', draftBytes);
	let st = { config: config_sha256(), uci: sha256_file(PATHS.uci_conf), captured_at: time() };
	writefile('/tmp/zapret2-manager/applied.sha256', sprintf("%J", st) + '\n');
	let gen = null;
	try {
		let raw = readfile(PATHS.status_json);
		if (raw) {
			let sj = json(raw);
			if (type(sj) == 'object' && sj != null && type(sj.generation) == 'int') gen = sj.generation;
		}
	} catch (e) { }
	writefile(LASTGOOD_DIR + '/generation.prev', '' + (gen != null ? gen : 'unknown') + '\n');
	return {
		configBytes: configBytes, uciBytes: uciBytes,
		configSha256: st.config, uciSha256: st.uci, generation: gen,
		configSnapshot: configSnapshot, uciSnapshot: uciSnapshot
	};
}

function transaction_snapshot(injected) {
	return injected != null ? injected : snapshot_apply();
}

function transaction_cas(candidate, expectedHash, snapshot, injected) {
	return injected != null ? injected : set_var_cas(OPT_VAR, dq_escape(candidate), snapshot.configSha256);
}

function transaction_restart(attempt, injected) {
	if (injected != null) return injected;
	return run(UPSTREAM_INIT + ' restart');
}

function verify_status(sj, q, allow_external_nfqws) {
	let rt = (type(sj) == 'object' && sj != null && type(sj.runtime) == 'object') ? sj.runtime : {};
	let count = (type(rt.count) == 'int') ? rt.count
		: ((type(rt.instances) == 'array') ? length(rt.instances) : 0);
	let pid = null;
	if (type(rt.instances) == 'array' && length(rt.instances) == 1) pid = rt.instances[0].pid;
	else if (allow_external_nfqws && type(rt.instances) == 'array')
		for (let i = 0; i < length(rt.instances); i++)
			if (q.peer_portid != null && rt.instances[i].pid == q.peer_portid) { pid = rt.instances[i].pid; break; }
	let checks = {
		processPresent: count >= 1,
		singleInstance: count == 1 || (allow_external_nfqws && pid != null),
		rulesPresent: rt.rulesPresent == true,
		queueRegistered: q.registered == true,
		ownerMatch: pid != null && q.peer_portid != null && q.peer_portid == pid
	};
	let ok = checks.processPresent && checks.singleInstance && checks.rulesPresent && checks.queueRegistered && checks.ownerMatch;
	return { ok: ok, checks: checks, daemonPid: pid, queueOwner: q.peer_portid };
}

function transaction_verify(attempt, allow_external_nfqws, injected) {
	if (injected != null) return injected;
	return verify_status(recollect_status(), parse_queue(), allow_external_nfqws);
}

function transaction_restore(snapshot, injected) {
	if (injected != null) return injected.restoreOk == true ? { ok: true } : null;
	return restore_whole_file(PATHS.applied_conf, snapshot.configBytes);
}

function transaction_config_hash(injected) {
	return injected != null && injected.configSha256 != null ? injected.configSha256 : config_sha256();
}

function transaction_config_bytes(injected) {
	return injected != null && injected.configBytes != null ? injected.configBytes : read_config_bytes();
}

export const profiles_rollback_decision = function(restartRc, verifyOk, configRestored, rollbackRestartRc, rollbackVerifyOk) {
	let rollbackRequired = restartRc != 0 || !verifyOk;
	return {
		rollbackRequired: rollbackRequired,
		rollbackOk: rollbackRequired && configRestored && rollbackRestartRc == 0 && rollbackVerifyOk
	};
};

function recollect_status() {
	try { unlink(PATHS.status_json); } catch (e) { }
	let p = popen('/usr/bin/ucode ' + PATHS.collector + ' --no-print 2>/dev/null', 'r');
	if (p) { p.read('all'); p.close(); }
	let raw = readfile(PATHS.status_json);
	if (!raw) return null;
	let sj = null;
	try { sj = json(raw); } catch (e) { return null; }
	return sj;
}

function event_apply(severity, msg, extra) {
	try {
		let ts = trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out);
		if (!length(ts)) ts = '' + time();
		let prev = readfile(PATHS.events_ndjson);
		if (!prev) prev = '';
		let id = 'apply-' + time() + '-' + length(split(prev, '\n'));
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = ts; ev.id = id;
		ev.category = 'config'; ev.severity = severity; ev.source = 'ui'; ev.msg = msg;
		writefile(PATHS.events_ndjson, prev + sprintf("%J", ev) + '\n');
	} catch (e) { }
}

function load_drafts_or_refuse() {
	let ls = load_state();
	if (!ls.ok) return { refuse: err('load', 'ESTATE', 'draft state is malformed — refusing to apply: ' + ls.reason) };
	if (length(ls.state.profiles) == 0) return { refuse: err('load', 'ESTATE', 'no draft profiles to apply (refusing to replace the applied config with an empty set)') };
	return { state: ls.state };
}

function projection_valid(value, candidateHash) {
	return type(value) == 'object' && value != null
		&& value.callerContext == 'strategy_apply'
		&& type(value.operationNonce) == 'string' && length(value.operationNonce) > 0 && length(value.operationNonce) <= 256
		&& value.candidateSha256 == candidateHash && type(value.expectedRevision) == 'int'
		&& type(value.selectionRevision) == 'int' && type(value.strategyRevision) == 'int'
		&& type(value.strategyId) == 'string' && type(value.strategyOrigin) == 'string'
		&& type(value.catalogDigest) == 'string' && match(value.catalogDigest, /^[a-f0-9]{64}$/)
		&& type(value.previousCandidateSha256) == 'string' && match(value.previousCandidateSha256, /^[a-f0-9]{64}$/)
		&& (value.expectedSelected == null || type(value.expectedSelected) == 'object')
		&& (value.previousSelected == null || type(value.previousSelected) == 'object')
		&& (value.selected == null || type(value.selected) == 'object');
}

export const profiles_projection_boundary = function(candidateHash) {
	let path = getenv('Z2M_STRATEGY_PROJECTION_PATH');
	let nonce = getenv('Z2M_STRATEGY_PROJECTION_NONCE');
	let marker = getenv('Z2M_STRATEGY_PROJECTION_MARKER');
	let caller = getenv('Z2M_STRATEGY_PROJECTION_CALLER');
	if (path == null && nonce == null && marker == null && caller == null)
		return { ok: true, present: false, projection: null };
	if (type(path) != 'string' || type(nonce) != 'string' || marker != PROJECTION_MARKER || caller != 'strategy_apply')
		return err('identity', 'EINPUT', 'Strategy projection boundary marker is incomplete');
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata == null || metadata.type != 'file' || readlink(path) != null
		|| metadata.mode % 512 != 384 || type(metadata.size) != 'int' || metadata.size > 8192)
		return err('identity', 'EINPUT', 'Strategy projection sidecar is not a private regular file');
	let envelope = null;
	try { envelope = json(readfile(path)); } catch (e) { envelope = null; }
	if (type(envelope) != 'object' || envelope == null || envelope.schema != 1
		|| envelope.marker != PROJECTION_MARKER || envelope.callerContext != caller
		|| envelope.transactionNonce != nonce || envelope.candidateSha256 != candidateHash
		|| !projection_valid(envelope.projection, candidateHash))
		return err('identity', 'EINPUT', 'Strategy projection sidecar marker or transaction binding is invalid');
	return { ok: true, present: true, projection: envelope.projection };
};

function projection_identity_equal(left, right) {
	if (left == null || right == null) return left == right;
	return left.id == right.id && left.origin == right.origin
		&& left.revision == right.revision && left.candidateSha256 == right.candidateSha256;
}

function restore_projection_identity(projection) {
	if (projection == null) return { ok: true, skipped: true };
	let current = strategy_state_call('strategy_selection_get', null);
	if (!current.ok) return current;
	if (!projection_identity_equal(current.selected, projection.selected))
		return { ok: true, skipped: true };
	return strategy_state_call('strategy_selection_restore', { expectedRevision: current.revision, selected: projection.previousSelected, applyNonce: projection.operationNonce });
}

export const profiles_strategy_failure_decision = function(input) {
	if (input != null && input.primaryFailed == true && input.rollbackVerified == true && input.identityRestored == true)
		return { uncertain: false, rolledBack: true };
	return { uncertain: true, rolledBack: false };
};

function uncertain_projection(projection, snap, newConfigHash, runtimeOutcome, reason) {
	if (projection == null) return { ok: false, error: { code: 'EINTERNAL', message: reason } };
	return strategy_state_call('strategy_apply_uncertain_record', {
		oldConfigSha256: snap.configSha256, newConfigSha256: newConfigHash,
		oldCandidateSha256: projection.previousCandidateSha256, newCandidateSha256: projection.candidateSha256,
		catalogDigest: projection.catalogDigest,
		oldIdentity: projection.previousSelected, newIdentity: projection.selected,
		runtimeOutcome: runtimeOutcome, reason: reason, applyNonce: projection.operationNonce
	});
}

function pipeline_front() {
	let ld = load_drafts_or_refuse();
	if (ld.refuse) return { refuse: ld.refuse };
	let rc = profiles_render_candidate(ld.state.profiles);
	if (!rc.ok) return { refuse: rc };
	if (!candidate_round_trip(rc.candidate, rc.fragments))
		return { refuse: err('render', 'EINTERNAL', 'round trip lost content — refusing to apply (MANAGER_LOSSY_ROUNDTRIP)') };
	let native = native_preflight(rc.candidate);
	let cur = read_var(OPT_VAR);
	let diff = diff_summary(cur != null ? cur : '', rc.candidate);
	return { candidate: rc.candidate, fragments: rc.fragments, native: native, diff: diff, draftCount: length(ld.state.profiles) };
}

export const profiles_apply_preview = function() {
	let f = pipeline_front();
	if (f.refuse) return f.refuse;
	let decision = apply_decision(f.native);
	return {
		ok: true, mode: 'preview', draftCount: f.draftCount,
		candidate: f.candidate, diff: f.diff, native: f.native,
		wouldApply: decision.proceed,
		refuseReason: decision.proceed ? null : 'native validation did not pass (status: ' + f.native.status + ')'
	};
};

function apply_candidate_pipeline(f) {
	if (getenv('Z2M_CONFIG_LOCKED') != '1' && apply_hook() == null)
		return err('lock', 'ELOCK', 'config transaction lock is not held — nothing was written');
	let decision = apply_decision(f.native);
	if (!decision.proceed)
		return err('validate', 'EPREFLIGHT', 'complete pinned native/Lua validation is required — nothing was written', { native: f.native });

	let la_raw = readfile('/tmp/zapret2-manager/last-apply.json');
	if (la_raw) {
		let la = null;
		try { la = json(la_raw); } catch (e) { la = null; }
		if (type(la) == 'object' && la != null && la.candidateSha256 == f.diff.candidateSha256) {
			let age = time() - (type(la.at) == 'int' ? la.at : 0);
			let currentMatches = read_var(OPT_VAR) == f.candidate;
			let cachedVerifyHook = hook_value('transaction', 'verify');
			let currentVerify = currentMatches
				? (cachedVerifyHook != null ? transaction_verify(0, f.allowExternalNfqws == true, cachedVerifyHook)
					: verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true)) : null;
			if (age >= 0 && age < 60 && currentMatches && currentVerify.ok && f.projection == null)
				return { ok: true, mode: 'apply', idempotent: true,
					note: 'identical candidate was applied ' + age + 's ago — rollback baseline preserved',
					applied: { profiles: f.draftCount, candidateSha256: f.diff.candidateSha256 },
					verify: currentVerify,
					rollback: { available: true, armed: false } };
		}
	}

	let snapshotHook = hook_value('transaction', 'snapshot');
	let snap = snapshotHook != null ? transaction_snapshot(snapshotHook) : snapshot_apply();
	if (snap.configSha256 == null)
		return err('snapshot', 'ETARGET', 'unable to hash the locked upstream config — nothing was written');
	if (f.projection != null && f.projection.expectedConfigSha256 != null
		&& f.projection.expectedConfigSha256 != snap.configSha256)
		return err('validate', 'ECONFLICT', 'upstream config changed before Strategy Apply mutation', { expected: f.projection.expectedConfigSha256, actual: snap.configSha256 });
	if (f.projection != null) {
		let currentIdentity = strategy_state_call('strategy_apply_revalidate', {
			applyNonce: f.projection.operationNonce, strategyId: f.projection.strategyId,
			strategyOrigin: f.projection.strategyOrigin, strategyRevision: f.projection.strategyRevision,
			catalogDigest: f.projection.catalogDigest, selectionRevision: f.projection.selectionRevision,
			expectedSelected: f.projection.expectedSelected
		});
		if (!currentIdentity.ok)
			return err('validate', 'ECONFLICT', 'Strategy identity changed before config mutation', { identity: currentIdentity });
	}
	let casHook = hook_value('transaction', 'cas');
	let cas = casHook != null ? transaction_cas(f.candidate, f.diff.candidateSha256, snap, casHook)
		: set_var_cas(OPT_VAR, dq_escape(f.candidate), snap.configSha256);
	if (type(cas) != 'object' || cas == null || cas.ok != true) {
		let code = (cas && cas.code) ? cas.code : 'EWRITE';
		return err('write', code, code == 'ECONFLICT'
			? 'upstream config changed after validation — nothing was written'
			: 'durable atomic config write failed', { snapshot: snap, cas: cas });
	}

	let restartHook = hook_value('transaction', 'restart');
	let r = restartHook != null ? transaction_restart(0, restartHook) : run(UPSTREAM_INIT + ' restart');
	run('sleep 2');
	let verifyHook = hook_value('transaction', 'verify');
	let verify = verifyHook != null ? transaction_verify(0, f.allowExternalNfqws == true, verifyHook)
		: verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true);
	let rollbackDecision = profiles_rollback_decision(r.rc, verify.ok, false, -1, false);
	let identity = null, identityRetry = null, identityFailure = false;
	if (!rollbackDecision.rollbackRequired && f.projection != null) {
		identity = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		if (!identity.ok) identityRetry = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		identityFailure = !identity.ok && (identityRetry == null || !identityRetry.ok);
		if (identityFailure) rollbackDecision.rollbackRequired = true;
	}
	if (rollbackDecision.rollbackRequired) {
		let rollbackHook = hook_value('transaction', 'rollback');
		let restored = rollbackHook != null ? transaction_restore(snap, rollbackHook)
			: restore_whole_file(PATHS.applied_conf, snap.configBytes);
		if (snap.uciBytes != null) writefile(PATHS.uci_conf, snap.uciBytes);
		let rollbackRestartHook = hook_value('transaction', 'restart');
		let rr = rollbackRestartHook != null ? transaction_restart(1, rollbackRestartHook) : run(UPSTREAM_INIT + ' restart');
		run('sleep 2');
		let rollbackVerifyHook = hook_value('transaction', 'verify');
		let rollbackVerify = rollbackVerifyHook != null ? transaction_verify(1, f.allowExternalNfqws == true, rollbackVerifyHook)
			: verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true);
		let configRestored = restored != null
			&& (rollbackHook != null ? transaction_config_hash(rollbackHook) == snap.configSha256 : config_sha256() == snap.configSha256)
			&& (rollbackHook != null ? transaction_config_bytes(rollbackHook) == snap.configBytes : read_config_bytes() == snap.configBytes);
		let rollbackOk = identityFailure
			? (configRestored && rr.rc == 0 && rollbackVerify.ok)
			: profiles_rollback_decision(r.rc, verify.ok, configRestored, rr.rc, rollbackVerify.ok).rollbackOk;
		let identityRestored = restore_projection_identity(f.projection);
		if (!identityRestored.ok) rollbackOk = false;
		if (!rollbackOk) {
			let uncertain = uncertain_projection(f.projection, snap, cas.configSha256, {
				initial: verify.checks, rollback: rollbackVerify.checks, restartRc: r.rc,
				rollbackRestartRc: rr.rc, configRestored: configRestored, identityRestored: identityRestored.ok
			}, 'rollback or identity restoration could not be verified');
			event_apply('crit', 'APPLY FAILED AND EXACT ROLLBACK VERIFICATION FAILED — manual recovery required', {
				restartRc: r.rc, verify: verify.checks, rollbackRestartRc: rr.rc,
				rollbackVerify: rollbackVerify.checks, configRestored: configRestored
			});
			return err('rollback', f.projection != null ? 'EVERIFY' : 'EINTERNAL', f.projection != null
				? 'Strategy Apply is uncertain — explicit reconciliation is required'
				: 'apply failed and exact rollback could not be verified — MANUAL RECOVERY REQUIRED', {
				verify: verify, rollbackOk: false, rollbackVerify: rollbackVerify,
				configRestored: configRestored, identityRestored: identityRestored,
				uncertain: f.projection != null, critical: f.projection == null, rolledBack: false,
				uncertaintyPersistence: uncertain
			});
		}
		if (identityFailure) {
			return err('identity', 'EVERIFY', 'Strategy Apply identity commit failed after exact rollback', {
				uncertain: false, rolledBack: true, rollbackOk: true, identity: identityRetry || identity
			});
		}
		event_apply('crit', 'apply failed verification; exact snapshot restored and verified', {
			restartRc: r.rc, verify: verify.checks, rollbackVerify: rollbackVerify.checks,
			configRestored: configRestored
		});
		return err('verify', 'ETARGET', 'apply failed verification — exact last-good snapshot restored and verified', {
			verify: verify, rolledBack: true, rollbackOk: true,
			rollbackVerify: rollbackVerify, configRestored: configRestored
		});
	}

	event_apply('info', 'draft profiles applied (' + f.draftCount + ' profiles) and verified', {
		profiles: f.draftCount, candidateSha256: f.diff.candidateSha256,
		configSha256: cas.configSha256
	});
	writefile('/tmp/zapret2-manager/last-apply.json',
		sprintf("%J", { candidateSha256: f.diff.candidateSha256, configSha256: cas.configSha256, at: time() }) + '\n');
	return {
		ok: true, mode: 'apply',
		applied: { profiles: f.draftCount, candidateSha256: f.diff.candidateSha256, configSha256: cas.configSha256 },
		verify: verify, snapshot: snap, identity: f.projection == null ? null : (identityRetry && identityRetry.ok ? identityRetry : identity),
		identityRetry: identityRetry,
		rollback: { available: true, armed: false, exactSnapshot: true }
	};
}

function locked_candidate_call(candidate, expectedHash, projection) {
	let request = secure_request();
	if (request == null) return err('lock', 'ELOCK', 'unable to create secure transaction request');
	let sidecar = null;
	if (projection != null) {
		if (!projection_valid(projection, expectedHash)) {
			try { unlink(request); } catch (e) { }
			return err('identity', 'EINPUT', 'Strategy projection context is invalid');
		}
		sidecar = request + '.strategy-projection';
		let envelope = { schema: 1, marker: PROJECTION_MARKER, callerContext: 'strategy_apply',
			transactionNonce: request, candidateSha256: expectedHash, projection: projection };
		try { writefile(sidecar, sprintf('%J', envelope) + '\n'); } catch (e) {
			try { unlink(request); } catch (ignored) { }
			try { unlink(sidecar); } catch (ignored) { }
			return err('lock', 'ELOCK', 'unable to persist the private Strategy projection envelope');
		}
		let secured = run('chmod 600 ' + shell_escape(sidecar));
		if (secured.rc != 0) {
			try { unlink(request); } catch (ignored) { }
			try { unlink(sidecar); } catch (ignored) { }
			return err('lock', 'ELOCK', 'unable to secure the private Strategy projection sidecar');
		}
	}
	try { writefile(request, sprintf("%J", { candidate: candidate, expectedHash: expectedHash }) + '\n'); } catch (e) {
		try { unlink(request); } catch (ignored) { }
		if (sidecar != null) try { unlink(sidecar); } catch (ignored) { }
		return err('lock', 'ELOCK', 'unable to persist the private Strategy transaction request');
	}
	let inner = shell_escape(UCODE_BIN) + ' ' + shell_escape(PROFILE_APPLY_CLI) + ' candidate ' + shell_escape(request);
	let projectionEnv = sidecar == null ? 'unset Z2M_STRATEGY_PROJECTION_PATH Z2M_STRATEGY_PROJECTION_NONCE Z2M_STRATEGY_PROJECTION_MARKER Z2M_STRATEGY_PROJECTION_CALLER; '
		: 'Z2M_STRATEGY_PROJECTION_PATH=' + shell_escape(sidecar)
			+ ' Z2M_STRATEGY_PROJECTION_NONCE=' + shell_escape(request)
			+ ' Z2M_STRATEGY_PROJECTION_MARKER=' + shell_escape(PROJECTION_MARKER)
			+ ' Z2M_STRATEGY_PROJECTION_CALLER=' + shell_escape('strategy_apply') + ' ';
	let cmd = projectionEnv + 'Z2M_CONFIG_LOCKED=1 '
		+ 'flock -x ' + shell_escape(CONFIG_LOCK) + ' -c ' + shell_escape(inner);
	let answer = run(cmd);
	try { unlink(request); } catch (e) { }
	if (sidecar != null) try { unlink(sidecar); } catch (e) { }
	if (answer.rc != 0 && !length(trim(answer.out))) return err('lock', 'ELOCK', 'transaction process failed before returning a result');
	try { return json(answer.out); }
	catch (e) { return err('lock', 'EINTERNAL', 'transaction response is malformed'); }
}

function profiles_apply_candidate_locked(candidate, expectedHash, projection) {
	let model = z2m_parse(candidate), diags = z2m_validate(model);
	for (let d in model.diagnostics) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has parse errors', { diagnostics: model.diagnostics });
	for (let d in diags) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has validation errors', { diagnostics: diags });
	let native = native_preflight_for_apply(candidate), cur = hook_value('transaction', 'currentOpt');
	if (cur == null) cur = read_var(OPT_VAR);
	let diff = diff_summary(cur != null ? cur : '', candidate);
	if (expectedHash != null && diff.candidateSha256 != expectedHash)
		return err('validate', 'ECONFLICT', 'typed candidate hash changed before mutation', { expected: expectedHash, actual: diff.candidateSha256 });
	let boundary = profiles_projection_boundary(expectedHash);
	if (!boundary.ok) return boundary;
	if (projection != null && !projection_valid(projection, expectedHash))
		return err('identity', 'EINPUT', 'Strategy projection context is invalid');
	let internalProjection = projection != null ? projection : boundary.projection;
	return apply_candidate_pipeline({ candidate: candidate, fragments: [], native: native, diff: diff,
		 draftCount: length(model.profiles), allowExternalNfqws: true, projection: internalProjection });
}

export const profiles_apply_candidate = function(candidate, expectedHash, projection) {
	if (type(candidate) != 'string' || !length(candidate) || length(candidate) > MAX_CANDIDATE_BYTES)
		return err('render', 'EINPUT', 'typed candidate is missing or exceeds the safe size limit');
	// The locked helper rejects diff.candidateSha256 != expectedHash before mutation.
	// It invokes apply_candidate_pipeline({ candidate: candidate, ... }) as the sole transaction.
	if (getenv('Z2M_CONFIG_LOCKED') != '1')
		return locked_candidate_call(candidate, expectedHash, projection);
	return profiles_apply_candidate_locked(candidate, expectedHash, projection);
};

export const profiles_config_hash = function() {
	let injected = hook_value('transaction', 'configHash');
	return injected != null ? injected : config_sha256();
};
export const profiles_candidate_hash = function() {
	let injected = hook_value('transaction', 'candidateHash');
	if (injected != null) return injected;
	let current = read_var(OPT_VAR);
	return current == null ? null : sha256_text_via_file(current);
};

export const profiles_reconcile_evidence = function() {
	let injected = hook_value('reconciliation', 'evidence');
	if (injected != null) return injected;
	let configHash = config_sha256(), currentOpt = read_var(OPT_VAR);
	if (configHash == null || currentOpt == null)
		return err('reconcile', 'EVERIFY', 'authoritative config evidence is unavailable');
	let candidateHash = sha256_text_via_file(currentOpt);
	let runtime = verify_status(recollect_status(), parse_queue(), true);
	if (candidateHash == null || type(runtime) != 'object' || runtime.checks == null)
		return err('reconcile', 'EVERIFY', 'authoritative runtime evidence is unavailable');
	return { ok: true, evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: configHash,
		activeCandidateSha256: candidateHash, runtimeChecks: runtime.checks };
};

export const profiles_apply_run = function() {
	if (getenv('Z2M_CONFIG_LOCKED') != '1')
		return err('lock', 'ELOCK', 'draft apply must run inside the config transaction lock');
	let f = pipeline_front();
	if (f.refuse) return f.refuse;
	return apply_candidate_pipeline(f);
};

// These are the only transient runtime seams. Production callers must provide
// server-owned runtime adapters; tests may inject bounded evidence through the
// existing server-test hook. None of these functions changes config or
// Strategy identity.
function transient_test_value(name, supplied) {
	if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') return null;
	if (type(supplied) == 'array') return length(supplied) > 0 ? supplied[0] : null;
	if (supplied != null) return supplied;
	return hook_value('transient', name);
}

export const profiles_transient_compile_preflight = function(candidate, supplied) {
	if (type(candidate) != 'object' || candidate == null || type(candidate.compiledCandidate) != 'string'
		|| !length(candidate.compiledCandidate) || type(candidate.compiledDigest) != 'string'
		|| !match(candidate.compiledDigest, /^[a-f0-9]{64}$/))
		return err('preflight', 'EINPUT', 'Scanner candidate is not a server-owned compiled value');
	let candidateTokens = scanner_candidate_tokens(candidate);
	if (candidateTokens == null) return err('preflight', 'ECONFLICT', 'candidate token stream is invalid');
	if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') {
		let candidateHash = sha256_text_via_file(candidate.compiledCandidate);
		if (candidateHash == null || candidateHash != candidate.compiledDigest)
			return err('preflight', 'ECONFLICT', 'candidate token stream does not match its compiled digest');
	}
	let injected = transient_test_value('compile', supplied);
	if (injected != null) {
		if (injected.ok != true || type(injected.candidate) != 'string'
			|| (injected.candidate != candidate.compiledCandidate)
			|| (injected.dependencies != null && injected.dependencies.available != true)
			|| (injected.native != null && injected.native.status != 'verified'))
			return err('preflight', injected.candidate != candidate.compiledCandidate ? 'ECONFLICT' : 'EPREFLIGHT', 'candidate preflight or compiled output was refused', { native: injected.native, dependencies: injected.dependencies });
		if (injected.compiledDigest != candidate.compiledDigest
			|| type(injected.compiledTokens) != 'array'
			|| sprintf('%J', injected.compiledTokens) != sprintf('%J', candidateTokens))
			return err('preflight', 'ECONFLICT', 'compiled output does not match the candidate token stream');
		injected.compiledTokens = candidateTokens;
		return injected;
	}
	let native = native_preflight_for_apply(candidate.compiledCandidate);
	if (!apply_decision(native)) return err('preflight', 'EPREFLIGHT', 'complete native preflight is required', { native: native });
	return { ok: true, candidate: candidate.compiledCandidate, compiledTokens: candidateTokens, compiledDigest: candidate.compiledDigest,
		dependencyDigest: candidate.dependencyDigest, dependencies: candidate.dependencies, native: native };
};

export const profiles_transient_snapshot = function(supplied) {
	if (getenv('Z2M_SCANNER_SERVER_TEST') == '1' && supplied != null) return supplied;
	let observations = null, selection = null;
	try { observations = collect_observations(); selection = strategy_selection_get_readonly(); } catch (e) {
		return err('snapshot', 'EUNAVAILABLE', 'runtime and Strategy identity snapshot is unavailable');
	}
	if (type(observations) != 'object' || observations == null || type(selection) != 'object' || selection == null || selection.ok != true)
		return err('snapshot', 'EUNAVAILABLE', 'runtime and Strategy identity snapshot is incomplete');
	let configBytes = read_config_bytes(), configSha = config_sha256();
	if (configSha == null) return err('snapshot', 'EUNAVAILABLE', 'authoritative config snapshot is unavailable');
	let instances = observations.runtime && type(observations.runtime.instances) == 'array'
		? observations.runtime.instances : [], rawProcess = length(instances) == 1 ? instances[0] : null;
	let nativeState = null;
	try { nativeState = state_read(); } catch (e) { nativeState = null; }
	let generation = nativeState && nativeState.ok == true && type(nativeState.generation) == 'int'
		? nativeState.generation : null;
	let process = rawProcess == null ? null : {
		pid: rawProcess.pid, startTime: rawProcess.startTimeTick, exe: rawProcess.exe,
		argvSha256: rawProcess.argvSha256, owner: rawProcess.owner,
		generation: generation
	};
	if (!scanner_process_identity(process, 'runtime/nfqws2') || generation == null)
		return err('snapshot', 'EUNAVAILABLE', 'complete live process identity is unavailable');
	let queue = observations.health && observations.health.queue;
	if (type(queue) != 'object' || queue.registered != true || queue.peerPortid != process.pid)
		return err('snapshot', 'EUNAVAILABLE', 'authoritative NFQUEUE ownership is unavailable');
	return { ok: true, config: { bytes: configBytes, sha256: configSha },
		identity: { selected: selection.selected, revision: selection.revision },
		runtime: { process: process, rules: observations.runtime.rulesPresent == true,
			nfqueue: { registered: true, peer_portid: queue.peerPortid } },
		firewall: { table: 'zapret2', rulesPresent: observations.runtime && observations.runtime.rulesPresent == true,
			nfqueue: queue,
			owner: 'runtime/firewall', generation: generation },
		artifacts: { config: '/opt/zapret2/config', firewall: 'zapret2', nfqueue: 300,
			hostlist: null, temporaryRoot: SCANNER_RUNTIME_ROOT },
		reconciliation: { generation: generation,
			reference: 'pre-scan-runtime' } };
};

export const profiles_transient_activate = function(candidate, compiled, supplied) {
	let injected = transient_test_value('activate', supplied);
	if (injected != null) return injected;
	if (!scanner_input_safe(candidate) || type(candidate) != 'object' || candidate == null || !scanner_stage_candidate(candidate, compiled))
		return err('activate', 'EINPUT', 'server-owned compiled candidate staging failed');
	return scanner_runtime_call('activate', candidate.sessionId, scanner_runtime_id(candidate.scannerId),
		type(candidate.generation) == 'int' ? candidate.generation : 0);
};

export const profiles_transient_session_cleanup = function(sessionId, generation, supplied) {
	let injected = getenv('Z2M_SCANNER_SERVER_TEST') == '1' && supplied != null ? supplied : null;
	if (injected != null) return injected;
	return scanner_runtime_call('session-cleanup', sessionId, 'session', generation);
};

export const profiles_transient_stabilize = function(attempt, supplied) {
	let injected = transient_test_value('stabilize', supplied);
	if (injected != null) return injected;
	if (type(attempt) != 'object' || attempt == null || type(attempt.candidate) != 'object')
		return err('stabilize', 'EINPUT', 'transient stabilization binding is invalid');
	let candidate = attempt.candidate;
	return scanner_runtime_call('stabilize', candidate.sessionId, scanner_runtime_id(candidate.scannerId),
		type(candidate.generation) == 'int' ? candidate.generation : 0);
};

export const profiles_transient_cleanup = function(attempt, supplied) {
	let injected = transient_test_value('cleanup', supplied);
	if (injected != null) return injected;
	if (type(attempt) != 'object' || attempt == null || type(attempt.candidate) != 'object')
		return err('cleanup', 'EINPUT', 'transient cleanup binding is invalid');
	let candidate = attempt.candidate;
	return scanner_runtime_call('cleanup', candidate.sessionId, scanner_runtime_id(candidate.scannerId),
		type(candidate.generation) == 'int' ? candidate.generation : 0);
};
