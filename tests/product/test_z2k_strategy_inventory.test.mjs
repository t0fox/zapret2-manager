import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P3-Task 1: Strategy inventory is built dynamically from pinned upstream and has exact pool counts', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  assert.ok(fs.existsSync(corpusPath), 'stressozz-corpus.json must exist');

  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  assert.ok(Array.isArray(corpus.strategies), 'corpus must have strategies array');
  assert.ok(corpus.pools, 'corpus must have pools dictionary');

  // Verify pool counts
  assert.equal(corpus.pools.rkn_tcp?.count, 50, 'rkn_tcp must have 50 strategies');
  assert.equal(corpus.pools.yt_tcp?.count, 22, 'yt_tcp must have 22 strategies');
  assert.equal(corpus.pools.gv_tcp?.count, 22, 'gv_tcp must have 22 strategies');
  assert.equal(corpus.pools.yt_quic?.count, 13, 'yt_quic must have 13 strategies');
  assert.equal(corpus.pools.discord_voice?.count, 12, 'discord_voice must have 12 strategies');

  const expectedTotal = 50 + 22 + 22 + 13 + 12;
  assert.equal(corpus.totalStrategies, expectedTotal, `Total strategies must equal ${expectedTotal}`);
  assert.equal(corpus.strategies.length, expectedTotal, `Strategy list length must equal ${expectedTotal}`);
});
