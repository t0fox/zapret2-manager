'use strict';
// profiles-draft.uc — DRAFT profile CRUD backend (SLICE 2).
//
// Drafts live ONLY in /etc/zapret2-manager/state.json. This module NEVER
// writes the applied upstream config (that is the Slice-3 apply path's job,
// through the sanctioned apply.uc writer). Runtime is never touched: no
// service restart happens on any draft op.
//
// Hard rules (mirrors tests/lib/profiles-draft.mjs — the node algorithm spec):
//   - schema-versioned state; a MALFORMED state is never overwritten —
//     mutating ops refuse with ESTATE and the raw file stays untouched;
//   - stable ids from a persisted sequence (nextIdSeq in state);
//   - optimistic concurrency: update carries the expected revision — a stale
//     revision is ECONFLICT, an unknown id is ESTATE;
//   - atomic write (temp + mv in the SAME directory) + a rolling backup of
//     the previous draft (.bak.1 newest, .bak.2, .bak.3 — capped at 3);
//   - serialization of concurrent writers: the CLI wraps mutating modes in
//     flock when present (see profiles-cli.uc); the marker file here is the
//     fallback only (same remaining-race caveat as apply.uc documents);
//   - opt fragments are OPAQUE — stored byte-verbatim, never normalized;
//   - profiles_validate runs the native parser ONLY as `nfqws2 --dry-run`
//     with argv elements POSIX-single-quote escaped (no shell interpolation
//     of content); no trusted Lua execution by default; the result
//     vocabulary is not_checked/partial/rejected/unavailable (never 'valid').

import { readfile, writefile, stat, unlink, popen } from 'fs';
import { read_var } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_tokenize, z2m_parse, z2m_validate, z2m_fragment } from './profiles.uc';

const DRAFT_SCHEMA = 1;
const MAX_OPT_BYTES = 65536;
const MAX_PROFILES = 64;
const STATE = PATHS.draft_state;                    // /etc/zapret2-manager/state.json
const BAK1 = STATE + '.bak.1';
const BAK2 = STATE + '.bak.2';
const BAK3 = STATE + '.bak.3';
const MARKER = '/tmp/zapret2-manager/state.writing'; // fallback lock (flock is primary, in the CLI)
const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const OPT_VAR = 'NFQWS2_OPT';

function err(code, message) {
	return { ok: false, error: { code: code, message: message } };
}

// ---------------------------------------------------------------------------
// state parse / serialize (mirrors parseState/serializeState)
// ---------------------------------------------------------------------------
function empty_state() {
	return { schema: DRAFT_SCHEMA, updatedAt: null, nextIdSeq: 1, profiles: [] };
}

function normalize_profile(p) {
	return {
		id: p.id,
		name: p.name,
		source: (type(p.source) == 'string') ? p.source : 'created',
		revision: (type(p.revision) == 'int' && p.revision >= 1) ? p.revision : 1,
		createdAt: (type(p.createdAt) == 'int') ? p.createdAt : null,
		updatedAt: (type(p.updatedAt) == 'int') ? p.updatedAt : null,
		opt: p.opt
	};
}

// parse_state(text) → { ok:true, state } | { ok:false, malformed:true, reason }
function parse_state(text) {
	if (text == null || trim('' + text) == '') return { ok: true, state: empty_state() };
	let obj = null;
	try { obj = json(text); } catch (e) {
		return { ok: false, malformed: true, reason: 'state.json is not valid JSON', state: null };
	}
	if (type(obj) != 'object' || obj == null)
		return { ok: false, malformed: true, reason: 'state.json is not an object', state: null };
	if (obj.schema == null && obj.profiles == null)
		return { ok: true, state: empty_state() };   // shipped skeleton {} → migrate
	if (obj.schema != DRAFT_SCHEMA)
		return { ok: false, malformed: true, reason: 'unsupported state schema (expected ' + DRAFT_SCHEMA + ')', state: null };
	if (type(obj.profiles) != 'array')
		return { ok: false, malformed: true, reason: 'state.profiles is not an array', state: null };
	for (let i = 0; i < length(obj.profiles); i++) {
		let p = obj.profiles[i];
		if (type(p) != 'object' || type(p.id) != 'string' || type(p.name) != 'string' || type(p.opt) != 'string')
			return { ok: false, malformed: true, reason: 'a profile record is malformed (id/name/opt must be strings)', state: null };
	}
	let profiles = [];
	for (let i = 0; i < length(obj.profiles); i++) push(profiles, normalize_profile(obj.profiles[i]));
	let state = {
		schema: DRAFT_SCHEMA,
		updatedAt: (type(obj.updatedAt) == 'int') ? obj.updatedAt : null,
		nextIdSeq: (type(obj.nextIdSeq) == 'int' && obj.nextIdSeq >= 1) ? obj.nextIdSeq : 1,
		profiles: profiles
	};
	// service.uc co-owns two free-form keys in the same file (passthrough /
	// active_profile — read by status.uc for the serviceState). They are NOT
	// draft-schema fields, but a draft save must never drop them: preserve.
	if (type(obj.passthrough) == 'object' && obj.passthrough != null) state.passthrough = obj.passthrough;
	if (type(obj.active_profile) == 'object' && obj.active_profile != null) state.active_profile = obj.active_profile;
	return { ok: true, state: state };
}

