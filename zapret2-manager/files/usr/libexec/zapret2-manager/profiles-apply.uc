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
//   4. native gate: `nfqws2 --dry-run` (argv elements POSIX-escaped; no Lua,
//      no traffic). rejected/unavailable/not_checked → REFUSE before any
//      write. A fabricated 'valid' is NOT a proceed signal.
//   5. preview diff (sha256 of current vs candidate)
//   6. snapshot last-good: config + UCI (if present) + draft state + hashes +
//      generation metadata
//   7. write ONLY NFQWS2_OPT through the sanctioned apply.uc set_var —
//      dqEscape makes the candidate safe for the double-quoted shell
//      assignment; no second writer exists
//   8. restart through /etc/init.d/zapret2 (upstream's own init; never a full
//      firewall restart, never an nft flush)
//   9. invalidate the status cache, re-collect
//  10. verify FIVE checks (process present, exactly one nfqws2, rules
//      present, queue 300 registered, queue owner == daemon PID). Failure →
//      immediate rollback via `service.uc rollback`; a rollback failure is
//      critical and explicit.
//
// The automatic 90s rollback timer stays DISABLED (ROLLBACK_TIMEOUT_ENABLED
// is false); manual confirm/rollback via the existing ubus methods remain
// available after a successful apply.

import { readfile, writefile, stat, unlink, popen, mkdir } from 'fs';
import { read_var, set_var } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_parse, z2m_validate, z2m_fragment } from './profiles.uc';
import { load_state } from './profiles-draft.uc';
import { parse_queue } from './qlen.uc';

const LASTGOOD_DIR = '/tmp/zapret2-manager/last-good';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const OPT_VAR = 'NFQWS2_OPT';
const MAX_CANDIDATE_BYTES = 262144;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
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

