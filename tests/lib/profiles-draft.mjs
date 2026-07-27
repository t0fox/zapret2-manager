// profiles-draft.mjs — node reference for DRAFT profile CRUD (SLICE 2).
//
// This is the ALGORITHM SPEC for the shipped ucode profiles-draft.uc. Drafts
// live ONLY in /etc/zapret2-manager/state.json — this module NEVER touches
// the applied upstream config (that is the Slice-3 apply path's job, through
// the sanctioned writer).
//
// Hard rules:
//   - schema-versioned state; a MALFORMED state is never overwritten —
//     mutating ops refuse with ESTATE and return state:null;
//   - stable ids from a persisted sequence (nextIdSeq in state);
//   - optimistic concurrency: update carries the expected revision — a stale
//     revision is ECONFLICT, an unknown id is ESTATE;
//   - opt fragments are OPAQUE: stored byte-verbatim, never normalized;
//   - native validation vocabulary: not_checked/partial/rejected/unavailable
//     (NEVER 'valid'); a dry-run rc=0 covers cliSyntax ONLY.
//
// The module is pure (no I/O). File effects (atomic write, lock, backups)
// live in the ucode mirror; the state-shape transitions are proven here.

import { parse } from '../strategy/lib/parse.mjs';
import { allDiagnostics } from '../strategy/lib/validate.mjs';

export const DRAFT_SCHEMA = 1;
export const MAX_OPT_BYTES = 65536;   // one fragment is router-scale text
export const MAX_PROFILES = 64;

export function emptyState() {
	return { schema: DRAFT_SCHEMA, updatedAt: null, nextIdSeq: 1, profiles: [] };
}

// parseState(text) → { ok:true, state } | { ok:false, malformed:true, reason, state:null }
// null/empty text and the shipped skeleton '{}' both map to an empty state.
export function parseState(text) {
	if (text == null || String(text).trim() === '') return { ok: true, state: emptyState() };
	let obj;
	try { obj = JSON.parse(text); } catch (e) {
		return { ok: false, malformed: true, reason: 'state.json is not valid JSON: ' + e.message, state: null };
	}
	if (obj == null || typeof obj !== 'object' || Array.isArray(obj))
		return { ok: false, malformed: true, reason: 'state.json is not an object', state: null };
	if (obj.schema == null && obj.profiles == null) {
		// shipped skeleton {} → migrate to an empty v1 state
		return { ok: true, state: emptyState() };
	}
	if (obj.schema !== DRAFT_SCHEMA)
		return { ok: false, malformed: true, reason: 'unsupported state schema ' + JSON.stringify(obj.schema) + ' (expected ' + DRAFT_SCHEMA + ')', state: null };
	if (!Array.isArray(obj.profiles))
		return { ok: false, malformed: true, reason: 'state.profiles is not an array', state: null };
	for (const p of obj.profiles) {
		if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.opt !== 'string' || typeof p.name !== 'string')
			return { ok: false, malformed: true, reason: 'a profile record is malformed (id/name/opt must be strings)', state: null };
	}
	const nextIdSeq = Number.isInteger(obj.nextIdSeq) && obj.nextIdSeq >= 1 ? obj.nextIdSeq : 1;
	const state = {
		schema: DRAFT_SCHEMA,
		updatedAt: Number.isInteger(obj.updatedAt) ? obj.updatedAt : null,
		nextIdSeq,
		profiles: obj.profiles.map(normalizeProfile)
	};
	// service.uc co-owns two free-form keys in the same file (passthrough /
	// active_profile — read by status.uc for the serviceState). They are NOT
	// draft-schema fields, but a draft save must never drop them: preserve.
	if (obj.passthrough && typeof obj.passthrough === 'object') state.passthrough = obj.passthrough;
	if (obj.active_profile && typeof obj.active_profile === 'object') state.active_profile = obj.active_profile;
	return { ok: true, state };
}

function normalizeProfile(p) {
	return {
		id: p.id,
		name: p.name,
		source: typeof p.source === 'string' ? p.source : 'created',
		revision: Number.isInteger(p.revision) && p.revision >= 1 ? p.revision : 1,
		createdAt: Number.isInteger(p.createdAt) ? p.createdAt : null,
		updatedAt: Number.isInteger(p.updatedAt) ? p.updatedAt : null,
		opt: p.opt
	};
}

export function serializeState(state) {
	return JSON.stringify(state, null, '\t') + '\n';
}

function malformedGuard(state) {
	if (state == null) return { ok: false, code: 'ESTATE', message: 'draft state is malformed — refusing to overwrite it', state: null };
	return null;
}

