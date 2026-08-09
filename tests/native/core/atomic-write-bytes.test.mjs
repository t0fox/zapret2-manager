import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceRoot = 'zapret2-manager/src/z2m-core-helper';
const temporaryRoot = mkdtempSync(join(tmpdir(), 'z2m-atomic-write-bytes-'));
const binary = join(temporaryRoot, 'atomic-write-bytes-link');

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

let jsonCFlags;

before(() => {
  const jsonC = spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' });
  assert.equal(jsonC.status, 0, jsonC.stderr);
  jsonCFlags = jsonC.stdout.trim().split(/\s+/);
});

function link() {
  return spawnSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-I', sourceRoot,
    'tests/native/core/atomic-write-bytes-link-fixture.c',
    `${sourceRoot}/atomic.c`,
    `${sourceRoot}/protocol.c`,
    `${sourceRoot}/errors.c`,
    `${sourceRoot}/roots.c`,
    `${sourceRoot}/paths.c`,
    `${sourceRoot}/files.c`,
    `${sourceRoot}/base64.c`,
    `${sourceRoot}/canonical.c`,
    ...jsonCFlags,
    '-o', binary,
  ], { encoding: 'utf8' });
}

test('shared atomic byte publication engine z2m_atomic_write_bytes() is a linkable production symbol', () => {
  const result = link();
  assert.equal(result.status, 0, result.stderr);
});
