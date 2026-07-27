'use strict';
// lists.uc — list management backend for zapret2-manager (ЦЕЛЬ ДВА).
//
// Manages USER lists (editable) and reports ENGINE-supplied lists (read-only).
// User lists: domain include, domain exclude, IP include, IP exclude, IP
// full-block. Engine lists: autohostlist (auto-formed), ipset (shipped). The
// page shows which lists are engine-supplied (not editable) vs user (editable),
// and whether a domain falls under the autohostlist (the main user-confusion
// source). A domain in BOTH include and exclude is an ERROR reported BEFORE
// apply. File generation goes through apply.uc (read_list_file /
// write_list_file) — no second write path. IP sets and firewall rules are
// READ-ONLY here; this module never touches nft/ipset.
//
// List file paths are [VERIFY:ROUTER] — the engine is not on the device yet.
// The paths below follow the zapret2 ipset/ convention; confirm on a freshly
// installed engine and adjust here (one place).
//
// Mirrors tests/lib/lists-logic.mjs (normalize_domain, find_conflicts,
// check_domain). ucode does not run locally; the node self-test proves the
// algorithm; runtime confirmed on target via smoke.sh.

import { readfile, writefile, stat } from 'fs';
import { read_list_file, write_list_file } from './apply.uc';

// [VERIFY:ROUTER] list file paths (zapret2 ipset/ convention)
const LIST_PATHS = {
	domainInclude:  '/opt/zapret2/ipset/zapret-hostlist-user.txt',
	domainExclude:  '/opt/zapret2/ipset/zapret-ipset-exclude-user.txt',
	autohostlist:   '/opt/zapret2/ipset/zapret-hosts-auto.txt',
	ipInclude:      '/opt/zapret2/ipset/zapret-ipset-include-user.txt',
	ipExclude:      '/opt/zapret2/ipset/zapret-ipset-exclude-user.txt',
	ipBlock:        '/opt/zapret2/ipset/zapret-ipset-block-user.txt'
};

// ---- logic (mirrors tests/lib/lists-logic.mjs) ------------------------------
// ucode does NOT hoist `function` declarations in module mode (a helper must
// precede its first caller), so tolower is defined BEFORE normalize_domain.

// ucode has no built-in tolower/.lower(); map A-Z → a-z via ord/chr (no
// subprocess, no shell injection). ASCII only — domains are ASCII (IDN is
// punycode-encoded before it reaches here).
function tolower(s) {
	let out = '';
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		let code = ord(c);
		if (code >= 65 && code <= 90) c = chr(code + 32);   // 'A'..'Z' → 'a'..'z'
		out += c;
	}
	return out;
}

function normalize_domain(d) {
	if (d == null) return '';
	let s = trim('' + d);
	s = tolower(s);
	if (substr(s, 0, 1) == '.') s = substr(s, 1);
	return s;
}

function find_conflicts(include, exclude) {
	if (!include || !exclude) return [];
	let ex = {};
	for (let i = 0; i < length(exclude); i++) {
		let n = normalize_domain(exclude[i]);
		if (length(n)) ex[n] = true;
	}
	let conflicts = [];
	let seen = {};
	for (let i = 0; i < length(include); i++) {
		let n = normalize_domain(include[i]);
		if (!length(n) || seen[n]) continue;
		if (ex[n]) { push(conflicts, n); seen[n] = true; }
	}
	return conflicts;
}

// _in_list is declared BEFORE check_domain (ucode does not hoist `function`
// declarations in module mode — a helper must precede its first caller).
function _in_list(n, arr) {
	if (!arr) return false;
	for (let i = 0; i < length(arr); i++)
		if (normalize_domain(arr[i]) == n) return true;
	return false;
}

function check_domain(domain, lists) {
	let n = normalize_domain(domain);
	let inInc = _in_list(n, lists.userInclude);
	let inExc = _in_list(n, lists.userExclude);
	let inAuto = _in_list(n, lists.autohostlist);
	return {
		domain: n,
		userInclude: inInc,
		userExclude: inExc,
		autohostlist: inAuto,
		conflict: inInc && inExc
	};
}

// ---- state ------------------------------------------------------------------

