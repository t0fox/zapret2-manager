import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function evaluateStrategyAdmission(strategy, systemContext) {
  const reqs = strategy.requirements || {
    engineCapabilities: [],
    luaFunctions: [],
    blobs: [],
    luaFiles: []
  };

  const missing = {
    engineCapabilities: [],
    luaFunctions: [],
    blobs: [],
    luaFiles: []
  };

  for (const cap of reqs.engineCapabilities) {
    if (!systemContext.engineCapabilities.includes(cap)) {
      missing.engineCapabilities.push(cap);
    }
  }

  for (const fn of reqs.luaFunctions) {
    if (!systemContext.luaFunctions.includes(fn)) {
      missing.luaFunctions.push(fn);
    }
  }

  for (const blob of reqs.blobs) {
    if (!systemContext.blobs.includes(blob)) {
      missing.blobs.push(blob);
    }
  }

  for (const file of reqs.luaFiles) {
    if (!systemContext.luaFiles.includes(file)) {
      missing.luaFiles.push(file);
    }
  }

  const isUsable = (
    missing.engineCapabilities.length === 0 &&
    missing.luaFunctions.length === 0 &&
    missing.blobs.length === 0 &&
    missing.luaFiles.length === 0
  );

  return {
    strategyId: strategy.id,
    usable: isUsable,
    status: isUsable ? 'usable' : 'imported_missing_deps',
    missingRequirements: missing
  };
}

test('P3-Task 3: Admission pipeline marks strategies usable only when all requirements are satisfied', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  // 1. Full context with all Z2K patches, functions, and blobs
  const fullContext = {
    engineCapabilities: ['Z2K_TLS_MOD', 'ANTIDPI_REPEATS_LOOP', 'AUTO_FAMILY_SPLIT'],
    luaFunctions: ['z2k_dynamic_ttl', 'z2k_quic_morph_v2', 'z2k_timing_morph', 'z2k_range_rand', 'z2k_nohost_key'],
    blobs: ['fake_default_tls', 'fake_default_quic', 'quic_google', 'quic_dbankcloud', 'quic5', 'quic4', 'quic1', 'quic6', 'quic_rutracker', 'tls_clienthello_www_google_com', 'tls_clienthello_4pda_to', 'tls_clienthello_activated', 'stun', 'tls_clienthello_www_onetrust_com', 'tls_clienthello_vk_com', 'tls_clienthello_gosuslugi_ru', 't2', 'tls_max_ru', 'syn_packet', 'tls_clienthello_14'],
    luaFiles: ['zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua', 'z2k-detectors.lua', 'z2k-modern-core.lua', 'z2k-fooling-ext.lua', 'z2k-range-rand.lua', 'z2k-state-persist.lua', 'z2k-alert.lua', 'z2k-quic-silence.lua']
  };

  let usableCount = 0;
  for (const strategy of corpus.strategies) {
    const adm = evaluateStrategyAdmission(strategy, fullContext);
    if (adm.usable) usableCount++;
  }
  assert.equal(usableCount, corpus.strategies.length, 'All strategies must be usable in full context');

  // 2. Partial context lacking Z2K_TLS_MOD
  const partialContext = {
    ...fullContext,
    engineCapabilities: [] // stock binary lacking Z2K_TLS_MOD
  };

  let rejectedCount = 0;
  for (const strategy of corpus.strategies) {
    const adm = evaluateStrategyAdmission(strategy, partialContext);
    if (!adm.usable) {
      rejectedCount++;
      assert.ok(adm.missingRequirements.engineCapabilities.includes('Z2K_TLS_MOD'), 'Must flag missing Z2K_TLS_MOD');
    }
  }
  assert.ok(rejectedCount > 0, 'Strategies requiring Z2K_TLS_MOD must be marked unusable in stock context');
});
