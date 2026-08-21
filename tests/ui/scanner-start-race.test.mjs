import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js', 'utf8');

test('Scanner treats async record publication ENOENT as bounded starting state', () => {
  assert.match(source, /MAX_STATUS_RETRIES\s*=\s*20/);
  assert.match(source, /record is unavailable|ENOENT/);
  assert.match(source, /waiting-record/);
  assert.match(source, /statusRetries/);
  assert.match(source, /statusRetries\s*<\s*MAX_STATUS_RETRIES/);
});

test('Scanner keeps non-ENOENT failures as application errors', () => {
  assert.match(source, /state\.error\s*=\s*error/);
  assert.match(source, /Scanner recovery\/error/);
});
