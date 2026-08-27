import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const ownerPath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js',
);
const read = () => fs.readFileSync(ownerPath, 'utf8');

test('Strategy owner has lossless Visual/Code sync and backend Problems mapping', () => {
  const source = read();
  for (const marker of [
    'applyVisualEdits',
    'Nfqws2Ide.serializeProfile',
    'setValue(next, { preserveHistory: true })',
    'syncSource',
    'raw-only',
    'setBackendDiagnostics',
    'profileIndex',
    'line',
    'column',
    'offset',
    'path',
  ]) assert.ok(source.includes(marker), marker);
  assert.doesNotMatch(source, /from:\s*0,\s*to:\s*0/);
});

test('Strategy page keeps canonical validate/preview/save ownership', () => {
  const page = fs.readFileSync(path.join(
    root,
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js',
  ), 'utf8');
  for (const marker of [
    'strategies.validate',
    'strategies.preview',
    'strategies.create',
    'strategies.update',
    'collectEditor',
  ]) assert.ok(page.includes(marker), marker);
});
