import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Requirement mapping contract (requirement-based compatibility):
//   Z2K_TLS_MOD is required ONLY by strategies whose args actually use the
//   z2k_* TLS-mod token family. Stock tokens (rnd, rndsni, sni, dupsid,
//   padencap) are upstream-native and must NEVER require a native delta.
// The three historical engine patches are retired; ANTIDPI_REPEATS_LOOP and
// AUTO_FAMILY_SPLIT have NO strategy-level requirement (behavior preserved
// via manager-owned Lua sidecars).

const Z2K_TLS_TOKEN = /tls_mod=[^\s"']*z2k_(grease|alpn|psk|keyshare|earlydata|pha|sct|delegcred)/;

function corpus() {
  const corpusPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json');
  return JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
}

test('P3-Task 2: Strategies in corpus contain explicit machine-readable requirements', () => {
  for (const strategy of corpus().strategies) {
    assert.ok(strategy.requirements, `Strategy ${strategy.id} must declare requirements`);
    assert.ok(Array.isArray(strategy.requirements.engineCapabilities), `Strategy ${strategy.id} engineCapabilities must be array`);
    assert.ok(Array.isArray(strategy.requirements.luaFunctions), `Strategy ${strategy.id} luaFunctions must be array`);
    assert.ok(Array.isArray(strategy.requirements.blobs), `Strategy ${strategy.id} blobs must be array`);
    assert.ok(Array.isArray(strategy.requirements.luaFiles), `Strategy ${strategy.id} luaFiles must be array`);

    const pArgs = strategy.profiles[0].args;
    if (Z2K_TLS_TOKEN.test(pArgs)) {
      assert.ok(strategy.requirements.engineCapabilities.includes('Z2K_TLS_MOD'), `Strategy ${strategy.id} with z2k tls_mod must require Z2K_TLS_MOD`);
    }
    if (/z2k_quic_morph_v2/.test(pArgs)) {
      assert.ok(strategy.requirements.luaFunctions.includes('z2k_quic_morph_v2'), `Strategy ${strategy.id} with morph v2 must require z2k_quic_morph_v2`);
    }
  }
});

test('Z2K_TLS_MOD is never declared without actual z2k tls_mod token usage', () => {
  for (const strategy of corpus().strategies) {
    const pArgs = strategy.profiles.map(p => p.args || '').join(' ');
    const caps = strategy.requirements?.engineCapabilities || [];
    if (caps.includes('Z2K_TLS_MOD')) {
      assert.match(pArgs, Z2K_TLS_TOKEN, `Strategy ${strategy.id} over-declares Z2K_TLS_MOD`);
    }
    // retired capabilities must not reappear as requirements
    assert.ok(!caps.includes('ANTIDPI_REPEATS_LOOP') && !caps.includes('AUTO_FAMILY_SPLIT'),
      `Strategy ${strategy.id} declares a retired capability`);
  }
});
