import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');
const COMPILER = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const COMPILER_AUTHORITY_MODULE = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-compiler-authority.uc');
const CATALOG_MANIFEST = JSON.parse(readFileSync(path.join(ROOT,
  'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json'), 'utf8'));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const AUTHORITY_MARKER = 'z2m-scanner-authority.v1';
const GENERATOR_MARKER = 'z2m-scanner-generator.v1';
const CATALOG_DIGEST = '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1';

function invokeCompiler(expression, extraEnv = {}) {
  const source = `import * as compiler from ${JSON.stringify(COMPILER)}; print(${expression});`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_COMPILER_SOURCE: COMPILER,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

const COMPILER_SEMANTIC_AUTHORITY = invokeCompiler('sprintf("%J", compiler.strategy_compiler_authority())');
const COMPILER_AUTHORITY = (() => {
  const source = `import * as authority from ${JSON.stringify(COMPILER_AUTHORITY_MODULE)}; print(sprintf('%J', authority.scanner_compiler_authority()));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_COMPILER_SOURCE: COMPILER,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
})();
const COMPILER_DIGEST = COMPILER_AUTHORITY.digest;
let lastCatalogAuthority = null;

function catalogEnvelope(value) {
  return {
    source: value.source ?? null, aggregateDigest: value.aggregateDigest ?? null,
    files: value.files ?? null, winnerOrder: value.winnerOrder ?? null, sets: value.sets ?? null,
    winners: value.winners ?? null, targetProfile: value.targetProfile ?? null,
    compilerEnvironment: value.compilerEnvironment ?? null, policy: value.policy ?? null,
  };
}

test('compiler authority digest covers the complete versioned semantic manifest', () => {
  assert.equal(COMPILER_SEMANTIC_AUTHORITY.digest,
    createHash('sha256').update(COMPILER_SEMANTIC_AUTHORITY.digestInput, 'utf8').digest('hex'));
  assert.deepEqual(JSON.parse(COMPILER_SEMANTIC_AUTHORITY.digestInput), COMPILER_SEMANTIC_AUTHORITY.manifest);
  assert.equal(COMPILER_SEMANTIC_AUTHORITY.manifest.schema, 1);
  for (const field of Object.keys(COMPILER_SEMANTIC_AUTHORITY.manifest)) {
    const changed = structuredClone(COMPILER_SEMANTIC_AUTHORITY.manifest);
    changed[field] = typeof changed[field] === 'number' ? changed[field] + 1 : `${JSON.stringify(changed[field])}:changed`;
    const digest = invokeCompiler(`sprintf("%J", compiler.strategy_compiler_manifest_digest(${JSON.stringify(changed)}))`);
    assert.notEqual(digest, COMPILER_SEMANTIC_AUTHORITY.digest, field);
  }
});

test('catalog envelope digest uses the canonical planning inputs', () => {
  const item = entry('digest-one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['digest-one'], standard: ['digest-one'], full: ['digest-one'] }, udp: { quick: [], standard: [], full: [] } };
  const value = snapshot([item], sets);
  assert.equal(invoke(`planner.scanner_snapshot_digest(${JSON.stringify(value)})`), value.authority.catalogEnvelopeDigest);
});

test('compiler authority automatically binds the installed compiler source and rejects drift', () => {
  assert.equal(COMPILER_AUTHORITY.sourceSha256,
    createHash('sha256').update(readFileSync(COMPILER)).digest('hex'));
  assert.equal(COMPILER_AUTHORITY.digest,
    createHash('sha256').update(`${COMPILER_AUTHORITY.manifestDigest}\n${COMPILER_AUTHORITY.sourceSha256}\n`, 'utf8').digest('hex'));

  const directory = mkdtempSync(path.join(tmpdir(), 'z2m-scanner-compiler-'));
  const changedCompiler = path.join(directory, 'strategy-compiler.uc');
  try {
    copyFileSync(COMPILER, changedCompiler);
    writeFileSync(changedCompiler, `${readFileSync(changedCompiler, 'utf8')}\n// drift\n`);
    const source = `import * as authority from ${JSON.stringify(COMPILER_AUTHORITY_MODULE)}; print(sprintf('%J', authority.scanner_compiler_authority()));`;
    const child = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_COMPILER_SOURCE: changedCompiler,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const changed = JSON.parse(child.stdout);
    assert.notEqual(changed.sourceSha256, COMPILER_AUTHORITY.sourceSha256);
    assert.notEqual(changed.digest, COMPILER_AUTHORITY.digest);

    const item = entry('compiler-drift', '--filter-tcp=443');
    const sets = { tcp: { quick: ['compiler-drift'], standard: ['compiler-drift'], full: ['compiler-drift'] }, udp: { quick: [], standard: [], full: [] } };
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets))}, ${JSON.stringify(users())})`, true, {
      Z2M_SCANNER_COMPILER_SOURCE: changedCompiler,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('production policy generates standard/full candidates but never quick candidates', () => {
  const item = entry('production-catalog', '--filter-tcp=443');
  const sets = { tcp: { quick: ['production-catalog'], standard: ['production-catalog'], full: ['production-catalog'] }, udp: { quick: [], standard: [], full: [] } };
  const catalog = snapshot([item], sets);
  for (const mode of ['standard', 'full']) {
    const result = invoke(`planner.scanner_plan_build_server_test(${JSON.stringify(request(mode))}, ${JSON.stringify(catalog)}, [], ${JSON.stringify(catalog.targetProfile)})`, false);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.plan.candidates.some(candidate => candidate.source === 'generator'), mode);
  }
  const quick = invoke(`planner.scanner_plan_build_server_test(${JSON.stringify(request('quick'))}, ${JSON.stringify(catalog)}, [], ${JSON.stringify(catalog.targetProfile)})`, false);
  assert.equal(quick.ok, true, JSON.stringify(quick));
  assert.equal(quick.plan.candidates.some(candidate => candidate.source === 'generator'), false);
});

test('production server policy can disable generated candidates', () => {
  const item = entry('production-catalog', '--filter-tcp=443');
  const sets = { tcp: { quick: ['production-catalog'], standard: ['production-catalog'], full: ['production-catalog'] }, udp: { quick: [], standard: [], full: [] } };
  const catalog = snapshot([item], sets);
  const result = invoke(`planner.scanner_plan_build_server_test(${JSON.stringify(request('standard'))}, ${JSON.stringify(catalog)}, [], ${JSON.stringify(catalog.targetProfile)})`, false, { Z2M_SCANNER_GENERATION: '0' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.plan.candidates.some(candidate => candidate.source === 'generator'), false);
});

function invoke(expression, useTestAuthority = true, extraEnv = {}) {
  if (useTestAuthority) expression = expression.replaceAll(
    'planner.scanner_plan_build(', 'planner.scanner_plan_build_test(')
    .replaceAll('planner.scanner_candidate_canonicalize(', 'planner.scanner_candidate_canonicalize_test(');
  const source = `import * as planner from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_COMPILER_SOURCE: COMPILER,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function entry(id, args, extra = {}) {
  return {
    id, args, winner: true, level: 'advanced', protocol: 'tcp', sourceFile: 'advanced/tcp.txt',
    sourceOrdinal: 1, sectionOrdinal: 1, effectiveOrdinal: 1,
    metadata: { name: id, label: '', ...extra },
  };
}

