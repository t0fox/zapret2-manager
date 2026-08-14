import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const compiler = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const ucode = process.env.UCODE_BIN;

test('Strategy compiler resolves asset references to server paths and stable dependency IDs', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const strategy = { id: 'asset-ref', name: 'asset ref', profiles: [{ id: 'p1', args: '--filter-tcp=443 --blob=payload:asset://blob/blob:test' }] };
  const environment = {
    paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/bin', listRoot: '/lists', ipsetRoot: '/lists' },
    assetRefs: { 'blob:test': { id: 'blob:test', type: 'blob', path: '/opt/zapret2/bin/test.bin', available: true, revision: 3, contentSha256: 'a'.repeat(64) } },
    blobs: {}, lua: {}, lists: {}, functions: {}, listMode: 'none',
  };
  const source = `import { strategy_compile } from ${JSON.stringify(compiler)}; print(sprintf('%J', strategy_compile(${JSON.stringify(strategy)}, ${JSON.stringify(environment)})));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH || process.env.LD_LIBRARY_PATH || '/opt/ucode/lib' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const compiled = JSON.parse(result.stdout);
  assert.equal(compiled.ok, true);
  assert.match(compiled.strategyArgs, /--blob=payload:\/opt\/zapret2\/bin\/test\.bin/);
  const dependency = compiled.dependencies.items.find((item) => item.kind === 'blob');
  assert.equal(dependency.id, 'blob:test');
  assert.equal(dependency.reference, 'payload');
  assert.equal(dependency.available, true);
});
