import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { releaseConfig } from './config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PACKAGE_FILES = [
  'zapret2-manager/Makefile',
  'luci-app-zapret2-manager/Makefile',
  'zapret2-manager-full/Makefile'
];

function fail(message) {
  throw new Error(`artifact verification failed: ${message}`);
}

function parsePackageIdentity() {
  return PACKAGE_FILES.map((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    const version = source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1];
    const release = source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1];
    const depends = source.match(/\bDEPENDS\s*:?=\s*([^\n]+)/)?.[1] ?? '';
    if (!version || !release) fail(`${relativePath} has no package identity`);
    return { version, release: Number(release), depends };
  });
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
}

export function verifyArtifacts(dist = path.join(ROOT, 'dist')) {
  const entries = fs.readdirSync(dist, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) fail('dist contains a directory or non-file entry');
  const names = entries.map((entry) => entry.name).sort();
  const apkNames = names.filter((name) => name.endsWith('.apk'));
  if (apkNames.length !== releaseConfig.packages.length) fail(`expected exactly ${releaseConfig.packages.length} APKs, found ${apkNames.length}`);
  if (names.length !== 5) fail(`dist must contain exactly 5 files, found ${names.length}`);
  if (names.includes('SHA256SUMS') === false || names.includes('build-manifest.json') === false)
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
  if (manifest.project.gitCommit !== (process.env.RELEASE_EXPECTED_COMMIT || currentCommit())) fail('manifest gitCommit does not match checked out HEAD');
  if (typeof manifest.project.gitRef !== 'string' || manifest.project.gitRef.length === 0) fail('manifest gitRef is empty');

  const identities = parsePackageIdentity();
  const versions = new Set(identities.map((item) => item.version));
  const releases = new Set(identities.map((item) => item.release));
  if (versions.size !== 1 || releases.size !== 1) fail('Makefile package identities are not synchronized');
  const identity = identities[0];
  if (manifest.package?.version !== identity.version || manifest.package?.release !== identity.release)
    fail('manifest package identity does not match the Makefiles');
  if (!/\+zapret2-manager\b/.test(identities[1].depends)) fail('LuCI package dependency is missing backend');
  if (!/@TARGET_mediatek_filogic/.test(identities[2].depends) ||
      !/\+zapret2-manager\b/.test(identities[2].depends) ||
      !/\+luci-app-zapret2-manager\b/.test(identities[2].depends)) fail('full package dependency contract is invalid');

  const openwrt = manifest.openwrt ?? {};
  for (const key of ['version', 'target', 'subtarget', 'sdkFilename', 'sdkSha256']) {
    if (openwrt[key] !== releaseConfig.openwrt[key]) fail(`manifest OpenWrt ${key} does not match release config`);
  }
  if (JSON.stringify(manifest.excludedOptionalPackages) !== JSON.stringify([...releaseConfig.excludedOptionalPackages]))
    fail('manifest optional-package exclusion list mismatch');
  if (JSON.stringify(manifest.installation) !== JSON.stringify(releaseConfig.installation)) fail('manifest installation contract mismatch');

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== releaseConfig.packages.length)
    fail('manifest must contain exactly three artifacts');
  const artifactFiles = [];
  for (const [index, packageName] of releaseConfig.packages.entries()) {
    const artifact = manifest.artifacts[index];
    if (artifact?.package !== packageName) fail(`manifest artifact ${index} has wrong package name`);
    if (typeof artifact.filename !== 'string' || !new RegExp(`^${packageName.replaceAll('-', '\\-')}-[0-9][^/]*\\.apk$`).test(artifact.filename))
      fail(`invalid ${packageName} APK filename: ${artifact.filename}`);
    if (!apkNames.includes(artifact.filename)) fail(`manifest artifact is missing from dist: ${artifact.filename}`);
    const file = path.join(dist, artifact.filename);
    const stat = fs.statSync(file);
    if (stat.size <= 0 || artifact.bytes !== stat.size) fail(`size mismatch: ${artifact.filename}`);
    const digest = sha256(file);
    if (artifact.sha256 !== digest) fail(`manifest checksum mismatch: ${artifact.filename}`);
    artifactFiles.push(artifact.filename);
  }
  if (new Set(artifactFiles).size !== artifactFiles.length || artifactFiles.length !== apkNames.length)
    fail('APK set does not match the manifest artifact set');
  verifyChecksums(dist, [...artifactFiles, 'build-manifest.json']);
  return { manifest, artifacts: manifest.artifacts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist');
    const result = verifyArtifacts(dist);
    console.log(`Verified ${result.artifacts.length} product APKs in ${dist}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