export const load_state = function() {
	return parse_state(readfile(STATE));
};

// restore_state_raw(content) — the SANCTIONED restore of state.json (Slice 5
// backup restore). The content is VALIDATED through parse_state (a malformed
// restore never lands), then written through save_state (rolling backup of
// the previous draft + atomic temp+mv + lock discipline). Returns the
// parse_state result on success, { ok:false, reason } on refusal.
export const restore_state_raw = function(content) {
	let pr = parse_state(content);
	if (!pr.ok) return { ok: false, reason: 'restore content is not a valid draft state: ' + pr.reason };
	if (!save_state(pr.state)) return { ok: false, reason: 'failed to write draft state (lock active or disk error)' };
	return { ok: true };
};

// restore_drafts(profilesArray) — replace ONLY the draft profiles (the
// 'profiles' backup scope): service keys (passthrough/active_profile) and
// the id sequence are preserved; every restored record is normalized
// through the same shape rules as CRUD. Returns { ok, count } | { ok:false }.
export const restore_drafts = function(profilesArray) {
	if (type(profilesArray) != 'array') return { ok: false, reason: 'profiles scope content is not an array' };
	let ls = load_state();
	if (!ls.ok) return { ok: false, reason: 'draft state is malformed — refusing to overwrite it: ' + ls.reason };
	let clean = [];
	for (let i = 0; i < length(profilesArray); i++) {
		let p = profilesArray[i];
		if (type(p) != 'object' || type(p.id) != 'string' || type(p.name) != 'string' || type(p.opt) != 'string')
			return { ok: false, reason: 'restored profile record #' + i + ' is malformed (id/name/opt must be strings)' };
		push(clean, normalize_profile(p));
	}
	if (length(clean) > MAX_PROFILES) return { ok: false, reason: 'restored set exceeds the draft profile limit' };
	// keep the id sequence ahead of every restored id to avoid collisions
	let maxSeq = ls.state.nextIdSeq;
	for (let i = 0; i < length(clean); i++) {
		let m = clean[i];
		if (substr(m.id, 0, 1) == 'p') {
			let n = +substr(m.id, 1);
			if (n > 0 && n + 1 > maxSeq) maxSeq = n + 1;
		}
	}
	ls.state.profiles = clean;
	ls.state.nextIdSeq = maxSeq;
	ls.state.updatedAt = time();
	if (!save_state(ls.state)) return { ok: false, reason: 'failed to write draft state (lock active or disk error)' };
	return { ok: true, count: length(clean) };
};

// save_state(state) — backup rotation (.bak.1/.2/.3) then atomic temp+mv.
// Returns true on success, false on any write failure (the caller surfaces
// ETARGET; nothing is left half-written: a failed mv leaves only the temp).
function save_state(state) {
	// marker fallback (flock is the real serializer — see profiles-cli.uc)
	if (stat(MARKER)) {
		let mt = trim(readfile(MARKER));
		let age = time() - (+mt);
		if (mt && age < 60) return false;
		try { unlink(MARKER); } catch (e) { }
	}
	try { writefile(MARKER, '' + time() + '\n'); } catch (e) { }

	// rotate backups: .bak.2 → .bak.3, .bak.1 → .bak.2, current → .bak.1
	if (stat(BAK2)) {
		let p = popen('mv -f ' + BAK2 + ' ' + BAK3 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}
	if (stat(BAK1)) {
		let p = popen('mv -f ' + BAK1 + ' ' + BAK2 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}
	if (stat(STATE)) {
		let p = popen('cp -p ' + STATE + ' ' + BAK1 + ' 2>/dev/null', 'r');
		if (p) p.close();
	}

	let out = sprintf("%J", state) + '\n';
	let tmp = STATE + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + STATE + ' 2>/dev/null', 'r');
	if (p) p.close();
	try { unlink(MARKER); } catch (e) { }
	if (stat(tmp)) { try { unlink(tmp); } catch (e) { } return false; }
	return true;
}

// ---------------------------------------------------------------------------
// CRUD (mirrors createProfile/updateProfile/cloneProfile/deleteProfile)
// ---------------------------------------------------------------------------
function alloc_id(state) {
	let s = '000000' + state.nextIdSeq;
	let id = 'p' + substr(s, length(s) - 6);
	state.nextIdSeq += 1;
	return id;
}

function valid_input(name, opt) {
	if (type(name) != 'string' || length(name) == 0 || length(name) > 128) return 'name must be a string 1..128 chars';
	if (type(opt) != 'string') return 'opt must be a string';
	if (length(opt) > MAX_OPT_BYTES) return 'opt exceeds ' + MAX_OPT_BYTES + ' bytes';
	return null;
}

function find_profile(state, id) {
	for (let i = 0; i < length(state.profiles); i++)
		if (state.profiles[i].id == id) return i;
	return -1;
}

export const profiles_create = function(input) {
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let bad = valid_input(input ? input.name : null, input ? input.opt : null);
	if (bad != null) return err('EINPUT', bad);
	if (length(ls.state.profiles) >= MAX_PROFILES)
		return err('ESTATE', 'draft profile limit reached (' + MAX_PROFILES + ')');
	let now = time();
	let profile = {
		id: alloc_id(ls.state),
		name: input.name,
		source: 'created',
		revision: 1,
		createdAt: now,
		updatedAt: now,
		opt: input.opt
	};
	push(ls.state.profiles, profile);
	ls.state.updatedAt = now;
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, id: profile.id, revision: profile.revision };
};