function snapshot(entries, sets, extra = {}) {
  const winners = Object.fromEntries(entries.map(item => [item.id, item]));
  const value = {
    serverOwned: true,
    authority: { marker: AUTHORITY_MARKER, repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c', catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST },
    aggregateDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    source: { repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c' },
    files: CATALOG_MANIFEST.files,
    policy: { useGenerated: false }, winners, sets,
    winnerOrder: entries.map(item => item.id),
    targetProfile: { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
      hostlistDomains: ['example.com'], expectedHostlists: [],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
       udp: { ports: '443', l7: 'stun', payload: 'binding' }, probeUrl: 'https://example.com/' },
    ...extra,
  };
  const catalogEnvelopeDigest = invoke(`planner.scanner_snapshot_digest(${JSON.stringify(value)})`);
  lastCatalogAuthority = { serverOwned: true, marker: 'z2m-scanner-catalog.v1',
    repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c',
    catalogDigest: CATALOG_DIGEST, catalogEnvelopeDigest,
    source: value.source, winnerOrder: value.winnerOrder,
    sets: value.sets, winners: value.winners, targetProfile: value.targetProfile,
    compilerEnvironment: value.compilerEnvironment ?? null, policy: value.policy };
  value.authority.catalogEnvelopeDigest = catalogEnvelopeDigest;
  value.authority.catalog = lastCatalogAuthority;
  if (value.generator?.authority) {
    value.generator.authority.catalogEnvelopeDigest = catalogEnvelopeDigest;
    value.generator.authority.catalog = lastCatalogAuthority;
  }
  return value;
}

function users(strategies = []) {
  return { serverOwned: true, authority: { marker: AUTHORITY_MARKER, repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    catalogEnvelopeDigest: lastCatalogAuthority?.catalogEnvelopeDigest,
    catalog: lastCatalogAuthority, records: structuredClone(strategies),
    recordsDigest: invoke(`planner.scanner_records_digest(${JSON.stringify(strategies)})`) }, strategies };
}

function generatedInput(values) {
  const candidates = values.map(value => ({ id: value.id, protocol: value.protocol,
    strategy: { id: value.id, name: value.id, profiles: [{ id: 'generated', args: value.args, enabled: true }] } }));
  return { serverOwned: true, authority: { marker: GENERATOR_MARKER,
    repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    catalogEnvelopeDigest: lastCatalogAuthority?.catalogEnvelopeDigest,
    catalog: lastCatalogAuthority, records: structuredClone(candidates),
    recordsDigest: invoke(`planner.scanner_records_digest(${JSON.stringify(candidates)})`) }, candidates };
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
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(all, sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  const plan = result.plan;
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
  const standardResult = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${data}, ${JSON.stringify(users())})`);
  assert.equal(standardResult.ok, true, JSON.stringify(standardResult));
  const standard = standardResult.plan;
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
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(candidates, sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  const plan = result.plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId), [
    'recommended-a', 'recommended-b', 'recommended-z', 'recommended-simple', 'normal',
  ]);
});

test('approved Scanner ordering restores source, section, effective, ID, and catalog tie-breakers', () => {
  const candidates = [
    { ...entry('id-z', '--lua-desync=split:pos=1 --name=z'), sourceFile: 'b.txt', sourceOrdinal: 2, sectionOrdinal: 2, effectiveOrdinal: 2 },
    { ...entry('id-a', '--lua-desync=split:pos=1 --name=a'), sourceFile: 'b.txt', sourceOrdinal: 2, sectionOrdinal: 2, effectiveOrdinal: 2 },
    { ...entry('source-a', '--lua-desync=split:pos=1 --comment=source'), sourceFile: 'a.txt', sourceOrdinal: 9, sectionOrdinal: 9, effectiveOrdinal: 9 },
    { ...entry('complex', '--lua-desync=split:repeats=8'), sourceFile: 'a.txt', sourceOrdinal: 1, effectiveOrdinal: 1 },
    { ...entry('recommended', '--lua-desync=split:pos=1 --comment=recommended', { label: 'recommended' }), sourceFile: 'z.txt' },
    { ...entry('full', '--filter-tcp=443'), level: 'builtin', sourceFile: 'builtin/presets.txt' },
  ];
  const ids = candidates.map(candidate => candidate.id);
  const sets = { tcp: { quick: ids, standard: ids, full: ids }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full'))}, ${JSON.stringify(snapshot(candidates, sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  const plan = result.plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId),
    ['full', 'recommended', 'source-a', 'id-a', 'id-z', 'complex']);
});

test('recommendation is an independent tie-breaker among full presets', () => {
  const candidates = [
    { ...entry('full-normal', '--filter-tcp=443 --name=normal'), level: 'builtin', sourceFile: 'a.txt' },
    { ...entry('full-recommended', '--filter-tcp=443 --name=recommended', { label: 'recommended' }), level: 'builtin', sourceFile: 'z.txt' },
  ];
  const ids = candidates.map(candidate => candidate.id);
  const sets = { tcp: { quick: ids, standard: ids, full: ids }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full'))}, ${JSON.stringify(snapshot(candidates, sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.plan.candidates.map(candidate => candidate.strategyId),
    ['full-recommended', 'full-normal']);
});

test('planner binds provenance, normalized compiled tokens, dependency closure, and ordinals', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets))}, ${JSON.stringify(users())})`).plan;
  const candidate = plan.candidates[0];
  assert.deepEqual(Object.keys(candidate).sort(), [
    'catalogOrder', 'compiledDigest', 'compiledTokens', 'complexity', 'dependencyClosure',
    'catalogDigest', 'compilerDigest',
    'dependencyDigest', 'fullPreset', 'identityKind', 'ordinal', 'protocol',
    'effectiveOrdinal', 'sectionOrdinal', 'recommended', 'saveRequired', 'scannerId', 'source', 'sourceOrdinal', 'sourcePath',
    'strategyId', 'strategyRevision',
  ].sort());
  assert.equal(candidate.identityKind, 'catalog');
  assert.equal(candidate.source, 'catalog');
  assert.equal(candidate.sourcePath, 'advanced/tcp.txt');
  assert.equal(candidate.ordinal, 1);
  assert.equal(candidate.fullPreset, true);
  assert.equal(candidate.saveRequired, false);
  assert.equal(plan.candidates[0].catalogDigest, CATALOG_DIGEST);
});

