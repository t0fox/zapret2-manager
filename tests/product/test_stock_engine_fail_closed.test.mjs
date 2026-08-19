import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateStrategyAdmission } from './support/strategy-admission.mjs';

test('P3-Task 4: Dedicated fail-closed regression test running production admission against stock bol-van engine', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  // Stock bol-van engine environment (NO Z2K patches, NO Z2K Lua assets)
  const stockBolvanContext = {
    engineCapabilities: [], // Lacks Z2K_TLS_MOD
    luaFunctions: [],        // Lacks z2k_quic_morph_v2, z2k_dynamic_ttl, etc.
    blobs: ['fake_default_tls', 'fake_default_quic'],
    luaFiles: ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua']
  };

  let rejectedCount = 0;
  let admittedCount = 0;
  const rejectReasons = {
    missingCapabilities: 0,
    missingLuaFunctions: 0,
    missingBlobs: 0,
    missingLuaFiles: 0
  };

  for (const strategy of corpus.strategies) {
    const admission = evaluateStrategyAdmission(strategy, stockBolvanContext);

    if (!admission.usable) {
      rejectedCount++;
      assert.equal(admission.usable, false, `Strategy ${strategy.id} must be unusable on stock engine`);
      assert.equal(admission.status, 'rejected_dependencies');
      assert.ok(admission.diagnostics.length > 0, `Strategy ${strategy.id} must have diagnostic reject reasons`);

      if (admission.missingRequirements.engineCapabilities.length > 0) rejectReasons.missingCapabilities++;
      if (admission.missingRequirements.luaFunctions.length > 0) rejectReasons.missingLuaFunctions++;
      if (admission.missingRequirements.blobs.length > 0) rejectReasons.missingBlobs++;
      if (admission.missingRequirements.luaFiles.length > 0) rejectReasons.missingLuaFiles++;
    } else {
      admittedCount++;
      assert.equal(admission.status, 'usable');
      assert.equal(admission.diagnostics.length, 0);
    }
  }

  assert.equal(rejectedCount + admittedCount, corpus.totalStrategies, 'All corpus strategies must be classified');
  assert.ok(rejectedCount > 0, `At least some strategies must fail closed on stock engine (found ${rejectedCount} rejected)`);
  assert.ok(admittedCount > 0, `Standard stock-compatible strategies must remain usable (found ${admittedCount} usable)`);

  console.log(`=== STOCK BOL-VAN FAIL-CLOSED REGRESSION RESULTS ===`);
  console.log(`Total Evaluated: ${corpus.totalStrategies}`);
  console.log(`Rejected (Fail-Closed): ${rejectedCount}`);
  console.log(`Admitted (Stock-Compatible): ${admittedCount}`);
  console.log(`Reject Reason Breakdown:`);
  console.log(`  - Missing Engine Capabilities (Z2K_TLS_MOD): ${rejectReasons.missingCapabilities}`);
  console.log(`  - Missing Lua Functions (z2k_*): ${rejectReasons.missingLuaFunctions}`);
  console.log(`  - Missing Binary Blobs: ${rejectReasons.missingBlobs}`);
  console.log(`  - Missing Lua Assets: ${rejectReasons.missingLuaFiles}`);
  console.log(`====================================================`);
});
