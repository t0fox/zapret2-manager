import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateStrategyAdmission } from './support/strategy-admission.mjs';

test('P3-Task 3: Production admission pipeline marks strategies usable only when all requirements are satisfied', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  // 1. Full context with all Z2K patches, functions, and blobs
  const fullContext = {
    engineCapabilities: ['Z2K_TLS_MOD', 'ANTIDPI_REPEATS_LOOP', 'AUTO_FAMILY_SPLIT'],
    luaFunctions: ['z2k_dynamic_ttl', 'z2k_quic_morph_v2', 'z2k_timing_morph', 'z2k_range_rand', 'z2k_nohost_key'],
    blobs: [
      'fake_default_tls', 'fake_default_quic', 'quic_google', 'quic_dbankcloud',
      'quic5', 'quic4', 'quic1', 'quic6', 'quic_rutracker',
      'tls_clienthello_www_google_com', 'tls_clienthello_4pda_to', 'tls_clienthello_activated',
      'stun', 'tls_clienthello_www_onetrust_com', 'tls_clienthello_vk_com',
      'tls_clienthello_gosuslugi_ru', 't2', 'tls_max_ru', 'syn_packet', 'tls_clienthello_14'
    ],
    luaFiles: [
      'zapret-lib.lua', 'zapret-antidpi.lua', 'zapret-auto.lua', 'z2k-detectors.lua',
      'z2k-modern-core.lua', 'z2k-fooling-ext.lua', 'z2k-range-rand.lua',
      'z2k-state-persist.lua', 'z2k-alert.lua', 'z2k-quic-silence.lua'
    ]
  };

  let usableCount = 0;
  for (const strategy of corpus.strategies) {
    const adm = evaluateStrategyAdmission(strategy, fullContext);
    if (adm.usable) {
      usableCount++;
      assert.equal(adm.status, 'usable');
      assert.equal(adm.stage, 'passed');
      assert.equal(adm.diagnostics.length, 0);
    }
  }
  assert.equal(usableCount, corpus.strategies.length, 'All strategies must pass admission in full context');

  // 2. Partial context lacking Z2K_TLS_MOD
  const partialContext = {
    ...fullContext,
    engineCapabilities: [] // stock binary lacking Z2K_TLS_MOD
  };

  let rejectedTlsModCount = 0;
  for (const strategy of corpus.strategies) {
    const adm = evaluateStrategyAdmission(strategy, partialContext);
    if (!adm.usable && adm.missingRequirements.engineCapabilities.includes('Z2K_TLS_MOD')) {
      rejectedTlsModCount++;
      assert.equal(adm.status, 'rejected_dependencies');
      assert.ok(adm.diagnostics.some(d => d.code === 'EENGINE_CAPABILITY_MISSING'));
    }
  }
  assert.ok(rejectedTlsModCount > 0, `Strategies requiring Z2K_TLS_MOD (${rejectedTlsModCount}) must be rejected in partial context`);
});