test('dependency digest fallback hashes the canonical closure without process access', () => {
  const item = { ...entry('one', '--filter-tcp=443'), dependencyDigest: null };
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const data = snapshot([item], sets);
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(data)}, ${JSON.stringify(users())})`).plan;
  assert.equal(plan.candidates[0].dependencyDigest,
    'fd6bc5930bb0a77ae383fbc33948ee0a4dc0700b69e43e506c97ea2ae18139c5');
});

test('canonicalization maps only exact normalized compiled tokens and dependency closure', () => {
  const exact = {
    scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
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
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
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

test('planner rejects compiler drift from the authoritative compiler contract', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets, { compilerDigest: '0'.repeat(64), authority: { marker: AUTHORITY_MARKER, repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c', catalogDigest: CATALOG_DIGEST, compilerDigest: '0'.repeat(64) } }))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EVERIFY');
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

test('production planner does not accept caller-supplied authority records', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const forged = snapshot([item], sets);
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(forged)}, ${JSON.stringify(users())})`, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('test authority hook is unavailable without the explicit server-test gate', () => {
  const source = `import * as planner from ${JSON.stringify(MODULE)}; print(sprintf('%J', planner.scanner_plan_build_test(${JSON.stringify(request('quick'))}, {}, {})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '0', LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, false);
  assert.equal(value.error.code, 'EACCES');
});

test('production catalog loading ignores path overrides outside the server-test gate', () => {
  const source = readFileSync(MODULE, 'utf8');
  assert.match(source,
    /strategy_catalog_load\(getenv\('Z2M_SCANNER_SERVER_TEST'\) == '1' \? getenv\('Z2M_STRATEGY_CATALOG_ROOT'\) \|\| null : null\)/);
  assert.doesNotMatch(source,
    /strategy_catalog_load\(getenv\('Z2M_STRATEGY_CATALOG_ROOT'\) \|\| null\)/);
});

test('planner fails closed when target profile resolution fails', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify({ ...request('quick'), target: 'bad target' })}, ${JSON.stringify(snapshot([item,], sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('planner rejects a target profile unrelated to the validated request target', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets, { targetProfile: { ...snapshot([], sets).targetProfile, primaryHost: 'other.example' } }))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('planner accepts the exact server-derived named profile when hosts and probe URL differ', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const youtube = {
    profileKey: 'youtube', primaryHost: 'youtube.com',
    testHosts: ['www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com'],
    hostlistDomains: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtubei.googleapis.com',
      'youtube-nocookie.com', 'googlevideo.com', 'rr1---sn-axq7sn7s.googlevideo.com', 'ytimg.com',
      'i.ytimg.com', 'yt3.ggpht.com', 'ggpht.com', 'lh3.googleusercontent.com', 'yt3.googleusercontent.com'],
    expectedHostlists: ['youtube.txt', 'youtubeGV.txt', 'youtubeQ.txt', 'youtube_v2.txt'],
    tcp: { ports: '80,443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'stun', payload: 'binding' },
    probeUrl: 'https://i.ytimg.com/generate_204',
  };
  const data = snapshot([item], sets, { targetProfile: youtube });
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify({ ...request('quick'), target: 'youtube.com' })}, ${JSON.stringify(data)}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.plan.targetProfile, youtube);
});

test('planner rejects a supplied dependency digest that disagrees with the validated closure', () => {
  const item = { ...entry('one', '--filter-tcp=443'), dependencyDigest: '0'.repeat(64) };
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets))}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EVERIFY');
});

test('planner rejects forged authority envelopes and unbound generated snapshots', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const trusted = snapshot([item], sets, {
    policy: { useGenerated: true }, generator: generatedInput([
      { id: 'generated-one', protocol: 'tcp', args: '--filter-tcp=443' },
    ]),
  });
  const cases = [
    { ...trusted, authority: { ...trusted.authority, catalog: { ...lastCatalogAuthority, commit: 'forged' } } },
    { ...trusted, generator: { ...trusted.generator, authority: { ...trusted.generator.authority, catalogDigest: '0'.repeat(64) } } },
    { ...trusted, files: trusted.files.slice(1) },
    { ...trusted, authority: { ...trusted.authority, compilerDigest: '0'.repeat(64) } },
  ];
  for (const forged of cases) {
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(forged)}, ${JSON.stringify(users())})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  }
});

test('planner binds a valid target profile to the requested protocol', () => {
  const item = entry('one', '--filter-udp=443');
  const sets = { tcp: { quick: [], standard: [], full: [] }, udp: { quick: ['one'], standard: ['one'], full: ['one'] } };
  const profile = snapshot([], sets).targetProfile;
  const data = snapshot([{ ...item, protocol: 'udp' }], sets, {
    targetProfile: { ...profile, udp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' } },
  });
  const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick', 'udp'))}, ${JSON.stringify(data)}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
});

test('canonicalization recomputes and validates the dependency digest', () => {
  const candidate = {
    scannerId: 'generated:one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    compiledTokens: ['--filter-tcp=443'],
    dependencyClosure: { available: true, items: [], missing: [], structurallyCompilable: true },
    dependencyDigest: '0'.repeat(64), catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    ordinal: 1, complexity: [0, 0, 0], recommended: false, fullPreset: true, saveRequired: true,
  };
  const result = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(candidate)}, ${JSON.stringify(users())})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EVERIFY');
});

test('canonicalization fails closed for unavailable authority and omitted compiler digest', () => {
  const sets = { tcp: { quick: [], standard: [], full: [] }, udp: { quick: [], standard: [], full: [] } };
  snapshot([], sets);
  const candidate = {
    scannerId: 'generated:one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    catalogDigest: CATALOG_DIGEST, compilerDigest: COMPILER_DIGEST,
    compiledTokens: ['--filter-tcp=443'],
    dependencyClosure: { available: true, items: [], missing: [], structurallyCompilable: true },
    ordinal: 1, complexity: [0, 0, 0], recommended: false, fullPreset: true, saveRequired: true,
  };
  const unavailable = invoke(
    `planner.scanner_candidate_canonicalize(${JSON.stringify(candidate)}, ${JSON.stringify(users())})`,
    true, { Z2M_SCANNER_COMPILER_SOURCE: '/missing/z2m-strategy-compiler.uc' });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'EVERIFY');

  const omitted = structuredClone(candidate);
  delete omitted.compilerDigest;
  const missingDigest = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(omitted)}, ${JSON.stringify(users())})`);
  assert.equal(missingDigest.ok, false);
  assert.equal(missingDigest.error.code, 'EVERIFY');
});

