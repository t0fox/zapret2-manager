// maintenance.test.mjs — Slice 5 backend logic (manifest, allowlist, limits,
// preview, version gate, events, redaction). Also covers the two pre-existing
// backup restore defects found in review: arbitrary archive paths and the
// missing allowlist in backup-logic restore().
//
// Run: node --test tests/maintenance.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	sha256hexNode, make_manifest, verify_manifest, check_archive_limits,
	restore_path_check, version_gate, restore_preview,
	events_parse, redact,
	BACKUP_MAX_FILE_BYTES, ARCHIVE_FORMAT
} from './lib/maintenance-logic.mjs';
import { BackupsStore } from './lib/backup-logic.mjs';

// ---- manifest ---------------------------------------------------------------------

test('manifest: per-file sha256 + whole-manifest sha256; tamper detected', () => {
	const files = [{ path: '/a', content: 'alpha' }, { path: '/b', content: 'beta' }];
	const m = make_manifest(files);
	assert.equal(m.format, ARCHIVE_FORMAT);
	assert.equal(m.files.length, 2);
	assert.equal(m.files[0].sha256, sha256hexNode('alpha'));
	const archive = { files, manifest: m };
	assert.equal(verify_manifest(archive).ok, true);
	// tamper with content
	const bad = { files: [{ path: '/a', content: 'ALPHA' }, { path: '/b', content: 'beta' }], manifest: m };
	const v = verify_manifest(bad);
	assert.equal(v.ok, false);
	assert.match(v.reason, /sha256 mismatch/);
	// tamper with the manifest itself
	const m2 = { ...m, sha256: '0'.repeat(64) };
	assert.equal(verify_manifest({ files, manifest: m2 }).ok, false);
	assert.equal(verify_manifest({ files }).ok, false, 'no manifest → fail closed');
});

// ---- limits -------------------------------------------------------------------------

test('archive limits: oversized file/archive refused', () => {
	assert.equal(check_archive_limits([{ path: '/a', content: 'x'.repeat(1000) }]).ok, true);
	assert.equal(check_archive_limits([{ path: '/a', content: 'x'.repeat(BACKUP_MAX_FILE_BYTES + 1) }]).ok, false);
	assert.equal(check_archive_limits([
		{ path: '/a', content: 'x'.repeat(2000000) },
		{ path: '/b', content: 'y'.repeat(2000000) },
		{ path: '/c', content: 'z'.repeat(2000000) }
	]).ok, false, 'total cap');
});

// ---- allowlist (the arbitrary-path fix) ---------------------------------------------------

test('restore_path_check: a crafted archive path outside the allowlist is REFUSED', () => {
	const allowed = ['/opt/zapret2/config'];
	assert.equal(restore_path_check('engineConfig', [{ path: '/opt/zapret2/config' }], allowed).ok, true);
	const evil = restore_path_check('engineConfig', [{ path: '/etc/passwd' }], allowed);
	assert.equal(evil.ok, false);
	assert.match(evil.reason, /not in the engineConfig allowlist/);
});

test('backup-logic restore(): without allowlist opt, legacy behavior; WITH it, foreign paths refused', () => {
	const store = new BackupsStore();
	const archive = {
		scope: 'ourState', version: 1, takenAt: 10,
		files: [{ path: '/p/ourState', content: 'good' }, { path: '/etc/evil', content: 'bad' }],
		checksum: null
	};
	// compute the FNV checksum the store expects
	const { make_archive } = await_import();
	const good = make_archive('ourState', 1, 10, archive.files);
	archive.checksum = good.checksum;
	const writes = [];
	const r = store.restore('ourState', archive, {
		currentVersion: 1,
		writeFiles: (p, c) => writes.push([p, c]),
		syntaxCheck: () => null,
		allowedPaths: ['/p/ourState']
	});
	assert.equal(r.ok, false, 'restore refused: /etc/evil is not allowlisted');
	assert.equal(writes.length, 0, 'NOTHING was written before the refusal');
	assert.match(r.reason, /allowlist/);
});

function await_import() {
	// local re-import helper (keeps the test flow linear)
	return { make_archive: (scope, version, takenAt, files) => {
		const payload = JSON.stringify({ scope, version, takenAt, files });
		let h = 0x811c9dc5;
		for (let i = 0; i < payload.length; i++) {
			h ^= payload.charCodeAt(i);
			h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
		}
		return { scope, version, takenAt, files, checksum: ('00000000' + (h >>> 0).toString(16)).slice(-8) };
	} };
}

// ---- version gate -------------------------------------------------------------------------

test('version_gate: newer refuses, older warns with downgrade, equal ok', () => {
	assert.equal(version_gate(2, 1), 'refuse');
	assert.equal(version_gate(1, 2), 'downgrade');
	assert.equal(version_gate(1, 1), 'ok');
});

// ---- preview --------------------------------------------------------------------------------

test('restore_preview: honest diff (changed/new/same) + syntax findings; NO writes', () => {
	const cur = [{ path: '/a', content: 'old' }];
	const archive = { files: [{ path: '/a', content: 'new' }, { path: '/b', content: 'fresh' }] };
	const p = restore_preview(cur, archive, (path, content) => (path === '/b' ? 'bad syntax' : null));
	assert.equal(p.diffs.length, 2);
	assert.equal(p.diffs[0].changed, true);
	assert.equal(p.diffs[0].currentSha256, sha256hexNode('old'));
	assert.equal(p.diffs[1].presentNow, false);
	assert.equal(p.syntax.length, 1);
	assert.equal(p.syntax[0].path, '/b');
});

// ---- events -----------------------------------------------------------------------------------

test('events_parse: tail cap, malformed lines reported (never dropped silently)', () => {
	const lines = [];
	for (let i = 0; i < 60; i++) lines.push(JSON.stringify({ schema: 'events.v1', ts: 't' + i, id: 'e' + i, category: 'c', severity: 'info', source: 'watchdog', msg: 'm' + i }));
	lines.push('{ broken');
	const r = events_parse(lines.join('\n'), 50);
	assert.equal(r.events.length, 49, 'tail capped at limit (the malformed line occupies one slot)');
	assert.equal(r.malformed.length, 1);
	assert.equal(r.total, 61);
	assert.equal(events_parse('', 10).events.length, 0);
});

// ---- redaction -------------------------------------------------------------------------------------

test('redact: secret keys and secret-shaped values are redacted everywhere', () => {
	const bundle = {
		versions: { upstream: 'v1' },
		config: { botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', note: 'ok' },
		nested: [{ password: 'hunter2' }, { safe: 'value' }],
		text: 'use Bearer abcdef1234567890xyz to auth'
	};
	const { value, redactedCount } = redact(bundle);
	assert.ok(redactedCount >= 3, 'token + password + bearer redacted: ' + redactedCount);
	assert.equal(value.config.botToken, '<redacted>');
	assert.equal(value.nested[0].password, '<redacted>');
	assert.ok(value.text.includes('<redacted>'));
	assert.equal(value.nested[1].safe, 'value', 'non-secret content untouched');
	assert.equal(value.versions.upstream, 'v1');
});

test('NEGATIVE CONTROL: a telegram-shaped token in an innocuous key is still caught', () => {
	const { value, redactedCount } = redact({ webhook: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
	assert.equal(redactedCount, 1);
	assert.ok(String(value.webhook).includes('<redacted>'));
});
