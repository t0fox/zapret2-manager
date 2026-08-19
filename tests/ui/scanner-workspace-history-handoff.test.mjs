import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const UI_DIR = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => fs.readFileSync(path.join(UI_DIR, name), 'utf8');

test('UI: Scanner Hub exports load, render, unmount lifecycle methods compatible with app.js', () => {
  const code = read('z2m-scanner-hub.js');
  
  assert.match(code, /load:\s*function/);
  assert.match(code, /render:\s*function/);
  assert.match(code, /unmount:\s*function|disposed\s*=\s*true/);
});

test('UI: callApi wraps blockcheckw, blockcheck2, and strategies with edit JSON serialization', () => {
  const code = read('z2m-scanner-hub.js');

  assert.match(code, /callApi|edit\(/);
  assert.match(code, /api\.blockcheckw/);
  assert.match(code, /api\.blockcheck2/);
  assert.match(code, /api\.strategies/);
});

test('UI: Handoff pipeline uses strict Canonical Strategy (authority strategy-handoff-v1, preview, validate, create)', () => {
  const code = read('z2m-scanner-hub.js');

  assert.match(code, /strategy-handoff-v1/);
  assert.match(code, /openHandoffModal/);
  assert.match(code, /saveHandoffStrategy/);
});
