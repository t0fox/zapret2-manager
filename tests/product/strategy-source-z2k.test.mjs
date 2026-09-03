import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');
const COMPILER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compiler.uc');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/z2k-official-compiler/a7fa893ae79e91accffb7aec8652519e36c82689');
const FILES = ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh'];
const COMMIT = 'a7fa893ae79e91accffb7aec8652519e36c82689';
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function fixtureSnapshot() {
  const files = {};
  for (const relative of FILES) files[relative] = fs.readFileSync(path.join(FIXTURE_ROOT, relative), 'utf8');
  const fileSha256 = {};
  for (const relative of FILES) fileSha256[relative] = crypto.createHash('sha256').update(files[relative]).digest('hex');
  return { repository: 'necronicle/z2k', sourceCommit: COMMIT, files, fileSha256 };
}

function invoke(module, functionName, args = [], extraEnv = {}) {
  const encodedArgs = args.map(JSON.stringify).join(', ');
  let requestPath = null;
  let call = encodedArgs;
  let prelude = "";
  if (encodedArgs.length > 12_000) {
    requestPath = path.join(os.tmpdir(), `z2m-z2k-source-request-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(args), { mode: 0o600 });
    prelude = `let __args = json(readfile(${JSON.stringify(requestPath)})); `;
    call = args.map((_, index) => `__args[${index}]`).join(', ');
  }
  const source = `import { readfile } from 'fs'; import * as mod from ${JSON.stringify(module)}; ${prelude}print(sprintf('%J', mod.${functionName}(${call})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  try {
    const result = spawnSync(UCODE_BIN, argv, {
      cwd: ROOT,
      env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS, ...extraEnv },
      encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
    return JSON.parse(result.stdout);
  } finally {
    if (requestPath) fs.rmSync(requestPath, { force: true });
  }
}

function compile() {
  const compilerResult = invoke(COMPILER, 'z2k_official_compile', [fixtureSnapshot()]);
  assert.equal(compilerResult.ok, true, JSON.stringify(compilerResult));
  return compilerResult;
}

function imported(extra = {}) {
  return invoke(MODULE, 'strategy_source_z2k_import_compiled', [compile(), { sourceCommit: COMMIT, ...extra }]);
}

test('Z2K adapter exposes official compiler authority, not a pool catalog', () => {
  const result = invoke(MODULE, 'strategy_source_z2k_info');
  assert.deepEqual(result, {
    sourceId: 'z2k', canonicalPrefix: 'z2k:', repository: 'necronicle/z2k',
    compiler: 'official:generate_nfqws2_opt_from_strategies', templates: 'disabled',
  });
});

test('flat official output imports every ordered profile, including profiles beyond five pools', () => {
  const result = imported();
  assert.equal(result.ok, true, JSON.stringify(result));
  const entry = result.entry;
  assert.equal(entry.canonicalId, 'z2k:z2k_all_in_one');
  assert.equal(entry.entryKind, 'all-in-one');
  assert.equal(entry.profiles.length, 7);
  assert.deepEqual(entry.profiles.map((profile) => profile.officialProfileIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(entry.composition.profileOrder, entry.profiles.map((profile) => profile.id));
  assert.equal(entry.provenance.compilerSnapshotDigest.length, 64);
  assert.equal(entry.provenance.nfqws2OptSha256.length, 64);
  assert.match(entry.profiles[4].officialArgs, /--filter-l7=discord,stun/);
  assert.match(entry.profiles[4].officialArgs, /--out-range=-d4/);
  assert.match(entry.profiles[4].officialArgs, /--payload=discord_ip_discovery,stun/);
  assert.match(entry.profiles[4].officialArgs, /udp_in=1:udp_out=4:key=discord_udp:nld=2:hostkey=z2k_nohost_key/);
  assert.match(entry.profiles[5].officialArgs, /--filter-tcp=80/);
  assert.match(entry.profiles[6].officialArgs, /--filter-tcp=5222/);
  assert.equal(result.standaloneCandidates.length, 7);
  assert.deepEqual(result.standaloneCandidates.map((candidate) => candidate.canonicalId),
    ['z2k:profile-1', 'z2k:profile-2', 'z2k:profile-3', 'z2k:profile-4', 'z2k:profile-5', 'z2k:profile-6', 'z2k:profile-7']);
  assert.equal(result.standaloneDiagnostics.length, 0);
  for (const candidate of result.standaloneCandidates) {
    assert.equal(candidate.entryKind, 'standalone');
    assert.equal(candidate.usable, false);
    assert.equal(candidate.profiles.length, 1);
    assert.equal(candidate.profiles[0].officialProfileIndex, candidate.provenance.officialProfileIndex);
    assert.match(candidate.semanticDigest, /^[0-9a-f]{64}$/);
  }
  assert.match(result.standaloneCandidates[4].profiles[0].officialArgs, /--filter-l7=discord,stun/);
});

test('resource rebinding changes only allowlisted infrastructure references', () => {
  const result = imported();
  assert.equal(result.ok, true, JSON.stringify(result));
  const entry = result.entry;
  assert.ok(entry.resourceBindings.some((binding) => binding.from === '/runtime-assets/lists/whitelist.txt'));
  assert.ok(entry.resourceBindings.some((binding) => binding.from === '/runtime-assets/lists/discovered-domains.txt'));
  assert.equal(entry.profiles[0].officialArgs.includes('/runtime-assets/lists/extra_strats/TCP/RKN/List.txt'), true);
  assert.equal(entry.profiles[0].args.includes('/runtime-assets/lists/extra_strats/TCP/RKN/List.txt'), true);
  assert.equal(entry.profiles[0].args.includes('/tmp/z2m-z2k-compile.'), false);
  assert.equal(entry.profiles[0].args.includes('/etc/zapret2-manager/lists/whitelist.txt'), true);
  const stripResources = (value) => value.replaceAll(/\/runtime-assets\/lists\/[^ ]+|\/etc\/zapret2-manager\/lists\/[^ ]+/g, '<resource>');
  assert.equal(stripResources(entry.profiles[4].args), stripResources(entry.profiles[4].officialArgs));
});

test('unknown temporary/logical resource paths fail closed without semantic fallback', () => {
  const compiler = compile();
  const nfqws2Opt = compiler.nfqws2Opt + ' --new --filter-tcp=443 --hostlist=/runtime-assets/lists/not-allowlisted.txt --payload=tls_client_hello';
  compiler.nfqws2Opt = nfqws2Opt;
  compiler.nfqws2OptSha256 = crypto.createHash('sha256').update(nfqws2Opt).digest('hex');
  const result = invoke(MODULE, 'strategy_source_z2k_import_compiled', [compiler, { sourceCommit: COMMIT }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ERESOURCE');
});

test('unavailable durable resources fail closed before the official entry is published', () => {
  const result = imported({ resourceBindings: {
    '/runtime-assets/lists/extra_strats/TCP/RKN/List.txt': { available: false },
  } });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ERESOURCE');
});

test('snapshot identity records all compiler files and official output provenance', () => {
  const compiler = compile();
  const snapshot = invoke(MODULE, 'strategy_source_z2k_prepare_snapshot', [{
    compiler,
    sourceCommit: COMMIT,
    sourceFiles: FILES,
    fileSha256: fixtureSnapshot().fileSha256,
  }]);
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  assert.equal(snapshot.snapshot.sourceFiles.length, 5);
  assert.deepEqual(snapshot.snapshot.sourceFiles, FILES);
  assert.equal(snapshot.snapshot.entryCount, 1);
  assert.equal(snapshot.snapshot.normalizedEntryCount, 1);
  assert.equal(snapshot.snapshot.allInOne.profileCount, 7);
  assert.equal(snapshot.snapshot.entries[0].sourceSnapshotId, snapshot.snapshot.snapshotId);
  assert.equal(snapshot.snapshot.entries[0].provenance.kind, 'strategy-catalog-import');
  assert.equal(snapshot.snapshot.immutable, true);
});

test('legacy hand-composed entries are rejected as semantic authority', () => {
  const result = invoke(MODULE, 'strategy_source_z2k_normalize', [{
    id: 'z2k:manual', sourceId: 'z2k', upstreamId: 'manual',
    entryKind: 'aggregate', profiles: [], args: '--filter-tcp=443',
    provenance: { repository: 'necronicle/z2k' },
  }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
});
