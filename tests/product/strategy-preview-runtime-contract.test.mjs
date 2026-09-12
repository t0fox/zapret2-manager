import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourcePath = path.join(root, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'strategy-cli.uc');

test('strategy preview declares blob descriptor helper before synthetic runtime callers', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const declaration = source.indexOf('function add_live_blob_descriptor(');
  const firstCaller = source.indexOf('add_live_blob_descriptor(liveBlobs, fn);');

  assert.notEqual(declaration, -1, 'blob descriptor helper must remain part of the runtime compiler');
  assert.notEqual(firstCaller, -1, 'synthetic runtime must inventory installed blobs');
  assert.ok(declaration < firstCaller, 'UCode resolves this function in source order on the router');
});
