'use strict';

export const id = 'andrevich';
export const label = '1andrevich';
const MAX_ASSET_SIZE = 33554432;
const KEY_NAME = 'zapret2-1andrevich.pub';
const KEY_SHA256_V103 = '484f670f1c3b12367d5a0648e065e3b6c0cb7fcb996fb05da08369ef0a9b8336';
const COMMIT_V103 = 'b78b52c4cd7f843da3ff0848a3430afbd401bdf2';
function sha256(value) { if (type(value) != 'string') return null; let m = match(value, /^sha256:([a-fA-F0-9]{64})$/); return m ? lc(m[1]) : null; }
function release_version(tag) { return type(tag) == 'string' && match(tag, /^v[0-9][0-9A-Za-z._-]*$/) ? substr(tag, 1) : null; }
function release_url(version, name) { return 'https://github.com/1andrevich/zapret2-openwrt/releases/download/v' + version + '/' + name; }
function exact_asset(assets, name) { if (type(assets) != 'array') return null; for (let i = 0; i < length(assets); i++) { let a = assets[i]; if (type(a) == 'object' && a != null && a.name == name) return a; } return null; }
function valid_asset(asset, name, version) { return type(asset) == 'object' && asset != null && asset.name == name && asset.state == 'uploaded' && +asset.size >= 1024 && +asset.size <= MAX_ASSET_SIZE && sha256(asset.digest) != null && asset.browser_download_url == release_url(version, name); }
function supported(version) { return version == '1.0.3'; }
function package_version(version) { return type(version) == 'string' ? version : null; }
function pinned_key(version) { return KEY_SHA256_V103; }
export const metadata = function (architecture) { return { provider: id, url: 'https://api.github.com/repos/1andrevich/zapret2-openwrt/releases?per_page=20' }; };
export const resolveAsset = function (version, architecture) { return type(version) == 'string' && type(architecture) == 'string' ? 'zapret2_' + architecture + '.apk' : null; };
export const resolveLatest = function (architecture, channel, document) {
	if (channel != 'stable' || type(document) != 'array') return null;
	for (let i = 0; i < length(document); i++) {
		let release = document[i];
		if (type(release) != 'object' || release == null || release.draft !== false || release.prerelease !== false || release.published_at == null) continue;
		let version = release_version(release.tag_name); if (version == null) continue;
		let name = resolveAsset(version, architecture), asset = exact_asset(release.assets, name), key = exact_asset(release.assets, KEY_NAME);
		if (!valid_asset(asset, name, version) || !valid_asset(key, KEY_NAME, version) || sha256(key.digest) != pinned_key(version)) continue;
		let compatible = supported(version);
		return { provider: id, version: version, packageVersion: package_version(version), upstreamVersion: version, upstreamCommit: compatible ? COMMIT_V103 : null, architecture: architecture, assetName: name, downloadUrl: asset.browser_download_url, sha256: sha256(asset.digest), size: +asset.size, releaseId: '' + release.id, publishedAt: release.published_at, prerelease: false, container: 'apk', keyName: KEY_NAME, keyUrl: key.browser_download_url, keySha256: pinned_key(version), compatible: compatible, compatibilityMessage: compatible ? 'Версия проверена с runtime-контрактом manager.' : 'Совместимость с этой версией manager не подтверждена.' };
	}
	return null;
};
export const verifyMetadata = function (c) { if (type(c) != 'object' || c == null || c.provider != id || c.packageVersion != package_version(c.version)) return false; let n = resolveAsset(c.version, c.architecture); return n != null && c.assetName == n && c.downloadUrl == release_url(c.version, n) && type(c.sha256) == 'string' && match(c.sha256, /^[a-f0-9]{64}$/) && +c.size >= 1024 && +c.size <= MAX_ASSET_SIZE && c.keyName == KEY_NAME && c.keyUrl == release_url(c.version, KEY_NAME) && c.keySha256 == pinned_key(c.version) && c.prerelease === false && type(c.compatible) == 'bool'; };
export const detectInstalled = function (meta, files, saved) {
	if (type(meta) != 'object' || meta == null || meta.name != 'zapret2') return { provider: 'unknown', confidence: 'none' };
	let v = meta.version, d = meta.description != null ? lc(meta.description) : '', r = meta.runtimeVersion != null ? lc(meta.runtimeVersion) : '';
	let explicit = index(d, '1andrevich/zapret2-openwrt') >= 0, commit = index(r, substr(COMMIT_V103, 0, 7)) >= 0;
	if ((v == '1.0.3' || v == '1.0.3-r1') && (explicit || commit)) return { provider: id, confidence: 'high', evidence: explicit ? 'description+version' : 'runtime-commit+version' };
	let stateMatch = type(saved) == 'object' && saved != null && saved.provider == id && saved.packageVersion == v && saved.assetSha256 == meta.managedAssetSha256;
	if ((v == '1.0.3' || v == '1.0.3-r1') && stateMatch && meta.runtimeContract === true) return { provider: id, confidence: 'high', evidence: 'package+runtime+managed-asset' };
	return { provider: 'unknown', confidence: 'none' };
};
