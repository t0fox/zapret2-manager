import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/strategy-source-z2k');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = (name) => fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8');

function invoke(functionName, args = [], extraEnv = {}) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  return invokeSource(source, extraEnv);
}

function invokeSource(source, extraEnv = {}) {
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function composeFixture(extraIni = '') {
  const files = {
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini') + extraIni,
  };
  const filesJson = JSON.stringify(files);
  const commit = '1'.repeat(40);
  return invokeSource(`import * as mod from ${JSON.stringify(MODULE)}; let parsed = mod.strategy_source_z2k_parse_files(${filesJson}, { sourceCommit: ${JSON.stringify(commit)} }); print(sprintf('%J', mod.strategy_source_z2k_compose_all_in_one(parsed.entries, { sourceCommit: ${JSON.stringify(commit)} })));`);
}

test('Z2K adapter declares the canonical source identity', () => {
  assert.deepEqual(invoke('strategy_source_z2k_info'), {
    sourceId: 'z2k',
    canonicalPrefix: 'z2k:',
    repository: 'necronicle/z2k',
  });
});

test('real strats_new2 records retain upstream IDs and become namespaced entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('strats_new2.txt'), { sourceCommit: 'a'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.entries.length >= 3);
  const rkn = result.entries.find((entry) => entry.upstreamId === 'manual_autocircular_rkn');
  assert.ok(rkn);
  assert.equal(rkn.canonicalId, 'z2k:manual_autocircular_rkn');
  assert.equal(rkn.sourceId, 'z2k');
  assert.equal(rkn.autocircular, true);
  assert.equal(rkn.provenance.repository, 'necronicle/z2k');
  assert.equal(rkn.provenance.sourcePath, 'strats_new2.txt');
});

test('Z2K parser derives Discord semantics from profile args and retains multi-profile entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('multi-profile.txt'), { sourceCommit: 'b'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const allInOne = result.entries.find((entry) => entry.upstreamId === 'z2k_all_in_one');
  assert.ok(allInOne);
  assert.equal(allInOne.canonicalId, 'z2k:z2k_all_in_one');
  assert.equal(allInOne.profiles.length, 3);
  assert.deepEqual(allInOne.capabilities, {
    autocircular: true,
    discordUdp: true,
    protocols: ['tcp', 'udp'],
  });
  assert.equal(allInOne.provenance.repository, 'necronicle/z2k');
  assert.notEqual(allInOne.provenance.repository, 'avatarDD/zapret-gui');
});

test('Z2K parser exposes aggregate pools and every numbered TCP slot without dropping common args', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('strats_new2.txt'), { sourceCommit: 'e'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const aggregate = result.entries.find((entry) => entry.upstreamId === 'manual_autocircular_rkn');
  assert.ok(aggregate);
  assert.equal(aggregate.entryKind, 'aggregate');
  const slots = result.entries.filter((entry) => entry.poolKey === 'rkn_tcp' && entry.entryKind === 'slot');
  assert.ok(slots.length >= 5);
  assert.deepEqual(slots.map((entry) => entry.strategyNumber), [...new Set(slots.map((entry) => entry.strategyNumber))].sort((a, b) => a - b));
  const first = slots.find((entry) => entry.strategyNumber === 1);
  assert.ok(first);
  assert.equal(first.canonicalId, 'z2k:rkn_tcp_strat_1');
  assert.match(first.profiles[0].args, /--filter-tcp=443/);
  assert.match(first.profiles[0].args, /--filter-l7=tls/);
  assert.match(first.profiles[0].args, /--lua-desync=circular/);
  assert.match(first.profiles[0].args, /strategy=1/);
  assert.doesNotMatch(first.profiles[0].args, /strategy=2/);
});

