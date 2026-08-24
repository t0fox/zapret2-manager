import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy');
const INSTALLED_ROOT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'catalog', 'avatar');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const CATALOG_UC = MODULE;
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
const expected = readFixture('manifest.expected.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function temporaryCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-avatar-catalog-'));
  fs.cpSync(INSTALLED_ROOT, root, { recursive: true });
  return root;
}

function manifestPath(root) {
  return path.join(root, 'manifest.json');
}

function readManifest(root) {
  return JSON.parse(readFileSync(manifestPath(root), 'utf8'));
}

function writeManifest(root, manifest) {
  fs.writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

function recomputeAggregateDigest(manifest) {
  manifest.aggregateDigest = createHash('sha256').update(manifest.files
    .map(file => `${file.sha256}  catalogs/${file.path}\n`).join('')).digest('hex');
}

function invokeCatalog(functionName, args = [], preloadRoot = null, extraEnv = {}) {
  const preload = preloadRoot == null ? ''
    : `catalogModule.strategy_catalog_load(${JSON.stringify(preloadRoot)});`;
  const source = `import * as catalogModule from ${JSON.stringify(MODULE)}; ${preload} print(sprintf('%J', catalogModule.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
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

function invokeScript(script) {
  const source = `import * as catalogModule from ${JSON.stringify(MODULE)}; ${script}`;
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

function load(root = INSTALLED_ROOT) {
  const result = invokeCatalog('strategy_catalog_load', [root]);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.catalog;
}

test('runtime winner follows level/file/source/cache-key traversal', () => {
  const catalog = load();
  assert.deepEqual(catalog.winnerOrder.slice(0, 3), expected.winnerOrder.slice(0, 3));
  assert.equal(catalog.winners.z2k_all_in_one.winner, true);
  assert.equal(catalog.physicalEntries.length, 1836);
});

test('installed manifest provenance and inventory remain exact', () => {
  const catalog = load();
  assert.deepEqual(catalog.source, expected.source);
  assert.equal(catalog.aggregateDigest, expected.aggregateDigest);
  assert.equal(catalog.physicalFileCount, expected.physicalFileCount);
  assert.equal(catalog.physicalEntryCount, expected.physicalEntryCount);
  assert.equal(catalog.uniqueStrategyIdCount, expected.uniqueStrategyIdCount);
  assert.equal(catalog.duplicateIdGroupCount, expected.duplicateIdGroupCount);
  assert.deepEqual(catalog.levelEntryCounts, expected.levelEntryCounts);
  assert.deepEqual(catalog.protocolEntryCounts, expected.protocolEntryCounts);
  assert.deepEqual(catalog.featuredIds, expected.featuredIds);
  assert.deepEqual(catalog.files, expected.files.map(({ installed, ...file }) => file));
});

test('physical entries retain metadata, raw arguments, provenance, and duplicate winners', () => {
  const catalog = load();
  for (let index = 0; index < expected.physicalEntries.length; index++)
    assert.deepEqual(catalog.physicalEntries[index], expected.physicalEntries[index], `entry ${index}`);
  assert.deepEqual(digest(catalog.physicalEntries), digest(expected.physicalEntries));
  assert.deepEqual(catalog.duplicateGroups, expected.duplicateGroups);
  assert.deepEqual(catalog.winnerOrder, expected.winnerOrder);
  assert.equal(catalog.physicalEntries.filter(entry => entry.winner).length,
    expected.uniqueStrategyIdCount);
  assert.deepEqual(catalog.physicalEntries.map(entry => entry.sourceOrdinal),
    Array.from({ length: expected.physicalEntryCount }, (_, index) => index + 1));
  assert.deepEqual([...catalog.physicalEntries].sort((a, b) => a.cacheOrdinal - b.cacheOrdinal)
    .map(entry => entry.cacheOrdinal),
  Array.from({ length: expected.physicalEntryCount }, (_, index) => index + 1));
  const duplicate = catalog.physicalEntries.find(entry => entry.id === 'z2k_all_in_one');
  assert.equal(duplicate.cacheKey, 'builtin/tcp');
  assert.equal(typeof duplicate.rawArgs, 'string');
  assert.equal(typeof duplicate.args, 'string');
  assert.equal(typeof duplicate.metadata, 'object');
  assert.equal(typeof duplicate.sourceFile, 'string');
  assert.equal(typeof duplicate.sourceOrdinal, 'number');
  assert.equal(typeof duplicate.duplicateGroup, 'number');
  assert.equal(typeof duplicate.cacheOrdinal, 'number');
  assert.equal(typeof duplicate.effectiveOrdinal, 'number');
});

test('catalog filters WinDivert-only entries and infers only tcp or udp', () => {
  const catalog = load();
  assert.deepEqual(catalog.physicalEntries.map(entry => entry.protocol),
    expected.physicalEntries.map(entry => entry.protocol));
  assert.ok(catalog.physicalEntries.every(entry => ['tcp', 'udp'].includes(entry.protocol)));
  assert.ok(catalog.physicalEntries.every(entry => !entry.args.split('\n')
    .some(arg => /^--wf-(tcp|udp|raw|l3|ip)(?:=|$)/i.test(arg))));
});

test('catalog exposes exact protocol sets and lookup APIs', () => {
  const catalog = load();
  for (const protocol of ['tcp', 'udp']) {
    for (const set of ['quick', 'standard', 'full']) {
      assert.deepEqual(catalog[protocol][set], expected.sets[protocol][set]);
      assert.equal(new Set(catalog[protocol][set]).size, catalog[protocol][set].length);
    }
    assert.ok(catalog[protocol].quick.length <= 30);
    assert.ok(catalog[protocol].standard.length <= 80);
    assert.ok(catalog[protocol].full.every(id => catalog.winners[id].winner));
  }
  for (const id of expected.featuredIds) {
    const result = invokeCatalog('strategy_catalog_get', [id], INSTALLED_ROOT);
    assert.equal(result.id, id);
  }
  assert.deepEqual(invokeCatalog('strategy_catalog_list', ['tcp', 'quick'], INSTALLED_ROOT), expected.sets.tcp.quick
    .map(id => catalog.winners[id]));
});

test('catalog status and reload report the verified source', () => {
  const loaded = load();
  // status/reload resolve the system catalog root instead of using the in-process
  // load; point the resolver at the installed package root for this check.
  const resolverEnv = { Z2M_STRATEGY_CATALOG_ROOT: INSTALLED_ROOT };
  const status = invokeCatalog('strategy_catalog_status', [], INSTALLED_ROOT, resolverEnv);
  assert.equal(status.ok, true);
  assert.equal(status.digest, expected.aggregateDigest);
  assert.deepEqual(status.counts, {
    files: expected.physicalFileCount,
    physicalEntries: expected.physicalEntryCount,
    uniqueStrategies: expected.uniqueStrategyIdCount,
    duplicateGroups: expected.duplicateIdGroupCount,
  });
  assert.equal(status.source, INSTALLED_ROOT + '/manifest.json');
  const reloaded = invokeCatalog('strategy_catalog_reload', [], INSTALLED_ROOT, resolverEnv);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.digest, loaded.aggregateDigest);
});

test('rejects symlinked catalog roots and level directories before reading files', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-avatar-root-'));
  const rootLink = path.join(parent, 'root-link');
  fs.symlinkSync(INSTALLED_ROOT, rootLink, 'dir');
  try {
    const rootResult = invokeCatalog('strategy_catalog_load', [rootLink]);
    assert.equal(rootResult.ok, false);
    assert.equal(rootResult.error.code, 'EPATH');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }

  const root = temporaryCatalog();
  const levelTarget = path.join(root, 'advanced');
  fs.rmSync(levelTarget, { recursive: true, force: true });
  fs.symlinkSync(path.join(INSTALLED_ROOT, 'advanced'), levelTarget, 'dir');
  try {
    const levelResult = invokeCatalog('strategy_catalog_load', [root]);
    assert.equal(levelResult.ok, false);
    assert.equal(levelResult.error.code, 'EPATH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed, oversized, escaping, and hash-mismatched evidence', () => {
  const cases = [
    ['malformed manifest', root => fs.writeFileSync(manifestPath(root), '{'), 'EMANIFEST'],
    ['oversized manifest', root => fs.writeFileSync(manifestPath(root), 'x'.repeat(4 * 1024 * 1024 + 1)), 'EMANIFEST'],
    ['oversized file', root => fs.appendFileSync(path.join(root, 'direct', 'tcp.txt'), Buffer.alloc(4 * 1024 * 1024 + 1)), 'EFILE'],
    ['path escape', root => {
      const manifest = readManifest(root);
      manifest.files[0].path = 'advanced/../direct/tcp.txt';
      writeManifest(root, manifest);
    }, 'EMANIFEST'],
    ['file hash mismatch', root => {
      const manifest = readManifest(root);
      manifest.files[0].sha256 = '0'.repeat(64);
      writeManifest(root, manifest);
    }, 'EDIGEST'],
    ['physical ordinal mismatch', root => {
      const manifest = readManifest(root);
      manifest.physicalEntries[0].sourceOrdinal = 2;
      writeManifest(root, manifest);
    }, 'EORDINAL'],
  ];

  for (const [name, mutate, code] of cases) {
    const root = temporaryCatalog();
    try {
      mutate(root);
      const result = invokeCatalog('strategy_catalog_load', [root]);
      assert.equal(result.ok, false, name);
      assert.equal(result.error.code, code, name);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('rejects every tampered manifest declaration instead of reporting stale catalog state', () => {
  const mutations = [
    ['uniqueStrategyIdCount', manifest => { manifest.uniqueStrategyIdCount++; }],
    ['duplicateIdGroupCount', manifest => { manifest.duplicateIdGroupCount++; }],
    ['winnerOrder', manifest => { manifest.winnerOrder = [...manifest.winnerOrder].reverse(); }],
    ['sets', manifest => { manifest.sets.tcp.quick = [...manifest.sets.tcp.quick].reverse(); }],
    ['levelEntryCounts', manifest => { manifest.levelEntryCounts.advanced++; }],
    ['protocolEntryCounts', manifest => { manifest.protocolEntryCounts.tcp++; }],
    ['featuredIds', manifest => { manifest.featuredIds = []; }],
    ['physicalEntries', manifest => { manifest.physicalEntries[0].args = 'tampered'; }],
    ['duplicateGroups', manifest => { manifest.duplicateGroups[0].winner++; }],
  ];

  for (const [name, mutate] of mutations) {
    const root = temporaryCatalog();
    try {
      const manifest = readManifest(root);
      mutate(manifest);
      writeManifest(root, manifest);
      const result = invokeCatalog('strategy_catalog_load', [root]);
      assert.equal(result.ok, false, name);
      assert.equal(result.error.code, 'EDECLARATION', name);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('matches reference WinDivert line prefixes and preserves inline tokens', () => {
  const root = temporaryCatalog();
  try {
    const manifest = readManifest(root);
    const file = manifest.files[0];
    const target = path.join(root, ...file.path.split('/'));
    const original = readFileSync(target, 'utf8');
    const entry = manifest.physicalEntries[0];
    const prefixLine = '--WF-TCP=1 --payload=discarded';
    const inlineLine = '--payload=preserved --wf-tcp=inline';
    const replacement = `${prefixLine}\n${inlineLine}\n${entry.rawArgs}`;
    fs.writeFileSync(target, original.replace(entry.rawArgs, replacement));
    entry.rawArgs = replacement;
    entry.args = `${inlineLine}\n${entry.args}`;
    file.byteSize = fs.statSync(target).size;
    file.sha256 = sha256File(target);
    recomputeAggregateDigest(manifest);
    writeManifest(root, manifest);

    const result = invokeCatalog('strategy_catalog_load', [root]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const parsed = result.catalog.physicalEntries[0];
    assert.match(parsed.rawArgs, /^--WF-TCP=1 --payload=discarded\n/);
    assert.doesNotMatch(parsed.args, /--payload=discarded/);
    assert.match(parsed.args, /^--payload=preserved --wf-tcp=inline\n/);
    assert.match(parsed.args, /--wf-tcp=inline/);
    assert.match(parsed.args, /--lua-desync=/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed loads clear prior state and reload does not leak a previous catalog', () => {
  const good = temporaryCatalog();
  try {
    const bad = temporaryCatalog();
    try {
      const manifest = readManifest(bad);
      manifest.aggregateDigest = '0'.repeat(64);
      writeManifest(bad, manifest);
      const result = invokeScript(`let good = catalogModule.strategy_catalog_load(${JSON.stringify(good)}); let bad = catalogModule.strategy_catalog_load(${JSON.stringify(bad)}); let status = catalogModule.strategy_catalog_status(); print(sprintf('%J', { good: good.ok, bad: bad.ok, status: status.ok }));`);
      assert.deepEqual(result, { good: true, bad: false, status: false });
    } finally {
      fs.rmSync(bad, { recursive: true, force: true });
    }

    const reloadResult = invokeScript(`import { readfile, writefile } from 'fs'; let loaded = catalogModule.strategy_catalog_load(${JSON.stringify(good)}); let raw = readfile(${JSON.stringify(manifestPath(good))}); let manifest = json(raw); manifest.uniqueStrategyIdCount++; writefile(${JSON.stringify(manifestPath(good))}, sprintf('%J', manifest)); let reload = catalogModule.strategy_catalog_reload(); let status = catalogModule.strategy_catalog_status(); print(sprintf('%J', { loaded: loaded.ok, reload: reload.ok, status: status.ok }));`);
    assert.deepEqual(reloadResult, { loaded: true, reload: false, status: false });
  } finally {
    fs.rmSync(good, { recursive: true, force: true });
  }
});

test('catalog exposes conversion for a physical winner without changing its identity', () => {
  const catalog = load();
  const entry = catalog.winners.z2k_all_in_one;
  const result = invokeCatalog('catalog_entry_to_strategy', [entry]);
  assert.equal(result.id, entry.id);
  assert.equal(result.id, 'z2k_all_in_one');
  assert.equal(result.source, 'catalog');
  assert.equal(result.is_builtin, true);
  assert.equal(result.enabled, undefined);
  assert.equal(result.sourceFile, entry.sourceFile);
  assert.equal(result.sourceOrdinal, entry.sourceOrdinal);
  assert.deepEqual(result.profiles.map(profile => profile.enabled),
    Array.from({ length: result.profiles.length }, () => true));
});

test('catalog winner records retain the planner tie-breaker provenance fields', () => {
  const catalog = load();
  const entry = catalog.winners.split;
  assert.equal(typeof entry.sourceFile, 'string');
  assert.equal(typeof entry.sourceOrdinal, 'number');
  assert.equal(typeof entry.level, 'string');
  assert.equal(typeof entry.protocol, 'string');
  assert.equal(typeof entry.metadata, 'object');
  assert.equal(typeof entry.args, 'string');
  assert.equal(typeof entry.rawArgs, 'string');
});

test('catalog activation prepares the managed parent idempotently (mkdir -p)', () => {
  const source = fs.readFileSync(CATALOG_UC, 'utf8');
  // Real-router evidence: the package ships /etc/zapret2-manager/catalog, so a
  // plain mkdir failed with EEXIST and every managed update died with EWRITE
  // before touching the staged snapshot.
  assert.match(source, /mkdir -p .*\/etc\/zapret2-manager\/catalog/);
  assert.doesNotMatch(source, /command_rc\('mkdir ' \+ shell_quote\('\/etc\/zapret2-manager\/catalog'\)\)/);
});

test('catalog activation prepares the managed parent idempotently (mkdir -p)', () => {
  // Real-router evidence: the package ships /etc/zapret2-manager/catalog, so a
  // plain mkdir failed with EEXIST and every managed update died with EWRITE
  // before touching the staged snapshot.
  const source = fs.readFileSync(CATALOG_UC, 'utf8');
  assert.match(source, /command_rc\('mkdir -p ' \+ shell_quote\('\/etc\/zapret2-manager\/catalog'\)\)/);
  assert.doesNotMatch(source, /command_rc\('mkdir ' \+ shell_quote\('\/etc\/zapret2-manager\/catalog'\)\)/);
});
