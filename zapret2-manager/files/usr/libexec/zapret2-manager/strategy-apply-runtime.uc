'use strict';
// strategy-apply-runtime.uc — Strategy-owned transactional Apply runtime.
// tests/product/strategy-apply*.test.mjs (the current Strategy Apply contract).
//
// PIPELINE (Strategy Apply):
//   1. validate the server-owned candidate (malformed/empty → refuse)
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
import { read_var, set_var_cas, set_vars_cas, restore_whole_file, read_config_bytes, config_sha256, commit_applied_identity } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_parse, z2m_validate, z2m_fragment, derive_capture_ports } from './profiles.uc';
import { parse_queue } from './qlen.uc';
import { native_preflight } from './native-preflight.uc';
import { resolveInstalled } from './runtime-composition.uc';
import { collect } from './core/status-collector.uc';
import * as strategy_state from './strategy-state.uc';
import { append_ndjson, event_id } from './events.uc';

const LASTGOOD_DIR = '/tmp/zapret2-manager/last-good';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const OPT_VAR = 'NFQWS2_OPT';
const MAX_CANDIDATE_BYTES = 262144;
const CONFIG_LOCK = getenv('Z2M_STRATEGY_CONFIG_LOCK') || '/opt/zapret2/config.lock';
const STRATEGY_APPLY_CLI = getenv('Z2M_STRATEGY_APPLY_RUNTIME_CLI') || '/usr/libexec/zapret2-manager/strategy-apply-runtime-cli.uc';
const UCODE_BIN = getenv('Z2M_STRATEGY_UCODE_BIN') || '/usr/bin/ucode';
const STRATEGY_STATE_MODULE = getenv('Z2M_STRATEGY_STATE_MODULE') || '/usr/libexec/zapret2-manager/strategy-state.uc';
const PROJECTION_MARKER = 'z2m-strategy-apply-projection.v1';
let APPLY_HOOK = null, APPLY_HOOK_LOADED = false, APPLY_HOOK_CURSOR = {};

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

const MAX_TIMING_MS = 600000;

// /proc/uptime is available on the supported OpenWrt target and gives us a
// monotonic clock without spawning another process. The wall-clock fallback
// keeps timing evidence non-authoritative on constrained test environments.
function monotonic_ms() {
	let raw = null;
	try { raw = readfile('/proc/uptime'); } catch (e) { raw = null; }
	let token = raw != null ? split(trim(raw), /[ \t]+/)[0] : null;
	let value = token != null && length(token) ? (+token * 1000) : (time() * 1000);
	return value >= 0 ? value : null;
}

function timing_elapsed(start) {
	let now = monotonic_ms();
	let value = start == null || now == null ? null : now - start;
	return value != null && value >= 0 && value <= MAX_TIMING_MS ? value : null;
}

function timing_set(timing, name, start) {
	let value = timing_elapsed(start);
	if (type(timing) == 'object' && timing != null && value != null) timing[name] = value;
}

