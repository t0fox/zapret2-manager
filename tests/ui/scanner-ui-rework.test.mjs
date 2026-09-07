import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('Scanner renders typed Detect action controls and canonical error handling', () => {
  const source = read('z2m-scanner.js');
  for (const action of ['probe', 'classify', 'quic', 'voice', 'tcp16']) assert.match(source, new RegExp(action));
  assert.match(source, /Действие Detect/);
  assert.match(source, /Автоматическое обнаружение/);
  assert.match(source, /EDETECT_(?:FAILED|SCHEMA|INCOMPATIBLE)/);
  assert.doesNotMatch(source, /candidate.?count|planner.?complexity|legacy.?planner/i);
});

test('Scanner result and history are explicitly proven typed Detect results', () => {
  const scanner = read('z2m-scanner.js');
  const product = read('z2m-scanner-product.js');
  assert.match(scanner, /typedDetect/);
  assert.match(scanner, /z2k-detect/);
  assert.match(product, /DETECT_OPERATIONS/);
  assert.match(product, /z2k-detect/);
  assert.match(product, /Подробности проверки/);
});

test('Scanner UI does not contain retired Manager-owned scanner controls or fallback', () => {
  const source = read('z2m-scanner.js') + read('z2m-scanner-product.js');
  assert.doesNotMatch(source, /scanner_worker|scanner_probe|scanner-planner|scanner-probes|BlockCheckW|blockcheck2/i);
  assert.doesNotMatch(source, /candidate.?count|planner.?complexity|сложность/i);
});
