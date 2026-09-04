import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PREFLIGHT = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc');

test('native preflight batches runtime and Lua digest probes into bounded sha256sum calls', () => {
  const source = readFileSync(PREFLIGHT, 'utf8');

  assert.match(source, /function sha256_files\(paths\)/,
    'native preflight needs one bounded digest probe for a path set');
  assert.match(source, /sha256sum .*join\([^\n]*quoted/,
    'the digest probe must invoke sha256sum once for the quoted path set');
  assert.match(source, /sha256_files\(runtimePaths\)/,
    'runtime composition verification must use the batch probe');
  assert.match(source, /sha256_files\(luaPaths\)/,
    'Lua identity verification must use the batch probe');
  assert.doesNotMatch(source, /sha256_file\(entry\.path\)/,
    'per-asset shell process fan-out regresses rpcd native validation');
});
