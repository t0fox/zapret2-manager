import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy');
const INSTALLED_ROOT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'catalog', 'avatar');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
const expected = readFixture('manifest.expected.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function invokeCatalog(functionName, args = [], preloadRoot = null) {
  const preload = preloadRoot == null ? ''
    : `catalogModule.strategy_catalog_load(${JSON.stringify(preloadRoot)});`;
  const source = `import * as catalogModule from ${JSON.stringify(MODULE)}; ${preload} print(sprintf('%J', catalogModule.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
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
  const status = invokeCatalog('strategy_catalog_status', [], INSTALLED_ROOT);
  assert.equal(status.ok, true);
  assert.equal(status.digest, expected.aggregateDigest);
  assert.deepEqual(status.counts, {
    files: expected.physicalFileCount,
    physicalEntries: expected.physicalEntryCount,
    uniqueStrategies: expected.uniqueStrategyIdCount,
    duplicateGroups: expected.duplicateIdGroupCount,
  });
  assert.equal(status.source, INSTALLED_ROOT + '/manifest.json');
  const reloaded = invokeCatalog('strategy_catalog_reload', [], INSTALLED_ROOT);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.digest, loaded.aggregateDigest);
});
