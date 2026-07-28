// profiles-draft.test.mjs — draft profile CRUD (tests/lib/profiles-draft.mjs,
// the node reference mirrored by the shipped ucode profiles-draft.uc).
//
// Contract (SLICE 2):
//   - drafts live ONLY in /etc/zapret2-manager/state.json — never in the
//     upstream config (no applied-config write on this path, ever);
//   - schema-versioned state; a malformed state is NEVER overwritten
//     (mutating ops refuse with ESTATE; the raw content is preserved);
//   - stable profile IDs from a persisted sequence; clone gets a NEW id;
//   - optimistic concurrency: update requires the current revision —
//     a stale revision is ECONFLICT;
//   - opaque Lua is preserved byte-verbatim (no interpretation);
//   - injection is inert: name/opt content is DATA, never shell;
//   - native validation maps dry-run rc honestly (partial/rejected), and
//     argv is built as an ARRAY — content never interpolated into a shell
//     string without POSIX single-quote escaping.
//
// Run: node --test tests/profiles-draft.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DRAFT_SCHEMA, parseState, serializeState, emptyState,
	createProfile, updateProfile, cloneProfile, deleteProfile,
	importApplied, validateDraft, nativeDryRunResult, nativeUnavailable,
	shellEscape, buildDryRunArgv, draftListEntry
} from './lib/profiles-draft.mjs';
import { parse } from './strategy/lib/parse.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POSTINSTALL_CONFIG = readFileSync(join(HERE, 'fixtures-postinstall', 'opt-zapret2-config.out'), 'utf8');

const NOW = 1785000000;
const OPT_A = '--filter-tcp=80 --filter-l7=http <HOSTLIST> --lua-desync=fake:blob=fake_default_http:tcp_md5';
const OPT_B = '--filter-udp=443 --filter-l7=quic --lua-desync=fake:blob=fake_default_quic:repeats=6';

function appliedModel() {
	// the applied fixture's NFQWS2_OPT parsed by the lossless parser
	const { read_var } = require_apply_writer();
	const opt = read_var(POSTINSTALL_CONFIG, 'NFQWS2_OPT');
	return { model: parse(opt), optText: opt };
}
function require_apply_writer() {
	// static import cycle avoidance for the test helper (ESM has no require;
	// import at top is fine — kept in one place for readability)
	return { read_var: (text, name) => {
		const m = text.match(new RegExp('^' + name + '="([\\s\\S]*)"$', 'm'));
		return m ? m[1] : null;
	} };
}

// ---- state parsing --------------------------------------------------------------

test('empty/missing state parses as an empty schema-versioned state', () => {
	assert.deepEqual(parseState(null), { ok: true, state: emptyState() });
	assert.deepEqual(parseState(''), { ok: true, state: emptyState() });
	const shipped = parseState('{}');   // the shipped skeleton state.json
	assert.equal(shipped.ok, true);
	assert.equal(shipped.state.schema, DRAFT_SCHEMA);
	assert.deepEqual(shipped.state.profiles, []);
});

test('malformed state is reported and NEVER overwritten', () => {
	const r = parseState('{ not json !!!');
	assert.equal(r.ok, false);
	assert.equal(r.malformed, true);
	// a mutating op on a malformed state refuses with ESTATE and no new state
	const c = createProfile(r.state ?? null, { name: 'x', opt: OPT_A }, NOW, r);
	assert.equal(c.ok, false);
	assert.equal(c.code, 'ESTATE');
	assert.equal(c.state, null, 'no replacement state is produced for malformed input');
});

// ---- CRUD ------------------------------------------------------------------------

test('create: stable id, revision 1, opt preserved verbatim (opaque Lua)', () => {
	const st = emptyState();
	const lua = '--lua-desync=circular:fails=2:time=30:func=multisplit:pos=1\\,midsld';
	const r = createProfile(st, { name: 'Web', opt: OPT_A + ' ' + lua }, NOW);
	assert.equal(r.ok, true);
	assert.equal(r.profile.id, 'p000001');
	assert.equal(r.profile.revision, 1);
	assert.equal(r.profile.source, 'created');
	assert.equal(r.profile.opt, OPT_A + ' ' + lua, 'opt must be stored byte-verbatim');
	assert.equal(r.state.nextIdSeq, 2);
	const r2 = createProfile(r.state, { name: 'Games', opt: OPT_B }, NOW + 1);
	assert.equal(r2.profile.id, 'p000002', 'ids are stable and sequential');
	assert.equal(r2.state.profiles.length, 2);
});

test('create: rejects non-string name/opt and over-long input (EINPUT)', () => {
	const st = emptyState();
	assert.equal(createProfile(st, { name: 5, opt: OPT_A }, NOW).code, 'EINPUT');
	assert.equal(createProfile(st, { name: 'x', opt: null }, NOW).code, 'EINPUT');
	assert.equal(createProfile(st, { name: 'x', opt: 'a'.repeat(70000) }, NOW).code, 'EINPUT');
});

