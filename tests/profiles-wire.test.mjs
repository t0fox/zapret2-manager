// profiles-wire.test.mjs — tests for the profiles_list wire envelope builder
// (tests/lib/profiles-wire.mjs, the node reference mirrored by the shipped
// ucode profiles.uc).
//
// The envelope is what the `profiles_list` ubus method returns. Contract:
//   - REAL applied config parses: the postinstall fixture (3 profiles,
//     <HOSTLIST> stray placeholders) comes through with byte-identical
//     preserve round-trip;
//   - --new and --name are distinguished (native order semantics: last naming
//     event wins; both records preserved);
//   - unknown options and stray words are preserved, diagnosed, never erased;
//   - malformed input (unterminated quote) is diagnosed and still produces a
//     partial model — nothing is silently dropped;
//   - native validation vocabulary is EXACTLY {not_checked, partial,
//     rejected, unavailable} — the wire NEVER carries 'valid';
//   - provenance fields identify the applied source.
//
// Run: node --test tests/profiles-wire.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope, sanitizeNativeValidation, PROFILES_WIRE_SCHEMA } from './lib/profiles-wire.mjs';
import { read_var } from './lib/apply-writer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const POSTINSTALL_CONFIG = readFileSync(join(HERE, 'fixtures-postinstall', 'opt-zapret2-config.out'), 'utf8');
const STRATEGY_FIXTURE_DIR = join(HERE, 'fixtures', 'strategies');

const NATIVE_STATUSES = ['not_checked', 'partial', 'rejected', 'unavailable'];

function everyNativeValidation(obj, out = []) {
	// walk the whole envelope; collect every nativeValidation.status found
	if (obj && typeof obj === 'object') {
		if (Object.prototype.hasOwnProperty.call(obj, 'status') && obj.coverage && obj.entryPoint !== undefined) {
			out.push(obj.status);
		}
		for (const v of Object.values(obj)) everyNativeValidation(v, out);
	}
	return out;
}

// ---- 1. REAL applied fixture -------------------------------------------------

test('real applied config: parses into 3 profiles with byte-identical round trip', () => {
	const opt = read_var(POSTINSTALL_CONFIG, 'NFQWS2_OPT');
	assert.ok(opt !== null && opt.length > 0, 'NFQWS2_OPT must be readable from the postinstall fixture');
	const env = buildEnvelope(POSTINSTALL_CONFIG, { configPath: '/opt/zapret2/config' });

	assert.equal(env.ok, true);
	assert.equal(env.schema, PROFILES_WIRE_SCHEMA);
	assert.equal(env.parseStatus, 'success');
	assert.equal(env.profileCount, 3);
	assert.equal(env.profiles.length, 3);

	// protocol derivation from the real profile structure
	assert.equal(env.profiles[0].protocol, 'tcp');
	assert.equal(env.profiles[1].protocol, 'tcp');
	assert.equal(env.profiles[2].protocol, 'udp');

	// real content: l7 filters and lua-desync raw values (opaque transport)
	assert.deepEqual(env.profiles[0].l7Filters.map((e) => e.value), ['http']);
	assert.equal(env.profiles[1].l7Filters[0].value, 'tls');
	assert.equal(env.profiles[2].l7Filters[0].value, 'quic');
	assert.equal(env.profiles[0].luaDesync[0].raw, 'fake:blob=fake_default_http:tcp_md5');
	assert.equal(env.profiles[2].luaDesync[0].raw, 'fake:blob=fake_default_quic:repeats=6');

	// upstream init placeholders are STRAY WORDS — preserved, never erased
	const stray = env.profiles[0].unknownOptions.filter((e) => e.strayWord).map((e) => e.value);
	assert.ok(stray.includes('<HOSTLIST>'), '<HOSTLIST> placeholder must be preserved as a stray word');
	const stray2 = env.profiles[2].unknownOptions.filter((e) => e.strayWord).map((e) => e.value);
	assert.ok(stray2.includes('<HOSTLIST_NOAUTO>'));

	// byte-identical preserve round trip on the REAL value
	assert.equal(env.roundtrip.preserve, 'identical',
		'preserve round trip must be byte-identical on the real applied NFQWS2_OPT');

	// provenance
	assert.equal(env.provenance.source, 'applied');
	assert.equal(env.provenance.configPath, '/opt/zapret2/config');
	assert.equal(env.source.optPresent, true);
});

