import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const graph = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependencies.uc');
const upstream = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const classification = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));

test('classification publishes the explicit compiler-input dependency boundary', () => {
  assert.equal(classification.schema, 'zapret2-manager.z2k-integration.v2');
  assert.deepEqual(classification.compilerInputs.map(item => [item.sourcePath, item.class, item.required]), [
    ['strats_new2.txt', 'compiler-input', true],
    ['quic_strats.ini', 'compiler-input', true],
    ['lib/utils.sh', 'compiler-input', true],
    ['lib/strategies.sh', 'compiler-input', true],
    ['lib/config_official.sh', 'compiler-input', true],
  ]);
});

test('dependency graph derives consumed unknowns from local Registry ownership', () => {
  assert.match(graph, /asset_registry_list/);
  assert.match(graph, /unknown-consumed/);
  assert.match(graph, /registryAvailable/);
  assert.match(graph, /compilerInputs/);
  assert.match(graph, /runtimeExact/);
  assert.match(graph, /adapted/);
  assert.match(graph, /watched/);
  assert.match(graph, /ignored/);
});

test('planner separates advisory unknown-unconsumed files from blocking consumed dependencies', () => {
  assert.match(upstream, /reason: 'unknown-unconsumed'/);
  assert.match(upstream, /reason: 'unknown-consumed-dependency'/);
  assert.match(upstream, /unknownUnconsumed/);
  assert.match(upstream, /compilerInputs/);
  assert.match(upstream, /attentionState/);
  assert.match(upstream, /canApply/);
  assert.doesNotMatch(upstream, /Unknown future upstream file — fail closed into a blocking review/);
});

test('planner fails closed when the Asset Registry cannot prove ownership', () => {
  assert.match(upstream, /graph\.registryAvailable !== true/);
  assert.match(upstream, /dependency-registry-unavailable/);
  assert.match(upstream, /Asset Registry is unavailable/);
  assert.match(upstream, /policy: 'blocking'/);
});

test('runtime exact compatibility keeps old exact-managed records readable', () => {
  assert.match(graph, /item\.class == 'exact-managed'/);
  assert.match(upstream, /dependency_class\(historical\) != 'runtime-exact'/);
});
