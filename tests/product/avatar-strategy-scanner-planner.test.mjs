import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const AUTHORITY_MARKER = 'z2m-scanner-authority.v1';
const GENERATOR_MARKER = 'z2m-scanner-generator.v1';
const COMPILER_DIGEST = 'ae6761cb991048e870d2d7adf7b8c93b21a88b43cf4963a599fd4158ad47d404';
const CATALOG_DIGEST = '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1';
const DEPENDENCY_DIGEST = 'b'.repeat(64);

function invoke(expression) {
  const source = `import * as planner from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function entry(id, args, extra = {}) {
  return {
    id, args, level: 'advanced', protocol: 'tcp', sourceFile: 'advanced/tcp.txt',
    sourceOrdinal: 1, effectiveOrdinal: 1, dependencyDigest: DEPENDENCY_DIGEST,
    metadata: { name: id, label: '', ...extra },
  };
}

function snapshot(entries, sets, extra = {}) {
  const winners = Object.fromEntries(entries.map(item => [item.id, item]));
  return {
    serverOwned: true,
    authority: { marker: AUTHORITY_MARKER, repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c', catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST },
    aggregateDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    policy: { useGenerated: false }, winners, sets,
    winnerOrder: entries.map(item => item.id),
    dependencyDigests: Object.fromEntries(entries.map(item => [item.id, DEPENDENCY_DIGEST])),
    targetProfile: { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
      hostlistDomains: ['example.com'], expectedHostlists: [],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'quic', payload: 'quic_initial' }, probeUrl: 'https://example.com/' },
    ...extra,
  };
}

function users(strategies = []) {
  return { serverOwned: true, authority: { marker: AUTHORITY_MARKER, repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST }, strategies };
}

function generatedInput(values) {
  return { marker: GENERATOR_MARKER, compilerDigest: COMPILER_DIGEST,
    candidates: values.map(value => ({ id: value.id, protocol: value.protocol, dependencyDigest: DEPENDENCY_DIGEST,
      strategy: { id: value.id, name: value.id, profiles: [{ id: 'generated', args: value.args, enabled: true }] } })) };
}

const request = (mode, protocol = 'tcp', dpi_type = null) => ({
  target: 'example.com', protocol, mode, resume: false, dpi_type,
});

test('quick prepends ten full presets and preserves the catalog tail order', () => {
  const full = Array.from({ length: 11 }, (_, index) => entry(
    `full-${index + 1}`, `--filter-tcp=443 --name=full-${index + 1}`, { label: '', source: 'builtin' },
  )).map((item, index) => ({ ...item, level: 'builtin', sourceFile: 'builtin/presets.txt', sourceOrdinal: index + 1 }));
  const tail = [
    entry('recommended-low', '--lua-desync=split:pos=1', { label: 'recommended' }),
    entry('recommended-source', '--lua-desync=split:pos=2', { label: 'recommended', sourceFile: 'basic/tcp.txt' }),
    entry('normal', '--lua-desync=fake:repeats=6'),
  ];
  const all = [...full, ...tail];
  const sets = { tcp: { quick: all.map(item => item.id), standard: all.map(item => item.id), full: all.map(item => item.id) }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(all, sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(item => item.strategyId), [
    ...full.slice(0, 10).map(item => item.id), ...tail.map(item => item.id),
  ]);
  assert.equal(plan.catalogDigest, CATALOG_DIGEST);
  assert.equal(plan.compilerDigest, COMPILER_DIGEST);
});

test('standard prepends twenty full presets, while full keeps only the requested protocol', () => {
  const tcp = Array.from({ length: 21 }, (_, index) => ({
    ...entry(`tcp-full-${index + 1}`, `--filter-tcp=443 --name=tcp-full-${index + 1}`), level: 'builtin',
    sourceFile: 'builtin/presets.txt', sourceOrdinal: index + 1,
  }));
  const udp = [{ ...entry('udp-full', '--filter-udp=443'), protocol: 'udp', level: 'builtin', sourceFile: 'builtin/presets.txt' }];
  const tail = entry('standard-tail', '--lua-desync=multisplit:pos=1');
  const all = [...tcp, tail, ...udp];
  const sets = {
    tcp: { quick: all.map(item => item.id), standard: all.map(item => item.id), full: all.map(item => item.id) },
    udp: { quick: ['udp-full'], standard: ['udp-full'], full: ['udp-full'] },
  };
  const data = JSON.stringify(snapshot(all, sets));
  const standard = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${data}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(standard.candidates.slice(0, 20).map(item => item.strategyId),
    tcp.slice(0, 20).map(item => item.id));
  const fullUdp = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full', 'udp'))}, ${data}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(fullUdp.candidates.map(item => item.strategyId), ['udp-full']);
});

test('generated entries append after catalog candidates and known DPI filtering runs after generation', () => {
  const catalogEntries = [
    entry('tls-one', '--filter-tcp=443 --filter-l7=tls --lua-desync=split:pos=1'),
    entry('quic-one', '--filter-udp=443 --filter-l7=quic --lua-desync=fake'),
  ];
  const generated = [
    { id: 'gen-keep', protocol: 'tcp', args: '--filter-tcp=443 --filter-l7=tls --lua-desync=multisplit:pos=1' },
    { id: 'gen-drop', protocol: 'tcp', args: '--filter-tcp=443 --filter-l7=quic --lua-desync=fake' },
  ];
  const sets = {
    tcp: { quick: ['tls-one'], standard: ['tls-one'], full: ['tls-one'] },
    udp: { quick: ['quic-one'], standard: ['quic-one'], full: ['quic-one'] },
  };
  const data = JSON.stringify(snapshot(catalogEntries, sets, {
    policy: { useGenerated: true }, generator: generatedInput(generated),
  }));
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'tls_dpi'))}, ${data}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(item => item.strategyId || item.scannerId), ['tls-one', 'generated:gen-keep']);
  const skipped = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'dns_fake'))}, ${data}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(skipped.candidates, []);
  const unknown = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'vendor_block_v1'))}, ${data}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(unknown.candidates.map(item => item.strategyId || item.scannerId), ['tls-one', 'generated:gen-keep', 'generated:gen-drop']);
});

test('normalized compiled-token and dependency closure dedup keeps the catalog identity', () => {
  const item = entry('catalog-one', '--filter-tcp=443 --lua-desync=multisplit:pos=1');
  const sets = { tcp: { quick: ['catalog-one'], standard: ['catalog-one'], full: ['catalog-one'] }, udp: { quick: [], standard: [], full: [] } };
  const data = snapshot([item], sets, {
    policy: { useGenerated: true },
    generator: generatedInput([{ id: 'same-generated', protocol: 'tcp', args: '  --filter-tcp=443\t--lua-desync=multisplit:pos=1  ' }]),
  });
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(data)}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId || candidate.scannerId), ['catalog-one']);
  assert.match(plan.candidates[0].compiledDigest, /^[a-f0-9]{64}$/);
  assert.match(plan.candidates[0].dependencyDigest, /^[a-f0-9]{64}$/);
});

test('recommended, complexity, source, and section tie-breakers are deterministic', () => {
  const candidates = [
    { ...entry('recommended-z', '--lua-desync=split:pos=2', { label: 'recommended' }), sourceFile: 'z-source.txt' },
    { ...entry('recommended-a', '--lua-desync=split:pos=1', { label: 'recommended' }), sourceFile: 'a-source.txt' },
    { ...entry('recommended-b', '--lua-desync=split:pos=3', { label: 'recommended' }), sourceFile: 'a-source.txt' },
    { ...entry('recommended-simple', '--lua-desync=split:repeats=1', { label: 'recommended' }), sourceFile: 'a-source.txt' },
    { ...entry('normal', '--lua-desync=fake:repeats=1'), sourceFile: '0-source.txt' },
  ];
  const ids = candidates.map(candidate => candidate.id);
  const sets = { tcp: { quick: ids, standard: ids, full: ids }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(candidates, sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId), [
    'recommended-z', 'recommended-a', 'recommended-b', 'recommended-simple', 'normal',
  ]);
});

test('planner binds provenance, normalized compiled tokens, dependency closure, and ordinals', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets))}, ${JSON.stringify(users())})`).plan;
  const candidate = plan.candidates[0];
  assert.deepEqual(Object.keys(candidate).sort(), [
    'catalogOrder', 'compiledDigest', 'compiledTokens', 'complexity', 'dependencyClosure',
    'dependencyDigest', 'fullPreset', 'identityKind', 'ordinal', 'protocol',
    'effectiveOrdinal', 'recommended', 'saveRequired', 'scannerId', 'source', 'sourceOrdinal', 'sourcePath',
    'strategyId', 'strategyRevision',
  ].sort());
  assert.equal(candidate.identityKind, 'catalog');
  assert.equal(candidate.source, 'catalog');
  assert.equal(candidate.sourcePath, 'advanced/tcp.txt');
  assert.equal(candidate.ordinal, 1);
  assert.equal(candidate.fullPreset, true);
  assert.equal(candidate.saveRequired, false);
  assert.equal(plan.candidates[0].catalogDigest, undefined);
});

