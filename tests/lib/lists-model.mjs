// Node reference for the LIST MODEL — the mapping between the manager's list
// keys (domainInclude, domainExclude, ipInclude, ipExclude, ipBlock,
// autohostlist) and the REAL Zapret2 list files on the router.
//
// SINGLE SOURCE OF TRUTH: the shipped declarative manifest
//   zapret2-manager/files/usr/libexec/zapret2-manager/lists-model.json
// lists.uc loads it at runtime (readfile + json, fail-closed); this module
// loads the same file for tests. There is NO second hand-maintained copy —
// the tests below parse the same bytes the backend ships.
//
// LEGACY FALLBACK (fail-closed): if the manifest is absent, the old inline
// LIST_PATHS block is extracted from lists.uc so the invariant tests still run
// against whatever the production mapping is. A missing/unparseable mapping
// returns null and FAILS the tests (never a vacuous pass).
//
// The manifest is router-derived (provenance field documents the evidence):
// the live nfqws2 argv carries
//   --hostlist=/opt/zapret2/ipset/zapret-hosts-user.txt
//   --hostlist-exclude=/opt/zapret2/ipset/zapret-hosts-user-exclude.txt
// and upstream scripts (ipset/def.sh, common/list.sh, uci-def-cfg.sh,
// ipset/create_ipset.sh) define the semantics of every other list file.
//
// Mirrors lists.uc (validate_edit / lists_get / lists_set enforcement).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'lists-model.json');
export const LISTS_UC_PATH = join(REPO_ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'lists.uc');

export const LIST_KEYS = ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock', 'autohostlist'];
export const USER_LIST_KEYS = ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'];

// loadProductionModel() → { schema, provenance, lists, source } | null.
// lists: { key: { path, type: 'domain'|'ip', editable: bool, engine?: bool, reason?: string|null } }
export function loadProductionModel() {
	if (existsSync(MANIFEST_PATH)) {
		let m;
		try { m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); }
		catch (e) { return null; }
		if (!m || typeof m !== 'object' || !m.lists || typeof m.lists !== 'object') return null;
		for (const k of LIST_KEYS) if (!m.lists[k]) return null;   // incomplete model — fail closed
		return { schema: m.schema, provenance: m.provenance || null, lists: m.lists, source: 'manifest' };
	}
	// Legacy fallback: the pre-manifest inline LIST_PATHS in lists.uc.
	if (!existsSync(LISTS_UC_PATH)) return null;
	const src = readFileSync(LISTS_UC_PATH, 'utf8');
	const block = src.match(/LIST_PATHS\s*=\s*\{([\s\S]*?)\};/);
	if (!block) return null;
	const lists = {};
	for (const mm of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) {
		const k = mm[1];
		lists[k] = {
			path: mm[2],
			type: k.startsWith('ip') ? 'ip' : 'domain',
			// legacy reality: the five user keys were all writable; autohostlist
			// sat in ENGINE_OWNED_LISTS and was rejected by validate_edit.
			editable: k !== 'autohostlist',
			engine: k === 'autohostlist',
			reason: null
		};
	}
	for (const k of LIST_KEYS) if (!lists[k]) return null;
	return { schema: 0, provenance: 'legacy inline LIST_PATHS extracted from lists.uc', lists, source: 'legacy-lists.uc' };
}

// Editable = user-writable keys only (engine-owned never editable).
export function editableKeys(model) {
	return LIST_KEYS.filter((k) => {
		const s = model.lists[k];
		return s && s.editable === true && s.engine !== true;
	});
}

// A1 + A2: two INDEPENDENT editable keys may never resolve to the same file —
// not by identical path string, and not by canonical realpath (symlink alias).
// realpath is injected so the symlink case is testable without a filesystem.
// Returns [] when the model is safe; a list of collision objects otherwise.
export function findPathCollisions(model, realpath = (p) => p) {
	const edit = editableKeys(model).filter((k) => model.lists[k].path != null);
	const collisions = [];
	for (let i = 0; i < edit.length; i++) {
		for (let j = i + 1; j < edit.length; j++) {
			const a = edit[i], b = edit[j];
			const pa = model.lists[a].path, pb = model.lists[b].path;
			if (pa === pb) collisions.push({ kind: 'identical-path', keys: [a, b], path: pa });
			else if (realpath(pa) === realpath(pb)) collisions.push({ kind: 'same-realpath', keys: [a, b], paths: [pa, pb] });
		}
	}
	return collisions;
}

