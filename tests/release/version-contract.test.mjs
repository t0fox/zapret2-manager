import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PACKAGE_FILES = {
  backend: 'zapret2-manager/Makefile',
  luci: 'luci-app-zapret2-manager/Makefile',
  full: 'zapret2-manager-full/Makefile'
};

function parseMakefile(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const version = source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1];
  const release = source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1];
  const depends = source.match(/\bDEPENDS\s*:?=\s*([^\n]+)/)?.[1] ?? '';
  assert.ok(version, `${relativePath} must define PKG_VERSION`);
  assert.ok(release, `${relativePath} must define PKG_RELEASE`);
  return { version, release, depends };
}

const packages = Object.fromEntries(
  Object.entries(PACKAGE_FILES).map(([name, file]) => [name, parseMakefile(file)])
);

test('all canonical manager packages share version and release identity', () => {
  assert.equal(new Set(Object.values(packages).map((item) => item.version)).size, 1);
  assert.equal(new Set(Object.values(packages).map((item) => item.release)).size, 1);
});

test('package dependency graph stays backend, LuCI, and target-specific meta only', () => {
  assert.match(packages.luci.depends, /\+zapret2-manager\b/);
  assert.match(packages.full.depends, /@TARGET_mediatek_filogic/);
  assert.match(packages.full.depends, /\+zapret2-manager\b/);
  assert.match(packages.full.depends, /\+luci-app-zapret2-manager\b/);
});
