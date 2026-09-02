import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = fs.readFileSync(path.join(ROOT, 'zapret2-manager/Makefile'), 'utf8');
const HARNESS = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh'), 'utf8');
const COMPILER = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compiler.uc'), 'utf8');

test('package ships the official compiler bridge with the required runtime modes', () => {
  assert.match(MAKEFILE, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
  assert.match(MAKEFILE, /chmod 0755 \$\(1\)\/usr\/libexec\/zapret2-manager\/\*\.sh/);
  assert.match(MAKEFILE, /chmod 0644 \$\(1\)\/usr\/libexec\/zapret2-manager\/\*\.uc/);
  assert.match(HARNESS, /create_default_strategy_files/);
  assert.doesNotMatch(HARNESS, /^[^#\r\n]*(?:install\.sh|service|iptables|nft\b|uci\b|reboot\b)/m);
  assert.match(COMPILER, /const DEFAULT_HARNESS = '\/usr\/libexec\/zapret2-manager\/z2k-official-compile\.sh'/);
  assert.match(COMPILER, /Z2K_NFQWS2_TEMPLATES=0/);
  assert.match(COMPILER, /ulimit -f 1024/);
});