test('ordering applies source, section, and effective ordinals before Strategy ID', () => {
  const candidates = [
    { ...entry('effective-late', '--lua-desync=split:pos=1 --name=effective-late'), sourceFile: 'a.txt', sourceOrdinal: 4, sectionOrdinal: 2, effectiveOrdinal: 9 },
    { ...entry('effective-first', '--lua-desync=split:pos=1 --name=effective-first'), sourceFile: 'a.txt', sourceOrdinal: 4, sectionOrdinal: 2, effectiveOrdinal: 2 },
    { ...entry('section-first', '--lua-desync=split:pos=1 --name=section-first'), sourceFile: 'a.txt', sourceOrdinal: 4, sectionOrdinal: 1, effectiveOrdinal: 99 },
    { ...entry('source-first', '--lua-desync=split:pos=1 --name=source-first'), sourceFile: 'a.txt', sourceOrdinal: 3, sectionOrdinal: 99, effectiveOrdinal: 99 },
    { ...entry('other-source', '--lua-desync=split:pos=1 --name=other-source'), sourceFile: 'b.txt', sourceOrdinal: 0, sectionOrdinal: 0, effectiveOrdinal: 0 },
  ];
  const ids = candidates.map(candidate => candidate.id);
  const sets = { tcp: { quick: ids, standard: ids, full: ids }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full'))}, ${JSON.stringify(snapshot(candidates, sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId),
	['source-first', 'section-first', 'effective-first', 'effective-late', 'other-source']);
});

