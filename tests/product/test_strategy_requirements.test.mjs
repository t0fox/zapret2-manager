import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P3-Task 2: Strategies in corpus contain explicit machine-readable requirements', () => {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const corpus = JSON.parse(raw);

  for (const strategy of corpus.strategies) {
    assert.ok(strategy.requirements, `Strategy ${strategy.id} must declare requirements`);
    assert.ok(Array.isArray(strategy.requirements.engineCapabilities), `Strategy ${strategy.id} engineCapabilities must be array`);
    assert.ok(Array.isArray(strategy.requirements.luaFunctions), `Strategy ${strategy.id} luaFunctions must be array`);
    assert.ok(Array.isArray(strategy.requirements.blobs), `Strategy ${strategy.id} blobs must be array`);
    assert.ok(Array.isArray(strategy.requirements.luaFiles), `Strategy ${strategy.id} luaFiles must be array`);

    const pArgs = strategy.profiles[0].args;
    if (/tls_mod=|grease|alpn_flood/.test(pArgs)) {
      assert.ok(strategy.requirements.engineCapabilities.includes('Z2K_TLS_MOD'), `Strategy ${strategy.id} with tls_mod must require Z2K_TLS_MOD`);
    }
    if (/z2k_quic_morph_v2/.test(pArgs)) {
      assert.ok(strategy.requirements.luaFunctions.includes('z2k_quic_morph_v2'), `Strategy ${strategy.id} with morph v2 must require z2k_quic_morph_v2`);
    }
  }
});