export const profiles_update = function(input) {
	if (type(input) != 'object' || type(input.id) != 'string')
		return err('EINPUT', 'missing id');
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let idx = find_profile(ls.state, input.id);
	if (idx < 0) return err('ESTATE', 'no draft profile with id ' + input.id);
	let cur = ls.state.profiles[idx];
	if (type(input.revision) != 'int' || input.revision != cur.revision)
		return err('ECONFLICT', 'draft ' + input.id + ' was changed elsewhere (revision ' + cur.revision + '); reload and retry');
	let newName = (input.name != null) ? input.name : cur.name;
	let newOpt = (input.opt != null) ? input.opt : cur.opt;
	let bad = valid_input(newName, newOpt);
	if (bad != null) return err('EINPUT', bad);
	cur.name = newName;
	cur.opt = newOpt;
	cur.revision = cur.revision + 1;
	cur.updatedAt = time();
	ls.state.profiles[idx] = cur;
	ls.state.updatedAt = time();
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, id: cur.id, revision: cur.revision };
};

export const profiles_clone = function(input) {
	if (type(input) != 'object' || type(input.id) != 'string')
		return err('EINPUT', 'missing id');
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let idx = find_profile(ls.state, input.id);
	if (idx < 0) return err('ESTATE', 'no draft profile with id ' + input.id);
	if (length(ls.state.profiles) >= MAX_PROFILES)
		return err('ESTATE', 'draft profile limit reached (' + MAX_PROFILES + ')');
	let cur = ls.state.profiles[idx];
	let now = time();
	let profile = {
		id: alloc_id(ls.state),
		name: cur.name + ' (copy)',
		source: 'cloned',
		revision: 1,
		createdAt: now,
		updatedAt: now,
		opt: cur.opt
	};
	push(ls.state.profiles, profile);
	ls.state.updatedAt = now;
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, id: profile.id, revision: profile.revision };
};

export const profiles_delete = function(input) {
	if (type(input) != 'object' || type(input.id) != 'string')
		return err('EINPUT', 'missing id');
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let idx = find_profile(ls.state, input.id);
	if (idx < 0) return err('ESTATE', 'no draft profile with id ' + input.id);
	// NOTE: deleting a DRAFT never affects runtime/applied — drafts are not
	// referenced by the running engine at all (three-level state model).
	let kept = [];
	for (let i = 0; i < length(ls.state.profiles); i++)
		if (ls.state.profiles[i].id != input.id) push(kept, ls.state.profiles[i]);
	ls.state.profiles = kept;
	ls.state.updatedAt = time();
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, id: input.id };
};

// ---------------------------------------------------------------------------
// import applied (READS the applied config through the sanctioned reader;
// every applied profile becomes a draft with its raw fragment preserved)
// ---------------------------------------------------------------------------
export const profiles_import_applied = function() {
	let opt = read_var(OPT_VAR);
	if (opt == null) return err('ETARGET', 'no applied ' + OPT_VAR + ' to import');
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let model = z2m_parse(opt);
	let imported = [];
	let now = time();
	for (let i = 0; i < length(model.profiles); i++) {
		if (length(ls.state.profiles) >= MAX_PROFILES) break;
		let p = model.profiles[i];
		let frag = z2m_fragment(model, p, opt);
		if (frag == '') continue;
		let profile = {
			id: alloc_id(ls.state),
			name: (p.name != null) ? p.name : ('applied #' + p.index),
			source: 'imported',
			revision: 1,
			createdAt: now,
			updatedAt: now,
			opt: frag
		};
		push(ls.state.profiles, profile);
		push(imported, profile.id);
	}
	ls.state.updatedAt = now;
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, imported: imported };
};

