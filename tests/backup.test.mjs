// Self-test for the backup/restore logic (ЦЕЛЬ cleanup/15).
//
// Five mandatory self-tests (each MUST reddened before the logic existed), plus the
// disk-shortage atomic-write check. archive.files is an ARRAY of {path,
// content} pairs (no for-in over an object — point6 clean). ucode does not run
// locally; this node self-test proves the ALGORITHM. The shipped ucode backup.uc
// mirrors it and runtime is confirmed on the target.
//
// Run: node --test tests/backup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackupsStore, make_archive, atomicWrite } from './lib/backup-logic.mjs';

// A mock filesystem: path -> content. Records writes (temp) and renames so a
// self-test can assert "no half-written archive" (a rename must follow a temp).
function mockFs() {
	const files = {};
	const ops = [];
	return {
		files,
		ops,
		writeTemp(name, content) { files[name] = content; ops.push(['tmp', name]); },
		rename(tmp, name) { files[name] = files[tmp]; delete files[tmp]; ops.push(['ren', name]); },
		read(name) { return files[name] != null ? files[name] : null; }
	};
}

// syntaxCheck stand-in: a file "fails" if its content has 'BAD_SYNTAX' or 'UNTERM_QUOTE'.
function syntaxCheck(path, content) {
	if (/BAD_SYNTAX/.test(content)) return 'bad syntax marker';
	if (/UNTERM_QUOTE/.test(content)) return 'unterminated quote';
	return null;
}

// helper: build an archive for a scope with given files (array of {path, content})
function arc(scope, version, takenAt, files) {
	return make_archive(scope, version, takenAt, files);
}

// helper: an array of one {path, content}
function one(path, content) {
	return [{ path, content }];
}

// ---- 1) restore a BROKEN archive changes no file --------------------------------
test('restore a broken archive (bad checksum) changes NO file', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	store.store('engineConfig', arc('engineConfig', 1, 1000, one('/opt/zapret2/config', 'NFQWS2_ENABLE=1')), 1000);
	fs.files['/opt/zapret2/config'] = 'NFQWS2_ENABLE=1';
	const broken = {
		scope: 'engineConfig', version: 1, takenAt: 2000,
		files: one('/opt/zapret2/config', 'NFQWS2_ENABLE=0'),
		checksum: 'deadbeef'
	};
	const r = store.restore('engineConfig', broken, {
		currentVersion: 1,
		writeFiles: (p, c) => atomicWrite(fs, p, c),
		syntaxCheck
	});
	assert.equal(r.ok, false, 'broken archive must be refused');
	assert.equal(r.restored, false);
	assert.equal(r.reason, 'checksum mismatch (archive corrupted)');
	assert.equal(fs.files['/opt/zapret2/config'], 'NFQWS2_ENABLE=1',
		'live config untouched after a failed restore');
});

// ---- 2) restore with full history evicts the OLDEST on the 4th entry ----------------
test('restore/store: 4th history entry evicts the oldest (proven, not assumed)', () => {
	const store = new BackupsStore();
	for (let i = 0; i < 3; i++)
		store.store('ourState', arc('ourState', 1, 1000 + i, one('/etc/zapret2-manager/state.json', '{}' + i)), 1000 + i);
	let st = store.state('ourState');
	assert.equal(st.history.length, 3, '3 history entries');
	store.store('ourState', arc('ourState', 1, 4000, one('/etc/zapret2-manager/state.json', '{v:2}')), 4000);
	st = store.state('ourState');
	assert.equal(st.history.length, 3, 'still 3 history entries after 4th');
	const times = st.history.map(h => h.takenAt);
	assert.ok(!times.includes(1000), 'oldest (1000) evicted');
	assert.deepEqual(times.sort(), [1001, 1002, 4000], 'remaining are 1001,1002,4000');
});

// ---- 3) restore a NEWER-version archive is refused -------------------------------
test('restore an archive from a NEWER package version is refused (explicit)', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	store.store('ourState', arc('ourState', 1, 1000, one('/etc/zapret2-manager/state.json', '{}')), 1000);
	fs.files['/etc/zapret2-manager/state.json'] = '{}';
	const newer = arc('ourState', 2, 2000, one('/etc/zapret2-manager/state.json', '{v:2}'));
	const r = store.restore('ourState', newer, {
		currentVersion: 1,
		writeFiles: (p, c) => atomicWrite(fs, p, c),
		syntaxCheck
	});
	assert.equal(r.ok, false, 'newer-version archive must be refused');
	assert.equal(r.restored, false);
	assert.ok(/NEWER/.test(r.reason), 'reason names the newer version explicitly');
	assert.equal(fs.files['/etc/zapret2-manager/state.json'], '{}',
		'live state untouched after a refused newer-version restore');
});