// Read all list state: user lists (editable) + engine lists (read-only).
// Returns an object the UI renders directly.
export const lists_get = function() {
	let domainInclude = read_list_file(LIST_PATHS.domainInclude);
	let domainExclude = read_list_file(LIST_PATHS.domainExclude);
	let autohostlist  = read_list_file(LIST_PATHS.autohostlist);
	let ipInclude     = read_list_file(LIST_PATHS.ipInclude);
	let ipExclude     = read_list_file(LIST_PATHS.ipExclude);
	let ipBlock       = read_list_file(LIST_PATHS.ipBlock);

	// which files are engine-supplied (not editable) vs user (editable)
	let engineSupplied = {
		autohostlist: stat(LIST_PATHS.autohostlist) ? true : false
	};

	return {
		userLists: {
			domainInclude: domainInclude,
			domainExclude: domainExclude,
			ipInclude: ipInclude,
			ipExclude: ipExclude,
			ipBlock: ipBlock
		},
		engineLists: {
			autohostlist: autohostlist,
			autohostlistPath: LIST_PATHS.autohostlist,
			engineSupplied: engineSupplied
		},
		paths: LIST_PATHS,
		conflicts: find_conflicts(domainInclude, domainExclude)
	};
};

// Apply user list edits. WIRE FORMAT: `edit` is a JSON STRING (rpcd params are
// strings — the frontend sends edit as a JSON-encoded string). We parse it ONCE
// (no sprintf("%J") before parse, no double-encode), require an OBJECT with
// ALLOWED keys whose values are arrays of strings. Engine-owned lists
// (autohostlist) are rejected. Conflicts (a domain in BOTH include and exclude)
// are refused BEFORE any write — no files touched. Each write goes through
// apply.uc write_list_file (single write path); a write failure is surfaced as
// {ok:false, error} (write_list_file returns null on failure). Mirrors
// tests/lib/lists-wire.mjs validate_edit + lists_set.
const ALLOWED_LIST_KEYS = {
	domainInclude: true, domainExclude: true,
	ipInclude: true, ipExclude: true, ipBlock: true
};
const ENGINE_OWNED_LISTS = { autohostlist: true };

// validate_edit(editStr) → { ok:true, edit } | { ok:false, error, ... }.
// Pure (no writes); runs every wire-format rule so the CLI and the rpcd plugin
// share one validation path. ucode type() returns 'string'/'array'/'object'/
// 'int'/'bool'/''(null); arrays are 'array' (NOT 'object'), so type() distinguishes.
export const validate_edit = function(edit_str) {
	if (type(edit_str) != 'string')
		return { ok: false, error: 'edit must be a JSON string', got: type(edit_str) };
	let edit = null;
	try { edit = json(edit_str); } catch (e) { return { ok: false, error: 'invalid JSON' }; }
	// json() decodes an object to type 'object', an array to 'array', null to ''
	// (empty), numbers to 'int'. Require an object (rejects array/null/scalar).
	if (type(edit) != 'object')
		return { ok: false, error: 'edit must decode to an object' };
	let ks = keys(edit);
	if (length(ks) === 0)
		return { ok: false, error: 'edit must be a non-empty object' };
	for (let i = 0; i < length(ks); i++) {
		let k = ks[i];
		if (ENGINE_OWNED_LISTS[k])
			return { ok: false, error: 'engine-owned list cannot be edited: ' + k };
		if (!ALLOWED_LIST_KEYS[k])
			return { ok: false, error: 'unknown list key: ' + k };
		let v = edit[k];
		if (type(v) != 'array')
			return { ok: false, error: 'value for ' + k + ' must be an array' };
		for (let j = 0; j < length(v); j++) {
			if (type(v[j]) != 'string')
				return { ok: false, error: 'element ' + j + ' of ' + k + ' must be a string' };
		}
	}
	return { ok: true, edit: edit };
};

export const lists_set = function(edit_str) {
	let v = validate_edit(edit_str);
	if (!v.ok) return v;          // { ok:false, error, ... }
	let edit = v.edit;
	let conflicts = find_conflicts(edit.domainInclude, edit.domainExclude);
	if (length(conflicts) > 0) {
		return { ok: false, error: 'conflict',
			message: 'domains in BOTH include and exclude',
			conflicts: conflicts };
	}
	// write each present list through apply.uc write_list_file (single write
	// path). write_list_file returns null on failure — surface it, do NOT claim
	// success.
	let written = [];
	let order = ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'];
	for (let i = 0; i < length(order); i++) {
		let k = order[i];
		if (edit[k] == null) continue;
		let r = write_list_file(LIST_PATHS[k], edit[k]);
		if (r == null)
			return { ok: false, error: 'write failed', list: k, written: written };
		push(written, k);
	}
	return { ok: true, written: written };
};

// Check whether a domain falls under the autohostlist or the user lists.
// The main user-confusion source: "I added a domain manually, but the auto-
// hostlist covers it, or vice versa."
export const lists_check_domain = function(domain) {
	let st = lists_get();
	return check_domain(domain, {
		userInclude: st.userLists.domainInclude,
		userExclude: st.userLists.domainExclude,
		autohostlist: st.engineLists.autohostlist
	});
};
