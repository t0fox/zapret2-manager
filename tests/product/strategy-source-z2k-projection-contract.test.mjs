import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc', 'utf8');
const refresh = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc', 'utf8');
const generation = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc', 'utf8');

test('Z2K adapter projects standalone entries from the same official compile model', () => {
  assert.match(source, /standaloneCandidates/);
  assert.match(source, /entryKind:\s*'standalone'/);
  assert.match(source, /semanticDigest/);
  assert.match(source, /officialProfileIndex/);
  assert.match(source, /strategy_source_z2k_finalize_snapshot/);
  assert.doesNotMatch(source, /DISCORD_OFFICIAL_ARGS|SUPPORTED_POOL_ORDER/);
});

test('standalone publication is native-preflight gated and failures remain diagnostics', () => {
  assert.match(refresh, /native_preflight\(.*args/);
  assert.match(source, /standaloneDiagnostics/);
  assert.match(refresh, /strategy_source_z2k_finalize_snapshot/);
  assert.match(source, /status\s*==\s*['"]verified['"]/);
});

test('current Z2K snapshot validation requires one All-in-One and validates published standalones', () => {
  assert.match(generation, /entryKind\s*==\s*['"]all-in-one['"]/);
  assert.match(generation, /entryKind\s*==\s*['"]standalone['"]/);
  assert.match(generation, /nativeValidation/);
});

test('standalone inclusion does not depend on a fixed pool-name allowlist', () => {
  assert.doesNotMatch(source, /SUPPORTED_POOL_ORDER|DISCORD_OFFICIAL_ARGS|strategy=N/);
  assert.match(source, /for\s*\(let i = 0; i < length\(checked\.model\.profiles\)/);
});
