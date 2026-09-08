import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viewDir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');

function loadScanner() {
  const source = fs.readFileSync(path.join(viewDir, 'z2m-scanner.js'), 'utf8')
    .replace('return baseclass.extend(', 'globalThis.__module = baseclass.extend(');
  const context = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    Date,
    JSON,
    URL,
    Promise,
    isFinite,
    console,
    _:(value) => value,
    baseclass: { extend: (value) => value },
    Icons: { wrappedNode: () => null },
    window: { setTimeout },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'z2m-scanner.js' });
  return context.__module;
}

const scanner = loadScanner();

test('Scanner maps every user action to the corresponding typed Detect RPC', () => {
  const calls = [];
  const api = {};
  for (const operation of ['Probe', 'Classify', 'Quic', 'Voice', 'Tcp16']) {
    api[`z2kDetect${operation}`] = (...args) => {
      calls.push([operation.toLowerCase(), args]);
      return { ok: true, operation };
    };
  }
  const ctx = { api };
  const args = {
    probe: { domain: 'example.com', timeoutMs: 6000 },
    classify: { host: 'example.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000 },
    quic: { domain: 'example.com', port: 443, repeats: 2, timeoutMs: 6000 },
    voice: { repeats: 2, timeoutMs: 6000 },
    tcp16: { timeoutMs: 6000 }
  };
  for (const operation of ['probe', 'classify', 'quic', 'voice', 'tcp16']) {
    scanner.detectInvoke(ctx, operation, args[operation]);
  }

  assert.deepEqual(calls.map(([operation]) => operation), ['probe', 'classify', 'quic', 'voice', 'tcp16']);
  assert.deepEqual(calls[0][1], ['example.com', 6000]);
  assert.deepEqual(calls[1][1], ['example.com', 443, 'both', 2, 6000]);
  assert.deepEqual(calls[2][1], ['example.com', 443, 2, 6000]);
  assert.deepEqual(calls[3][1], [2, 6000]);
  assert.deepEqual(calls[4][1], [6000]);
});

test('Scanner action normalization never falls back to the retired planner', () => {
  assert.equal(scanner.detectOperation({ operation: 'classify', protocol: 'tcp' }), 'classify');
  assert.equal(scanner.detectOperation({ operation: 'quic', protocol: 'tcp' }), 'quic');
  assert.equal(scanner.detectOperation({ operation: 'unknown', protocol: 'tcp' }), 'probe');
});

test('Scanner maps canonical Detect errors and preserves their code', () => {
  const ctx = { api: { normalizeError: () => ({ message: 'normalized' }) } };
  const schemaError = scanner.normalizeDetectError(ctx, { error: { code: 'EDETECT_SCHEMA', message: 'bad JSON' } }, 'EDETECT_FAILED');
  assert.equal(schemaError.code, 'EDETECT_SCHEMA');
  assert.equal(schemaError.message, 'bad JSON');
  assert.equal(schemaError.details, null);
  assert.equal(scanner.normalizeDetectError(ctx, { code: 'EOLD_SCANNER' }, 'EDETECT_FAILED').code, 'EDETECT_FAILED');
});

test('Scanner normalizes canonical autodiscovery status and exposes control mapping', () => {
  const ready = scanner.normalizeDiscoveryStatus({
    ok: true,
    schema: 1,
    enabled: true,
    running: true,
    dnsSource: 'auto',
    discoveredDomains: { count: 4, mtime: 123 }
  });
  const unavailable = scanner.normalizeDiscoveryStatus({
    ok: false,
    error: { code: 'EDETECT_UNAVAILABLE', message: 'Detect is absent' }
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.enabled, true);
  assert.equal(ready.running, true);
  assert.equal(ready.dnsSource, 'auto');
  assert.equal(ready.discoveredCount, 4);
  assert.equal(ready.discoveredMtime, 123);
  assert.equal(ready.error, null);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.error.code, 'EDETECT_UNAVAILABLE');
  assert.deepEqual(['enable', 'disable', 'restart'].map((action) => scanner.discoveryControlMethod(action)), [
    'z2kDetectDiscoveryEnable', 'z2kDetectDiscoveryDisable', 'z2kDetectDiscoveryRestart'
  ]);
});

test('typed API exposes the canonical autodiscovery status and controls', () => {
  const api = fs.readFileSync(path.join(viewDir, 'z2m-api.js'), 'utf8');
  for (const method of ['z2k_detect_discovery_status', 'z2k_detect_discovery_enable', 'z2k_detect_discovery_disable', 'z2k_detect_discovery_restart']) {
    assert.match(api, new RegExp(method));
  }
});

test('Scanner UI uses detection wording and removes legacy planner controls', () => {
  const scannerSource = fs.readFileSync(path.join(viewDir, 'z2m-scanner.js'), 'utf8');
  const productSource = fs.readFileSync(path.join(viewDir, 'z2m-scanner-product.js'), 'utf8');
  for (const action of ['probe', 'classify', 'quic', 'voice', 'tcp16']) assert.match(scannerSource, new RegExp(action));
  assert.match(scannerSource, /DETECT_FORMS/);
  assert.match(scannerSource, /Автоматическое обнаружение/);
  assert.doesNotMatch(scannerSource + productSource, /candidate.?count|planner.?complexity|legacy.?planner|Подбор стратегии и история проверок/i);
  assert.doesNotMatch(scannerSource + productSource, /scanner_worker|scanner_probe|scanner-planner|scanner-probes|BlockCheckW|blockcheck2/i);
});

test('Scanner UI keeps semantic form/error states and calm accessible motion rules', () => {
  const scannerSource = fs.readFileSync(path.join(viewDir, 'z2m-scanner.js'), 'utf8');
  const componentsCss = fs.readFileSync(path.join(viewDir, 'z2m-components.css'), 'utf8');
  const uiCss = fs.readFileSync(path.join(viewDir, 'z2m-ui.css'), 'utf8');

  assert.match(scannerSource, /attrs\.type = field === 'domain' \|\| field === 'host' \? 'url'/);
  assert.match(scannerSource, /name: 'detect-' \+ field/);
  assert.match(scannerSource, /autocomplete: 'off'/);
  assert.match(scannerSource, /role: 'alert'/);
  assert.match(scannerSource, /function formField\(label, control/);
  assert.match(componentsCss, /min-height:44px/);
  assert.match(componentsCss, /:focus-visible/);
  assert.match(componentsCss, /@media \(hover:hover\) and \(pointer:fine\)/);
  assert.match(componentsCss, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(componentsCss, /\.z2m-scanner-operations\{[^}]*grid-template-columns:repeat\(5/);
  assert.match(componentsCss, /\.z2m-scanner-operation:focus-visible/);
  assert.match(componentsCss, /\.z2m-scanner-operation:active\{transform:scale\(.97\)/);
  assert.doesNotMatch(componentsCss, /z2m-scanner-segmented/);
  assert.doesNotMatch(componentsCss + uiCss, /transition\s*:\s*all/);
  assert.doesNotMatch(componentsCss + uiCss, /scale\(0\)/);
});

test('Scanner renders exactly five explicit user operations without retired controls', () => {
  const scannerSource = fs.readFileSync(path.join(viewDir, 'z2m-scanner.js'), 'utf8');
  const labels = ['Проверка сайта', 'Анализ DPI', 'QUIC', 'Discord Voice', 'TCP16'];
  assert.match(scannerSource, /z2m-scanner-operations/);
  assert.match(scannerSource, /aria-pressed/);
  assert.match(scannerSource, /DETECT_ACTIONS\.map/);
  for (const label of labels) assert.match(scannerSource, new RegExp(label));
  assert.doesNotMatch(scannerSource, /detect-action-select|formField\(_\('Операция'\)/);
  assert.doesNotMatch(scannerSource, /Действие Detect|Быстро|Обычно|Тщательно|z2m-scanner-segmented|Протокол/);
});

test('Scanner gives Voice and TCP16 only their real inputs and actionable voice copy', () => {
  const scannerSource = fs.readFileSync(path.join(viewDir, 'z2m-scanner.js'), 'utf8');
  assert.match(scannerSource, /жив(ой|ого)\s+(голосовой|видеозвонок)|активн(ый|ого)\s+.*Discord/i);
  assert.match(scannerSource, /Подключитесь к голосовому каналу Discord и повторите проверку\./);
  assert.match(scannerSource, /voice: \{[^}]*fields: \['repeats', 'timeoutMs'\]/);
  assert.match(scannerSource, /tcp16: \{[^}]*fields: \['timeoutMs'\]/);
});

test('Scanner maps the no-active-voice code to the user next step while preserving the code', () => {
  const error = scanner.normalizeDetectError({}, { error: { code: 'EDETECT_NO_ACTIVE_VOICE', message: 'raw backend detail' } }, 'EDETECT_FAILED');
  assert.equal(error.code, 'EDETECT_NO_ACTIVE_VOICE');
  assert.equal(error.message, 'Подключитесь к голосовому каналу Discord и повторите проверку.');
});
