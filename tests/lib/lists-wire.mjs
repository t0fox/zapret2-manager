// Node reference: the lists_set wire format (Part 3).
//
// The frontend sends `edit` as a JSON STRING. validate_edit parses it ONCE
// (json(edit)), requires an object whose keys exist in the production LIST
// MODEL (lists-model.json via tests/lib/lists-model.mjs): unknown keys,
// engine-owned keys, non-writable keys (unproven/generated) and entry-type
// mismatches are refused BEFORE any write. lists_set runs validate_edit,
// then conflict-check, then writes via write_list_file (single writer) to
// the model paths. Mirrors lists.uc validate_edit / lists_set.

import { write_list_file } from './list-io.mjs';
import { loadProductionModel, validateEdit, LIST_KEYS } from './lists-model.mjs';

// The production model, loaded once from the SHIPPED manifest (same bytes the
// backend ships). Tests may inject a different model/paths via parameters.
const PRODUCTION_MODEL = loadProductionModel();

// validate_edit(editStr, model?) → { ok:true, edit } | { ok:false, error, ... }.
export function validate_edit(editStr, model = PRODUCTION_MODEL) {
	return validateEdit(editStr, model);
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

// lists_set(editStr, paths?, model?) → { ok:true, written } | { ok:false, ... }.
// paths: optional key→file override (tests write to temp dirs); the default
// target is the model path — validate_edit has already proven the key
// writable with a non-null path, so only editable keys are ever written.
export function lists_set(editStr, paths, model = PRODUCTION_MODEL) {
	const v = validate_edit(editStr, model);
	if (!v.ok) return v;
	const edit = v.edit;
	const conflicts = find_conflicts(edit.domainInclude, edit.domainExclude);
	if (conflicts.length > 0)
		return { ok: false, error: 'conflict', message: 'domains in BOTH include and exclude', conflicts };
	const written = [];
	for (const k of LIST_KEYS) {
		if (edit[k] == null) continue;
		const target = (paths && paths[k] != null) ? paths[k] : model.lists[k].path;
		const r = write_list_file(target, edit[k]);
		if (r === null) return { ok: false, error: 'write failed', list: k, written };
		written.push(k);
	}
	return { ok: true, written };
}
