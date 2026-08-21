import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js', 'utf8');

test('Scanner treats async record publication ENOENT as bounded starting state', () => {
  assert.match(source, /MAX_STATUS_RETRIES\s*=\s*20/);
  assert.match(source, /record is unavailable|ENOENT/);
  assert.match(source, /waiting-record/);
  assert.match(source, /statusRetries/);
  assert.match(source, /statusRetries\s*(?:<|>=)\s*MAX_STATUS_RETRIES/);
});

test('Scanner starts polling after refresh resolves with a not-yet-published record', () => {
  assert.match(source, /return refresh\(ctx\)\.then\(function \(\) \{[\s\S]{0,300}schedule\(ctx\);/);
});

test('Scanner recognizes wrapped record-publication errors without masking other failures', () => {
  assert.match(source, /JSON\.stringify\(raw\)/);
  assert.match(source, /Scanner record is unavailable/);
});

test('Scanner treats resolved ENOENT status payloads as pending records', () => {
  assert.match(source, /if \(recordPending\(status\)\)/);
  assert.match(source, /recordPending\(value\)[\s\S]{0,350}statusRetries/);
  assert.match(source, /return refresh\(ctx\)\.then\(function \(\) \{[\s\S]{0,500}schedule\(ctx\);/);
});

test('Scanner never reuses a previous scan identity for a rejected start', () => {
  assert.match(source, /function answerId\(value\)[\s\S]{0,220}object\(value\.record\)\.id\) \|\| null/);
  assert.match(source, /state\.scanId = null;[\s\S]{0,100}state\.error = null; state\.report = null; state\.status = \{ status: 'starting'/);
});

test('Scanner fails closed after the bounded record-publication wait', () => {
  assert.match(source, /function failPending\(ctx, value\)[\s\S]{0,220}state\.scanId = null;[\s\S]{0,160}state\.status = \{ status: 'error'/);
  assert.match(source, /MAX_STATUS_RETRIES/);
});

test('Scanner does not rehydrate a terminally failed identity from stale view data', () => {
  assert.match(source, /ignoreDataScanId/);
  assert.match(source, /!state\.ignoreDataScanId && ctx && ctx\.data && ctx\.data\.scanId/);
  assert.match(source, /state\.ignoreDataScanId = true/);
});

test('Scanner keeps non-ENOENT failures as application errors', () => {
  assert.match(source, /state\.error\s*=\s*error/);
  assert.match(source, /Проверка не завершена/);
});
