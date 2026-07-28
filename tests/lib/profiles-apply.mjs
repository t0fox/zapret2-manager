// profiles-apply.mjs — node reference for the SAFE draft apply pipeline
// (SLICE 3). Mirrored by the shipped ucode profiles-apply.uc.
//
// The pipeline (ucode side, with real I/O — this module is the pure logic):
//   1. load drafts → renderCandidate (this module)
//   2. round-trip proof → candidateRoundTrip
//   3. native --dry-run → applyDecision (rejected/unavailable/not_checked
//      REFUSE before any write; a fabricated 'valid' is NOT a proceed)
//   4. snapshot last-good (config + UCI + draft + hashes + generation)
//   5. set_var('NFQWS2_OPT', candidate) via the sanctioned apply.uc writer
//   6. /etc/init.d/zapret2 restart (upstream's own init; never a full
//      firewall restart, never an nft flush, never a second writer)
//   7. status cache invalidation + fresh collect
//   8. verifyStatus — five checks; failure rolls back via service.uc
//      rollback; rollback failure is critical and explicit
//
// Preview = steps 1–3 + diffSummary. No write, no restart.

import { parse } from '../strategy/lib/parse.mjs';
import { allDiagnostics } from '../strategy/lib/validate.mjs';
import { profileFragment } from './profiles-draft.mjs';
import { createHash } from 'node:crypto';

export const MAX_CANDIDATE_BYTES = 262144;