test('real applied config: native validation is not_checked EVERYWHERE and never valid', () => {
	const env = buildEnvelope(POSTINSTALL_CONFIG, { configPath: '/opt/zapret2/config' });
	const statuses = everyNativeValidation(env);
	assert.ok(statuses.length > 0, 'envelope must carry nativeValidation records');
	for (const s of statuses) {
		assert.ok(NATIVE_STATUSES.includes(s), `status '${s}' outside the native vocabulary`);
		assert.equal(s, 'not_checked', 'nothing ran natively — every record must be not_checked');
	}
	// blunt scan: the word "valid" as a status value must not appear anywhere
	const json = JSON.stringify(env);
	assert.ok(!/"status":"valid"/.test(json), 'the wire must never carry status "valid"');
});

// ---- 2. --new vs --name -------------------------------------------------------

test('--new and --name are distinguished; last naming event wins; both preserved', () => {
	const text = '--filter-tcp=80 --new=One --name=Two --filter-tcp=443';
	const env = buildEnvelope(text, { alreadyOptValue: true });
	assert.equal(env.ok, true);
	assert.equal(env.profileCount, 2);
	const p1 = env.profiles[1];
	assert.equal(p1.name, 'Two', 'native order semantics: the LAST naming event wins');
	assert.equal(p1.nameSource, 'name-option');
	assert.equal(p1.nameRecords.length, 2, 'both naming events are preserved');
	assert.equal(p1.nameRecords[0].via, 'new');
	assert.equal(p1.nameRecords[1].via, 'name-option');
	assert.ok(env.diagnostics.some((d) => d.code === 'MANAGER_CONFLICTING_PROFILE_NAMES'),
		'conflicting --new=A + --name=B must be diagnosed (both forms preserved)');
	assert.equal(env.roundtrip.preserve, 'identical');
});

test('a named --new=Name profile reports nameSource "new"', () => {
	const env = buildEnvelope('--filter-tcp=80 --new=Games --filter-udp=1-2', { alreadyOptValue: true });
	assert.equal(env.profiles[1].name, 'Games');
	assert.equal(env.profiles[1].nameSource, 'new');
	assert.equal(env.profiles[1].protocol, 'udp');
});

// ---- 3. unknown options / stray words -----------------------------------------

test('unknown options and stray words are preserved and diagnosed, never erased', () => {
	const text = '--filter-tcp=80 --bogus=x strayword --lua-desync=pass';
	const env = buildEnvelope(text, { alreadyOptValue: true });
	assert.equal(env.ok, true);
	const unk = env.profiles[0].unknownOptions;
	assert.ok(unk.some((e) => e.option === '--bogus' && e.value === 'x'), 'unknown --bogus=x preserved');
	assert.ok(unk.some((e) => e.strayWord === true && e.value === 'strayword'), 'stray word preserved');
	assert.ok(env.diagnostics.some((d) => d.code === 'MANAGER_UNKNOWN_OPTION'));
	assert.equal(env.roundtrip.preserve, 'identical', 'unknown content must round-trip byte-identically');
});

// ---- 4. malformed input --------------------------------------------------------

test('malformed input (unterminated quote): diagnosed, partial model, nothing dropped', () => {
	const text = '--filter-tcp=80 --lua-desync="fake:tcp_md5 --filter-udp=443';
	const env = buildEnvelope(text, { alreadyOptValue: true });
	assert.equal(env.ok, true, 'malformed input must not crash the builder');
	assert.equal(env.parseStatus, 'partial', 'error-severity diagnostics → partial');
	assert.ok(env.diagnostics.some((d) => d.code === 'MANAGER_UNTERMINATED_QUOTE' && d.severity === 'error'));
	// the token stream is preserved: everything after the quote opener is ONE
	// token's raw text, and the round trip still reproduces the input bytes
	assert.equal(env.roundtrip.preserve, 'identical');
});

