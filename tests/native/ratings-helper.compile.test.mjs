import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const ratingsHelper = './zapret2-manager/files/usr/libexec/zapret2-manager/ratings-helper.uc';

test('shipped ratings helper compiles with target ucode', () => {
  const compile = spawnSync('wsl.exe', [
    '-d', 'Ubuntu', '--cd', wslRoot, '--',
    'env', 'LD_LIBRARY_PATH=/opt/ucode/lib',
    '/opt/ucode/bin/ucode', '-c', '-o', '/dev/null', ratingsHelper
  ], { encoding: 'utf8' });

  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
});