test('self-rehashing forged catalog, user, or generator contents does not confer authority', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const trusted = snapshot([item], sets, { policy: { useGenerated: true }, generator: generatedInput([{ id: 'gen', protocol: 'tcp', args: '--filter-tcp=443' }]) });
  const forgedCatalog = { ...trusted, winners: { one: { ...item, args: '--filter-tcp=80' } } };
  const forgedCatalogDigest = invoke(`planner.scanner_snapshot_digest(${JSON.stringify(forgedCatalog)})`);
  forgedCatalog.authority = { ...trusted.authority, catalogEnvelopeDigest: forgedCatalogDigest,
    catalog: { ...trusted.authority.catalog, catalogEnvelopeDigest: forgedCatalogDigest } };
  const forgedUsers = users([{ id: 'u', revision: 1, name: 'u', origin: 'user', profiles: [{ id: 'p', args: '--filter-tcp=443', enabled: true }] }]);
  forgedUsers.strategies[0].profiles[0].args = '--filter-tcp=80';
  forgedUsers.authority.recordsDigest = invoke(`planner.scanner_records_digest(${JSON.stringify(forgedUsers.strategies)})`);
  const forgedGenerator = structuredClone(trusted);
  forgedGenerator.generator.candidates[0].strategy.profiles[0].args = '--filter-tcp=80';
  forgedGenerator.generator.authority.recordsDigest = invoke(`planner.scanner_records_digest(${JSON.stringify(forgedGenerator.generator.candidates)})`);
  for (const [catalog, userRecords] of [[forgedCatalog, users()], [trusted, forgedUsers], [forgedGenerator, users()]]) {
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(catalog)}, ${JSON.stringify(userRecords)})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  }
});

