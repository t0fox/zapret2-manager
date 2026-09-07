import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const VIEW = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = name => fs.readFileSync(`${VIEW}/${name}`, 'utf8');
const api = read('z2m-api.js');
const scanner = read('z2m-scanner.js');
const product = read('z2m-scanner-product.js');

const methods = [
  ['status', 'z2kDetectStatus'],
  ['probe', 'z2kDetectProbe'],
  ['classify', 'z2kDetectClassify'],
  ['quic', 'z2kDetectQuic'],
  ['voice', 'z2kDetectVoice'],
  ['tcp16', 'z2kDetectTcp16'],
];

test('Scanner API surface contains exactly the canonical typed Detect methods', () => {
  assert.doesNotMatch(api, /scannerUnavailable|\bscanner\s*:/);
  for (const [rpc, method] of methods) {
    assert.match(api, new RegExp(`${method}:rpc\\.declare\\(\\{[^}]*method:'z2k_detect_${rpc}'`), method);
    assert.equal((api.match(new RegExp(`method:'z2k_detect_${rpc}'`, 'g')) || []).length, 1, `${rpc} RPC declaration`);
  }
});

test('Scanner production consumers have no legacy scanner API references', () => {
  for (const source of [scanner, product]) {
    assert.doesNotMatch(source, /ctx\.api\.scanner|\bapi\.scanner/);
    assert.doesNotMatch(source, /scanner_(start|status|results|stop|resume|save_generated|history_list|history_get)/);
  }
});

test('Scanner consumers call the typed Detect methods and retain canonical error normalization', () => {
  for (const [, method] of methods)
    assert.match(scanner + product, new RegExp(`ctx\\.api\\.${method}\\s*\\(`), method);
  assert.match(scanner, /normalizeError|errorText/);
  assert.match(product, /normalizeError/);
  assert.match(scanner + product, /EDETECT_(UNAVAILABLE|INCOMPATIBLE|TIMEOUT|FAILED|SCHEMA|NO_TARGET|NO_ACTIVE_VOICE)/);
});
