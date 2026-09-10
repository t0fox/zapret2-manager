import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const view = name => fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager', name), 'utf8');

test('Dashboard domain status uses one bounded Z2K Detect measurement', () => {
  const source = view('z2m-overview.js');
  assert.match(source, /ctx\.api\.z2kDetectProbe/);
  assert.match(source, /z2kDetectProbe\(domain,\s*\d+\)/);
  assert.doesNotMatch(source, /totalTimeoutSec|maxAttempts|maxCandidates|candidateMode/);
});

test('Services status uses one bounded Z2K Detect probe per service', () => {
  const source = view('z2m-services.js');
  assert.match(source, /ctx\.api\.z2kDetectProbe/);
  assert.match(source, /z2kDetectProbe\(domain,\s*\d+\)/);
  assert.doesNotMatch(source, /totalTimeoutSec|maxAttempts|maxCandidates|candidateMode/);
});
