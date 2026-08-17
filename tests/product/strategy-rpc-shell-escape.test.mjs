import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');

test('Strategy RPC command builders retain the shared shell escaping helper', () => {
  const source = fs.readFileSync(RPC, 'utf8');
  const definition = source.indexOf('function shell_escape(value)');
  const firstUse = source.indexOf('shell_escape(');

  assert.notEqual(definition, -1, 'RPC backend must define shell_escape before building child commands');
  assert.ok(definition <= firstUse, 'shell_escape definition must precede its first use');
});
