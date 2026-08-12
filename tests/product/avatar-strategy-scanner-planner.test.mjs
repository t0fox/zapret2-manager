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
    sourceOrdinal: 1, metadata: { name: id, label: '', ...extra },
  };
}

function snapshot(entries, sets, extra = {}) {
  const winners = Object.fromEntries(entries.map(item => [item.id, item]));
  return {
    aggregateDigest: 'catalog-digest', compilerDigest: 'compiler-digest',
    policy: { useGenerated: false }, winners, sets,
    winnerOrder: entries.map(item => item.id),
    ...extra,
  };
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
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(all, sets))}, [])`).plan;
  assert.deepEqual(plan.candidates.map(item => item.strategyId), [
    ...full.slice(0, 10).map(item => item.id).sort(), ...tail.map(item => item.id),
  ]);
  assert.equal(plan.catalogDigest, 'catalog-digest');
  assert.equal(plan.compilerDigest, 'compiler-digest');
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
  const standard = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${data}, [])`).plan;
  assert.deepEqual(standard.candidates.slice(0, 20).map(item => item.strategyId),
    tcp.slice(0, 20).map(item => item.id).sort());
  const fullUdp = invoke(`planner.scanner_plan_build(${JSON.stringify(request('full', 'udp'))}, ${data}, [])`).plan;
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
    policy: { useGenerated: true }, generatedCandidates: generated,
  }));
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'tls_dpi'))}, ${data}, [])`).plan;
  assert.deepEqual(plan.candidates.map(item => item.strategyId || item.scannerId), ['tls-one', 'generated:gen-keep']);
  const skipped = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'dns_fake'))}, ${data}, [])`).plan;
  assert.deepEqual(skipped.candidates, []);
  const unknown = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard', 'tcp', 'vendor_block_v1'))}, ${data}, [])`).plan;
  assert.deepEqual(unknown.candidates.map(item => item.strategyId || item.scannerId), ['tls-one', 'generated:gen-keep', 'generated:gen-drop']);
});

test('normalized compiled-token and dependency closure dedup keeps the catalog identity', () => {
  const item = entry('catalog-one', '--filter-tcp=443 --lua-desync=multisplit:pos=1');
  const sets = { tcp: { quick: ['catalog-one'], standard: ['catalog-one'], full: ['catalog-one'] }, udp: { quick: [], standard: [], full: [] } };
  const data = snapshot([item], sets, {
    policy: { useGenerated: true },
    generatedCandidates: [{ id: 'same-generated', protocol: 'tcp', args: '  --filter-tcp=443\t--lua-desync=multisplit:pos=1  ' }],
  });
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('standard'))}, ${JSON.stringify(data)}, [])`).plan;
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
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot(candidates, sets))}, [])`).plan;
  assert.deepEqual(plan.candidates.map(candidate => candidate.strategyId), [
    'recommended-a', 'recommended-b', 'recommended-z', 'recommended-simple', 'normal',
  ]);
});

test('planner binds provenance, normalized compiled tokens, dependency closure, and ordinals', () => {
  const item = entry('one', '--filter-tcp=443');
  const sets = { tcp: { quick: ['one'], standard: ['one'], full: ['one'] }, udp: { quick: [], standard: [], full: [] } };
  const plan = invoke(`planner.scanner_plan_build(${JSON.stringify(request('quick'))}, ${JSON.stringify(snapshot([item], sets))}, [])`).plan;
  const candidate = plan.candidates[0];
  assert.deepEqual(Object.keys(candidate).sort(), [
    'compiledDigest', 'compiledTokens', 'complexity', 'dependencyClosure',
    'dependencyDigest', 'fullPreset', 'identityKind', 'ordinal', 'protocol',
    'recommended', 'saveRequired', 'scannerId', 'source', 'sourcePath',
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

test('canonicalization maps only exact normalized compiled tokens and dependency closure', () => {
  const exact = {
    scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null,
    strategyRevision: null, source: 'generator', sourcePath: 'generator', protocol: 'tcp',
    compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=1'],
    dependencyClosure: { available: true, items: [{ key: 'function:multisplit', available: true }], missing: [], structurallyCompilable: true },
    ordinal: 1, complexity: [1, 0, 0], recommended: false, fullPreset: false, saveRequired: true,
  };
  const existing = [{
    id: 'user-one', revision: 3, name: 'Generated display name', profiles: [],
    compiledTokens: [...exact.compiledTokens], dependencyClosure: JSON.parse(JSON.stringify(exact.dependencyClosure)),
  }];
  const canonical = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(exact)}, ${JSON.stringify(existing)})`);
  assert.deepEqual(canonical, { identityKind: 'canonicalized', strategyId: 'user-one', strategyRevision: 3, saveRequired: false });

  for (const changed of [
    { ...exact, scannerId: 'generated:user-one' },
    { ...exact, compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=2'] },
    { ...exact, compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=1'], dependencyClosure: { ...exact.dependencyClosure, items: [] } },
  ]) {
    const result = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(changed)}, ${JSON.stringify(existing)})`);
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
  const existing = [{ id: 'display-name-match', revision: 1, name: 'gen-one', compiledTokens: ['--filter-tcp=80'], dependencyClosure: candidate.dependencyClosure }];
  const mismatch = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify(candidate)}, ${JSON.stringify(existing)})`);
  assert.equal(mismatch.strategyId, null);
  assert.equal(mismatch.saveRequired, true);
  const rejected = invoke(`planner.scanner_candidate_canonicalize(${JSON.stringify({ ...candidate, args: '--filter-tcp=443' })}, [])`);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EINPUT');
});