test('dependency digest fallback hashes the canonical closure without process access', () => {
  const item = { ...entry('one', '--filter-tcp=443'), dependencyDigest: null };
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const data = snapshot([item], sets, { dependencyDigests: {} });
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(data)}, ${JSON.stringify(users())})`).plan;
  assert.equal(plan.candidates[0].dependencyDigest,
    'fd6bc5930bb0a77ae383fbc33948ee0a4dc0700b69e43e506c97ea2ae18139c5');
});

test('canonicalization maps only exact normalized compiled tokens and dependency closure', () => {
  const exact = {
    scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    compiledTokens: ['--filter-tcp=443'],
    dependencyClosure: { available: true, items: [], missing: [], structurallyCompilable: true },
    ordinal: 1, complexity: [1, 0, 0], recommended: false, fullPreset: false, saveRequired: true,
  };
  const existing = [{
    id: 'user-one', revision: 3, name: 'Generated display name', origin: 'user',
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }],
  }];
  const canonical = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(exact)}, ${JSON.stringify(users(existing))})`);
  assert.deepEqual(canonical, { identityKind: 'canonicalized', strategyId: 'user-one', strategyRevision: 3, saveRequired: false });

  for (const changed of [
    { ...exact, scannerId: 'generated:user-one' },
    { ...exact, compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=2'] },
    { ...exact, compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=1'], dependencyClosure: { ...exact.dependencyClosure, items: [] } },
  ]) {
    const result = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(changed)}, ${JSON.stringify(users(existing))})`);
    assert.deepEqual(result, { identityKind: 'generated', strategyId: null, strategyRevision: null, saveRequired: true });
  }
});

test('canonicalization rejects display-only, approximate, and client raw-argument identity', () => {
  const candidate = {
    scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    compiledTokens: ['--filter-tcp=443'], dependencyClosure: { available: true, items: [], missing: [], structurallyCompilable: true },
    ordinal: 1, complexity: [0, 0, 0], recommended: false, fullPreset: true, saveRequired: true,
  };
  const existing = [{ id: 'display-name-match', revision: 1, name: 'gen-one', origin: 'user',
    profiles: [{ id: 'p1', args: '--filter-tcp=80', enabled: true }] }];
  const mismatch = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(candidate)}, ${JSON.stringify(users(existing))})`);
  assert.equal(mismatch.strategyId, null);
  assert.equal(mismatch.saveRequired, true);
  const rejected = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify({ ...candidate, args: '--filter-tcp=443' })}, ${JSON.stringify(users())})`);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EINPUT');
});

test('planner rejects missing or mismatched compiler/catalog authority', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  for (const mutate of [
    snapshot([item], sets, { compilerDigest: null }),
    snapshot([item], sets, { compilerDigest: '0'.repeat(64) }),
    snapshot([item], sets, { authority: { marker: AUTHORITY_MARKER, catalogDigest: '0'.repeat(64), compilerDigest: COMPILER_DIGEST } }),
  ]) {
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(mutate)}, ${JSON.stringify(users())})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  }
});

test('planner rejects untrusted snapshots, user records, and public generated args', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const trusted = snapshot([item], sets);
  const untrustedSnapshot = { ...trusted, serverOwned: false };
  const badSnapshot = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(untrustedSnapshot)}, ${JSON.stringify(users())})`);
  assert.equal(badSnapshot.ok, false);
  assert.equal(badSnapshot.error.code, 'EVERIFY');

  const badUser = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(trusted)}, ${JSON.stringify({ serverOwned: false, strategies: [] })})`);
  assert.equal(badUser.ok, false);
  assert.equal(badUser.error.code, 'EVERIFY');

  const publicGenerated = snapshot([item], sets, {
    policy: { useGenerated: true }, generatedCandidates: [{ id: 'raw', protocol: 'tcp', args: '--filter-tcp=443' }],
  });
  const badGenerated = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(publicGenerated)}, ${JSON.stringify(users())})`);
  assert.equal(badGenerated.ok, false);
  assert.equal(badGenerated.error.code, 'EVERIFY');
});

