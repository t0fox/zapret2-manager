import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

function temporaryPackageRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-package-postinst-'));
  fs.mkdirSync(path.join(root, 'etc', 'zapret2-manager'), { recursive: true });
  return root;
}

function runPostinst(root) {
  const fakeBin = path.join(root, 'bin');
  const installLog = path.join(root, 'install.log');
  fs.mkdirSync(fakeBin);

  // Use the real package shell body, redirecting only its absolute targets into the fake root.
  const script = block('Package/zapret2-manager/postinst')
    .replace(/\$\$/g, '$')
    .replaceAll('/etc/zapret2-manager', path.join(root, 'etc', 'zapret2-manager'))
    .replace('/usr/libexec/zapret2-manager/z2m-root-bootstrap', '/bin/true')
    .replace('/etc/init.d/rpcd reload', ':')
    .replace('/etc/init.d/zapret2-manager enable', ':');
  const installShim = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const original = process.argv.slice(2);
fs.appendFileSync(process.env.Z2M_INSTALL_LOG, JSON.stringify(original) + '\\n');
let args = original;
if (process.getuid?.() !== 0) {
  args = [];
  for (let index = 0; index < original.length; index++) {
    if (original[index] === '-o' || original[index] === '-g') index++;
    else args.push(original[index]);
  }
}
const result = spawnSync('/usr/bin/install', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`;
  fs.writeFileSync(path.join(fakeBin, 'install'), installShim, { mode: 0o755 });

  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, Z2M_INSTALL_LOG: installLog };
  delete env.IPKG_INSTROOT;
  const result = spawnSync('/bin/sh', ['-eu', '-c', script], { env, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const calls = fs.existsSync(installLog)
    ? fs.readFileSync(installLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  return { calls, root };
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function assertRootOwnership(file) {
  if (process.getuid?.() === 0) {
    const stat = fs.statSync(file);
    assert.equal(stat.uid, 0, `${file} uid`);
    assert.equal(stat.gid, 0, `${file} gid`);
  }
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
  assert.match(postinst, /printf '[^\n]+schema[^\n]+revision[^\n]+'[\s\\\n]+\| install -o root -g root -m 0600 \/dev\/stdin \/etc\/zapret2-manager\/strategy-state\.json/);
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

test('postinst creates absent Strategy storage in a temporary package root', () => {
  const root = temporaryPackageRoot();
  try {
    const { calls } = runPostinst(root);
    const strategies = path.join(root, 'etc', 'zapret2-manager', 'strategies');
    const state = path.join(root, 'etc', 'zapret2-manager', 'strategy-state.json');
    assert.equal(fs.statSync(strategies).isDirectory(), true);
    assert.equal(mode(strategies), 0o700);
    assert.equal(mode(state), 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf8')), {
      schema: 1, revision: 0, favorites: [], selected: null,
    });
    assertRootOwnership(strategies);
    assertRootOwnership(state);
    assert.ok(calls.some(args => args.includes('-d') && args.includes('-o') && args.includes('root')
      && args.includes('-g') && args.includes('root') && args.includes('0700') && args.includes(strategies)));
    assert.ok(calls.some(args => args.includes('-o') && args.includes('root') && args.includes('-g')
      && args.includes('root') && args.includes('0600') && args.includes(state)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('postinst preserves existing Strategy files, selection state, and legacy state', () => {
  const root = temporaryPackageRoot();
  const etc = path.join(root, 'etc', 'zapret2-manager');
  const strategies = path.join(etc, 'strategies');
  const userStrategy = path.join(strategies, 'user.json');
  const strategyState = path.join(etc, 'strategy-state.json');
  const legacyState = path.join(etc, 'state.json');
  try {
    fs.mkdirSync(strategies);
    fs.writeFileSync(userStrategy, '{"id":"user-one","profiles":[]}');
    fs.writeFileSync(strategyState, '{"favorites":["user-one"],"selected":"user-one"}');
    fs.writeFileSync(legacyState, '{"profiles":[{"id":"legacy"}]}');
    fs.chmodSync(strategies, 0o755);
    fs.chmodSync(strategyState, 0o644);
    fs.chmodSync(legacyState, 0o600);
    const before = new Map([
      [userStrategy, fs.readFileSync(userStrategy)],
      [strategyState, fs.readFileSync(strategyState)],
      [legacyState, fs.readFileSync(legacyState)],
    ]);

    const { calls } = runPostinst(root);
    assert.deepEqual(calls, [], 'existing storage must not invoke install');
    for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, file);
    assert.equal(mode(strategies), 0o755, 'existing Strategy directory mode must not be rewritten');
    assert.equal(mode(strategyState), 0o644, 'existing selection state mode must not be rewritten');
    assert.equal(mode(legacyState), 0o600, 'legacy Profile state must remain unchanged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('postinst does not follow live Strategy storage symlinks', () => {
  const root = temporaryPackageRoot();
  const etc = path.join(root, 'etc', 'zapret2-manager');
  const targetDir = path.join(root, 'user-strategies');
  const targetState = path.join(root, 'user-strategy-state.json');
  try {
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, 'keep.json'), 'keep');
    fs.writeFileSync(targetState, '{"favorites":["keep"]}');
    fs.symlinkSync(targetDir, path.join(etc, 'strategies'), 'dir');
    fs.symlinkSync(targetState, path.join(etc, 'strategy-state.json'));
    const { calls } = runPostinst(root);
    assert.deepEqual(calls, [], 'live symlinks must not invoke install');
    assert.equal(fs.lstatSync(path.join(etc, 'strategies')).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(etc, 'strategy-state.json')).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(targetDir, 'keep.json'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(targetState, 'utf8'), '{"favorites":["keep"]}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('postinst preserves dangling Strategy storage symlinks', () => {
  const root = temporaryPackageRoot();
  const etc = path.join(root, 'etc', 'zapret2-manager');
  const strategies = path.join(etc, 'strategies');
  const strategyState = path.join(etc, 'strategy-state.json');
  try {
    fs.symlinkSync(path.join(root, 'missing-strategies'), strategies, 'dir');
    fs.symlinkSync(path.join(root, 'missing-state.json'), strategyState);
    const { calls } = runPostinst(root);
    assert.deepEqual(calls, [], 'dangling symlinks must not invoke install');
    assert.equal(fs.lstatSync(strategies).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(strategyState).isSymbolicLink(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