function validInput(name, opt) {
	if (typeof name !== 'string' || name.length === 0 || name.length > 128) return 'name must be a string 1..128 chars';
	if (typeof opt !== 'string') return 'opt must be a string';
	if (opt.length > MAX_OPT_BYTES) return 'opt exceeds ' + MAX_OPT_BYTES + ' bytes';
	return null;
}

function allocId(state) {
	const id = 'p' + ('000000' + state.nextIdSeq).slice(-6);
	state.nextIdSeq += 1;
	return id;
}

export function createProfile(state, input, now, parsedStateResult = null) {
	const guard = malformedGuard(state);
	if (guard) return guard;
	const bad = validInput(input?.name, input?.opt);
	if (bad) return { ok: false, code: 'EINPUT', message: bad, state: null };
	if (state.profiles.length >= MAX_PROFILES)
		return { ok: false, code: 'ESTATE', message: 'draft profile limit reached (' + MAX_PROFILES + ')', state: null };
	const next = { ...state, profiles: state.profiles.slice() };
	const profile = {
		id: allocId(next),
		name: input.name,
		source: 'created',
		revision: 1,
		createdAt: now ?? null,
		updatedAt: now ?? null,
		opt: input.opt
	};
	next.profiles.push(profile);
	next.updatedAt = now ?? null;
	return { ok: true, state: next, profile };
}

export function updateProfile(state, id, revision, input, now) {
	const guard = malformedGuard(state);
	if (guard) return guard;
	const idx = state.profiles.findIndex((p) => p.id === id);
	if (idx < 0) return { ok: false, code: 'ESTATE', message: 'no draft profile with id ' + id, state: null };
	const cur = state.profiles[idx];
	if (!Number.isInteger(revision) || revision !== cur.revision)
		return { ok: false, code: 'ECONFLICT', message: 'draft ' + id + ' was changed elsewhere (revision ' + cur.revision + '); reload and retry', state: null };
	if (input?.name != null || input?.opt != null) {
		const bad = validInput(input.name ?? cur.name, input.opt ?? cur.opt);
		if (bad) return { ok: false, code: 'EINPUT', message: bad, state: null };
	}
	const next = { ...state, profiles: state.profiles.slice() };
	const profile = { ...cur, revision: cur.revision + 1, updatedAt: now ?? null };
	if (input?.name != null) profile.name = input.name;
	if (input?.opt != null) profile.opt = input.opt;
	next.profiles[idx] = profile;
	next.updatedAt = now ?? null;
	return { ok: true, state: next, profile };
}

export function cloneProfile(state, id, now) {
	const guard = malformedGuard(state);
	if (guard) return guard;
	const cur = state.profiles.find((p) => p.id === id);
	if (!cur) return { ok: false, code: 'ESTATE', message: 'no draft profile with id ' + id, state: null };
	if (state.profiles.length >= MAX_PROFILES)
		return { ok: false, code: 'ESTATE', message: 'draft profile limit reached (' + MAX_PROFILES + ')', state: null };
	const next = { ...state, profiles: state.profiles.slice() };
	const profile = {
		...cur,
		id: allocId(next),
		name: cur.name + ' (copy)',
		source: 'cloned',
		revision: 1,
		createdAt: now ?? null,
		updatedAt: now ?? null
	};
	next.profiles.push(profile);
	next.updatedAt = now ?? null;
	return { ok: true, state: next, profile };
}

export function deleteProfile(state, id, now) {
	const guard = malformedGuard(state);
	if (guard) return guard;
	const idx = state.profiles.findIndex((p) => p.id === id);
	if (idx < 0) return { ok: false, code: 'ESTATE', message: 'no draft profile with id ' + id, state: null };
	const next = { ...state, profiles: state.profiles.filter((p) => p.id !== id) };
	next.updatedAt = now ?? null;
	return { ok: true, state: next };
}

// importApplied(state, model, optText, now) — every applied profile becomes a
// draft carrying its RAW fragment (byte-slice of the applied opt text, the
// --new separator excluded, surrounding whitespace trimmed). Applied/runtime
// are READ, never modified.
export function importApplied(state, model, optText, now) {
	const guard = malformedGuard(state);
	if (guard) return guard;
	const next = { ...state, profiles: state.profiles.slice() };
	const imported = [];
	for (const p of model.profiles) {
		if (next.profiles.length >= MAX_PROFILES) break;
		const frag = profileFragment(model, p, optText);
		if (frag === '') continue;
		const profile = {
			id: allocId(next),
			name: p.name ?? ('applied #' + p.index),
			source: 'imported',
			revision: 1,
			createdAt: now ?? null,
			updatedAt: now ?? null,
			opt: frag
		};
		next.profiles.push(profile);
		imported.push(profile.id);
	}
	next.updatedAt = now ?? null;
	return { ok: true, state: next, imported };
}