test('Z2K parser imports quic_strats.ini aggregates and fixed slots with explicit Discord adaptation', () => {
  const result = invoke('strategy_source_z2k_parse_files', [{
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini'),
  }, { sourceCommit: 'f'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const yt = result.entries.find((entry) => entry.upstreamId === 'yt_quic_autocircular' && entry.entryKind === 'aggregate');
  assert.ok(yt);
  assert.equal(yt.poolKey, 'yt_quic');
  assert.ok(result.entries.some((entry) => entry.canonicalId === 'z2k:yt_quic_strat_1'));
  const discord = result.entries.find((entry) => entry.upstreamId === 'discord_voice_autocircular' && entry.entryKind === 'aggregate');
  assert.ok(discord);
  assert.equal(discord.poolKey, 'discord_udp');
  assert.equal(discord.capabilities.discordUdp, true);
  assert.equal(discord.provenance.legacyRuntimeKey, 'discord_voice');
  assert.match(discord.args, /key=discord_udp/);
  assert.doesNotMatch(discord.args, /key=discord_voice/);
  assert.ok(result.entries.some((entry) => entry.canonicalId === 'z2k:discord_udp_strat_1'));
});

test('Z2K parser canonicalizes the upstream Discord definition to the official STUN runtime flow', () => {
  const upstreamShape = readFixture('quic_strats.ini').replace(
    '--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --payload=discord_ip_discovery,stun --lua-desync=circular:key=discord_voice:hostkey=z2k_nohost_key',
    '--filter-udp=50000-50099,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --in-range=-d100 --out-range=-d100 --payload=quic_initial,discord_ip_discovery --lua-desync=circular:fails=3:time=60:udp_in=1:udp_out=4:key=discord_voice:nld=2:hostkey=z2k_nohost_key'
  );
  const result = invoke('strategy_source_z2k_parse_files', [{
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': upstreamShape,
  }, { sourceCommit: '9'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const discord = result.entries.find((entry) => entry.upstreamId === 'discord_voice_autocircular' && entry.entryKind === 'aggregate');
  assert.ok(discord);
  assert.match(discord.args, /--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344/);
  assert.doesNotMatch(discord.args, /--in-range=-d100/);
  assert.match(discord.args, /--out-range=-d4/);
  assert.match(discord.args, /--payload=discord_ip_discovery,stun/);
  assert.match(discord.args, /key=discord_udp:nld=2:hostkey=z2k_nohost_key/);
  assert.match(discord.args, /blob=active_discord_udp:repeats=6:strategy=1/);
  assert.match(discord.args, /blob=quic_dbankcloud:repeats=6:strategy=6/);
  assert.match(discord.args, /blob=quic_dbankcloud:repeats=5:strategy=9/);
  assert.doesNotMatch(discord.args, /z2k_quic_morph_v2/);
  assert.deepEqual(result.entries
    .filter((entry) => entry.poolKey === 'discord_udp' && entry.entryKind === 'slot')
    .map((entry) => entry.strategyNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(discord.requirements.blobs.includes('active_discord_udp'));
  assert.match(discord.provenance.adaptation, /official Discord STUN runtime flow/);
});

test('Z2K composer generates a deterministic direct-source All-in-One from current pools', () => {
  const first = composeFixture();
  const second = composeFixture();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second, first);
  assert.equal(first.entry.canonicalId, 'z2k:z2k_all_in_one');
  assert.equal(first.entry.name, 'z2k всё-в-одном');
  assert.equal(first.entry.sourceId, 'z2k');
  assert.equal(first.entry.entryKind, 'all-in-one');
  assert.equal(first.entry.profiles.length, 5);
  assert.deepEqual(first.entry.composition.order, ['rkn_tcp', 'yt_tcp', 'gv_tcp', 'yt_quic', 'discord_udp']);
  assert.equal(first.entry.composition.families[3].protocol, 'udp');
  assert.equal(first.entry.composition.families[3].ports, '443');
  assert.equal(first.entry.composition.families[3].l7, 'quic');
  assert.deepEqual(first.entry.capabilities.protocols, ['tcp', 'udp']);
  assert.equal(first.entry.capabilities.discordUdp, true);
  assert.ok(first.entry.requirements.luaFunctions.includes('circular'));
  assert.ok(first.entry.requirements.blobs.includes('quic_dbankcloud'));
  assert.match(first.entry.provenance.adaptation, /official Discord STUN runtime flow/);
  assert.match(first.entry.provenance.compositions[0], /yt_quic queue scoped/);
  assert.match(first.entry.profiles[0].args, /--filter-tcp=/);
  assert.match(first.entry.profiles[3].args, /--filter-udp=443/);
  assert.match(first.entry.profiles[3].args, /--filter-l7=quic/);
  assert.match(first.entry.profiles[4].args, /--filter-l7=discord,stun/);
});

test('Z2K composer fails closed when an exact snapshot contains an unknown pool family', () => {
  const extraIni = '\n[mystery_autocircular]\nargs=--filter-udp=9999 --lua-desync=circular:key=future_family\n';
  const filesJson = JSON.stringify({
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini') + extraIni,
  });
  const composed = invokeSource(`import * as mod from ${JSON.stringify(MODULE)}; let parsed = mod.strategy_source_z2k_parse_files(${filesJson}, { sourceCommit: ${JSON.stringify('2'.repeat(40))} }); print(sprintf('%J', mod.strategy_source_z2k_compose_all_in_one(parsed.entries, { sourceCommit: ${JSON.stringify('2'.repeat(40))} })));`);
  assert.equal(composed.ok, false, JSON.stringify(composed));
  assert.equal(composed.error.code, 'EUNSUPPORTED');
});

test('Z2K composer rejects a non-443 explicit YouTube QUIC queue', () => {
  const files = {
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini').replace(
      'args=--in-range=a', 'args=--filter-udp=9999 --in-range=a'
    ),
  };
  const commit = '3'.repeat(40);
  const composed = invokeSource(`import * as mod from ${JSON.stringify(MODULE)}; let parsed = mod.strategy_source_z2k_parse_files(${JSON.stringify(files)}, { sourceCommit: ${JSON.stringify(commit)} }); print(sprintf('%J', mod.strategy_source_z2k_compose_all_in_one(parsed.entries, { sourceCommit: ${JSON.stringify(commit)} })));`);
  assert.equal(composed.ok, false, JSON.stringify(composed));
  assert.equal(composed.error.code, 'EUNSUPPORTED');
  assert.equal(composed.error.path, 'filter-udp');
});

test('malformed Z2K input is not usable and does not produce partial entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('malformed.txt'), { sourceCommit: 'c'.repeat(40) }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
});

test('Z2K snapshot identity binds both exact files, revision, order, and entry count', () => {
  const input = { files: {
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini'),
  }, sourceCommit: 'd'.repeat(40) };
  const first = invoke('strategy_source_z2k_prepare_snapshot', [input]);
  const second = invoke('strategy_source_z2k_prepare_snapshot', [input]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.equal(first.snapshot.schema, 'z2m.strategy-source-snapshot.v1');
  assert.equal(first.snapshot.sourceId, 'z2k');
  assert.equal(first.snapshot.repository, 'necronicle/z2k');
  assert.equal(first.snapshot.sourceCommit, 'd'.repeat(40));
  assert.match(first.snapshot.contentDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.snapshot.sourceFiles.length, 2);
  assert.equal(first.snapshot.allInOne.canonicalId, 'z2k:z2k_all_in_one');
  assert.match(first.snapshot.snapshotId, /^z2k-[0-9a-f]{64}$/);
  assert.equal(first.snapshot.normalizedEntryCount, first.snapshot.entries.length);
  assert.equal(first.snapshot.immutable, true);
});

test('Z2K snapshot identity binds both exact source files', () => {
  const files = {
    'strats_new2.txt': readFixture('strats_new2.txt'),
    'quic_strats.ini': readFixture('quic_strats.ini'),
  };
  const first = invoke('strategy_source_z2k_prepare_snapshot', [{ files, sourceCommit: '1'.repeat(40) }]);
  const changed = invoke('strategy_source_z2k_prepare_snapshot', [{
    files: { ...files, 'quic_strats.ini': files['quic_strats.ini'] + '\n# changed\n' },
    sourceCommit: '1'.repeat(40),
  }]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.match(first.snapshot.stratsNew2Digest, /^[0-9a-f]{64}$/);
  assert.match(first.snapshot.quicStratsDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(changed.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Z2K adapter rejects Avatar provenance and preserves canonical source separation', () => {
  const result = invoke('strategy_source_z2k_normalize', [{
    id: 'avatar:shared',
    sourceId: 'avatar',
    upstreamId: 'shared',
    provenance: { repository: 'avatarDD/zapret-gui' },
  }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EPROVENANCE');
});