function timing_attach(result, timing) {
	if (type(result) != 'object' || result == null || type(timing) != 'object' || timing == null) return result;
	let encoded = null;
	try { encoded = sprintf('%J', timing); } catch (e) { encoded = null; }
	if (encoded != null && length(encoded) <= 4096) result.timing = timing;
	return result;
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

// OpenWrt init scripts are owned by rc.common and are not required to have
// the executable bit set. Keep this invocation boundary in one place so the
// transaction and its rollback use the same upstream service owner.
function upstream_action(action) {
	return run('sh /etc/rc.common ' + shell_escape(UPSTREAM_INIT) + ' ' + shell_escape(action));
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
	// The profile transaction already runs inside the authoritative config
	// lock. Keep the identity revalidation/commit in this same UCode process so
	// Apply does not pay for a second rpcd-style module bootstrap per state
	// transition. strategy-state.uc still owns its private state lock and CAS.
	let local = strategy_state[name];
	if (local != null) {
		try { return input == null ? local() : local(input); }
		catch (e) { return err('identity', 'EINTERNAL', 'Strategy state operation failed'); }
	}
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

function native_preflight_for_apply(candidate, runtimeSnapshot) {
	let injected = hook_value('transaction', 'preflight');
	return injected != null ? injected : native_preflight(candidate, runtimeSnapshot);
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

// `alreadyValidated` is an internal compiler fast path only.  The caller must
// have validated every transformed fragment immediately before rendering;
// ordinary draft/apply callers keep the full parser and validator gate.
export const strategy_render_candidate = function(profiles, alreadyValidated) {
	if (type(profiles) != 'array' || length(profiles) == 0)
		return err('load', 'ESTATE', 'Strategy candidate is empty — refusing to replace the applied config');
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
		} else if (alreadyValidated !== true) {
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
		return err('render', 'EINPUT', length(failures) + ' Strategy fragment(s) are structurally unfit — refusing to apply', { failures: failures });
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
export const strategy_candidate_round_trip = candidate_round_trip;

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
	return upstream_action('restart');
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

function recollect_status() {
	try { unlink(PATHS.status_json); } catch (e) { }
	// In-process collection: spawning the collector as a CLI script fails to
	// parse (it uses exports), which silently left the status file missing and
	// made every apply verification fail.
	try { collect(); } catch (e) { return null; }
	let raw = readfile(PATHS.status_json);
	if (!raw) return null;
	let sj = null;
	try { sj = json(raw); } catch (e) { return null; }
	return sj;
}

function readiness_test_value() {
	return getenv('Z2M_STRATEGY_SERVER_TEST') == '1' ? hook_value('transaction', 'readiness') : null;
}

function runtime_composition_test_value() {
	if (getenv('Z2M_STRATEGY_SERVER_TEST') != '1') return null;
	let hook = apply_hook();
	return hook != null && hook.runtimeComposition != null ? hook.runtimeComposition : null;
}

function readiness_budget() {
	let timeoutSec = 5, maxPolls = 50;
	// Tests may shorten the bounded budget to exercise timeout/rollback paths;
	// production RPC has the fixed five-second/50-probe budget.
	if (getenv('Z2M_STRATEGY_SERVER_TEST') == '1') {
		let requestedTimeout = getenv('Z2M_STRATEGY_READY_TIMEOUT_SEC');
		let requestedPolls = getenv('Z2M_STRATEGY_READY_MAX_POLLS');
		if (requestedTimeout != null && type(+requestedTimeout) == 'int' && +requestedTimeout >= 1 && +requestedTimeout <= 5)
			timeoutSec = +requestedTimeout;
		if (requestedPolls != null && type(+requestedPolls) == 'int' && +requestedPolls >= 1 && +requestedPolls <= 50)
			maxPolls = +requestedPolls;
	}
	return { timeoutSec: timeoutSec, maxPolls: maxPolls };
}

function transaction_verify(attempt, allow_external_nfqws, injected) {
	if (injected != null) return injected;
	// Firewall rules are (re)created by the init hook after the daemon start
	// returns. Poll the existing postflight invariants with a hard deadline;
	// readiness reached on the first probe returns without an arbitrary delay.
	let budget = readiness_budget(), started = time(), deadline = started + budget.timeoutSec, result = null, attempts = 0;
	while (attempts < budget.maxPolls) {
		let supplied = readiness_test_value();
		if (supplied != null) result = supplied;
		else {
			let sj = recollect_status(), q = parse_queue();
			result = verify_status(sj, q, allow_external_nfqws);
		}
		attempts++;
		if (result != null && result.ok) {
			result.readiness = { attempts: attempts, elapsedSec: time() - started, deadlineSec: budget.timeoutSec, timedOut: false };
			return result;
		}
		if (time() >= deadline) break;
		run('sleep 0.1');
	}
	if (result == null) result = verify_status(null, { registered: false, peer_portid: null }, allow_external_nfqws);
	result.readiness = { attempts: attempts, elapsedSec: time() - started, deadlineSec: budget.timeoutSec, timedOut: true };
	return result;
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

function transaction_commit_applied_identity(injected) {
	return injected != null ? injected : commit_applied_identity();
}

function strategy_rollback_decision(restartRc, verifyOk, configRestored, rollbackRestartRc, rollbackVerifyOk) {
	let rollbackRequired = restartRc != 0 || !verifyOk;
	return {
		rollbackRequired: rollbackRequired,
		rollbackOk: rollbackRequired && configRestored && rollbackRestartRc == 0 && rollbackVerifyOk
	};
};

function event_apply(severity, msg, extra) {
	try {
		let ts = trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out);
		if (!length(ts)) ts = '' + time();
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = ts; ev.id = event_id('apply');
		ev.category = 'config'; ev.severity = severity; ev.source = 'ui'; ev.msg = msg;
		append_ndjson(PATHS.events_ndjson, ev);
	} catch (e) { }
}

function runtime_binding_valid(value) {
	if (type(value) != 'object' || value == null
		|| type(value.observedRegistryRevision) != 'int' || value.observedRegistryRevision < 0) return false;
	let compact = type(value.snapshotIdSha256) == 'string' && match(value.snapshotIdSha256, /^[a-f0-9]{64}$/)
		&& type(value.compositionSnapshotIdSha256) == 'string' && match(value.compositionSnapshotIdSha256, /^[a-f0-9]{64}$/);
	compact = compact && type(value.membershipDigestSha256) == 'string' && match(value.membershipDigestSha256, /^[a-f0-9]{64}$/);
	let legacy = type(value.snapshotId) == 'string' && length(value.snapshotId) > 0 && length(value.snapshotId) <= 256
		&& type(value.compositionSnapshotId) == 'string' && length(value.compositionSnapshotId) > 0
		&& length(value.compositionSnapshotId) <= 256
		&& type(value.membershipDigest) == 'string' && match(value.membershipDigest, /^[a-f0-9]{64}$/);
	return compact || legacy;
}

function runtime_binding_matches(value, binding) {
	if (type(value) != 'object' || type(binding) != 'object') return false;
	let snapshotDigest = type(binding.snapshotIdSha256) == 'string'
		? sha256_text_via_file(value.snapshotId) : binding.snapshotId;
	let compositionDigest = type(binding.compositionSnapshotIdSha256) == 'string'
		? sha256_text_via_file(value.compositionSnapshotId) : binding.compositionSnapshotId;
	let membershipDigest = type(binding.membershipDigestSha256) == 'string'
		? sha256_text_via_file(value.membershipDigest) : binding.membershipDigest;
	return snapshotDigest == (binding.snapshotIdSha256 || value.snapshotId)
		&& compositionDigest == (binding.compositionSnapshotIdSha256 || value.compositionSnapshotId)
		&& membershipDigest == (binding.membershipDigestSha256 || value.membershipDigest)
		&& binding.observedRegistryRevision == value.observedRegistryRevision;
}

function projection_invalid_reason(value, candidateHash) {
	if (type(value) != 'object' || value == null) return 'projection-shape';
	if (value.callerContext != 'strategy_apply') return 'caller-context';
	if (type(value.operationNonce) != 'string' || length(value.operationNonce) == 0 || length(value.operationNonce) > 256) return 'operation-nonce';
	if (value.candidateSha256 != candidateHash) return 'candidate-hash';
	if (type(value.expectedRevision) != 'int' || type(value.selectionRevision) != 'int' || type(value.strategyRevision) != 'int') return 'selection-revision';
	if (type(value.strategyId) != 'string' || type(value.strategyOrigin) != 'string') return 'strategy-identity';
	if (type(value.catalogDigest) != 'string' || !match(value.catalogDigest, /^[a-f0-9]{64}$/)) return 'catalog-digest';
	if (type(value.previousCandidateSha256) != 'string' || !match(value.previousCandidateSha256, /^[a-f0-9]{64}$/)) return 'previous-candidate-hash';
	if (!runtime_binding_valid(value.runtimeBinding)) return 'runtime-binding-shape';
	if (value.expectedSelected != null && type(value.expectedSelected) != 'object') return 'expected-selection';
	if (value.previousSelected != null && type(value.previousSelected) != 'object') return 'previous-selection';
	if (value.selected != null && type(value.selected) != 'object') return 'selected-identity';
	return null;
}

function projection_valid(value, candidateHash) {
	return projection_invalid_reason(value, candidateHash) == null;
}

export const strategy_projection_boundary = function(candidateHash) {
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
		|| metadata.mode % 512 != 384 || type(metadata.size) != 'int' || metadata.size > 8192) {
		return err('identity', 'EINPUT', 'Strategy projection sidecar is not a private regular file');
	}
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

function apply_candidate_pipeline(f) {
	let timing = type(f.timing) == 'object' && f.timing != null ? f.timing : null;
	if (getenv('Z2M_CONFIG_LOCKED') != '1' && apply_hook() == null)
		return err('lock', 'ELOCK', 'config transaction lock is not held — nothing was written');
	if (f.ports == null) {
		f.ports = derive_capture_ports(f.candidate);
		if (!f.ports.ok)
			return err('validate', 'EINPUT', 'candidate contains invalid port expressions: ' + f.ports.error);
	}
	let decision = apply_decision(f.native);
	if (!decision.proceed)
		return err('validate', 'EPREFLIGHT', 'complete pinned native/Lua validation is required — nothing was written', { native: f.native });

	let la_raw = readfile('/tmp/zapret2-manager/last-apply.json');
	if (la_raw) {
		let la = null;
		try { la = json(la_raw); } catch (e) { la = null; }
		if (type(la) == 'object' && la != null && la.candidateSha256 == f.diff.candidateSha256) {
			let age = time() - (type(la.at) == 'int' ? la.at : 0);
			let currentMatches = read_var(OPT_VAR) == f.candidate
				&& (f.ports == null || (read_var('NFQWS2_PORTS_TCP') == f.ports.tcp && read_var('NFQWS2_PORTS_UDP') == f.ports.udp));
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
	let vars_map = {};
	vars_map[OPT_VAR] = dq_escape(f.candidate);
	if (f.ports != null && f.ports.ok) {
		vars_map['NFQWS2_PORTS_TCP'] = f.ports.tcp;
		vars_map['NFQWS2_PORTS_UDP'] = f.ports.udp;
	}
	let casHook = hook_value('transaction', 'cas');
	let writeStarted = monotonic_ms();
	let cas = casHook != null ? transaction_cas(f.candidate, f.diff.candidateSha256, snap, casHook)
		: set_vars_cas(vars_map, snap.configSha256);
	if (timing != null) timing_set(timing, 'writeMs', writeStarted);
	if (type(cas) != 'object' || cas == null || cas.ok != true) {
		let code = (cas && cas.code) ? cas.code : 'EWRITE';
		return err('write', code, code == 'ECONFLICT'
			? 'upstream config changed after validation — nothing was written'
			: 'durable atomic config write failed', { snapshot: snap, cas: cas });
	}

	let restartHook = hook_value('transaction', 'restart');
	let restartStarted = monotonic_ms();
	let r = restartHook != null ? transaction_restart(0, restartHook) : upstream_action('restart');
	if (timing != null) timing_set(timing, 'restartMs', restartStarted);
	let verifyHook = hook_value('transaction', 'verify');
	let postflightStarted = monotonic_ms();
	let verify = verifyHook != null ? transaction_verify(0, f.allowExternalNfqws == true, verifyHook)
		: transaction_verify(0, f.allowExternalNfqws == true, null);
	if (timing != null) timing_set(timing, 'postflightMs', postflightStarted);
	let rollbackDecision = strategy_rollback_decision(r.rc, verify.ok, false, -1, false);
	let identityStarted = monotonic_ms();
	let identity = null, identityRetry = null, identityFailure = false, appliedIdentity = null;
	if (!rollbackDecision.rollbackRequired && f.projection != null) {
		identity = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		if (!identity.ok) identityRetry = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		identityFailure = !identity.ok && (identityRetry == null || !identityRetry.ok);
		if (identityFailure) rollbackDecision.rollbackRequired = true;
	}
	if (!rollbackDecision.rollbackRequired) {
		appliedIdentity = transaction_commit_applied_identity(hook_value('transaction', 'appliedIdentity'));
		if (appliedIdentity == null || appliedIdentity.config != cas.configSha256) {
			rollbackDecision.rollbackRequired = true;
			identityFailure = true;
		}
	}
	if (rollbackDecision.rollbackRequired) {
		let rollbackHook = hook_value('transaction', 'rollback');
		let restored = rollbackHook != null ? transaction_restore(snap, rollbackHook)
			: restore_whole_file(PATHS.applied_conf, snap.configBytes);
		if (snap.uciBytes != null) writefile(PATHS.uci_conf, snap.uciBytes);
		let rollbackRestartHook = hook_value('transaction', 'restart');
		let rr = rollbackRestartHook != null ? transaction_restart(1, rollbackRestartHook) : upstream_action('restart');
		let rollbackVerifyHook = hook_value('transaction', 'verify');
		let rollbackVerify = rollbackVerifyHook != null ? transaction_verify(1, f.allowExternalNfqws == true, rollbackVerifyHook)
			: transaction_verify(1, f.allowExternalNfqws == true, null);
		let configRestored = restored != null
			&& (rollbackHook != null ? transaction_config_hash(rollbackHook) == snap.configSha256 : config_sha256() == snap.configSha256)
			&& (rollbackHook != null ? transaction_config_bytes(rollbackHook) == snap.configBytes : read_config_bytes() == snap.configBytes);
		let rollbackAppliedIdentity = configRestored && rollbackVerify.ok
			? transaction_commit_applied_identity(hook_value('transaction', 'rollbackAppliedIdentity')) : null;
		let rollbackOk = identityFailure
			? (configRestored && rr.rc == 0 && rollbackVerify.ok && rollbackAppliedIdentity != null
				&& rollbackAppliedIdentity.config == snap.configSha256)
			: (strategy_rollback_decision(r.rc, verify.ok, configRestored, rr.rc, rollbackVerify.ok).rollbackOk
				&& rollbackAppliedIdentity != null && rollbackAppliedIdentity.config == snap.configSha256);
		let identityRestored = restore_projection_identity(f.projection);
		if (!identityRestored.ok) rollbackOk = false;
		if (!rollbackOk) {
			let uncertain = uncertain_projection(f.projection, snap, cas.configSha256, {
				initial: verify.checks, rollback: rollbackVerify.checks, restartRc: r.rc,
				rollbackRestartRc: rr.rc, configRestored: configRestored, identityRestored: identityRestored.ok
			}, 'rollback or identity restoration could not be verified');
			event_apply('crit', 'APPLY FAILED AND EXACT ROLLBACK VERIFICATION FAILED — manual recovery required', {
				restartRc: r.rc, verify: verify.checks, rollbackRestartRc: rr.rc,
				rollbackVerify: rollbackVerify.checks, configRestored: configRestored,
				rollbackAppliedIdentity: rollbackAppliedIdentity
			});
			return err('rollback', f.projection != null ? 'EVERIFY' : 'EINTERNAL', f.projection != null
				? 'Strategy Apply is uncertain — explicit reconciliation is required'
				: 'apply failed and exact rollback could not be verified — MANUAL RECOVERY REQUIRED', {
				verify: verify, rollbackOk: false, rollbackVerify: rollbackVerify,
				configRestored: configRestored, identityRestored: identityRestored,
				rollbackAppliedIdentity: rollbackAppliedIdentity,
				uncertain: f.projection != null, critical: f.projection == null, rolledBack: false,
				uncertaintyPersistence: uncertain
			});
		}
		if (identityFailure) {
			return err('identity', 'EVERIFY', 'Strategy Apply identity commit failed after exact rollback', {
				uncertain: false, rolledBack: true, rollbackOk: true, identity: identityRetry || identity,
				rollbackAppliedIdentity: rollbackAppliedIdentity
			});
		}
		event_apply('crit', 'apply failed verification; exact snapshot restored and verified', {
			restartRc: r.rc, verify: verify.checks, rollbackVerify: rollbackVerify.checks,
			configRestored: configRestored
		});
		return err('verify', 'ETARGET', 'apply failed verification — exact last-good snapshot restored and verified', {
			verify: verify, rolledBack: true, rollbackOk: true,
			rollbackVerify: rollbackVerify, configRestored: configRestored,
			rollbackAppliedIdentity: rollbackAppliedIdentity
		});
	}

	event_apply('info', 'Strategy applied and verified', {
		profiles: f.draftCount, candidateSha256: f.diff.candidateSha256,
		configSha256: cas.configSha256
	});
	writefile('/tmp/zapret2-manager/last-apply.json',
		sprintf("%J", { candidateSha256: f.diff.candidateSha256, configSha256: cas.configSha256, at: time() }) + '\n');
	let result = {
		ok: true, mode: 'apply',
		applied: { profiles: f.draftCount, candidateSha256: f.diff.candidateSha256, configSha256: cas.configSha256 },
		appliedIdentity: appliedIdentity,
		verify: verify, snapshot: snap, identity: f.projection == null ? null : (identityRetry && identityRetry.ok ? identityRetry : identity),
		identityRetry: identityRetry,
		rollback: { available: true, armed: false, exactSnapshot: true }
	};
	if (timing != null) timing_set(timing, 'identityCommitMs', identityStarted);
	return result;
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
	let inner = shell_escape(UCODE_BIN) + ' ' + shell_escape(STRATEGY_APPLY_CLI) + ' candidate ' + shell_escape(request);
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

function strategy_apply_candidate_locked(candidate, expectedHash, projection) {
	let transactionStarted = monotonic_ms(), timing = {
		schema: 'z2m.strategy-apply-timing.v1', preflightCount: 0
	};
	let model = z2m_parse(candidate), diags = z2m_validate(model);
	for (let d in model.diagnostics) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has parse errors', { diagnostics: model.diagnostics });
	for (let d in diags) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has validation errors', { diagnostics: diags });
	let boundary = strategy_projection_boundary(expectedHash);
	if (!boundary.ok) return boundary;
	if (projection != null && !projection_valid(projection, expectedHash))
		return err('identity', 'EINPUT', 'Strategy projection context is invalid', { reason: projection_invalid_reason(projection, expectedHash) });
	let internalProjection = projection != null ? projection : boundary.projection;
	let runtimeSnapshot = null;
	if (internalProjection != null && internalProjection.runtimeBinding != null) {
		let resolveStarted = monotonic_ms();
		let resolved = runtime_composition_test_value();
		if (resolved == null) try { resolved = resolveInstalled({}); } catch (e) { resolved = null; }
		timing_set(timing, 'lockedRuntimeResolveMs', resolveStarted);
		let binding = internalProjection.runtimeBinding;
		if (resolved == null || resolved.ok != true || resolved.lifecycleState != 'installed'
			|| resolved.compositionStatus != 'canonical' || type(resolved.snapshotId) != 'string'
			|| type(resolved.compositionSnapshotId) != 'string' || type(resolved.membershipDigest) != 'string'
			|| type(resolved.observedRegistryRevision) != 'int'
			|| !runtime_binding_matches(resolved, binding))
			return err('preflight', 'ESTALE', 'installed runtime composition changed before authoritative Strategy preflight', {
				expected: binding, actual: resolved });
			runtimeSnapshot = resolved;
	}
	let preflightStarted = monotonic_ms();
	let native = native_preflight_for_apply(candidate, runtimeSnapshot), cur = hook_value('transaction', 'currentOpt');
	timing.preflightCount = 1;
	timing_set(timing, 'authoritativePreflightMs', preflightStarted);
	if (cur == null) cur = read_var(OPT_VAR);
	let diff = diff_summary(cur != null ? cur : '', candidate);
	if (expectedHash != null && diff.candidateSha256 != expectedHash)
		return err('validate', 'ECONFLICT', 'typed candidate hash changed before mutation', { expected: expectedHash, actual: diff.candidateSha256 });
	let ports = derive_capture_ports(candidate);
	if (!ports.ok) return err('validate', 'EINPUT', 'candidate contains invalid port expressions: ' + ports.error);
	let result = apply_candidate_pipeline({ candidate: candidate, ports: ports, fragments: [], native: native, diff: diff,
			draftCount: length(model.profiles), allowExternalNfqws: true, projection: internalProjection, timing: timing });
	timing_set(timing, 'lockedTransactionMs', transactionStarted);
	timing_attach(result, timing);
	return result;
}

export const strategy_apply_candidate = function(candidate, expectedHash, projection) {
	if (type(candidate) != 'string' || !length(candidate) || length(candidate) > MAX_CANDIDATE_BYTES)
		return err('render', 'EINPUT', 'typed candidate is missing or exceeds the safe size limit');
	// The locked helper rejects diff.candidateSha256 != expectedHash before mutation.
	// It invokes apply_candidate_pipeline({ candidate: candidate, ... }) as the sole transaction.
	if (getenv('Z2M_CONFIG_LOCKED') != '1')
		return locked_candidate_call(candidate, expectedHash, projection);
	return strategy_apply_candidate_locked(candidate, expectedHash, projection);
};

export const strategy_config_hash = function() {
	let injected = hook_value('transaction', 'configHash');
	return injected != null ? injected : config_sha256();
};
export const strategy_candidate_hash = function() {
	let injected = hook_value('transaction', 'candidateHash');
	if (injected != null) return injected;
	let current = read_var(OPT_VAR);
	return current == null ? null : sha256_text_via_file(current);
};
export const strategy_candidate_digest = function(candidate) {
	if (type(candidate) != 'string' || !length(candidate) || length(candidate) > MAX_CANDIDATE_BYTES) return null;
	return sha256_text_via_file(candidate);
};

export const strategy_reconcile_evidence = function() {
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
