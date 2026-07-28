// maintenance-logic.mjs — node reference for Slice 5 (events, versions,
// backup manifest/preview/allowlist, diagnostics redaction). Mirrored by the
// shipped ucode maintenance.uc / backup.uc extensions.
//
// Hard rules implemented here (pure, fs-injected by the caller):
//   - SHA-256 manifest per archive (per-file + whole-archive);
//   - restore writes ONLY allowlisted scope paths — an archive carrying any
//     other path is REFUSED (a crafted archive must never become an
//     arbitrary-file-write primitive);
//   - size limits (per file, per archive);
//   - preview = diff + version check + syntax check, NO writes;
//   - downgrade = warning, newer-version = refusal;
//   - diagnostics export redacts secrets by key name AND value pattern.

import { createHash } from 'node:crypto';

export function sha256hexNode(text) {
	return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// ---- manifest -----------------------------------------------------------------

export const BACKUP_MAX_FILE_BYTES = 1048576;      // 1 MB per file
export const BACKUP_MAX_ARCHIVE_BYTES = 4194304;   // 4 MB per archive
export const ARCHIVE_FORMAT = 2;

// make_manifest(files, sha256fn) — files: [{path, content, mode?, owner?}]
export function make_manifest(files, sha256fn = sha256hexNode) {
	const entries = files.map((f) => ({
		path: f.path,
		sha256: sha256fn(f.content ?? ''),
		size: String(f.content ?? '').length,
		mode: f.mode ?? null,
		owner: f.owner ?? null
	}));
	const payload = JSON.stringify(entries);
	return { format: ARCHIVE_FORMAT, files: entries, sha256: sha256fn(payload) };
}

// verify_manifest(archive, sha256fn) → { ok, reason }
export function verify_manifest(archive, sha256fn = sha256hexNode) {
	const m = archive && archive.manifest;
	if (!m || !Array.isArray(m.files)) return { ok: false, reason: 'no manifest' };
	for (const entry of m.files) {
		const f = (archive.files || []).find((x) => x.path === entry.path);
		if (!f) return { ok: false, reason: 'manifest entry without content: ' + entry.path };
		if (sha256fn(f.content ?? '') !== entry.sha256)
			return { ok: false, reason: 'sha256 mismatch for ' + entry.path + ' (archive corrupted)' };
	}
	const payload = JSON.stringify(m.files);
	if (sha256fn(payload) !== m.sha256) return { ok: false, reason: 'manifest sha256 mismatch (tampered)' };
	return { ok: true };
}

// check_archive_limits(files) → { ok, reason }
export function check_archive_limits(files) {
	let total = 0;
	for (const f of files) {
		const n = String(f.content ?? '').length;
		if (n > BACKUP_MAX_FILE_BYTES) return { ok: false, reason: 'file ' + f.path + ' exceeds ' + BACKUP_MAX_FILE_BYTES + ' bytes' };
		total += n;
	}
	if (total > BACKUP_MAX_ARCHIVE_BYTES) return { ok: false, reason: 'archive exceeds ' + BACKUP_MAX_ARCHIVE_BYTES + ' bytes' };
	return { ok: true };
}

// restore_path_check(scope, archiveFiles, allowedPaths) — every archive path
// must be in the scope's allowlist. Set equality is NOT required (an archive
// may carry a subset), but no path outside the allowlist may appear.
export function restore_path_check(scope, archiveFiles, allowedPaths) {
	for (const f of archiveFiles) {
		if (!allowedPaths.includes(f.path))
			return { ok: false, reason: 'archive path ' + f.path + ' is not in the ' + scope + ' allowlist — restore REFUSED (no arbitrary paths)' };
	}
	return { ok: true };
}

// version_gate(archiveVersion, currentVersion) → 'refuse' | 'downgrade' | 'ok'
export function version_gate(archiveVersion, currentVersion) {
	if (archiveVersion > currentVersion) return 'refuse';
	if (archiveVersion < currentVersion) return 'downgrade';
	return 'ok';
}

// restore_preview(currentFiles, archive, syntaxCheck, sha256fn) → the preview
// block (diff + manifest + syntax + version), NO writes anywhere.
export function restore_preview(currentFiles, archive, syntaxCheck, sha256fn = sha256hexNode) {
	const diffs = [];
	for (const af of archive.files || []) {
		const cur = currentFiles.find((f) => f.path === af.path);
		const curContent = cur ? cur.content ?? '' : null;
		diffs.push({
			path: af.path,
			presentNow: cur != null,
			changed: cur == null || curContent !== (af.content ?? ''),
			currentSha256: cur != null ? sha256fn(curContent) : null,
			archiveSha256: sha256fn(af.content ?? ''),
			currentSize: cur != null ? curContent.length : null,
			archiveSize: String(af.content ?? '').length
		});
	}
	const syntax = [];
	if (syntaxCheck) {
		for (const af of archive.files || []) {
			const why = syntaxCheck(af.path, af.content ?? '');
			if (why) syntax.push({ path: af.path, reason: why });
		}
	}
	return { diffs, syntax };
}

// ---- events -------------------------------------------------------------------

// events_parse(text, limit) — ndjson tail: one JSON object per line.
// Malformed lines are REPORTED (never silently dropped, never fatal).
export function events_parse(text, limit = 50) {
	const lines = String(text ?? '').split('\n').filter((l) => l.trim() !== '');
	const tail = lines.slice(-Math.max(1, Math.min(limit, 200)));
	const events = [];
	const malformed = [];
	for (const line of tail) {
		try { events.push(JSON.parse(line)); }
		catch (e) { malformed.push({ preview: line.slice(0, 120) }); }
	}
	return { events, malformed, total: lines.length };
}

// ---- engineConfig restore syntax check (mirrors backup.uc SCOPES check) -----

// engineConfigSyntaxCheck(content) → null (accept) | reason (refuse).
// The check guards against garbage/empty engine configs on restore. The
// pre-existing ucode version had an OFF-BY-ONE: substr(t,0,14) compared to
// the 13-char prefix 'NFQWS2_ENABLE' can NEVER match ('NFQWS2_ENABLE='
// ≠ 'NFQWS2_ENABLE'), so it refused EVERY valid config — found during the
// acceptance baseline restore (100% refusal). Accepts an ACTIVE
// NFQWS2_ENABLE or NFQWS2_OPT assignment (commented lines are not active).
export function engineConfigSyntaxCheck(content) {
	if (!content || !content.length) return 'empty config';
	for (const line of String(content).split('\n')) {
		const t = line.trim();
		if (t.startsWith('#')) continue;
		if (t.startsWith('NFQWS2_ENABLE') || t.startsWith('NFQWS2_OPT')) return null;
	}
	return 'no active NFQWS2_ENABLE/NFQWS2_OPT assignment';
}

// ---- diagnostics redaction -------------------------------------------------------

const SECRET_KEY_RE = /(token|secret|passw|api[_-]?key|private[_-]?key|session|cookie|authorization)/i;
const SECRET_VALUE_RES = [
	/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/,           // telegram-bot-token shape
	/\bBearer\s+\S{10,}\b/i,
	/\b[A-Fa-f0-9]{64}\b(?=.*(key|token|secret))/i
];

// redact(value, keyHint) → { value, redactedCount }. Deep walk; a string
// matching a secret VALUE pattern inside any field is replaced with
// "<redacted>"; any field whose KEY matches the secret pattern has its whole
// value replaced. Diagnostics must never leak a secret — even one a future
// feature (Telegram tokens etc.) introduces.
export function redact(value, keyHint = '') {
	let count = 0;
	const walk = (v, key) => {
		if (SECRET_KEY_RE.test(key)) {
			if (v != null && v !== '') { count++; return '<redacted>'; }
			return v;
		}
		if (typeof v === 'string') {
			for (const re of SECRET_VALUE_RES) {
				if (re.test(v)) { count++; return v.replace(re, '<redacted>'); }
			}
			return v;
		}
		if (Array.isArray(v)) return v.map((x) => walk(x, key));
		if (v && typeof v === 'object') {
			const out = {};
			for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
			return out;
		}
		return v;
	};
	const result = walk(value, keyHint);
	return { value: result, redactedCount: count };
}