test('dependency closure rejects missing extras, duplicate keys, and non-canonical missing order', () => {
  const sets = { tcp: { quick: [], standard: [], full: [] }, udp: { quick: [], standard: [], full: [] } };
  snapshot([], sets);
  const base = {
    scannerId: 'generated:one', identityKind: 'generated', strategyId: null, strategyRevision: null,
    source: 'generator', sourcePath: 'generator', protocol: 'tcp', catalogDigest: CATALOG_DIGEST,
    compilerDigest: COMPILER_DIGEST, compiledTokens: ['--filter-tcp=443'], ordinal: 1,
    complexity: [0, 0, 0], recommended: false, fullPreset: true, saveRequired: true,
  };
  const unavailable = key => ({ key, kind: 'function', id: key, reference: key, available: false, reason: 'missing' });
  const cases = [
    { available: false, items: [unavailable('a')], missing: [unavailable('a'), unavailable('extra')], structurallyCompilable: true },
    { available: false, items: [unavailable('a'), unavailable('a')], missing: [unavailable('a')], structurallyCompilable: true },
    { available: false, items: [unavailable('a'), unavailable('b')], missing: [unavailable('b'), unavailable('a')], structurallyCompilable: true },
  ];
  for (const dependencyClosure of cases) {
    const result = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify({ ...base, dependencyClosure })}, ${JSON.stringify(users())})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EINPUT');
  }
});

