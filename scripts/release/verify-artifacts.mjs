import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { releaseConfig } from './config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FULL_PACKAGE_MAKEFILE = 'zapret2-manager-full/Makefile';

function fail(message) {
  throw new Error(`artifact verification failed: ${message}`);
}

function readFullPackage() {
  const relativePath = FULL_PACKAGE_MAKEFILE;
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const version = source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1];
  const release = source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1];
  const depends = source.match(/\bDEPENDS\s*:?=\s*([^\n]+)/)?.[1] ?? '';
  const provides = source.match(/\bPROVIDES\s*:?=\s*([^\n]+)/)?.[1] ?? '';
  if (!version || !release) fail(`${relativePath} has no package identity`);
  return { version, release: Number(release), depends, provides };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function verifyChecksums(dist, files) {
  const checksumFile = path.join(dist, 'SHA256SUMS');
  if (!fs.statSync(checksumFile).isFile()) fail('SHA256SUMS is missing');
  const lines = fs.readFileSync(checksumFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== files.length) fail(`SHA256SUMS must contain ${files.length} entries`);
  const expected = new Map();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) fail(`invalid SHA256SUMS line: ${line}`);
    if (expected.has(match[2])) fail(`duplicate SHA256SUMS entry: ${match[2]}`);
    expected.set(match[2], match[1]);
  }
  for (const file of files) {
    if (expected.get(file) !== sha256(path.join(dist, file))) fail(`checksum mismatch: ${file}`);
  }
  if (expected.size !== files.length || [...expected.keys()].some((file) => !files.includes(file)))
    fail('SHA256SUMS contains an unexpected file entry');
}

function equalJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} mismatch`);
}

export function verifyArtifacts(dist = path.join(ROOT, 'dist')) {
  if (!fs.statSync(dist).isDirectory()) fail(`dist directory is missing: ${dist}`);
  const entries = fs.readdirSync(dist, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) fail('dist contains a directory or non-file entry');
  const names = entries.map((entry) => entry.name).sort();
  const apkNames = names.filter((name) => name.endsWith('.apk'));
  if (apkNames.length !== releaseConfig.packages.length)
    fail(`expected exactly ${releaseConfig.packages.length} APKs, found ${apkNames.length}`);
  if (names.length !== 3) fail(`dist must contain exactly 3 files, found ${names.length}`);
  if (!names.includes('SHA256SUMS') || !names.includes('build-manifest.json'))
    fail('dist must contain build-manifest.json and SHA256SUMS');
  for (const optionalPackage of releaseConfig.excludedOptionalPackages) {
    if (names.some((name) => name.includes(optionalPackage))) fail(`excluded optional package is present: ${optionalPackage}`);
  }

  const manifestPath = path.join(dist, 'build-manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { fail(`build-manifest.json is not valid JSON: ${error.message}`); }
  if (manifest.schema !== releaseConfig.manifestSchema) fail('manifest schema mismatch');
  if (manifest.project?.repository !== releaseConfig.repository) fail('manifest repository mismatch');
  if (!/^[0-9a-f]{40}$/.test(manifest.project?.gitCommit ?? '')) fail('manifest gitCommit is not a full SHA');
  if (manifest.project.gitCommit !== (process.env.RELEASE_EXPECTED_COMMIT || currentCommit()))
    fail('manifest gitCommit does not match checked out HEAD');
  if (typeof manifest.project.gitRef !== 'string' || manifest.project.gitRef.length === 0) fail('manifest gitRef is empty');

  const identity = readFullPackage();
  if (manifest.package?.version !== identity.version || manifest.package?.release !== identity.release)
    fail('manifest package identity does not match the full package Makefile');
  if (!/@TARGET_mediatek_filogic/.test(identity.depends)) fail('full package target constraint is missing');
  if (/\+zapret2-manager\b|\+luci-app-zapret2-manager\b/.test(identity.depends))
    fail('full package depends on a split manager package');
  for (const dependency of releaseConfig.externalDependencies) {
    if (!new RegExp(`\\+${dependency.replaceAll('-', '\\-')}\\b`).test(identity.depends))
      fail(`full package dependency is missing: ${dependency}`);
  }
  const expectedProvides = releaseConfig.compatibility.provides.join(' ');
  if (identity.provides.trim() !== expectedProvides) fail('full package compatibility provides are invalid');

  const openwrt = manifest.openwrt ?? {};
  for (const key of ['version', 'target', 'subtarget', 'sdkFilename', 'sdkSha256']) {
    if (openwrt[key] !== releaseConfig.openwrt[key]) fail(`manifest OpenWrt ${key} does not match release config`);
  }
  equalJson(manifest.externalDependencies, [...releaseConfig.externalDependencies], 'external dependency list');
  equalJson(manifest.bundled, releaseConfig.bundled, 'bundled component contract');
  equalJson(manifest.compatibility, releaseConfig.compatibility, 'compatibility contract');
  equalJson(manifest.excludedOptionalPackages, [...releaseConfig.excludedOptionalPackages], 'optional-package exclusion list');
  equalJson(manifest.installation, releaseConfig.installation, 'manifest installation contract');

  const artifact = manifest.artifact;
  if (!artifact || Array.isArray(artifact)) fail('manifest must contain one singular artifact object');
  if (artifact.package !== releaseConfig.packages[0]) fail('manifest artifact has wrong package name');
  if (typeof artifact.filename !== 'string' ||
      !new RegExp(`^${releaseConfig.packages[0].replaceAll('-', '\\-')}-[0-9][^/]*\\.apk$`).test(artifact.filename))
    fail(`invalid full package APK filename: ${artifact.filename}`);
  if (apkNames.length !== 1 || apkNames[0] !== artifact.filename) fail('APK set does not match the singular manifest artifact');
  const file = path.join(dist, artifact.filename);
  const stat = fs.statSync(file);
  if (stat.size <= 0 || artifact.bytes !== stat.size) fail(`size mismatch: ${artifact.filename}`);
  if (artifact.sha256 !== sha256(file)) fail(`manifest checksum mismatch: ${artifact.filename}`);
  verifyChecksums(dist, [artifact.filename, 'build-manifest.json']);
  return { manifest, artifact };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist');
    const result = verifyArtifacts(dist);
    console.log(`Verified ${result.artifact.package} APK in ${dist}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
