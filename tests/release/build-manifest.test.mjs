import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { releaseConfig } from '../../scripts/release/config.mjs';
import { verifyArtifacts } from '../../scripts/release/verify-artifacts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function packageIdentity(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  return {
    version: source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)[1],
    release: Number(source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)[1])
  };
}

test('canonical release config pins the exact SDK and one full package', () => {
  assert.equal(releaseConfig.manifestSchema, 'zapret2-manager.release-build.v2');
  assert.deepEqual(releaseConfig.packages, ['zapret2-manager-full']);
  assert.deepEqual(releaseConfig.excludedOptionalPackages, ['tg-ws-proxy-go', 'tg-ws-proxy-rs']);
  assert.equal(releaseConfig.openwrt.version, '25.12.5');
  assert.equal(releaseConfig.openwrt.target, 'mediatek');
  assert.equal(releaseConfig.openwrt.subtarget, 'filogic');
  assert.equal(releaseConfig.openwrt.sdkSha256,
    'ff4a38a397caa2cfe1c39e18f84ddede14878221b3593c3f2c4cfe24e3ec4c25');
});

test('installation contract keeps engine and Telegram Proxy independent', () => {
  assert.deepEqual(releaseConfig.installation, {
    trustMode: 'allow-untrusted',
    engineBundled: false,
    telegramProxyBundled: false
  });
});

test('artifact verifier accepts the exact three-file single-artifact manifest shape', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-release-verifier-'));
  try {
    const identity = packageIdentity('zapret2-manager/Makefile');
    const artifactName = `${releaseConfig.packages[0]}-${identity.version}-r${identity.release}-filogic.apk`;
    const artifactFile = path.join(dist, artifactName);
    fs.writeFileSync(artifactFile, 'fixture-full');
    const artifact = {
      package: releaseConfig.packages[0],
      filename: artifactName,
      bytes: fs.statSync(artifactFile).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(artifactFile)).digest('hex')
    };
    const manifest = {
      schema: releaseConfig.manifestSchema,
      project: {
        repository: releaseConfig.repository,
        gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        gitRef: 'main'
      },
      package: identity,
      openwrt: {
        version: releaseConfig.openwrt.version,
        target: releaseConfig.openwrt.target,
        subtarget: releaseConfig.openwrt.subtarget,
        sdkFilename: releaseConfig.openwrt.sdkFilename,
        sdkSha256: releaseConfig.openwrt.sdkSha256
      },
      artifact,
      excludedOptionalPackages: [...releaseConfig.excludedOptionalPackages],
      installation: { ...releaseConfig.installation },
      bundled: { ...releaseConfig.bundled },
      compatibility: {
        provides: [...releaseConfig.compatibility.provides],
        legacyPackages: [...releaseConfig.compatibility.legacyPackages]
      },
      externalDependencies: [...releaseConfig.externalDependencies]
    };
    fs.writeFileSync(path.join(dist, 'build-manifest.json'), `${JSON.stringify(manifest)}\n`);
    const checksummed = [artifactName, 'build-manifest.json'].map((filename) => {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, filename))).digest('hex');
      return `${sha256}  ${filename}`;
    });
    fs.writeFileSync(path.join(dist, 'SHA256SUMS'), `${checksummed.join('\n')}\n`);
    assert.doesNotThrow(() => verifyArtifacts(dist));
    fs.writeFileSync(path.join(dist, 'unexpected.apk'), 'extra');
    assert.throws(() => verifyArtifacts(dist), /exactly 1 APKs|exactly 3 files/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
