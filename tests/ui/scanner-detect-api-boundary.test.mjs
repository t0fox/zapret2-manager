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
    assert.match(api, new RegExp(`\\b${method}:calls\\.${method}`), `${method} must be exported to the Scanner context`);
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

test('Scanner evidence rendering is typed-only and fails closed for legacy-shaped reports', () => {
  const renderEvidence = scanner.slice(scanner.indexOf('function renderEvidence'), scanner.indexOf('function renderTypedResult'));
  assert.match(renderEvidence, /typedDetect\s*(!==|===|==)/,
    'evidence adapter must require the canonical typed Detect envelope');
  assert.doesNotMatch(renderEvidence, /reportRows|reportBest|finalists|topCandidates|ranked|working/,
    'legacy scanner-shaped evidence must not be rendered by the production adapter');
  const render = scanner.slice(scanner.indexOf('function render(ctx'), scanner.indexOf('function mount(ctx)'));
  assert.doesNotMatch(render, /Object\.keys\(report\)\.length\s*\?\s*renderEvidence/,
    'render must not route arbitrary non-typed reports to evidence rendering');
});

test('Scanner completion path declares a monotonic generation and disposed guard', () => {
  const run = scanner.slice(scanner.indexOf('function runDetect'), scanner.indexOf('function load(ctx)'));
  const start = scanner.slice(scanner.indexOf('function start(ctx'), scanner.indexOf('function renderEvidence'));
  assert.match(run, /generation|disposed/);
  assert.match(run, /state\.report|state\.status|rememberDetectResult/);
  assert.match(start, /generation|disposed/);
  assert.match(scanner, /state\.generation\+\+/,
    'unmount must invalidate in-flight Detect generations');
});