test('planner fails closed when target profile resolution fails', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify({ ...request('quick'), target: 'bad target' })}, ${JSON.stringify(snapshot([item,], sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('final ordinals are contiguous after authoritative-order deduplication', () => {
  const first = { ...entry('z-section', '--filter-tcp=443 --name=z'), sourceFile: 'a.txt', sourceOrdinal: 20, effectiveOrdinal: 9 };
  const second = { ...entry('a-section', '--filter-tcp=443 --name=a'), sourceFile: 'a.txt', sourceOrdinal: 10, effectiveOrdinal: 3 };
  const sets = { tcp: { quick: ['z-section', 'a-section'], standard: ['z-section', 'a-section'], full: ['z-section', 'a-section'] }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full'))}, ${JSON.stringify(snapshot([first, second], sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId), ['z-section', 'a-section']);
  assert.deepEqual(plan.candidates.map(candidate => candidate.ordinal), [1, 2]);
});

test('canonicalization rejects incomplete dependency items and closure mismatches', () => {
  const candidate = {
    scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    compiledTokens: ['--filter-tcp=443'],
    dependencyClosure: { available: true, items: [{ key: 'function:fake', kind: 'function', id: 'fake', reference: 'fake', available: true }], missing: [], structurallyCompilable: true },
    ordinal: 1, complexity: [0, 0, 0], recommended: false, fullPreset: true, saveRequired: true,
  };
  const result = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(candidate)}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});