export function sha256hexNode(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function trimWs(s) {
	return String(s).replace(/^\s+/, '').replace(/\s+$/, '');
}

// dqEscape(candidate) — make the candidate safe to write inside the
// DOUBLE-QUOTED shell assignment NFQWS2_OPT="…". Shell double-quote rules
// treat \ $ ` " \ and newline specially, so each gets a preceding backslash
// (backslash FIRST, or it would double-escape). When the init script sources
// the config, the shell un-escapes them back to the exact candidate bytes.
// Without this, a candidate holding a literal " would terminate the string
// early and corrupt the whole config.
export function dqEscape(s) {
	let out = '';
	for (const ch of String(s)) {
		if (ch === '\\') out += '\\\\';
		else if (ch === '"') out += '\\"';
		else if (ch === '$') out += '\\$';
		else if (ch === '`') out += '\\`';
		else out += ch;
	}
	return out;
}

// renderCandidate(draftProfiles) → { ok:true, candidate } |
//   { ok:false, code, message, failures:[{id, index, diagnostics}] }
// Every fragment must parse to EXACTLY one native profile with NO
// error-severity diagnostics. The candidate joins fragments with ' --new '.
export function renderCandidate(draftProfiles) {
	if (!Array.isArray(draftProfiles) || draftProfiles.length === 0)
		return { ok: false, code: 'ESTATE', message: 'no draft profiles to apply (refusing to replace the applied config with an empty set)', failures: [] };
	const failures = [];
	const frags = [];
	for (let i = 0; i < draftProfiles.length; i++) {
		const p = draftProfiles[i];
		const frag = trimWs(p.opt ?? '');
		const errs = [];
		if (frag === '') {
			errs.push({ severity: 'error', code: 'MANAGER_EMPTY_PROFILE', message: `draft ${p.id}: empty options fragment`, tokenIndex: null, profileIndex: null });
		} else if (frag.includes('\n') || frag.includes('\r')) {
			// the applied config holds NFQWS2_OPT as a SINGLE-LINE quoted value;
			// multi-line fragments are a later feature, not silently flattened
			errs.push({ severity: 'error', code: 'MANAGER_FRAGMENT_MULTILINE', message: `draft ${p.id}: fragment contains a raw newline (single-line fragments only)`, tokenIndex: null, profileIndex: null });
		} else {
			const model = parse(frag);
			for (const d of allDiagnostics(model)) {
				if (d.severity === 'error') errs.push(d);
			}
			if (model.profiles.length !== 1 || model.trailingTokens.length > 0) {
				errs.push({ severity: 'error', code: 'MANAGER_FRAGMENT_NOT_SINGLE_PROFILE', message: `draft ${p.id}: fragment must parse to exactly one profile (found ${model.profiles.length})`, tokenIndex: null, profileIndex: null });
			}
		}
		if (errs.length) failures.push({ id: p.id ?? ('#' + i), index: i, diagnostics: errs });
		frags.push(frag);
	}
	if (failures.length)
		return { ok: false, code: 'EINPUT', message: failures.length + ' draft fragment(s) are structurally unfit — refusing to apply', failures };
	const candidate = frags.join(' --new ');
	if (candidate.length > MAX_CANDIDATE_BYTES)
		return { ok: false, code: 'EINPUT', message: 'candidate exceeds ' + MAX_CANDIDATE_BYTES + ' bytes', failures: [] };
	return { ok: true, candidate, fragments: frags };
}

// candidateRoundTrip(candidate, fragments) — parse the rendered document and
// prove every source fragment survives byte-for-byte (after the documented
// edge-whitespace trim). Any loss → false (the apply must refuse).
export function candidateRoundTrip(candidate, fragments) {
	const model = parse(candidate);
	if (model.profiles.length !== fragments.length) return false;
	for (let i = 0; i < fragments.length; i++) {
		if (profileFragment(model, model.profiles[i], candidate) !== trimWs(fragments[i])) return false;
	}
	return true;
}

// diffSummary(currentOpt, candidate, sha256hexFn) — honest preview diff.
export function diffSummary(currentOpt, candidate, sha256hexFn = sha256hexNode) {
	const cur = currentOpt ?? '';
	const curSha = sha256hexFn(cur);
	const candSha = sha256hexFn(candidate);
	return {
		changed: curSha !== candSha,
		currentSha256: curSha,
		candidateSha256: candSha,
		currentLength: cur.length,
		candidateLength: candidate.length
	};
}

// applyDecision(nativeValidation) — the native gate. Only a REAL dry-run pass
// (status 'partial', cliSyntax passed) proceeds. rejected / unavailable /
// not_checked refuse; any out-of-vocabulary status (incl. a fabricated
// 'valid') refuses.
export function applyDecision(nativeValidation) {
	const st = nativeValidation && nativeValidation.status;
	if (st === 'partial' && nativeValidation.coverage && nativeValidation.coverage.cliSyntax === 'passed')
		return { proceed: true };
	return { proceed: false, stage: 'validate' };
}

// checkIdempotent(lastApply, candidateSha256, now, windowSec) — a SECOND
// apply with the byte-identical candidate inside the window is a no-op.
// Motivation (supervised acceptance r10): an apply executed TWICE 21s apart
// from a single operator call (cause not reproduced — suspected duplicate
// dispatch); run #2 re-snapshotted the already-applied candidate into
// last-good, so the subsequent manual rollback restored the candidate, not
// the baseline. Regardless of the duplicate's source, the pipeline must be
// idempotent: re-running an identical candidate inside the window returns
// the previous result instead of re-writing/re-restarting/re-snapshotting.
export const APPLY_IDEMPOTENCY_WINDOW_SEC = 60;
export function checkIdempotent(lastApply, candidateSha256, now, windowSec = APPLY_IDEMPOTENCY_WINDOW_SEC) {
	if (!lastApply || typeof lastApply !== 'object') return { skip: false };
	if (lastApply.candidateSha256 !== candidateSha256) return { skip: false };
	const age = now - lastApply.at;
	if (age < 0 || age > windowSec * 1000) return { skip: false };
	return { skip: true, secondsAgo: Math.floor(age / 1000) };
}

// verifyStatus(statusJson, queueInfo) — the five post-restart checks:
//   processPresent  — runtime.count >= 1
//   singleInstance  — exactly ONE nfqws2
//   rulesPresent    — nft table present
//   queueRegistered — queue 300 registered in the kernel. Derived from
//                     queueInfo (the DIRECT /proc parse, which selects the
//                     row by queue number — registration of queue 300 by
//                     construction), NOT from the status collector: the
//                     collector races the daemon's asynchronous queue bind
//                     right after a restart and false-failed exactly this
//                     way during supervised acceptance (r9 drill: direct
//                     read registered+owner-match, collector read
//                     not-yet-registered → spurious rollback).
//   ownerMatch      — queue peer_portid == daemon PID (fixture-grounded:
//                     proc-nfnetlink_queue.out field 2 == ps pid)
export function verifyStatus(statusJson, queueInfo) {
	const rt = (statusJson && statusJson.runtime) || {};
	const health = (statusJson && statusJson.health) || {};
	const count = Number.isInteger(rt.count) ? rt.count : (Array.isArray(rt.instances) ? rt.instances.length : 0);
	const pid = Array.isArray(rt.instances) && rt.instances.length === 1 ? rt.instances[0].pid : null;
	const checks = {
		processPresent: count >= 1,
		singleInstance: count === 1,
		rulesPresent: rt.rulesPresent === true,
		queueRegistered: !!(queueInfo && queueInfo.registered),
		ownerMatch: pid != null && queueInfo && queueInfo.peer_portid != null && queueInfo.peer_portid === pid
	};
	const ok = Object.values(checks).every(Boolean);
	return { ok, checks, daemonPid: pid, queueOwner: queueInfo ? queueInfo.peer_portid : null };
}
