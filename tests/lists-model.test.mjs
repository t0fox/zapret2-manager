// Negative controls for the PRODUCTION list-path mapping (БЛОКЕР A).
//
// These tests load the SHIPPED production mapping — the declarative manifest
// lists-model.json that lists.uc consumes at runtime (legacy fallback: the
// inline LIST_PATHS of the pre-manifest lists.uc) — and enforce the hard
// rules that prevent list data loss:
//
//   A1  no two editable keys may map to ONE path (the shipped collision:
//       domainExclude == ipExclude == zapret-ipset-exclude-user.txt)
//   A2  ...nor to one canonical realpath through a symlink alias
//   A3  the engine-owned autohostlist must reject writes
//   A4  unproven / generated paths must not be writable
//   A5  a domain-key write to an IP-only mapping must be rejected
//   A6  an IP-key write to a domain-only mapping must be rejected
//   A7  multiple active paths for one flag must surface as ambiguity,
//       never collapse silently to the first path
//
// Plus the router-binding: the production domain paths must equal the paths
// in the REAL captured nfqws2 argv (tests/fixtures/nfqws2-cmdline-running.bin),
// and write validation is exercised through the production wire mirror
// (tests/lib/lists-wire.mjs — the Node mirror of lists.uc validate_edit).
//
// Run: node --test tests/lists-model.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	loadProductionModel, editableKeys, findPathCollisions,
	keyType, classifyListPath, resolveFlagPaths, validateEdit, LIST_KEYS, USER_LIST_KEYS,
	REPO_ROOT
} from './lib/lists-model.mjs';
import { validate_edit } from './lib/lists-wire.mjs';

const model = loadProductionModel();

test('A0: a production list model loads and covers all six keys', () => {
	assert.ok(model, 'no production list model found (neither lists-model.json nor LIST_PATHS in lists.uc)');
	for (const k of LIST_KEYS)
		assert.ok(model.lists[k], `model missing key ${k}`);
});

test('A1: no two editable keys share one path (production collision control)', () => {
	const collisions = findPathCollisions(model);
	assert.deepEqual(collisions, [],
		`editable path collisions in production model (${model.source}): ${JSON.stringify(collisions)}`);
});

test('A1b: the historical collision pair is specifically distinct', () => {
	const de = model.lists.domainExclude, ie = model.lists.ipExclude;
	if (de.path != null && ie.path != null)
		assert.notEqual(de.path, ie.path,
			'domainExclude and ipExclude must not point at the same file');
});

test('A2: symlink-aliased paths are detected as collisions (canonical realpath)', () => {
	// shipped model: no collisions even under canonicalization (files on the
	// router are regular files, no symlinks — evidence: ls -l -rw-r--r--).
	assert.deepEqual(findPathCollisions(model, (p) => p), []);
	// negative logic control: two editable keys whose paths resolve through a
	// symlink to ONE file MUST be reported.
	const fake = {
		lists: {
			domainInclude: { path: '/a/user.txt', type: 'domain', editable: true },
			domainExclude: { path: '/a/link.txt', type: 'domain', editable: true },
			autohostlist: { path: '/a/auto.txt', type: 'domain', editable: false, engine: true }
		}
	};
	const realpath = (p) => (p === '/a/link.txt' ? '/a/user.txt' : p);
	const collisions = findPathCollisions(fake, realpath);
	assert.equal(collisions.length, 1);
	assert.equal(collisions[0].kind, 'same-realpath');
});

test('A3: engine-owned autohostlist is not editable and rejects writes', () => {
	const spec = model.lists.autohostlist;
	assert.equal(spec.engine, true, 'autohostlist must be flagged engine-owned');
	assert.notEqual(spec.editable, true, 'autohostlist must not be editable');
	const r = validate_edit('{"autohostlist":["evil.example"]}');
	assert.equal(r.ok, false, 'writing the engine autohostlist must be rejected');
	assert.match(r.error, /engine-owned/);
});

test('A4: unproven or generated paths are not writable', () => {
	// Router evidence (2026-07-27, Cudy WBR3000UAX, live argv + upstream
	// scripts): only the two domain lists are proven user-maintained and
	// active-config-referenced. Every IP-semantic key is either generated
	// (zapret-ip-user.txt ← getuser(), zapret-ip-user-ipban.txt ← _get_ipban())
	// or has no engine consumer at all (zapret-ip-user-exclude.txt).
	assert.deepEqual(editableKeys(model).sort(), ['domainExclude', 'domainInclude'].sort(),
		'only the two argv-proven domain lists may be writable');
	for (const k of ['ipInclude', 'ipExclude', 'ipBlock']) {
		assert.notEqual(model.lists[k].editable, true, `${k} must not be writable`);
		assert.ok(model.lists[k].reason, `${k} must carry an explicit reason`);
		const r = validate_edit(JSON.stringify({ [k]: ['192.0.2.1'] }));
		assert.equal(r.ok, false, `write to ${k} must be rejected`);
		assert.match(r.error, /not writable|no proven path|engine-owned/);
	}
});

