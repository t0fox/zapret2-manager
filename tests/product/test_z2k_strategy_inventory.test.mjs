import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCorpus, PINNED_UPSTREAM } from '../../tools/z2k-corpus-importer.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const corpusPath = path.join(
  ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json',
);
const committedCorpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

test('committed corpus carries the pinned upstream provenance and schema', () => {
  assert.equal(committedCorpus.schema, 'zapret2-manager.strategy-corpus.v2');
  assert.equal(committedCorpus.provenance.upstream, PINNED_UPSTREAM.upstream);
  assert.equal(committedCorpus.provenance.commit, PINNED_UPSTREAM.commit);
  assert.equal(committedCorpus.provenance.tag, PINNED_UPSTREAM.tag);
});

test('committed corpus inventory is internally consistent', () => {
  assert.equal(committedCorpus.totalStrategies, committedCorpus.strategies.length);
  const byId = new Set(committedCorpus.strategies.map((s) => s.id));
  assert.equal(byId.size, committedCorpus.strategies.length, 'strategy ids must be unique');

  for (const [poolKey, pool] of Object.entries(committedCorpus.pools)) {
    assert.equal(
      pool.count,
      pool.strategies.length,
      `Pool ${poolKey} count must match its strategy id list`,
    );
    for (const id of pool.strategies) {
      assert.ok(byId.has(id), `Pool ${poolKey} references unknown strategy ${id}`);
      assert.equal(
        committedCorpus.strategies.find((s) => s.id === id).pool,
        poolKey,
        `Strategy ${id} must declare its owning pool ${poolKey}`,
      );
    }
  }
});

test('every committed strategy keeps the initial import safety invariant', () => {
  for (const strat of committedCorpus.strategies) {
    assert.equal(strat.status, 'imported_unverified', `Strategy ${strat.id} must import as imported_unverified`);
    assert.equal(strat.usable, false, `Strategy ${strat.id} must import with usable=false until admission passes`);
  }
});

test('dynamic buildCorpus against the pinned CI upstream stubs is deterministic and matches the stub contract', () => {
  const dynamicCorpus = buildCorpus(path.join(ROOT, 'upstreams/z2k'));
  assert.equal(dynamicCorpus.schema, committedCorpus.schema);
  assert.equal(dynamicCorpus.provenance.commit, committedCorpus.provenance.commit);

  // The CI upstream files are minimal stubs (see tests/product/z2k-upstream-ci-fixtures.test.mjs):
  // the three TCP pool markers parse without --lua-desync= slots and no QUIC or
  // Discord pools may be synthesized from them.
  assert.deepEqual(Object.keys(dynamicCorpus.pools).sort(), ['gv_tcp', 'rkn_tcp', 'yt_tcp']);
  for (const poolKey of ['rkn_tcp', 'yt_tcp', 'gv_tcp']) {
    assert.equal(dynamicCorpus.pools[poolKey].count, 0, `${poolKey} must stay empty against the CI stubs`);
  }
  assert.equal(dynamicCorpus.totalStrategies, 0);
  assert.deepEqual(dynamicCorpus.strategies, []);

  const repeat = buildCorpus(path.join(ROOT, 'upstreams/z2k'));
  assert.equal(repeat.totalStrategies, dynamicCorpus.totalStrategies);
  assert.deepEqual(Object.keys(repeat.pools).sort(), Object.keys(dynamicCorpus.pools).sort());
  assert.deepEqual(repeat.strategies, dynamicCorpus.strategies);
});
