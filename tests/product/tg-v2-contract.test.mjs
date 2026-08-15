import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const product = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');
const cli = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc'), 'utf8');

test('TG v2 has one canonical product schema and fixed provider ids', () => {
  assert.match(product, /const SCHEMA = 'tg-product\.v2'/);
  assert.match(product, /const IDS = \[ 'go', 'rust' \]/);
  for (const field of ['selected', 'installed', 'observed', 'status', 'sharedConfig', 'providerConfig', 'readiness', 'health']) {
    assert.match(product, new RegExp(`\\b${field}\\s*:`), `canonical state field ${field}`);
  }
  assert.match(product, /redacted: true/);
  assert.doesNotMatch(product, /latestVersion\s*:/, 'do not invent latest package versions in the read model');
});

test('TG v2 CLI exposes the complete canonical surface', () => {
  for (const mode of ['get', 'catalog', 'status', 'validate', 'preview', 'apply', 'health', 'check_updates', 'switch', 'install', 'update', 'remove', 'purge', 'start', 'stop', 'restart']) {
    assert.match(cli, new RegExp(`mode == ['"]${mode}['"]`), mode);
  }
});
