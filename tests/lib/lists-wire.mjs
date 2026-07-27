// Node reference: the lists_set wire format (Part 3).
//
// The frontend sends `edit` as a JSON STRING. validate_edit parses it ONCE
// (json(edit)), requires an object with ALLOWED keys whose values are arrays of
// strings, and rejects engine-owned lists (autohostlist). lists_set runs
// validate_edit, then conflict-check, then writes via write_list_file (single
// writer). Mirrors lists.uc validate_edit / lists_set.

import { write_list_file } from './list-io.mjs';

const ALLOWED_LIST_KEYS = new Set(['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock']);
const ENGINE_OWNED_LISTS = new Set(['autohostlist']);

// validate_edit(editStr) → { ok:true, edit } | { ok:false, error, ... }.
export function validate_edit(editStr) {
	if (typeof editStr !== 'string')
		return { ok: false, error: 'edit must be a JSON string', got: typeof editStr };
	let edit;
	try { edit = JSON.parse(editStr); } catch (e) { return { ok: false, error: 'invalid JSON' }; }
	if (edit === null || typeof edit !== 'object' || Array.isArray(edit))
		return { ok: false, error: 'edit must decode to a non-empty object' };
	const keys = Object.keys(edit);
	if (keys.length === 0) return { ok: false, error: 'edit must decode to a non-empty object' };
	for (const k of keys) {
		if (ENGINE_OWNED_LISTS.has(k)) return { ok: false, error: `engine-owned list cannot be edited: ${k}` };
		if (!ALLOWED_LIST_KEYS.has(k)) return { ok: false, error: `unknown list key: ${k}` };
		const v = edit[k];
		if (!Array.isArray(v)) return { ok: false, error: `value for ${k} must be an array` };
		for (let j = 0; j < v.length; j++) {
			if (typeof v[j] !== 'string')
				return { ok: false, error: `element ${j} of ${k} must be a string` };
		}
	}
	return { ok: true, edit };
}

function normalize_domain(d) {
	if (d == null) return '';
	let s = String(d).trim().toLowerCase();
	if (s.startsWith('.')) s = s.slice(1);
	return s;
}
function find_conflicts(include, exclude) {
	if (!include || !exclude) return [];
	const ex = new Set(exclude.map(normalize_domain).filter(Boolean));
	const conflicts = [];
	const seen = new Set();
	for (const d of include) {
		const n = normalize_domain(d);
		if (!n || seen.has(n)) continue;
		if (ex.has(n)) { conflicts.push(n); seen.add(n); }
	}
	return conflicts;
}

// lists_set(editStr, paths) → { ok:true, written } | { ok:false, error, ... }.
// paths: map of key→file path (only the present keys are written). Pure
// validation + conflict check; writes via write_list_file (single writer).
export function lists_set(editStr, paths) {
	const v = validate_edit(editStr);
	if (!v.ok) return v;
	const edit = v.edit;
	const conflicts = find_conflicts(edit.domainInclude, edit.domainExclude);
	if (conflicts.length > 0)
		return { ok: false, error: 'conflict', message: 'domains in BOTH include and exclude', conflicts };
	const order = ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'];
	const written = [];
	for (const k of order) {
		if (edit[k] == null) continue;
		const r = write_list_file(paths[k], edit[k]);
		if (r === null) return { ok: false, error: 'write failed', list: k, written };
		written.push(k);
	}
	return { ok: true, written };
}
