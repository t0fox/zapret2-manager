import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc', 'utf8');

test('health matrix uses its own runner fingerprint for start and crash recovery', () => {
  assert.match(source, /job\.kind\s*==\s*['"]healthmatrix['"]\s*\?\s*['"]health-run\.sh['"]/);
  assert.match(source, /job\.runnerFingerprint\s*\|\|/);
  assert.match(source, /proc_alive\(job\.runnerPid,\s*runnerFingerprint\)/);
});
