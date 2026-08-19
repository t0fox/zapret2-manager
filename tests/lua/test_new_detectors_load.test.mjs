import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P1-Task 3: z2k-alert.lua and z2k-quic-silence.lua exist and export detectors', () => {
  const alertPath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-alert.lua');
  const silencePath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-quic-silence.lua');

  assert.ok(fs.existsSync(alertPath), 'z2k-alert.lua must exist');
  assert.ok(fs.existsSync(silencePath), 'z2k-quic-silence.lua must exist');

  const alertContent = fs.readFileSync(alertPath, 'utf8');
  assert.match(alertContent, /function z2k_alert_detector/, 'z2k-alert.lua must define z2k_alert_detector');

  const silenceContent = fs.readFileSync(silencePath, 'utf8');
  assert.match(silenceContent, /function z2k_quic_silence_detector/, 'z2k-quic-silence.lua must define z2k_quic_silence_detector');
});
