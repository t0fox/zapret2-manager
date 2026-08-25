import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js', 'utf8');

test('Scanner handles ENOENT as transient running without legacy recordPending gaming', () => {
  assert.doesNotMatch(source, /MAX_STATUS_RETRIES\s*=\s*20/);
  assert.doesNotMatch(source, /recordPending/);
  assert.doesNotMatch(source, /failPending/);
  assert.doesNotMatch(source, /ignoreDataScanId/);
  assert.doesNotMatch(source, /Scanner record is unavailable/);
  assert.match(source, /ENOENT/);
  assert.match(source, /status:\s*'running',\s*phase:\s*'searching'/);
});

test('Scanner uses Avatar-style polling with 2000ms and updateUI/fetchStatus', () => {
  assert.match(source, /setInterval/);
  assert.match(source, /2000/);
  assert.match(source, /function fetchStatus/);
  assert.match(source, /function fetchResults/);
  assert.match(source, /function updateUI/);
  assert.match(source, /startPolling|stopPolling/);
  assert.doesNotMatch(source, /return refresh\(ctx\)\.then\(function \(\) \{[\s\S]{0,300}schedule\(ctx\);/);
});

test('Scanner start does not reuse stale identity and uses Avatar card layout', () => {
  assert.match(source, /scan-target/);
  assert.match(source, /scan-protocol/);
  assert.match(source, /scan-mode/);
  assert.match(source, /scan-btn-start/);
  assert.match(source, /state\.request/);
  assert.match(source, /target.*protocol.*mode/);
  assert.doesNotMatch(source, /function answerId/);
});

test('Scanner has no legacy test-gaming strings', () => {
  assert.doesNotMatch(source, /test contract compatibility/);
  assert.doesNotMatch(source, /legacy class kept/);
  assert.doesNotMatch(source, /\[object HTMLElement\]/);
  assert.doesNotMatch(source, /z2m-scanner-options/);
});

test('Scanner keeps non-ENOENT failures as application errors without RPC spam', () => {
  assert.match(source, /status:\s*'error'/);
  assert.doesNotMatch(source, /RPC недоступен/);
  assert.doesNotMatch(source, /Scanner record is unavailable/);
});
