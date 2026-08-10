import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'catalog', 'avatar');
const EXPECTED_MANIFEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy',
  'manifest.expected.json');
const PINNED_SHA = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const LEVELS = ['advanced', 'basic', 'builtin', 'direct'];

const makefile = fs.readFileSync(path.join(ROOT, 'zapret2-manager', 'Makefile'), 'utf8');
const expectedManifest = JSON.parse(fs.readFileSync(EXPECTED_MANIFEST_PATH, 'utf8'));

function readInstalledManifest() {
  return JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8'));
}

function block(name) {
  const match = new RegExp(`define ${name}\\n([\\s\\S]*?)\\nendef`).exec(makefile);
  assert.ok(match, `${name} must be defined`);
  return match[1];
}

function installedPath(relativePath) {
  return path.join(CATALOG_ROOT, ...relativePath.split('/'));
}

test('package source contains every pinned Avatar catalog file', () => {
  const manifest = readInstalledManifest();
  assert.equal(manifest.source.repository, 'avatarDD/zapret-gui');
  assert.equal(manifest.source.commit, PINNED_SHA);
  assert.equal(manifest.physicalFileCount, 23);
  assert.deepEqual(
    manifest.files.map(({ installed, ...file }) => file),
    expectedManifest.files,
    'installed manifest must preserve the audited Task 1 file records',
  );
  for (const file of manifest.files) assert.equal(file.installed, true);
});

test('package manifest and raw files remain byte-identical to pinned evidence', () => {
  const manifest = readInstalledManifest();
  assert.equal(manifest.aggregateDigest, expectedManifest.aggregateDigest);
  assert.equal(manifest.aggregateDigestAlgorithm, expectedManifest.aggregateDigestAlgorithm);
  assert.deepEqual(manifest.physicalEntries, expectedManifest.physicalEntries);
  assert.deepEqual(manifest.duplicateGroups, expectedManifest.duplicateGroups);
  assert.deepEqual(manifest.winnerOrder, expectedManifest.winnerOrder);
  assert.deepEqual(manifest.sets, expectedManifest.sets);

  for (const file of expectedManifest.files) {
    const asset = installedPath(file.path);
    assert.equal(fs.statSync(asset).isFile(), true, file.path);
    assert.equal(fs.statSync(asset).mode & 0o777, 0o644, `${file.path} mode`);
    assert.equal(fs.statSync(asset).size, file.byteSize, `${file.path} byte size`);
    assert.equal(
      createHash('sha256').update(fs.readFileSync(asset)).digest('hex'),
      file.sha256,
      file.path,
    );
  }
});

test('package inventory has exactly the four pinned catalog levels', () => {
  const entries = fs.readdirSync(CATALOG_ROOT, { withFileTypes: true });
  assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), LEVELS);
  assert.deepEqual(entries.filter(entry => entry.isFile()).map(entry => entry.name).sort(), ['manifest.json']);
  assert.equal(fs.existsSync(path.join(CATALOG_ROOT, 'catalogs')), false,
    'package must not create a catalogs/presets compatibility tree');
});

test('package installs immutable catalog data without making it a conffile', () => {
  const install = block('Package/zapret2-manager/install');
  const conffiles = block('Package/zapret2-manager/conffiles');
  assert.match(install, /\$\(CP\) \.\/files\/\*\s+\$\(1\)\//,
    'package install must copy the local package files');
  assert.match(install, /find \$\(1\)\/usr\/share\/zapret2-manager -type f -exec chmod 0644 \{\} \+/,
    'catalog files must be installed read-only');
  assert.doesNotMatch(conffiles, /catalog\/avatar|strategy-state\.json|strategies\//,
    'immutable catalog and Strategy state must not be conffiles');
});

test('postinst bootstraps absent Strategy storage with fixed root ownership and modes', () => {
  const postinst = block('Package/zapret2-manager/postinst');
  assert.match(postinst, /if \[ ! -e \/etc\/zapret2-manager\/strategies \] && \[ ! -L \/etc\/zapret2-manager\/strategies \]; then/);
  assert.match(postinst, /install -d -o root -g root -m 0700 \/etc\/zapret2-manager\/strategies/);
  assert.match(postinst, /if \[ ! -e \/etc\/zapret2-manager\/strategy-state\.json \] && \[ ! -L \/etc\/zapret2-manager\/strategy-state\.json \]; then/);
  assert.match(postinst, /install -o root -g root -m 0600 \/dev\/null \/etc\/zapret2-manager\/strategy-state\.json/);
  assert.match(postinst, /\/usr\/libexec\/zapret2-manager\/z2m-root-bootstrap persistent \|\| exit \$\$\?/);
});

test('postinst preserves existing Strategy data and legacy Profile state on upgrades', () => {
  const postinst = block('Package/zapret2-manager/postinst');
  const conffiles = block('Package/zapret2-manager/conffiles');
  assert.match(conffiles, /^\/etc\/zapret2-manager\/state\.json$/m,
    'legacy Profile state must remain a package compatibility document');
  assert.doesNotMatch(postinst, /(?:cp|mv|rm|rmdir|truncate|tee)\b[^\n]*(?:strateg(?:y|ies)|state\.json)/i,
    'postinst must not replace or remove user state');
  assert.doesNotMatch(postinst, /(?:>|>>)[^\n]*(?:strateg(?:y|ies)|state\.json)/i,
    'postinst must not redirect over user state');
  assert.match(postinst, /\[ ! -e [^\n]+ \] && \[ ! -L [^\n]+ \]/,
    'bootstrap must guard both existing paths and dangling symlinks');
});

test('catalog installation and postinst have no network dependency', () => {
  const install = block('Package/zapret2-manager/install');
  const postinst = block('Package/zapret2-manager/postinst');
  for (const body of [install, postinst]) {
    assert.doesNotMatch(body, /(?:https?:\/\/|curl|wget|git\b|uclient-fetch|scp|ssh)\b/i);
  }
  assert.doesNotMatch(install, /AVATAR_PINNED_SRC|catalogs\/presets/);
  assert.doesNotMatch(postinst, /AVATAR_PINNED_SRC|catalogs\/presets/);
});