function sha256_text_via_file(text, tmppath) {
	// ucode has no sha256 builtin; hash via a temp file (fixed path, no
	// injection: the CONTENT is written as data, the command is a constant).
	writefile(tmppath, text);
	let r = run("sha256sum " + tmppath + " 2>/dev/null | awk '{print $1}'");
	try { unlink(tmppath); } catch (e) { }
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

// dqEscape — see tests/lib/profiles-apply.mjs (double-quoted shell
// assignment safety; backslash first). chr(34) is the double-quote (a
// single-quoted '"' literal would confuse the naive string stripper of the
// local bracket gate — and readers).
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

// ---------------------------------------------------------------------------
// render + round trip (mirrors renderCandidate / candidateRoundTrip)
// ---------------------------------------------------------------------------
function render_candidate(profiles) {
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
			if (length(model.profiles) != 1 || length(model.trailingTokens) > 0) {
				push(errs, { severity: 'error', code: 'MANAGER_FRAGMENT_NOT_SINGLE_PROFILE', message: 'draft ' + p.id + ': fragment must parse to exactly one profile (found ' + length(model.profiles) + ')', tokenIndex: null, profileIndex: null });
			}
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
}

function candidate_round_trip(candidate, frags) {
	let model = z2m_parse(candidate);
	if (length(model.profiles) != length(frags)) return false;
	for (let i = 0; i < length(frags); i++) {
		if (z2m_fragment(model, model.profiles[i], candidate) != trim_ws(frags[i])) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// native gate (nfqws2 --dry-run; argv POSIX-escaped; honest vocabulary)
// ---------------------------------------------------------------------------
function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

function native_unavailable(reason) {
	return {
		status: 'unavailable', entryPoint: null,
		coverage: { cliSyntax: 'not_checked', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: [{ severity: 'error', code: 'NATIVE_UNAVAILABLE', message: '' + reason, tokenIndex: null, profileIndex: null }],
		bundleId: null, nativeVersion: null, luaCompatVer: null
	};
}

function native_dry_run(candidate) {
	if (!stat(NFQWS2_BIN)) return native_unavailable('nfqws2 binary not found at ' + NFQWS2_BIN);
	let tz = z2m_tokenize(candidate);
	let cmd = shell_escape(NFQWS2_BIN) + ' --dry-run';
	for (let i = 0; i < length(tz.tokens); i++)
		cmd += ' ' + shell_escape(tz.tokens[i].value);
	cmd += ' 2>&1';
	let p = popen(cmd, 'r');
	if (!p) return native_unavailable('popen failed');
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	if (rc == 0) {
		return {
			status: 'partial', entryPoint: 'dry-run',
			coverage: { cliSyntax: 'passed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
			diagnostics: [], bundleId: null, nativeVersion: null, luaCompatVer: null
		};
	}
	let msg = trim(out);
	if (msg == '') msg = 'nfqws2 --dry-run exited ' + rc;
	return {
		status: 'rejected', entryPoint: 'dry-run',
		coverage: { cliSyntax: 'failed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: [{ severity: 'error', code: 'NATIVE_REJECTED', message: msg, tokenIndex: null, profileIndex: null }],
		bundleId: null, nativeVersion: null, luaCompatVer: null
	};
}

function apply_decision(nv) {
	if (type(nv) != 'object' || nv == null) return { proceed: false, stage: 'validate' };
	if (nv.status == 'partial' && type(nv.coverage) == 'object' && nv.coverage != null
		&& nv.coverage.cliSyntax == 'passed')
		return { proceed: true };
	return { proceed: false, stage: 'validate' };
}

// ---------------------------------------------------------------------------
// diff / snapshot / verify
// ---------------------------------------------------------------------------
function diff_summary(currentOpt, candidate) {
	let curSha = sha256_text_via_file(currentOpt != null ? currentOpt : '', '/tmp/z2m-apply-cur.sha');
	let candSha = sha256_text_via_file(candidate, '/tmp/z2m-apply-cand.sha');
	return {
		changed: curSha != candSha,
		currentSha256: curSha,
		candidateSha256: candSha,
		currentLength: length(currentOpt != null ? currentOpt : ''),
		candidateLength: length(candidate)
	};
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let r = run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

// Snapshot last-good BEFORE any write: config + UCI (if present) + draft
// state + hashes + generation metadata.
function snapshot_apply() {
	try { mkdir('/tmp/zapret2-manager'); } catch (e) { }
	run('mkdir -p ' + LASTGOOD_DIR);
	run('cp -f ' + PATHS.applied_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
	run('cp -f ' + PATHS.uci_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
	run('cp -f ' + PATHS.draft_state + ' ' + LASTGOOD_DIR + '/state.json 2>/dev/null');
	let st = { config: sha256_file(PATHS.applied_conf), uci: sha256_file(PATHS.uci_conf), captured_at: time() };
	writefile('/tmp/zapret2-manager/applied.sha256', sprintf("%J", st) + '\n');
	// generation metadata (the manager reads the upstream generation counter)
	let gen = null;
	try {
		let raw = readfile(PATHS.status_json);
		if (raw) {
			let sj = json(raw);
			if (type(sj) == 'object' && sj != null && type(sj.generation) == 'int') gen = sj.generation;
		}
	} catch (e) { }
	writefile(LASTGOOD_DIR + '/generation.prev', '' + (gen != null ? gen : 'unknown') + '\n');
	return { configSha256: st.config, uciSha256: st.uci, generation: gen };
}

function verify_status(sj, q) {
	let rt = (type(sj) == 'object' && sj != null && type(sj.runtime) == 'object') ? sj.runtime : {};
	let health = (type(sj) == 'object' && sj != null && type(sj.health) == 'object') ? sj.health : {};
	let queue = (type(health.queue) == 'object' && health.queue != null) ? health.queue : {};
	let count = (type(rt.count) == 'int') ? rt.count
		: ((type(rt.instances) == 'array') ? length(rt.instances) : 0);
	let pid = null;
	if (type(rt.instances) == 'array' && length(rt.instances) == 1) pid = rt.instances[0].pid;
	let checks = {
		processPresent: count >= 1,
		singleInstance: count == 1,
		rulesPresent: rt.rulesPresent == true,
		queueRegistered: queue.registered == true && queue.number == 300 && q.registered == true,
		ownerMatch: pid != null && q.peer_portid != null && q.peer_portid == pid
	};
	let ok = checks.processPresent && checks.singleInstance && checks.rulesPresent && checks.queueRegistered && checks.ownerMatch;
	return { ok: ok, checks: checks, daemonPid: pid, queueOwner: q.peer_portid };
}

function recollect_status() {
	try { unlink(PATHS.status_json); } catch (e) { }   // invalidate cache
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

// ---------------------------------------------------------------------------
// preview / apply
// ---------------------------------------------------------------------------
function load_drafts_or_refuse() {
	let ls = load_state();
	if (!ls.ok) return { refuse: err('load', 'ESTATE', 'draft state is malformed — refusing to apply: ' + ls.reason) };
	if (length(ls.state.profiles) == 0) return { refuse: err('load', 'ESTATE', 'no draft profiles to apply (refusing to replace the applied config with an empty set)') };
	return { state: ls.state };
}

function pipeline_front() {
	// steps 1–5 shared by preview and apply: load → render → round trip →
	// native gate → diff. Returns { candidate, fragments, native, diff } or
	// { refuse: <error envelope> }.
	let ld = load_drafts_or_refuse();
	if (ld.refuse) return { refuse: ld.refuse };
	let rc = render_candidate(ld.state.profiles);
	if (!rc.ok) return { refuse: rc };
	if (!candidate_round_trip(rc.candidate, rc.fragments))
		return { refuse: err('render', 'EINTERNAL', 'round trip lost content — refusing to apply (MANAGER_LOSSY_ROUNDTRIP)') };
	let native = native_dry_run(rc.candidate);
	let cur = read_var(OPT_VAR);
	let diff = diff_summary(cur != null ? cur : '', rc.candidate);
	return { candidate: rc.candidate, fragments: rc.fragments, native: native, diff: diff, draftCount: length(ld.state.profiles) };
}

export const profiles_apply_preview = function() {
	let f = pipeline_front();
	if (f.refuse) {
		// validation-stage refusals carry the native record for visibility
		let e = f.refuse;
		if (f.refuse.stage == 'render' || f.refuse.stage == 'load') return e;
		return e;
	}
	let decision = apply_decision(f.native);
	return {
		ok: true,
		mode: 'preview',
		draftCount: f.draftCount,
		candidate: f.candidate,
		diff: f.diff,
		native: f.native,
		wouldApply: decision.proceed,
		refuseReason: decision.proceed ? null : 'native validation did not pass (status: ' + f.native.status + ')'
	};
};

export const profiles_apply_run = function() {
	let f = pipeline_front();
	if (f.refuse) return f.refuse;
	let decision = apply_decision(f.native);
	if (!decision.proceed) {
		return err('validate', 'ETARGET', 'native validation refused the candidate (status: ' + f.native.status + ') — nothing was written', { native: f.native });
	}

	// snapshot last-good BEFORE the write
	let snap = snapshot_apply();

	// write ONLY NFQWS2_OPT through the sanctioned writer (dqEscape makes the
	// candidate safe for the double-quoted shell assignment)
	let written = set_var(OPT_VAR, dq_escape(f.candidate));
	if (written == null) {
		return err('write', 'ETARGET', 'set_var failed to write ' + OPT_VAR + ' — nothing applied', { snapshot: snap });
	}

	// restart through upstream's own init (never a full firewall restart)
	let r = run(UPSTREAM_INIT + ' restart');

	// invalidate + re-collect status, then verify FIVE checks
	let sj = recollect_status();
	let q = parse_queue();
	let verify = verify_status(sj, q);

	if (r.rc != 0 || !verify.ok) {
		// immediate rollback attempt via the existing manual rollback
		let rb = run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback');
		let rbOk = false;
		try {
			let rbj = json(rb.out);
			rbOk = (type(rbj) == 'object' && rbj != null && rbj.ok == true);
		} catch (e) { }
		if (!rbOk) {
			event_apply('crit', 'APPLY FAILED AND ROLLBACK FAILED — manual recovery required', { rc: r.rc, verify: verify.checks });
			return err('rollback', 'EINTERNAL', 'apply failed (restart rc=' + r.rc + ', verify ok=' + verify.ok + ') AND the rollback attempt failed — MANUAL RECOVERY REQUIRED', {
				verify: verify, rollbackOk: false, critical: true
			});
		}
		event_apply('crit', 'apply failed verification; rolled back to last-good', { rc: r.rc, verify: verify.checks });
		return err('verify', 'ETARGET', 'apply failed verification (restart rc=' + r.rc + ') — rolled back to last-good', {
			verify: verify, rolledBack: true, rollbackOk: true
		});
	}

	event_apply('info', 'draft profiles applied (' + f.draftCount + ' profiles) and verified', {
		profiles: f.draftCount, candidateSha256: f.diff.candidateSha256
	});
	return {
		ok: true,
		mode: 'apply',
		applied: { profiles: f.draftCount, candidateSha256: f.diff.candidateSha256 },
		verify: verify,
		snapshot: snap,
		rollback: { available: true, armed: false, note: 'manual rollback via the rollback ubus method remains available; the automatic 90s timer is disabled' }
	};
};
