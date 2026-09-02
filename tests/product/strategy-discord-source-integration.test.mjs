import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATION = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const DISCORD = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];

function invoke(module, expression, env) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function entry(sourceId, snapshotId, commit, name, discord) {
  const args = discord
    ? '--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --lua-desync=circular:key=discord_udp:hostkey=z2k_nohost_key'
    : '--filter-tcp=443 --filter-l7=tls --lua-desync=circular:key=rkn_tcp';
  return {
    canonicalId: `${sourceId}:${name}`, sourceId, upstreamId: name,
    sourceSnapshotId: snapshotId, sourceCommit: commit, name: 'Same display name', args,
    profiles: [{ id: 'discord-profile', name: 'Discord Voice / Video', enabled: true, args }],
    capabilities: { autocircular: true, discordUdp: discord, protocols: discord ? ['udp'] : ['tcp'] },
    requirements: { engine: 'nfqws2' },
    provenance: { repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k', sourceId,
      sourceCommit: commit, sourcePath: 'strats_new2.txt', kind: 'strategy-catalog' },
  };
}

function source(sourceId, snapshotId, commit, entries) {
  const result = {
    schema: 'z2m.strategy-source-snapshot.v1',
    sourceId, repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k',
    sourceCommit: commit, contentDigest: sourceId === 'avatar' ? 'b'.repeat(64) : 'c'.repeat(64),
    snapshotId, entryCount: entries.length, normalizedEntryCount: entries.length,
    immutable: true, published: true, entries,
  };
  if (sourceId === 'z2k') {
    result.sourceFiles = ['strats_new2.txt', 'quic_strats.ini'];
    result.allInOne = { canonicalId: 'z2k:z2k_all_in_one', digest: 'e'.repeat(64), profileCount: 1 };
  }
  return result;
}

test('Discord donor discovery is semantic, source-filterable, and provenance-complete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-discord-generation-'));
  const avatarCommit = 'a'.repeat(40), z2kCommit = 'd'.repeat(40);
  const avatarEntries = [entry('avatar', 'avatar-s1', avatarCommit, 'shared-display', true)];
  const z2kEntries = [
    entry('z2k', 'z2k-s1', z2kCommit, 'shared-display', true),
    entry('z2k', 'z2k-s1', z2kCommit, 'tls-only', false),
    { ...entry('z2k', 'z2k-s1', z2kCommit, 'z2k_all_in_one', false),
      canonicalId: 'z2k:z2k_all_in_one', entryKind: 'all-in-one', poolKey: 'all-in-one', usable: true },
  ];
  const env = { Z2M_STRATEGY_CATALOG_GENERATION_ROOT: root };
  try {
    const published = invoke(GENERATION, `mod.strategy_catalog_generation_publish(${JSON.stringify({
      generatedAt: 1788201000,
      sources: {
        avatar: { enabled: true, currentSnapshotId: 'avatar-s1', snapshot: source('avatar', 'avatar-s1', avatarCommit, avatarEntries) },
        z2k: { enabled: true, currentSnapshotId: 'z2k-s1', snapshot: source('z2k', 'z2k-s1', z2kCommit, z2kEntries) },
      }, userRevision: 2,
    })})`, env);
    assert.equal(published.ok, true, JSON.stringify(published));

    const all = invoke(DISCORD, 'mod.discord_autocircular_donor("all")', env);
    assert.equal(all.ok, false, 'fixture intentionally lacks router-native dependencies');
    assert.equal(all.donors.length, 2);
    assert.deepEqual(all.donors.map((donor) => donor.sourceId), ['avatar', 'z2k']);
    for (const donor of all.donors) {
      assert.match(donor.canonicalStrategyId, /^(avatar|z2k):shared-display$/);
      assert.match(donor.sourceSnapshotId, /^(avatar|z2k)-s1$/);
      assert.match(donor.sourceCommit, /^[a-f0-9]{40}$/);
      assert.match(donor.contentDigest, /^[a-f0-9]{64}$/);
      assert.equal(donor.donorProfileId, 'discord-profile');
      assert.match(donor.donorProfileDigest, /^[a-f0-9]{64}$/);
      assert.deepEqual(donor.semantic, { key: 'discord_udp', host: 'nohost', protocol: 'STUN', hostkey: 'z2k_nohost_key' });
      assert.deepEqual(donor.requiredDependencies.blobs, ['quic_dbankcloud']);
      assert.equal(donor.rejectionReason, 'MISSING_BLOB');
      assert.equal(donor.diagnostics.classification, 'MISSING_BLOB');
      assert.deepEqual(donor.diagnostics.requiredDependencies.blobs, ['quic_dbankcloud']);
      assert.equal(donor.provenance.sourceId, donor.sourceId);
      assert.equal(donor.provenance.sourceCommit, donor.sourceCommit);
    }

    const z2k = invoke(DISCORD, 'mod.discord_autocircular_donor("z2k")', env);
    assert.equal(z2k.donors.length, 1);
    assert.equal(z2k.donors[0].canonicalStrategyId, 'z2k:shared-display');
    const avatar = invoke(DISCORD, 'mod.discord_autocircular_donor("avatar")', env);
    assert.equal(avatar.donors.length, 1);
    assert.equal(avatar.donors[0].canonicalStrategyId, 'avatar:shared-display');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production Discord donor has no hardcoded Strategy or competing runtime key', () => {
  const source = fs.readFileSync(DISCORD, 'utf8');
  assert.doesNotMatch(source, /strategy_catalog_get_detail\s*\(/);
  assert.doesNotMatch(source, /z2k_all_in_one/);
  assert.doesNotMatch(source, /avatar-catalog/);
  assert.match(source, /key=discord_udp/);
  assert.doesNotMatch(source, /discord_voice.*(?:key|runtime)/i);
});

test('Discord donor returns compiler-compatible blob paths', () => {
  const source = fs.readFileSync(DISCORD, 'utf8');
  assert.match(source, /let donorArgs = '--blob=quic_dbankcloud:@bin\/quic_initial_dbankcloud_ru\.bin ' \+ args/);
  assert.match(source, /let nativeArgs = '--blob=quic_dbankcloud:' \+ blobPath/);
  assert.match(source, /let native = native_check\(nativeArgs\)/);
  assert.doesNotMatch(source, /quic_dbankcloud:@'\s*\+\s*blobPath/);
});
