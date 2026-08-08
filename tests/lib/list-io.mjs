// Node reference: list file I/O — the single-writer path used by lists.uc.
//
// Mirrors apply.uc read_list_file / write_list_file. ucode does not run locally,
// so this is the ALGORITHM SPEC; the shipped ucode mirrors it and its RUNTIME is
// confirmed on the target via smoke.sh (lists_get/lists_set round-trip).
//
// Single-writer rule: list files are written ONLY through write_list_file (in
// apply.uc, the same module as set_var). No second write path.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

// read_list_file(path) → string[] (trimmed, non-empty, order preserved).
// Missing file → []. No invented entries.
export function read_list_file(path) {
	let raw;
	try { raw = readFileSync(path, 'utf8'); } catch (e) { return []; }
	const lines = raw.split('\n');
	const out = [];
	for (const line of lines) {
		const t = line.trim();
		if (t.length) out.push(t);
	}
	return out;
}

// write_list_file(path, entries) → content string on success, null on failure.
// One entry per line, LF-separated, trailing LF. Atomic: temp in the same dir +
// rename. Parent dir is created if missing. Returns null on write/rename
// failure (mirrors the ucode, which has no throw — the caller surfaces the
// error). A concurrent writer never sees a partial file (same-FS rename is
// atomic); a crash leaves only the temp — the target is untouched. Path-
// agnostic: the caller (lists_set) enforces "no engine-owned lists".
export function write_list_file(path, entries) {
	let out = '';
	for (const e of entries) {
		const line = String(e).trim();
		if (!line.length) continue;
		out += line + '\n';
	}
	const parent = dirname(path);
	try { mkdirSync(parent, { recursive: true }); } catch (e) { /* exists ok */ }
	const tmp = `${path}.tmp.${Date.now()}`;
	try {
		writeFileSync(tmp, out);
	} catch (e) {
		return null;   // cannot even stage the temp — surface failure, no partial target
	}
	try {
		renameSync(tmp, path);
	} catch (e) {
		// leave no partial target; surface the failure as null
		try { unlinkSync(tmp); } catch {}
		return null;
	}
	return out;
}