// ---------------------------------------------------------------------------
// validate (manager structural diagnostics + native --dry-run, argv escaped)
// ---------------------------------------------------------------------------

// POSIX single-quote escaping: a single-quoted string is literal to every
// shell; the only special character is the quote itself, escaped as '\''.
// Content escaped this way can never be re-interpreted by the shell.
function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

function validate_draft_manager(optText) {
	let model = z2m_parse(optText);
	let vdiags = z2m_validate(model);
	let diags = [];
	for (let i = 0; i < length(model.diagnostics); i++) push(diags, model.diagnostics[i]);
	for (let i = 0; i < length(vdiags); i++) push(diags, vdiags[i]);
	let hasErrors = false;
	for (let i = 0; i < length(diags); i++)
		if (diags[i].severity == 'error') { hasErrors = true; break; }
	return {
		parseStatus: hasErrors ? 'partial' : 'success',
		profileCount: length(model.profiles),
		diagnostics: diags
	};
}

function native_unavailable(reason) {
	return {
		status: 'unavailable', entryPoint: null,
		coverage: { cliSyntax: 'not_checked', luaLoad: 'not_checked', luaCompatibility: 'not_checked', functionExistence: 'not_checked', runtimeArguments: 'not_checked', executionPlan: 'not_checked' },
		diagnostics: [{ severity: 'error', code: 'NATIVE_UNAVAILABLE', message: '' + reason, tokenIndex: null, profileIndex: null }],
		bundleId: null, nativeVersion: null, luaCompatVer: null
	};
}

function native_dry_run_result(rc, out) {
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

// native_dry_run(optText) — runs `nfqws2 --dry-run <tokens>` where EVERY
// options token is ONE argv element, POSIX-single-quote escaped (no shell
// interpolation of content). --dry-run exits before nfq_main: no Lua, no
// sockets, no NFQUEUE, no traffic (verified native architecture,
// strategy-model.md §2.2).
function native_dry_run(optText) {
	if (!stat(NFQWS2_BIN)) return native_unavailable('nfqws2 binary not found at ' + NFQWS2_BIN);
	let tz = z2m_tokenize(optText);
	let cmd = shell_escape(NFQWS2_BIN) + ' --dry-run';
	for (let i = 0; i < length(tz.tokens); i++)
		cmd += ' ' + shell_escape(tz.tokens[i].value);
	cmd += ' 2>&1';
	let p = popen(cmd, 'r');
	if (!p) return native_unavailable('popen failed');
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return native_dry_run_result(rc, out);
}

export const profiles_validate = function(input) {
	let optText = null;
	let draftId = null;
	if (type(input) == 'object' && type(input.id) == 'string') {
		let ls = load_state();
		if (!ls.ok) return err('ESTATE', 'draft state is malformed: ' + ls.reason);
		let idx = find_profile(ls.state, input.id);
		if (idx < 0) return err('ESTATE', 'no draft profile with id ' + input.id);
		optText = ls.state.profiles[idx].opt;
		draftId = input.id;
	} else if (type(input) == 'object' && type(input.opt) == 'string') {
		optText = input.opt;
	} else {
		return err('EINPUT', 'validate needs {"id": "p000001"} or {"opt": "<options>"}');
	}
	return {
		ok: true,
		draftId: draftId,
		manager: validate_draft_manager(optText),
		native: native_dry_run(optText)
	};
};

// ---------------------------------------------------------------------------
// draft block for profiles_list (mirrors draftBlock in the node reference)
// ---------------------------------------------------------------------------
function draft_list_entry(p, all) {
	let v = validate_draft_manager(p.opt);
	let dup = false;
	for (let i = 0; i < length(all); i++)
		if (all[i] != p && all[i].name == p.name) { dup = true; break; }
	return {
		id: p.id, name: p.name, source: p.source, revision: p.revision,
		createdAt: p.createdAt, updatedAt: p.updatedAt, opt: p.opt,
		parseStatus: v.parseStatus, diagnostics: v.diagnostics,
		duplicateName: dup
	};
}

export const draft_block = function() {
	let raw = readfile(STATE);
	if (raw == null)
		return { present: false, malformed: false, malformedReason: null, profileCount: 0, profiles: [] };
	let ls = parse_state(raw);
	if (!ls.ok)
		return { present: true, malformed: true, malformedReason: (ls.reason != null) ? ls.reason : 'malformed', profileCount: 0, profiles: [] };
	let entries = [];
	for (let i = 0; i < length(ls.state.profiles); i++)
		push(entries, draft_list_entry(ls.state.profiles[i], ls.state.profiles));
	return {
		present: true, malformed: false, malformedReason: null,
		profileCount: length(ls.state.profiles),
		profiles: entries
	};
};