test('A5: a domain-key write to an IP-only mapping is rejected', () => {
	// production: the editable domain keys are typed 'domain' AND their paths
	// classify as hostlist (domain) files by the upstream naming convention.
	for (const k of ['domainInclude', 'domainExclude']) {
		assert.equal(model.lists[k].type, 'domain', `${k} must be typed domain`);
		assert.equal(classifyListPath(model.lists[k].path), 'domain',
			`${k} path must classify as a hostlist (domain) file, got ${model.lists[k].path}`);
	}
	// a domain key DECLARED with an ip type refuses writes (mapping mismatch)
	const bad1 = { lists: { domainInclude: { path: '/opt/zapret2/ipset/zapret-ip-user.txt', type: 'ip', editable: true } } };
	const r1 = validateEdit('{"domainInclude":["example.com"]}', bad1);
	assert.equal(r1.ok, false);
	assert.equal(r1.error, 'mapping type mismatch');
	// and the upstream path classification independently flags an ipset path
	// for a domain key — the historical defect shape (domainExclude →
	// zapret-ipset-exclude-user.txt) is caught by it:
	assert.equal(classifyListPath('/opt/zapret2/ipset/zapret-ipset-exclude-user.txt'), 'ip');
});

test('A6: an IP-key write to a domain-only mapping is rejected', () => {
	// production: every ip-semantic key is typed 'ip' (and none is writable).
	for (const k of ['ipInclude', 'ipExclude', 'ipBlock']) {
		assert.equal(model.lists[k].type, 'ip', `${k} must be typed ip`);
		if (model.lists[k].path != null)
			assert.equal(classifyListPath(model.lists[k].path), 'ip',
				`${k} path must classify as an ipset (IP) file, got ${model.lists[k].path}`);
	}
	// an ip key DECLARED with a domain type refuses writes (mapping mismatch)
	const bad2 = { lists: { ipInclude: { path: '/opt/zapret2/ipset/zapret-hosts-user.txt', type: 'domain', editable: true } } };
	const r2 = validateEdit('{"ipInclude":["192.0.2.1"]}', bad2);
	assert.equal(r2.ok, false);
	assert.equal(r2.error, 'mapping type mismatch');
	// production: ip keys reject writes outright (not writable — see A4)
	assert.equal(validate_edit('{"ipInclude":["192.0.2.1"]}').ok, false);
});

test('A7: repeated flag with DISTINCT paths is ambiguity, never first-wins', () => {
	const argv = [
		'nfqws2',
		'--hostlist=/opt/zapret2/ipset/zapret-hosts-user.txt',
		'--new',
		'--hostlist=/opt/zapret2/ipset/other-hosts.txt'
	];
	const r = resolveFlagPaths(argv, '--hostlist');
	assert.equal(r.state, 'ambiguous');
	assert.deepEqual(r.paths, ['/opt/zapret2/ipset/zapret-hosts-user.txt', '/opt/zapret2/ipset/other-hosts.txt']);
	// same path repeated per profile resolves to that one path honestly
	const argv2 = ['nfqws2', '--hostlist=/a/list.txt', '--new', '--hostlist=/a/list.txt'];
	const r2 = resolveFlagPaths(argv2, '--hostlist');
	assert.equal(r2.state, 'ok');
	assert.equal(r2.path, '/a/list.txt');
	// space-separated flag form also parsed
	const r3 = resolveFlagPaths(['nfqws2', '--hostlist', '/a/l.txt'], '--hostlist');
	assert.equal(r3.state, 'ok');
	assert.equal(r3.path, '/a/l.txt');
	assert.equal(resolveFlagPaths(['nfqws2'], '--hostlist').state, 'absent');
});

test('A7b: the REAL captured argv resolves to the production domain paths', () => {
	// tests/fixtures/nfqws2-cmdline-running.bin is a NUL-separated capture of
	// /proc/<pid>/cmdline from the live router (running nfqws2, QNUM 300).
	const raw = readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'nfqws2-cmdline-running.bin'));
	const argv = raw.toString('utf8').split('\0').filter((s) => s.length > 0);
	const inc = resolveFlagPaths(argv, '--hostlist');
	const exc = resolveFlagPaths(argv, '--hostlist-exclude');
	assert.equal(inc.state, 'ok', `live --hostlist must resolve to one path, got ${inc.state}`);
	assert.equal(exc.state, 'ok', `live --hostlist-exclude must resolve to one path, got ${exc.state}`);
	assert.equal(model.lists.domainInclude.path, inc.path,
		'production domainInclude path must equal the live argv --hostlist path');
	assert.equal(model.lists.domainExclude.path, exc.path,
		'production domainExclude path must equal the live argv --hostlist-exclude path');
});

test('A8: autohostlist path matches the upstream engine convention', () => {
	// common/list.sh: HOSTLIST_AUTO="$HOSTLIST_BASE/zapret-hosts-auto.txt" —
	// the file nfqws2 itself maintains in autohostlist mode.
	assert.equal(model.lists.autohostlist.path, '/opt/zapret2/ipset/zapret-hosts-auto.txt');
	assert.equal(model.lists.autohostlist.type, 'domain');
});

test('model provenance is documented (router-derived, not guessed)', () => {
	assert.ok(model.provenance && model.provenance.length > 40,
		'manifest must carry a provenance description of the router evidence');
});