// ---- mapping type validation (A5/A6) -----------------------------------------
// The semantic type of a KEY is fixed by the manager contract: domain keys
// hold hostnames, IP keys hold addresses. A write is refused when the model
// maps a key to the WRONG type (the shipped-defect class: domainExclude → an
// ipset file). The path classification below mirrors the upstream naming that
// def.sh/list.sh define: hostlist files ("hosts") are domain lists, ipset
// files ("ip") are IP lists — an independent anchor, not a self-declaration.

export function keyType(k) {
	if (k === 'domainInclude' || k === 'domainExclude' || k === 'autohostlist') return 'domain';
	if (k === 'ipInclude' || k === 'ipExclude' || k === 'ipBlock') return 'ip';
	return null;
}

// classifyListPath(path) → 'domain' | 'ip' | null, from the upstream filename
// convention (zapret-hosts-*.txt are hostlists; zapret-ip*.txt are ipsets).
export function classifyListPath(path) {
	if (path == null) return null;
	const base = path.slice(path.lastIndexOf('/') + 1);
	if (base.indexOf('hosts') >= 0 || base.indexOf('hostlist') >= 0) return 'domain';
	if (base.indexOf('ip') >= 0) return 'ip';
	return null;
}

// ---- flag path resolver (A7) -------------------------------------------------
// Zapret2 may repeat a list flag across profiles (--hostlist=..., once per
// profile). The resolver NEVER collapses several DISTINCT active paths into
// one silently: distinct values → { state:'ambiguous', paths }. Same value
// repeated (per-profile) resolves to that one path honestly.
export function resolveFlagPaths(argv, flag) {
	const found = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (typeof a !== 'string') continue;
		if (a === flag) {
			if (i + 1 < argv.length) found.push(argv[i + 1]);
		} else if (a.startsWith(flag + '=')) {
			found.push(a.slice(flag.length + 1));
		}
	}
	const uniq = [...new Set(found)];
	if (uniq.length === 0) return { state: 'absent', paths: [] };
	if (uniq.length > 1) return { state: 'ambiguous', paths: uniq };
	return { state: 'ok', path: uniq[0], paths: uniq };
}

// ---- model-driven edit validation (mirrors lists.uc validate_edit) ----------
// The wire rules (edit is a JSON string decoding to a non-empty object of
// arrays of strings) plus the MODEL rules: unknown key, engine-owned key,
// non-writable key (unproven/generated), path-less key, and per-entry type
// checks. Pure — no I/O. lists-wire.mjs calls this with the production model.
export function validateEdit(editStr, model) {
	if (model == null) return { ok: false, error: 'list model unavailable' };
	if (typeof editStr !== 'string')
		return { ok: false, error: 'edit must be a JSON string', got: typeof editStr };
	let edit;
	try { edit = JSON.parse(editStr); } catch (e) { return { ok: false, error: 'invalid JSON' }; }
	if (edit === null || typeof edit !== 'object' || Array.isArray(edit))
		return { ok: false, error: 'edit must decode to an object' };
	const keys = Object.keys(edit);
	if (keys.length === 0)
		return { ok: false, error: 'edit must be a non-empty object' };
	for (const k of keys) {
		const spec = model.lists[k];
		if (!spec) return { ok: false, error: `unknown list key: ${k}` };
		if (spec.engine === true)
			return { ok: false, error: `engine-owned list cannot be edited: ${k}` };
		if (spec.editable !== true)
			return { ok: false, error: 'list is not writable', list: k, reason: spec.reason != null ? spec.reason : null };
		if (spec.path == null)
			return { ok: false, error: 'list has no proven path', list: k, reason: spec.reason != null ? spec.reason : null };
		if (keyType(k) != null && spec.type !== keyType(k))
			return { ok: false, error: 'mapping type mismatch', list: k, expected: keyType(k), got: spec.type };
		const v = edit[k];
		if (!Array.isArray(v)) return { ok: false, error: `value for ${k} must be an array` };
		for (let j = 0; j < v.length; j++) {
			if (typeof v[j] !== 'string')
				return { ok: false, error: `element ${j} of ${k} must be a string` };
		}
	}
	return { ok: true, edit };
}
