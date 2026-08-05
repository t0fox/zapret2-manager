import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const backend = read('zapret2-manager/Makefile');
const luci = read('luci-app-zapret2-manager/Makefile');

test('backend package requires a real flock implementation', () => {
  assert.match(backend, /\bDEPENDS:=[^\n]*\+flock\b/);
});

test('package lifecycle scripts are image-builder safe', () => {
  for (const [name, source] of [['backend', backend], ['luci', luci]]) {
    assert.match(source, /IPKG_INSTROOT/, `${name} checks IPKG_INSTROOT`);
    assert.match(source, /\[\s+-n\s+"\$\$\{IPKG_INSTROOT:-\}"\s+\]\s+&&\s+exit\s+0/,
      `${name} exits before target runtime actions`);
  }
});

test('LuCI package ships authoritative local CSS without build-time imports', () => {
  assert.doesNotMatch(luci, /@import|z2m-holyversion\.css/);
  assert.match(luci, /wildcard .*zapret2-manager\/\*\.css/);
});

test('backend package installs only its version-controlled runtime tree', () => {
  assert.match(backend, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
  assert.doesNotMatch(backend, /(?:tests|docs|artifacts|\.git)\//);
});