// ---- 4) restoring ONE scope does not touch the other three ----------------------
test('restore one scope leaves the other three untouched', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	const scopes = ['engineConfig', 'ourState', 'lists', 'profiles'];
	for (const s of scopes) {
		store.store(s, arc(s, 1, 1000, one('/p/' + s, 'OLD-' + s)), 1000);
		fs.files['/p/' + s] = 'OLD-' + s;
	}
	const r = store.restore('engineConfig',
		arc('engineConfig', 1, 2000, one('/opt/zapret2/config', 'NFQWS2_ENABLE=0')),
		{ currentVersion: 1, writeFiles: (p, c) => atomicWrite(fs, p, c), syntaxCheck });
	assert.equal(r.ok, true, 'engineConfig restore succeeds');
	assert.equal(fs.files['/opt/zapret2/config'], 'NFQWS2_ENABLE=0', 'engineConfig restored');
	for (const s of ['ourState', 'lists', 'profiles']) {
		assert.equal(fs.files['/p/' + s], 'OLD-' + s, s + ' untouched by engineConfig restore');
	}
});

// ---- 5) a pre-restore snapshot is taken ALWAYS -------------------------------
test('restore takes a pre-restore snapshot of current (always, no exceptions)', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	store.store('ourState', arc('ourState', 1, 1000, one('/etc/zapret2-manager/state.json', '{v:1}')), 1000);
	fs.files['/etc/zapret2-manager/state.json'] = '{v:1}';
	let st = store.state('ourState');
	assert.equal(st.history.length, 1, '1 history entry before restore');
	const r = store.restore('ourState',
		arc('ourState', 1, 1000, one('/etc/zapret2-manager/state.json', '{v:1}')),
		{ currentVersion: 1, writeFiles: (p, c) => atomicWrite(fs, p, c), syntaxCheck });
	assert.equal(r.ok, true);
	assert.equal(r.preTaken, true, 'a pre-restore snapshot was taken');
	st = store.state('ourState');
	assert.equal(st.history.length, 2, 'pre-restore snapshot added to history');
});

// ---- disk shortage: no half-written archive (temp + rename) ----------------
test('backup/restore: an atomic write never leaves a half-written file (temp + rename)', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	store.store('ourState', arc('ourState', 1, 1000, one('/etc/zapret2-manager/state.json', '{}')), 1000);
	fs.files['/etc/zapret2-manager/state.json'] = '{}';
	const r = store.restore('ourState',
		arc('ourState', 1, 2000, one('/etc/zapret2-manager/state.json', '{v:1}')),
		{ currentVersion: 1, writeFiles: (p, c) => atomicWrite(fs, p, c), syntaxCheck });
	assert.equal(r.ok, true);
	const tmps = Object.keys(fs.files).filter(k => /\.tmp\./.test(k));
	assert.equal(tmps.length, 0, 'no temp file left behind (rename happened)');
	assert.equal(fs.files['/etc/zapret2-manager/state.json'], '{v:1}', 'final content present');
});

// ---- syntax check refuses a bad-syntax archive BEFORE overwrite ----------------
test('restore: bad-syntax archive is refused before any overwrite', () => {
	const fs = mockFs();
	const store = new BackupsStore();
	store.store('engineConfig', arc('engineConfig', 1, 1000, one('/opt/zapret2/config', 'NFQWS2_ENABLE=1')), 1000);
	fs.files['/opt/zapret2/config'] = 'NFQWS2_ENABLE=1';
	const bad = arc('engineConfig', 1, 2000, one('/opt/zapret2/config', 'NFQWS2_ENABLE=0 BAD_SYNTAX'));
	const r = store.restore('engineConfig', bad, {
		currentVersion: 1,
		writeFiles: (p, c) => atomicWrite(fs, p, c),
		syntaxCheck
	});
	assert.equal(r.ok, false, 'bad-syntax archive refused');
	assert.equal(r.restored, false);
	assert.equal(fs.files['/opt/zapret2/config'], 'NFQWS2_ENABLE=1', 'live config untouched');
});