test('update: stale revision is ECONFLICT; current revision applies and bumps', () => {
	let st = createProfile(emptyState(), { name: 'Web', opt: OPT_A }, NOW).state;
	const ok = updateProfile(st, 'p000001', 1, { name: 'Web2' }, NOW + 1);
	assert.equal(ok.ok, true);
	assert.equal(ok.profile.revision, 2);
	assert.equal(ok.profile.name, 'Web2');
	assert.equal(ok.profile.opt, OPT_A, 'untouched fields stay');

	const stale = updateProfile(ok.state, 'p000001', 1, { name: 'Hijack' }, NOW + 2);
	assert.equal(stale.ok, false);
	assert.equal(stale.code, 'ECONFLICT', 'optimistic concurrency: stale revision refused');

	const missing = updateProfile(ok.state, 'p999999', 1, { name: 'x' }, NOW + 2);
	assert.equal(missing.code, 'ESTATE', 'unknown id → ESTATE');
});

test('clone: NEW id, same opt, revision reset, name marked as a copy', () => {
	let st = createProfile(emptyState(), { name: 'Web', opt: OPT_A }, NOW).state;
	st = createProfile(st, { name: 'Games', opt: OPT_B }, NOW + 1).state;
	const r = cloneProfile(st, 'p000001', NOW + 2);
	assert.equal(r.ok, true);
	assert.equal(r.profile.id, 'p000003', 'clone allocates a fresh stable id');
	assert.equal(r.profile.opt, OPT_A);
	assert.equal(r.profile.revision, 1);
	assert.equal(r.profile.source, 'cloned');
	assert.match(r.profile.name, /Web/);
	assert.notEqual(r.profile.name, 'Web', 'clone name must differ (copy marker)');
	assert.equal(cloneProfile(st, 'p999999', NOW).code, 'ESTATE');
});

test('delete: removes only the draft; applied/runtime are untouched (state-only op)', () => {
	let st = createProfile(emptyState(), { name: 'Web', opt: OPT_A }, NOW).state;
	st = createProfile(st, { name: 'Games', opt: OPT_B }, NOW + 1).state;
	const r = deleteProfile(st, 'p000001', NOW + 2);
	assert.equal(r.ok, true);
	assert.equal(r.state.profiles.length, 1);
	assert.equal(r.state.profiles[0].name, 'Games');
	assert.equal(deleteProfile(st, 'p999999', NOW).code, 'ESTATE');
});

// ---- import applied -----------------------------------------------------------------

test('import_applied: every applied profile becomes a draft with its raw fragment preserved', () => {
	const { model, optText } = appliedModel();
	assert.equal(model.profiles.length, 3, 'fixture has 3 applied profiles');
	const r = importApplied(emptyState(), model, optText, NOW);
	assert.equal(r.ok, true);
	assert.equal(r.state.profiles.length, 3);
	assert.equal(r.state.profiles[0].source, 'imported');
	// fragment fidelity: each imported opt re-parses to ONE profile with the
	// same protocol as the applied source profile
	for (let i = 0; i < 3; i++) {
		const frag = r.state.profiles[i].opt;
		assert.ok(frag.length > 0, `fragment ${i} must not be empty`);
		const m = parse(frag);
		assert.equal(m.profiles.length, 1, `fragment ${i} must be exactly one profile`);
		assert.equal(m.profiles[0].protocol, model.profiles[i].protocol, `fragment ${i} protocol preserved`);
	}
	// placeholders survive the round trip
	assert.ok(r.state.profiles[0].opt.includes('<HOSTLIST>'));
	assert.ok(r.state.profiles[2].opt.includes('<HOSTLIST_NOAUTO>'));
});

// ---- validation -----------------------------------------------------------------------