test('target profile must be request-bound, not only share its primary host', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const base = snapshot([item], sets);
  for (const targetProfile of [
    { ...base.targetProfile, testHosts: ['unrelated.example', 'example.com'] },
    { ...base.targetProfile, probeUrl: 'https://unrelated.example/' },
  ]) {
    const forged = { ...base, targetProfile };
    const envelopeDigest = invoke(`planner.scanner_snapshot_digest(${JSON.stringify(forged)})`);
    forged.authority = { ...base.authority, catalogEnvelopeDigest: envelopeDigest,
      catalog: { ...base.authority.catalog, catalogEnvelopeDigest: envelopeDigest } };
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(forged)}, ${JSON.stringify(users())})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  }
});

test('catalog, policy, profile, environment, generator, and user record contents are digest-bound', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const trusted = snapshot([item], sets, { compilerEnvironment: { listMode: 'none' } });
  const trustedUsers = users([{ id: 'u', revision: 1, name: 'u', origin: 'user', profiles: [{ id: 'p', args: '--filter-tcp=443', enabled: true }] }]);
  const cases = [
    { catalog: { ...trusted, winners: { one: { ...item, args: '--filter-tcp=80' } } }, users: trustedUsers },
    { catalog: { ...trusted, policy: { useGenerated: true } }, users: trustedUsers },
    { catalog: { ...trusted, targetProfile: { ...trusted.targetProfile, probeUrl: 'https://evil.example/' } }, users: trustedUsers },
    { catalog: { ...trusted, compilerEnvironment: { listMode: 'hostlist' } }, users: trustedUsers },
    { catalog: trusted, users: { ...trustedUsers, strategies: [{ ...trustedUsers.strategies[0], name: 'replaced' }] } },
  ];
  for (const value of cases) {
    const result = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(value.catalog)}, ${JSON.stringify(value.users)})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EVERIFY');
  }
});

test('generated records are digest-bound and DPI filtering preserves Avatar trick exceptions', () => {
  const entries = [
    { ...entry('pure-split', '--lua-split=pos=1'), level: 'advanced' },
    { ...entry('pure-oob', '--oob=1'), level: 'advanced' },
    { ...entry('basic-trick', '--lua-desync=pass --comment=basic'), level: 'basic', sourceFile: 'basic/tcp.txt' },
    entry('irrelevant', '--lua-desync=pass'),
  ];
  const sets = { tcp: { quick: entries.map(x => x.id), standard: entries.map(x => x.id), full: entries.map(x => x.id) }, udp: { quick: [], standard: [], full: [] } };
  const base = snapshot(entries, sets, { policy: { useGenerated: true }, generator: generatedInput([{ id: 'gen', protocol: 'tcp', args: '--filter-l7=tls --lua-desync=fake' }]) });
  const forged = { ...base, generator: { ...base.generator, candidates: [{ ...base.generator.candidates[0], id: 'replaced' }] } };
  const rejected = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(forged)}, ${JSON.stringify(users())})`);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EVERIFY');
  const filtered = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick', 'tcp', 'tls_dpi'))}, ${JSON.stringify(snapshot(entries, sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(filtered.candidates.map(x => x.strategyId), ['pure-oob', 'pure-split', 'basic-trick']);
});

test('final ordinals are contiguous after authoritative-order deduplication', () => {
  const first = { ...entry('z-section', '--filter-tcp=443 --name=same'), sourceFile: 'a.txt', sourceOrdinal: 20, effectiveOrdinal: 9 };
  const second = { ...entry('a-section', '--filter-tcp=443 --name=other'), sourceFile: 'a.txt', sourceOrdinal: 10, effectiveOrdinal: 3 };
  const sets = { tcp: { quick: ['z-section', 'a-section'], standard: ['z-section', 'a-section'], full: ['z-section', 'a-section'] }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full'))}, ${JSON.stringify(snapshot([first, second], sets))}, ${JSON.stringify(users())})`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId), ['a-section', 'z-section']);
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
  assert.equal(result.error.code, 'EVERIFY');
});
