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
  return { scanner: context.__module, source };
}

const { scanner, source } = loadScanner();

test('Scanner exposes operation-specific Detect fields', () => {
  assert.deepEqual(Array.from(scanner.detectFields('probe')), ['domain', 'timeoutMs']);
  assert.deepEqual(Array.from(scanner.detectFields('classify')), ['host', 'port', 'hello', 'repeats', 'timeoutMs']);
  assert.deepEqual(Array.from(scanner.detectFields('quic')), ['domain', 'port', 'repeats', 'timeoutMs']);
  assert.deepEqual(Array.from(scanner.detectFields('voice')), ['repeats', 'timeoutMs']);
  assert.deepEqual(Array.from(scanner.detectFields('tcp16')), ['timeoutMs']);
});

test('Scanner descriptors own explicit defaults without shared protocol or depth state', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectDefaults('probe'))), { domain: 'youtube.com', timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectDefaults('classify'))), { host: 'youtube.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectDefaults('quic'))), { domain: 'youtube.com', port: 443, repeats: 2, timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectDefaults('voice'))), { repeats: 2, timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectDefaults('tcp16'))), { timeoutMs: 6000 });

  assert.doesNotMatch(source, /\bprotocol\b/);
  assert.doesNotMatch(source, /\bmode\b/);
  assert.doesNotMatch(source, /\bquick\b|\bstandard\b|\bfull\b/);
});

test('Scanner builds exact arguments for hostless Detect operations', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectArguments({ operation: 'voice' }))), { repeats: 2, timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectArguments({ operation: 'tcp16' }))), { timeoutMs: 6000 });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectArguments({ operation: 'classify' }))), {
    host: 'youtube.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000
  });
  assert.deepEqual(JSON.parse(JSON.stringify(scanner.detectArguments({ operation: 'quic' }))), {
    domain: 'youtube.com', port: 443, repeats: 2, timeoutMs: 6000
  });
});