// profileFragment(model, profile, optText) — the profile's raw byte-slice:
// from the end of its --new separator (or its first token, for the implicit
// first profile) to its sourceSpan end; surrounding whitespace trimmed. All
// CONTENT bytes (quotes, escapes, placeholders) survive verbatim.
export function profileFragment(model, profile, optText) {
	let start;
	if (profile.separator && profile.separator.span) start = profile.separator.span.end;
	else if (profile.originalTokens.length > 0) start = model.tokens[profile.originalTokens[0]].start;
	else start = profile.sourceSpan.start ?? 0;
	let end = profile.sourceSpan.end ?? optText.length;
	const frag = optText.slice(start, end);
	return frag.replace(/^\s+/, '').replace(/\s+$/, '');
}

// validateDraft(optText) — MANAGER-level structural diagnostics only (no
// native execution; that is the dry-run adapter's job).
export function validateDraft(optText) {
	const model = parse(optText ?? '');
	const diags = allDiagnostics(model).map((d) => ({
		severity: d.severity, code: d.code, message: d.message,
		tokenIndex: d.tokenIndex ?? null, profileIndex: d.profileIndex ?? null
	}));
	return {
		parseStatus: diags.some((d) => d.severity === 'error') ? 'partial' : 'success',
		profileCount: model.profiles.length,
		diagnostics: diags
	};
}

// nativeDryRunResult(rc, stderr) — honest mapping of a native `--dry-run` run:
// rc=0 covers CLI SYNTAX only (partial; every deeper layer not_checked); rc!=0
// is rejected with the native error carried in diagnostics.
export function nativeDryRunResult(rc, stderr) {
	if (rc === 0) {
		return {
			status: 'partial', entryPoint: 'dry-run',
			coverage: { cliSyntax: 'passed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
			diagnostics: [], bundleId: null, nativeVersion: null, luaCompatVer: null
		};
	}
	return {
		status: 'rejected', entryPoint: 'dry-run',
		coverage: { cliSyntax: 'failed', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: [{ severity: 'error', code: 'NATIVE_REJECTED', message: String(stderr ?? '').trim() || ('nfqws2 --dry-run exited ' + rc), tokenIndex: null, profileIndex: null }],
		bundleId: null, nativeVersion: null, luaCompatVer: null
	};
}

export function nativeUnavailable(reason) {
	return {
		status: 'unavailable', entryPoint: null,
		coverage: { cliSyntax: 'not_checked', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: [{ severity: 'error', code: 'NATIVE_UNAVAILABLE', message: String(reason), tokenIndex: null, profileIndex: null }],
		bundleId: null, nativeVersion: null, luaCompatVer: null
	};
}

// buildDryRunArgv(tokenValues) — the argv ARRAY for `nfqws2 --dry-run`:
// every options token is ONE argv element, verbatim. The runner must never
// interpolate these into a shell string without per-element POSIX escaping
// (shellEscape below is exactly that).
export function buildDryRunArgv(tokenValues) {
	return ['--dry-run', ...tokenValues];
}

// shellEscape(s) — canonical POSIX single-quote escaping: a single-quoted
// string is literal to every shell; the only special character is the quote
// itself, escaped as '\'' (end quote, escaped quote, reopen quote). Content
// escaped this way can never be re-interpreted by the shell.
export function shellEscape(s) {
	return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// draftListEntry(profile, allProfiles) — the profiles_list draft-block entry:
// the stored fields plus manager parse diagnostics of the fragment and a
// duplicate-name flag (duplicates are ALLOWED, never silently rejected).
export function draftListEntry(profile, allProfiles = [profile]) {
	const v = validateDraft(profile.opt);
	const dup = allProfiles.filter((p) => p !== profile && p.name === profile.name).length > 0;
	return {
		id: profile.id,
		name: profile.name,
		source: profile.source,
		revision: profile.revision,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
		opt: profile.opt,
		parseStatus: v.parseStatus,
		diagnostics: v.diagnostics,
		duplicateName: dup
	};
}

// draftBlock(stateResult) — the profiles_list `draft` block. Honest states:
//   null result        → present:false (state file absent/unreadable)
//   malformed          → present:true, malformed:true (raw preserved, never
//                        overwritten; mutating ops refuse)
//   ok                 → entries with per-fragment diagnostics
export function draftBlock(stateResult) {
	if (stateResult == null)
		return { present: false, malformed: false, malformedReason: null, profileCount: 0, profiles: [] };
	if (!stateResult.ok)
		return { present: true, malformed: true, malformedReason: stateResult.reason ?? 'malformed', profileCount: 0, profiles: [] };
	const st = stateResult.state;
	return {
		present: true, malformed: false, malformedReason: null,
		profileCount: st.profiles.length,
		profiles: st.profiles.map((p) => draftListEntry(p, st.profiles))
	};
}