test('validateDraft: manager structural diagnostics without native execution', () => {
	const good = validateDraft(OPT_A);
	assert.equal(good.parseStatus, 'success');
	const bad = validateDraft('--filter-tcp=80-90-100 --lua-desync="unterminated');
	assert.equal(bad.parseStatus, 'partial');
	assert.ok(bad.diagnostics.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT' || d.code === 'MANAGER_UNTERMINATED_QUOTE'));
});

test('nativeDryRunResult: rc=0 → partial with ONLY cliSyntax passed; rc!=0 → rejected', () => {
	const ok = nativeDryRunResult(0, '');
	assert.equal(ok.status, 'partial');
	assert.equal(ok.entryPoint, 'dry-run');
	assert.equal(ok.coverage.cliSyntax, 'passed');
	assert.equal(ok.coverage.luaLoad, 'not_checked', 'dry-run never loads Lua');
	assert.equal(ok.coverage.functionExistence, 'not_checked');
	assert.equal(ok.coverage.runtimeArguments, 'not_checked');

	const bad = nativeDryRunResult(1, 'unknown option --bogus');
	assert.equal(bad.status, 'rejected');
	assert.equal(bad.coverage.cliSyntax, 'failed');
	assert.ok(bad.diagnostics.length > 0);

	const un = nativeUnavailable('nfqws2 binary not found');
	assert.equal(un.status, 'unavailable');
	assert.ok(!Object.values(un.coverage).includes('passed'), 'unavailable never reports passed coverage');
});

// ---- argv / injection safety -------------------------------------------------------------

test('buildDryRunArgv: tokens become argv ELEMENTS (no shell string); throwaway qnum present', () => {
	const argv = buildDryRunArgv(['--filter-tcp=80', '--lua-desync=fake:pattern=a;b`rm -rf /`']);
	assert.deepEqual(argv[0], '--dry-run');
	assert.equal(argv[1], '--qnum=30999', 'the real binary REQUIRES --qnum even for --dry-run (verified on target); a throwaway number is used — dry-run never binds');
	assert.equal(argv[3], '--lua-desync=fake:pattern=a;b`rm -rf /`', 'content is one argv element, verbatim');
});

test('shellEscape: POSIX single-quote escaping is injection-proof', () => {
	assert.equal(shellEscape('abc'), "'abc'");
	assert.equal(shellEscape("a'b"), "'a'\\''b'");
	const evil = "'; rm -rf /; echo '";
	const esc = shellEscape(evil);
	// every ' becomes '\'' (end-quote, escaped quote, reopen); the whole is
	// wrapped in single quotes → the shell sees ONE literal argv element
	assert.equal(esc, "''\\''; rm -rf /; echo '\\'''");
	// the escaped form contains no unquoted single quote: removing all
	// quoted spans must leave nothing but the escape sequence pattern
	assert.ok(esc.startsWith("'") && esc.endsWith("'"));
});

// ---- serialization / draft list entries -----------------------------------------------------

test('serializeState/parseState round trip; draftListEntry carries parse diagnostics', () => {
	let st = createProfile(emptyState(), { name: 'Web', opt: OPT_A }, NOW).state;
	const text = serializeState(st);
	const back = parseState(text);
	assert.equal(back.ok, true);
	assert.deepEqual(back.state, st);
	const entry = draftListEntry(back.state.profiles[0]);
	assert.equal(entry.id, 'p000001');
	assert.equal(entry.parseStatus, 'success');
	assert.ok(Array.isArray(entry.diagnostics));
});

test('duplicate draft names are allowed but flagged in the list entry', () => {
	let st = createProfile(emptyState(), { name: 'Web', opt: OPT_A }, NOW).state;
	st = createProfile(st, { name: 'Web', opt: OPT_B }, NOW + 1).state;
	const flagged = st.profiles.map((p) => draftListEntry(p, st.profiles));
	assert.ok(flagged.every((e) => e.duplicateName === true), 'duplicates flagged, not rejected');
});

test('service.uc keys (passthrough/active_profile) survive a draft CRUD round trip', () => {
	// service.uc passthrough() writes free-form keys into the SAME state.json;
	// status.uc reads draft.passthrough.enabled for the serviceState. A draft
	// save must NEVER drop them (Slice-2 regression class).
	const withSvc = {
		schema: 1, updatedAt: NOW, nextIdSeq: 1, profiles: [],
		passthrough: { enabled: true }, active_profile: { name: 'passthrough', strategies: [] }
	};
	const parsed = parseState(JSON.stringify(withSvc));
	assert.equal(parsed.ok, true);
	const saved = createProfile(parsed.state, { name: 'Web', opt: OPT_A }, NOW + 1);
	assert.equal(saved.ok, true);
	const reread = parseState(serializeState(saved.state));
	assert.equal(reread.state.passthrough?.enabled, true, 'passthrough key must survive parse+save');
	assert.equal(reread.state.active_profile?.name, 'passthrough', 'active_profile key must survive');
});

test('the dns draft key survives a draft CRUD round trip (S6 co-owned key)', () => {
	const withDns = {
		schema: 1, updatedAt: NOW, nextIdSeq: 1, profiles: [],
		dns: { entries: [{ domain: 'a.com', ip: '1.2.3.4', enabled: true }], revision: 1 },
		catalog: { enabled: ['youtube'], ownedDomains: { 'youtube.com': ['youtube'] }, revision: 2 }
	};
	const parsed = parseState(JSON.stringify(withDns));
	assert.equal(parsed.ok, true);
	const saved = createProfile(parsed.state, { name: 'Web', opt: OPT_A }, NOW + 1);
	const reread = parseState(serializeState(saved.state));
	assert.equal(reread.state.dns?.entries?.[0]?.domain, 'a.com', 'dns key must survive parse+save');
	assert.equal(reread.state.catalog?.enabled?.[0], 'youtube', 'catalog ledger key must survive parse+save');
});
