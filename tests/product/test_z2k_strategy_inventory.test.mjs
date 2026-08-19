import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCorpus } from '../../tools/z2k-corpus-importer.mjs';

test('P3-Task 1: Strategy inventory is built dynamically from pinned upstream and matches committed corpus', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  assert.ok(fs.existsSync(corpusPath), 'stressozz-corpus.json must exist');

  const committedCorpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const dynamicCorpus = buildCorpus();

  // Assert schema and provenance
  assert.equal(committedCorpus.schema, dynamicCorpus.schema);
  assert.equal(committedCorpus.provenance.commit, dynamicCorpus.provenance.commit);

  // Assert pool structure and counts match dynamic parser output
  assert.deepEqual(Object.keys(committedCorpus.pools).sort(), Object.keys(dynamicCorpus.pools).sort());
  for (const poolKey of Object.keys(dynamicCorpus.pools)) {
    assert.equal(
      committedCorpus.pools[poolKey].count,
      dynamicCorpus.pools[poolKey].count,
      `Pool ${poolKey} count must match dynamic parser output`
    );
  }

  assert.equal(committedCorpus.totalStrategies, dynamicCorpus.totalStrategies);
  assert.equal(committedCorpus.strategies.length, dynamicCorpus.strategies.length);

  // Assert initial import safety invariant: strategies start unverified and non-usable
  for (const strat of committedCorpus.strategies) {
    assert.equal(strat.status, 'imported_unverified', `Strategy ${strat.id} must import as imported_unverified`);
    assert.equal(strat.usable, false, `Strategy ${strat.id} must import with usable=false until admission passes`);
  }

  console.log(`Dynamic Inventory Verification: ${dynamicCorpus.totalStrategies} strategies across ${Object.keys(dynamicCorpus.pools).length} pools verified against pinned upstream.`);
});
