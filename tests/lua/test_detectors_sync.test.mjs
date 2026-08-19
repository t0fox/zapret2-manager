import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P1-Task 2: z2k-detectors.lua contains browser-cancel early return and QUIC video detectors', () => {
  const detPath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-detectors.lua');
  assert.ok(fs.existsSync(detPath), 'z2k-detectors.lua must exist');

  const content = fs.readFileSync(detPath, 'utf8');

  // Check browser-cancel return false
  assert.match(content, /if is_browser_cancel then[\s\S]*?return false[\s\S]*?else/m, 'is_browser_cancel branch must return false');

  // Check QUIC detectors
  assert.match(content, /function z2k_quic_success/, 'z2k_quic_success must be defined');
  assert.match(content, /function z2k_quic_stall/, 'z2k_quic_stall must be defined');
  assert.match(content, /Z2K_QUIC_SUCCESS_BYTES\s*=\s*24576/, 'Z2K_QUIC_SUCCESS_BYTES must be 24576');
});