test('empty and absent opt values are honest (no fabricated profiles)', () => {
	const empty = buildEnvelope('', { alreadyOptValue: true });
	assert.equal(empty.ok, true);
	assert.equal(empty.profileCount, 0);
	assert.deepEqual(empty.profiles, []);
	assert.equal(empty.parseStatus, 'success');

	const noOpt = buildEnvelope('NFQWS2_ENABLE=1\nMODE=custom\n', { configPath: '/opt/zapret2/config' });
	assert.equal(noOpt.ok, true);
	assert.equal(noOpt.source.optPresent, false);
	assert.equal(noOpt.parseStatus, 'unavailable', 'no NFQWS2_OPT → unavailable, not an invented empty profile');
	assert.equal(noOpt.profileCount, 0);

	const unreadable = buildEnvelope(null, { configPath: '/opt/zapret2/config' });
	assert.equal(unreadable.ok, false);
	assert.equal(unreadable.error.code, 'ETARGET');
});

// ---- 5. strategy fixture corpus -------------------------------------------------

test('every strategy fixture builds an envelope without throwing; good ones round-trip identically', () => {
	const files = readdirSync(STRATEGY_FIXTURE_DIR).filter((f) => f.endsWith('.txt')).sort();
	assert.ok(files.length >= 10, 'corpus must be present');
	for (const f of files) {
		const text = readFileSync(join(STRATEGY_FIXTURE_DIR, f), 'utf8').replace(/\n$/, '');
		const env = buildEnvelope(text, { alreadyOptValue: true });
		assert.equal(env.ok, true, `${f}: envelope must build`);
		assert.ok(['success', 'partial'].includes(env.parseStatus), `${f}: parseStatus honest`);
		if (f.startsWith('g')) {
			assert.equal(env.roundtrip.preserve, 'identical', `${f}: good fixture must round-trip byte-identically`);
		}
		const statuses = everyNativeValidation(env);
		for (const s of statuses) assert.ok(NATIVE_STATUSES.includes(s), `${f}: status '${s}' outside vocabulary`);
	}
});

// ---- 6. native vocabulary negative control ---------------------------------------

test('NEGATIVE CONTROL: a forged native status is clamped — the wire can never carry "valid"', () => {
	// buildEnvelope must clamp any non-vocabulary status present in a model it
	// is asked to serialize (defense against fabricated validity leaking to
	// the wire). A forged 'valid' record comes back inside the vocabulary.
	const forged = { status: 'valid', entryPoint: 'dry-run', coverage: {}, diagnostics: [], bundleId: 'x' };
	const clamped = sanitizeNativeValidation(forged);
	assert.notEqual(clamped.status, 'valid');
	assert.ok(NATIVE_STATUSES.includes(clamped.status));
	assert.equal(clamped.status, 'not_checked');

	// and the vocabulary sanitizer leaves honest shells untouched
	const honest = { status: 'not_checked', entryPoint: null, coverage: {}, diagnostics: [] };
	assert.equal(sanitizeNativeValidation(honest).status, 'not_checked');
});

// ---- 7. provenance ---------------------------------------------------------------

test('provenance identifies the applied source and the model contract', () => {
	const env = buildEnvelope(POSTINSTALL_CONFIG, { configPath: '/opt/zapret2/config' });
	assert.equal(env.provenance.source, 'applied');
	assert.equal(env.provenance.model, 'strategy-model.md v1');
	assert.ok(env.provenance.upstreamCommit, 'upstream pin must be recorded');
	assert.equal(env.provenance.reader, 'apply.uc read_var');
});
