import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P2-Task 1: z2k-modern-core.lua removes broken live_chance and sets ipfrag="" in profile 3', () => {
  const corePath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-modern-core.lua');
  assert.ok(fs.existsSync(corePath), 'z2k-modern-core.lua must exist');

  const content = fs.readFileSync(corePath, 'utf8');

  // Verify live_chance mutation is removed
  assert.doesNotMatch(content, /live_chance > 0 and math\.random/, 'live_chance mutation must be removed from live outgoing path');
  assert.match(content, /Never morph the LIVE outgoing packet/, 'Must contain rationale comment about RFC 9001 AEAD preservation');

  // Verify profile 3 has ipfrag = ""
  assert.match(content, /ipfrag\s*=\s*""/, 'Profile 3 must explicitly specify ipfrag = ""');

  // Verify z2k_nohost_key and z2k_game_udp are preserved
  assert.match(content, /function z2k_nohost_key/, 'z2k_nohost_key must be defined');
  assert.match(content, /function z2k_game_udp/, 'z2k_game_udp must be defined');
});
