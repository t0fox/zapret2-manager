import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapArchitecture,
  parseAndrevichReleases,
  parseRemittorManifest,
  detectProvider,
  compareApkVersions
} from './lib/engine-provider-logic.mjs';

const arch = 'aarch64_cortex-a53';
const digest = 'a'.repeat(64);

function asset(name, overrides = {}) {
  return Object.assign({
    name,
    state: 'uploaded',
    size: 564500,
    digest: `sha256:${digest}`,
    browser_download_url: `https://github.com/1andrevich/zapret2-openwrt/releases/download/v1.0.3/${name}`
  }, overrides);
}

test('architecture mapping prefers exact OpenWrt APK architecture', () => {
  assert.equal(mapArchitecture({ distribArch: arch, apkArch: arch }), arch);
  assert.equal(mapArchitecture({ distribArch: 'aarch64_generic', apkArch: 'aarch64_cortex-a53' }), arch);
  assert.equal(mapArchitecture({ distribArch: 'x86_64', apkArch: 'x86_64' }), 'x86_64');
  assert.equal(mapArchitecture({ distribArch: 'unsupported', apkArch: 'unsupported' }), null);
});

test('1andrevich parser selects a published stable engine APK only', () => {
  const releases = [{
    id: 358634632,
    tag_name: 'v1.0.3',
    draft: false,
    prerelease: false,
    published_at: '2026-07-23T11:22:44Z',
    assets: [
      asset('luci-app-zapret2.apk'),
      asset(`zapret2_${arch}.ipk`),
      asset(`zapret2_${arch}.apk`)
    ]
  }];
  const candidate = parseAndrevichReleases(releases, arch, 'stable');
  assert.equal(candidate.provider, 'andrevich');
  assert.equal(candidate.version, '1.0.3');
  assert.equal(candidate.assetName, `zapret2_${arch}.apk`);
  assert.equal(candidate.sha256, digest);
  assert.equal(candidate.releaseId, '358634632');
  assert.equal(candidate.prerelease, false);
});

test('1andrevich parser ignores drafts, prereleases and branch-only versions', () => {
  const releases = [
    { id: 2, tag_name: 'v1.0.4', draft: false, prerelease: true, assets: [asset(`zapret2_${arch}.apk`)] },
    { id: 1, tag_name: 'v1.0.3', draft: false, prerelease: false, published_at: '2026-07-23T11:22:44Z', assets: [asset(`zapret2_${arch}.apk`)] }
  ];
  assert.equal(parseAndrevichReleases(releases, arch, 'stable').version, '1.0.3');
});

test('1andrevich parser rejects missing asset, digest and malformed metadata', () => {
  assert.throws(() => parseAndrevichReleases([], arch, 'stable'), /release/i);
  assert.throws(() => parseAndrevichReleases([{ id: 1, tag_name: 'v1.0.3', draft: false, prerelease: false, assets: [asset('luci-app-zapret2.apk')] }], arch, 'stable'), /asset/i);
  assert.throws(() => parseAndrevichReleases([{ id: 1, tag_name: 'v1.0.3', draft: false, prerelease: false, assets: [asset(`zapret2_${arch}.apk`, { digest: null })] }], arch, 'stable'), /digest/i);
  assert.throws(() => parseAndrevichReleases(null, arch, 'stable'), /metadata/i);
});

test('Remittor parser selects stable architecture ZIP with digest for engine-only extraction', () => {
  const manifest = {
    generated_at: '2026-03-07T07:32:52Z',
    releases: [{
      tag: 'v0.9.20260307',
      prerelease: false,
      published_at: '2026-03-07T06:27:30Z',
      assets: [{
        id: 368761307,
        name: `zapret2_v0.9.20260307_${arch}.zip`,
        state: 'uploaded',
        size: 847585,
        digest: `sha256:${digest}`,
        browser_download_url: `https://github.com/remittor/zapret-openwrt/releases/download/v0.9.20260307/zapret2_v0.9.20260307_${arch}.zip`
      }]
    }]
  };
  const candidate = parseRemittorManifest(manifest, arch, 'stable');
  assert.equal(candidate.provider, 'remittor');
  assert.equal(candidate.packageVersion, '0.9.20260307-r3');
  assert.equal(candidate.container, 'zip');
  assert.equal(candidate.packageAssetPattern, 'zapret2-*.apk');
  assert.equal(candidate.sha256, digest);
});

test('APK version comparison is release-aware', () => {
  assert.equal(compareApkVersions('1.0.3-r1', '1.0.3-r2'), -1);
  assert.equal(compareApkVersions('1.0.3-r2', '1.0.3-r2'), 0);
  assert.equal(compareApkVersions('1.0.4-r1', '1.0.3-r9'), 1);
});

test('provider detection is evidence-based and otherwise unknown', () => {
  assert.equal(detectProvider({ version: '0.9.20260307-r3', description: 'remittor/zapret-openwrt', files: ['/opt/zapret2/update-pkg.sh'] }, null), 'remittor');
  assert.equal(detectProvider({ version: '1.0.3-r1', description: 'prebuilt by 1andrevich/zapret2-openwrt', files: [] }, null), 'andrevich');
  assert.equal(detectProvider({ version: '9.9.9-r1', description: 'zapret2', files: [] }, { provider: 'remittor', packageVersion: '0.9.20260307-r3' }), 'unknown');
});
