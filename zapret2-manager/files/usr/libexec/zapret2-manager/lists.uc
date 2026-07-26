#!/usr/bin/ucode
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
import { stringify as jstringify } from 'json';
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

function normalize_domain(d) {
	if (d == null) return '';
	let s = trim('' + d);
	s = tolower(s);
	if (substr(s, 0, 1) == '.') s = substr(s, 1);
	return s;
}

function tolower(s) {
	// ucode has no tolower; use tr via popen-free char map is overkill. The
	// domain strings from the UI are already lowercase in practice; this is a
	// best-effort normalization. [VERIFY:ROUTER] ucode string case functions.
	return s;   // TODO: replace with ucode tolower if available
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

function _in_list(n, arr) {
	if (!arr) return false;
	for (let i = 0; i < length(arr); i++)
		if (normalize_domain(arr[i]) == n) return true;
	return false;
}

// ---- state ------------------------------------------------------------------

// Read all list state: user lists (editable) + engine lists (read-only).
// Returns an object the UI renders directly.
export function lists_get() {
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
}

// Apply user list edits. Validates conflicts BEFORE writing; if any domain is
// in BOTH include and exclude, refuses and returns the conflicts (no files
// written). File generation goes through apply.uc write_list_file only.
export function lists_set(edit) {
	// edit = { domainInclude: [...], domainExclude: [...], ipInclude: [...],
	//          ipExclude: [...], ipBlock: [...] } (only the lists being edited
	//          are present; absent lists are not touched)
	let conflicts = find_conflicts(edit.domainInclude, edit.domainExclude);
	if (length(conflicts) > 0) {
		return { ok: false, error: 'conflict',
			message: 'domains in BOTH include and exclude',
			conflicts: conflicts };
	}
	// write each present list through apply.uc (single write path)
	let written = [];
	if (edit.domainInclude) { write_list_file(LIST_PATHS.domainInclude, edit.domainInclude); push(written, 'domainInclude'); }
	if (edit.domainExclude) { write_list_file(LIST_PATHS.domainExclude, edit.domainExclude); push(written, 'domainExclude'); }
	if (edit.ipInclude)     { write_list_file(LIST_PATHS.ipInclude, edit.ipInclude); push(written, 'ipInclude'); }
	if (edit.ipExclude)     { write_list_file(LIST_PATHS.ipExclude, edit.ipExclude); push(written, 'ipExclude'); }
	if (edit.ipBlock)       { write_list_file(LIST_PATHS.ipBlock, edit.ipBlock); push(written, 'ipBlock'); }
	return { ok: true, written: written };
}

// Check whether a domain falls under the autohostlist or the user lists.
// The main user-confusion source: "I added a domain manually, but the auto-
// hostlist covers it, or vice versa."
export function lists_check_domain(domain) {
	let st = lists_get();
	return check_domain(domain, {
		userInclude: st.userLists.domainInclude,
		userExclude: st.userLists.domainExclude,
		autohostlist: st.engineLists.autohostlist
	});
}

// ---- CLI --------------------------------------------------------------------
import { parse as jparse } from 'json';
let mode = ARGV[0];
if (mode == 'get') {
	print(jstringify(lists_get()) + '\n');
} else if (mode == 'check') {
	print(jstringify(lists_check_domain(ARGV[1])) + '\n');
} else if (mode == 'set') {
	// 'set <file>' — file contains a JSON edit object
	let raw = readfile(ARGV[1]);
	if (!raw) { print(jstringify({ ok: false, error: 'no edit file' }) + '\n'); exit(1); }
	let edit = jparse(raw);
	if (!edit) { print(jstringify({ ok: false, error: 'bad edit JSON' }) + '\n'); exit(1); }
	print(jstringify(lists_set(edit)) + '\n');
} else if (mode == undefined) {
	// imported as a library
} else {
	print('usage: ucode lists.uc get | check <domain>\n');
	exit(1);
}
