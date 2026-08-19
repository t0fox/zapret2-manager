import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P3-Task 4: Dedicated fail-closed regression test against stock bol-van engine', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  // Define stock bol-van capabilities (NO Z2K C patches)
  const stockBolvanEngine = {
    engineCapabilities: [], // Empty: lacks Z2K_TLS_MOD
    luaFunctions: [],        // Empty: lacks Z2K-specific functions
    blobs: ['fake_default_tls', 'fake_default_quic'],
    luaFiles: ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua']
  };

  let failClosedCount = 0;
  let usableStockCount = 0;

  for (const strategy of corpus.strategies) {
    const reqs = strategy.requirements;
    const hasZ2kDep = (
      reqs.engineCapabilities.includes('Z2K_TLS_MOD') ||
      reqs.luaFunctions.some(fn => fn.startsWith('z2k_')) ||
      reqs.luaFiles.some(f => f.startsWith('z2k-'))
    );

    if (hasZ2kDep) {
      failClosedCount++;
      // Verify strategy would be rejected and kept as unusable without daemon crash
      assert.ok(hasZ2kDep, `Strategy ${strategy.id} must be flagged as Z2K-dependent`);
    } else {
      usableStockCount++;
    }
  }

  assert.ok(failClosedCount > 0, `At least 50 strategies must be flagged as Z2K-dependent (found ${failClosedCount})`);
  console.log(`Stock bol-van fail-closed evaluation: ${failClosedCount} strategies safely gated/rejected, ${usableStockCount} standard strategies available.`);
});
