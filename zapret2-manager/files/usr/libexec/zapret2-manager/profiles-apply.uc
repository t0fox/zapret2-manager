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
import { z2m_parse, z2m_validate, z2m_fragment } from './profiles.uc';
import { load_state } from './profiles-draft.uc';
import { parse_queue } from './qlen.uc';
import { native_preflight } from './native-preflight.uc';

const LASTGOOD_DIR = '/tmp/zapret2-manager/last-good';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const OPT_VAR = 'NFQWS2_OPT';
const MAX_CANDIDATE_BYTES = 262144;
const CONFIG_LOCK = '/opt/zapret2/config.lock';
const PROFILE_APPLY_CLI = '/usr/libexec/zapret2-manager/profiles-apply-cli.uc';
const STRATEGY_STATE_MODULE = '/usr/libexec/zapret2-manager/strategy-state.uc';
const PROJECTION_MARKER = 'z2m-strategy-apply-projection.v1';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function strategy_state_call(name, input) {
	let source = 'import { ' + name + ' } from ' + sprintf('%J', STRATEGY_STATE_MODULE)
		+ '; print(sprintf("%J", ' + name + '(' + (input == null ? '' : sprintf('%J', input)) + ')));';
	let answer = run('/usr/bin/ucode -e ' + shell_escape(source));
	if (answer.rc != 0) return err('identity', 'EINTERNAL', 'Strategy state hook failed');
	try { return json(answer.out); } catch (e) { return err('identity', 'EINTERNAL', 'Strategy state hook response is malformed'); }
}

function err(stage, code, message, extra) {
	let e = { ok: false, stage: stage, error: { code: code, message: message } };
	if (extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) e[ks[i]] = extra[ks[i]];
	}
	return e;
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

function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

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
	if (getenv('Z2M_CONFIG_LOCKED') != '1')
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
			let currentVerify = currentMatches ? verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true) : null;
			if (age >= 0 && age < 60 && currentMatches && currentVerify.ok && f.projection == null)
				return { ok: true, mode: 'apply', idempotent: true,
					note: 'identical candidate was applied ' + age + 's ago — rollback baseline preserved',
					applied: { profiles: f.draftCount, candidateSha256: f.diff.candidateSha256 },
					verify: currentVerify,
					rollback: { available: true, armed: false } };
		}
	}

	let snap = snapshot_apply();
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
	let cas = set_var_cas(OPT_VAR, dq_escape(f.candidate), snap.configSha256);
	if (type(cas) != 'object' || cas == null || cas.ok != true) {
		let code = (cas && cas.code) ? cas.code : 'EWRITE';
		return err('write', code, code == 'ECONFLICT'
			? 'upstream config changed after validation — nothing was written'
			: 'durable atomic config write failed', { snapshot: snap, cas: cas });
	}

	let r = run(UPSTREAM_INIT + ' restart');
	run('sleep 2');
	let verify = verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true);
	let rollbackDecision = profiles_rollback_decision(r.rc, verify.ok, false, -1, false);
	let identity = null, identityRetry = null, identityFailure = false;
	if (!rollbackDecision.rollbackRequired && f.projection != null) {
		identity = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		if (!identity.ok) identityRetry = strategy_state_call('strategy_selection_apply', { expectedRevision: f.projection.expectedRevision, selected: f.projection.selected, applyNonce: f.projection.operationNonce });
		identityFailure = !identity.ok && (identityRetry == null || !identityRetry.ok);
		if (identityFailure) rollbackDecision.rollbackRequired = true;
	}
	if (rollbackDecision.rollbackRequired) {
		let restored = restore_whole_file(PATHS.applied_conf, snap.configBytes);
		if (snap.uciBytes != null) writefile(PATHS.uci_conf, snap.uciBytes);
		let rr = run(UPSTREAM_INIT + ' restart');
		run('sleep 2');
		let rollbackVerify = verify_status(recollect_status(), parse_queue(), f.allowExternalNfqws == true);
		let configRestored = restored != null && config_sha256() == snap.configSha256 && read_config_bytes() == snap.configBytes;
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
		rollback: { available: true, armed: false, exactSnapshot: true }
	};
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
	let inner = '/usr/bin/ucode ' + PROFILE_APPLY_CLI + ' candidate ' + shell_escape(request);
	let projectionEnv = sidecar == null ? ''
		: 'Z2M_STRATEGY_PROJECTION_PATH=' + shell_escape(sidecar)
			+ ' Z2M_STRATEGY_PROJECTION_NONCE=' + shell_escape(request)
			+ ' Z2M_STRATEGY_PROJECTION_MARKER=' + shell_escape(PROJECTION_MARKER)
			+ ' Z2M_STRATEGY_PROJECTION_CALLER=' + shell_escape('strategy_apply') + ' ';
	let cmd = 'Z2M_CONFIG_LOCKED=1 ' + projectionEnv
		+ 'flock -x ' + shell_escape(CONFIG_LOCK) + ' -c ' + shell_escape(inner);
	let answer = run(cmd);
	try { unlink(request); } catch (e) { }
	if (sidecar != null) try { unlink(sidecar); } catch (e) { }
	if (answer.rc != 0 && !length(trim(answer.out))) return err('lock', 'ELOCK', 'transaction process failed before returning a result');
	try { return json(answer.out); }
	catch (e) { return err('lock', 'EINTERNAL', 'transaction response is malformed'); }
}

export const profiles_apply_candidate = function(candidate, expectedHash, projection) {
	if (type(candidate) != 'string' || !length(candidate) || length(candidate) > MAX_CANDIDATE_BYTES)
		return err('render', 'EINPUT', 'typed candidate is missing or exceeds the safe size limit');
	if (getenv('Z2M_CONFIG_LOCKED') != '1')
		return locked_candidate_call(candidate, expectedHash, projection);
	let model = z2m_parse(candidate), diags = z2m_validate(model);
	for (let d in model.diagnostics) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has parse errors', { diagnostics: model.diagnostics });
	for (let d in diags) if (d.severity == 'error') return err('render', 'EINPUT', 'typed candidate has validation errors', { diagnostics: diags });
	let native = native_preflight(candidate), cur = read_var(OPT_VAR), diff = diff_summary(cur != null ? cur : '', candidate);
	if (expectedHash != null && diff.candidateSha256 != expectedHash)
		return err('validate', 'ECONFLICT', 'typed candidate hash changed before mutation', { expected: expectedHash, actual: diff.candidateSha256 });
	let boundary = profiles_projection_boundary(expectedHash);
	if (!boundary.ok) return boundary;
	if (projection != null && !projection_valid(projection, expectedHash))
		return err('identity', 'EINPUT', 'Strategy projection context is invalid');
	let internalProjection = projection != null ? projection : boundary.projection;
	return apply_candidate_pipeline({ candidate: candidate, fragments: [], native: native, diff: diff,
		draftCount: length(model.profiles), allowExternalNfqws: true, projection: internalProjection });
};

export const profiles_config_hash = function() { return config_sha256(); };
export const profiles_candidate_hash = function() {
	let current = read_var(OPT_VAR);
	return current == null ? null : sha256_text_via_file(current);
};

export const profiles_reconcile_evidence = function() {
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
