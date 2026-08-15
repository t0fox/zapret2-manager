'use strict';

export const id = 'remittor';
export const label = 'Remittor';
const MAX_ASSET_SIZE = 33554432;
const COMMIT_V20260307 = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
function sha256(value) { if (type(value) != 'string') return null; let m = match(value, /^sha256:([a-fA-F0-9]{64})$/); return m ? lc(m[1]) : null; }
function release_version(tag) { return type(tag) == 'string' && match(tag, /^v[0-9][0-9A-Za-z._-]*$/) ? substr(tag, 1) : null; }
function supported(version) { return version == '0.9.20260307'; }
function package_version(version) { return supported(version) ? '0.9.20260307' : null; }
function exact_asset(assets, name) { if (type(assets) != 'array') return null; for (let i = 0; i < length(assets); i++) { let a = assets[i]; if (type(a) == 'object' && a != null && a.name == name) return a; } return null; }
function release_url(version, name) { return 'https://github.com/remittor/zapret-openwrt/releases/download/v' + version + '/' + name; }
function valid_asset(asset, name, version) { return type(asset) == 'object' && asset != null && asset.name == name && asset.state == 'uploaded' && +asset.size >= 1024 && +asset.size <= MAX_ASSET_SIZE && sha256(asset.digest) != null && asset.browser_download_url == release_url(version, name); }
export const metadata = function (architecture) { return { provider: id, url: 'https://raw.githubusercontent.com/remittor/zapret-openwrt/gh-pages/releases/releases_zap2_' + architecture + '.json' }; };
export const resolveAsset = function (version, architecture) { return type(version) == 'string' && type(architecture) == 'string' ? 'zapret2_v' + version + '_' + architecture + '.zip' : null; };
export const resolveLatest = function (architecture, channel, document) {
	if (channel != 'stable' || type(document) != 'object' || document == null || type(document.releases) != 'array' || document.generated_at == null) return null;
	for (let i = 0; i < length(document.releases); i++) {
		let release = document.releases[i];
		if (type(release) != 'object' || release == null || release.prerelease !== false || release.published_at == null) continue;
		let version = release_version(release.tag); if (version == null) continue;
		let name = resolveAsset(version, architecture), asset = exact_asset(release.assets, name); if (!valid_asset(asset, name, version)) continue;
		let compatible = supported(version);
		return { provider: id, version: version, packageVersion: package_version(version), upstreamVersion: version, upstreamCommit: compatible ? COMMIT_V20260307 : null, architecture: architecture, assetName: name, downloadUrl: asset.browser_download_url, sha256: sha256(asset.digest), size: +asset.size, releaseId: '' + (asset.id != null ? asset.id : release.tag), publishedAt: release.published_at, prerelease: false, container: 'zip', innerPackagePattern: 'zapret2-*.apk', compatible: compatible, compatibilityMessage: compatible ? 'Версия проверена с runtime-контрактом manager.' : 'Совместимость с этой версией manager не подтверждена.' };
	}
	return null;
};
export const verifyMetadata = function (c) { if (type(c) != 'object' || c == null || c.provider != id) return false; if (c.compatible === true && c.packageVersion != package_version(c.version)) return false; if (c.compatible !== true && c.packageVersion != null) return false; let n = resolveAsset(c.version, c.architecture); return n != null && c.assetName == n && c.downloadUrl == release_url(c.version, n) && type(c.sha256) == 'string' && match(c.sha256, /^[a-f0-9]{64}$/) && +c.size >= 1024 && +c.size <= MAX_ASSET_SIZE && c.container == 'zip' && c.prerelease === false && type(c.compatible) == 'bool'; };
export const detectInstalled = function (meta, files, saved) {
	if (type(meta) != 'object' || meta == null || meta.name != 'zapret2') return { provider: 'unknown', confidence: 'none' };
	let v = meta.version, d = meta.description != null ? lc(meta.description) : '', r = meta.runtimeVersion != null ? lc(meta.runtimeVersion) : '', marker = meta.providerMarker != null ? lc(meta.providerMarker) : '';
	let explicit = index(d, 'remittor/zapret-openwrt') >= 0 || index(marker, 'remittor/zapret-openwrt') >= 0, commit = index(r, substr(COMMIT_V20260307, 0, 7)) >= 0;
	if (match(v, /^0\.9\.20260307(-r[0-9]+)?$/) && (explicit || commit)) return { provider: id, confidence: 'high', evidence: explicit ? 'updater-marker+version' : 'runtime-commit+version' };
	let stateMatch = type(saved) == 'object' && saved != null && saved.provider == id && saved.packageVersion == v && saved.assetSha256 == meta.managedAssetSha256;
	if (match(v, /^0\.9\.20260307(-r[0-9]+)?$/) && stateMatch && meta.runtimeContract === true) return { provider: id, confidence: 'high', evidence: 'package+runtime+managed-asset' };
	return { provider: 'unknown', confidence: 'none' };
};
