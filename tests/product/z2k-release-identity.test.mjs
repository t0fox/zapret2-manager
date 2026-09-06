import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const backend = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager');
const releaseModule = path.join(backend, 'z2k-release.uc');
const installed = fs.readFileSync(path.join(backend, 'z2k-installed-release.uc'), 'utf8');
const runtime = fs.readFileSync(path.join(backend, 'runtime-composition.uc'), 'utf8');
const versions = fs.readFileSync(path.join(backend, 'z2k-versions.uc'), 'utf8');
const ucode = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

function invoke(expression) {
  const source = `import * as release from ${JSON.stringify(releaseModule)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('shared release parser accepts both supported families and rejects malformed identities', () => {
  assert.deepEqual(invoke("release.z2k_release_parse('r-82.7')"), {
    version: 'r-82.7', family: 'r', major: 82, minor: 7,
  });
  assert.deepEqual(invoke("release.z2k_release_parse('p-82.14')"), {
    version: 'p-82.14', family: 'p', major: 82, minor: 14,
  });
  assert.equal(invoke("release.z2k_release_parse('x-82.14')"), null);
  assert.equal(invoke("release.z2k_release_parse('p-82.14.1')"), null);
});
test('installed and runtime authorities consume the shared release validator', () => {
  assert.match(installed, /import \{ z2k_release_parse, z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(runtime, /import \{ z2k_release_parse, z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(installed, /z2k_release_valid\(receipt\.version\)/);
  assert.match(runtime, /z2k_release_valid\(entry\.version\)/);
  assert.doesNotMatch(installed, /\/\^\[rp\]-\[0-9\]/);
  assert.doesNotMatch(runtime, /\/\^\[rp\]-\[0-9\]/);
});

test('catalog uses the shared parser and keeps manifest current as latest identity', () => {
  assert.match(versions, /import \{ z2k_release_parse, z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(versions, /value\.current/);
  assert.doesNotMatch(versions, /function parse_release\(/);
});
