'use strict';
// Optional TG Proxy provider manager.
//
// The browser sends only allow-listed provider/source/version identifiers. It
// cannot choose a package name, URL or shell fragment. The provider manager is
// still the sole owner of TG packages and keeps every download bounded and
// digest-verified.

import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';
import { proxycfg_health } from './proxycfg.uc';

const STATE_FILE = '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = '/tmp/zapret2-manager-proxy-provider.lock';
const SNAP_DIR = '/tmp/zapret2-manager-proxy-provider-snapshot';
const INIT_PATH = '/etc/init.d/tg-ws-proxy';
const CONFIG_DIR = '/etc/tg-ws-proxy';
const BINARY_PATH = '/usr/bin/tg-ws-proxy';
const CHECK_DIR = '/tmp/zapret2-manager/proxy-provider-checks';
const CHECK_TTL = 600;
const OP_DIR = '/tmp/zapret2-manager/tg-operations';
const OP_ACTIVE = OP_DIR + '/active.json';
const OP_SUBMIT_LOCK = '/tmp/zapret2-manager-tg-operation-submit.lock';
const OP_RUN_LOCK = '/tmp/zapret2-manager-tg-operation.lock';
const OP_STAGES = [ 'PREPARE', 'PREFLIGHT', 'DOWNLOAD', 'VERIFY', 'BACKUP', 'INSTALL', 'CONFIG_VALIDATE', 'RESTART', 'HEALTHCHECK', 'COMMIT' ];
const OP_STAGE_TIMEOUTS = {
	PREPARE: 30, PREFLIGHT: 120, DOWNLOAD: 120, VERIFY: 90, BACKUP: 60,
	INSTALL: 180, CONFIG_VALIDATE: 60, RESTART: 90, HEALTHCHECK: 120,
	COMMIT: 30, ROLLING_BACK: 180
};
const MAX_METADATA = 4194304;
const MAX_RELEASES = 50;
const MAX_RELEASE_BODY = 32768;
const MAX_RELEASE_ASSETS = 64;
const SOURCE_APK = 'openwrt-apk-feed';
const SOURCE_GITHUB = 'official-github-release';

const PROVIDERS = [
	{
		id: 'rust',
		title: 'Rust',
		short: 'Лучше обходит сложные блокировки',
		feature: 'Автоматически пробует разные способы подключения; рекомендуется большинству пользователей',
		package: 'tg-ws-proxy-rs'
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Простой базовый вариант',
		feature: 'Подходит для обычного подключения и поддерживает основные способы обхода блокировок',
		package: 'tg-ws-proxy-go'
	}
];

function run(command) {
	let p = popen(command + ' 2>/dev/null', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { rc: rc, out: out };
}

function error(code, message) {
	return { ok: false, error: { code: code, message: message } };
}

function literal(value) {
	return type(value) == 'string' && index(value, "'") < 0 && index(value, '\n') < 0 && index(value, '\r') < 0
		? "'" + value + "'" : null;
}

function safe_token(value) {
	return type(value) == 'string' && match(value, /^[a-f0-9]{48}$/) ? value : null;
}

function safe_digest(value) {
	if (type(value) != 'string') return null;
	let found = match(value, /^sha256:([a-fA-F0-9]{64})$/);
	if (found) return lc(found[1]);
	return match(value, /^[a-fA-F0-9]{64}$/) ? lc(value) : null;
}

function safe_package_version(value) {
	let s = '' + (value != null ? value : '');
	if (s == '' || length(s) > 96) return false;
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		let ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) ||
			(c >= 97 && c <= 122) || c == 43 || c == 45 || c == 46 ||
			c == 95 || c == 126;
		if (!ok) return false;
	}
	return true;
}

function read_json(path, fallback) {
	try { let raw = readfile(path); return raw ? json(raw) : fallback; }
	catch (e) { return fallback; }
}

function ensure_dir(path) {
	try { mkdir(path); } catch (e) { }
	let quoted = literal(path);
	if (quoted != null) run('chmod 700 ' + quoted);
}

function atomic_json(path, value) {
	let tmp = path + '.tmp.' + time() + '-' + length(sprintf('%J', value));
	if (!writefile(tmp, sprintf('%J', value) + '\n')) return false;
	let source = literal(tmp), target = literal(path);
	if (source == null || target == null) return false;
	let moved = run('chmod 600 ' + source + ' && mv -f ' + source + ' ' + target);
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) { } return false; }
	return stat(path) != null;
}

function random_token() {
	return trim(run("(cat /proc/sys/kernel/random/uuid; cat /proc/sys/kernel/random/uuid) | tr -cd 'a-f0-9' | cut -c1-48").out);
}

function compare_versions(a, b) {
	if (!safe_package_version(a) || !safe_package_version(b)) return null;
	let left = literal(a), right = literal(b);
	if (left == null || right == null) return null;
	let answer = trim(run('apk version -t ' + left + ' ' + right).out);
	return answer == '<' ? -1 : answer == '>' ? 1 : answer == '=' ? 0 : null;
}

function architecture() {
	let value = trim(run(". /etc/openwrt_release 2>/dev/null; printf '%s' \"$DISTRIB_ARCH\"").out);
	if (value == '') value = trim(run('apk --print-arch').out);
	return match(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) ? value : null;
}

function metadata_url(provider) {
	if (provider == 'rust') return 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/latest';
	if (provider == 'go') return 'https://github.com/d0mhate/-tg-ws-proxy-Manager-go/releases/latest';
	return null;
}

function github_api_url(provider) {
	if (provider == 'rust') return 'https://api.github.com/repos/valnesfjord/tg-ws-proxy-rs/releases?per_page=50';
	if (provider == 'go') return 'https://api.github.com/repos/d0mhate/-tg-ws-proxy-Manager-go/releases?per_page=50';
	return null;
}

function release_identity(providerId, tag) {
	if (providerId == 'rust') {
		if (!match(tag, /^v[0-9][0-9A-Za-z._-]*$/)) return null;
		let upstream = substr(tag, 1);
		return { tag: tag, upstreamVersion: upstream, packageRevision: 1,
			displayVersion: upstream, packageVersion: upstream + '-r1' };
	}
	if (providerId != 'go') return null;
	let modern = match(tag, /^v([0-9][0-9A-Za-z._-]*)$/);
	if (modern) {
		let upstream = modern[1];
		return { tag: tag, upstreamVersion: upstream, packageRevision: 1,
			displayVersion: upstream, packageVersion: upstream };
	}
	let revised = match(tag, /^([0-9][0-9A-Za-z._-]*)-rev([0-9]+)$/), base = match(tag, /^([0-9][0-9A-Za-z._-]*)$/);
	let upstream = revised ? revised[1] : base ? base[1] : null;
	let revision = revised ? +revised[2] : base ? 1 : null;
	if (upstream == null || revision == null || revision < 1 || revision > 99) return null;
	let displayVersion = upstream + '-' + revision;
	return { tag: tag, upstreamVersion: upstream, packageRevision: revision,
		displayVersion: displayVersion, packageVersion: upstream + '-r' + revision };
}

function source_url(provider, sourceId) {
	if (sourceId == SOURCE_APK) return metadata_url(provider);
	if (sourceId == SOURCE_GITHUB) return github_api_url(provider);
	return null;
}

function source_kind(sourceId) {
	return sourceId == SOURCE_APK ? 'apk-feed' : sourceId == SOURCE_GITHUB ? 'github-release' : null;
}

function fetch_releases(provider) {
	let url = github_api_url(provider), quotedUrl = literal(url);
	if (quotedUrl == null) return error('ESECURITY', 'Источник upstream не входит в allowlist.');
	let file = '/tmp/zapret2-manager/proxy-provider-releases.' + provider + '.' + time();
	let quotedFile = literal(file);
	let result = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager-proxy -O ' + quotedFile + ' ' + quotedUrl);
	let info = stat(file);
	if (result.rc != 0 || info == null) { try { unlink(file); } catch (e) { } return error('ENETWORK', 'Не удалось получить список официальных релизов.'); }
	if (info.size < 2 || info.size > MAX_METADATA) { try { unlink(file); } catch (e) { } return error('EMETADATA', 'Ответ upstream имеет недопустимый размер.'); }
	let document = read_json(file, null);
	try { unlink(file); } catch (e) { }
	if (type(document) != 'array') return error('EMETADATA', 'Список официальных релизов повреждён.');
	let releases = [];
	for (let i = 0; i < length(document) && length(releases) < MAX_RELEASES; i++)
		if (type(document[i]) == 'object' && document[i] != null) push(releases, document[i]);
	return { ok: true, releases: releases };
}

function latest_candidate(providerId, arch) {
	let url = metadata_url(providerId), quoted = literal(url);
	if (quoted == null) return error('ESECURITY', 'Metadata URL не входит в allowlist.');
	let response = run('curl -sSI --connect-timeout 10 --max-time 20 ' + quoted);
	if (response.rc != 0) return error('ENETWORK', 'Не удалось проверить обновления.');
	let lines = split(response.out, '\n'), location = null;
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (substr(lc(line), 0, 9) == 'location:') location = trim(substr(line, 9));
	}
	let prefix = providerId == 'rust'
		? 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/'
		: 'https://github.com/d0mhate/-tg-ws-proxy-Manager-go/releases/tag/';
	if (location == null || substr(location, 0, length(prefix)) != prefix) return error('EMETADATA', 'GitHub не вернул допустимую stable release ссылку.');
	let tag = substr(location, length(prefix)), identity = release_identity(providerId, tag);
	if (identity == null || !safe_package_version(identity.displayVersion) || !safe_package_version(identity.packageVersion))
		return error('EMETADATA', 'Версия upstream имеет недопустимый формат.');
	return { ok: true, candidate: { provider: providerId, version: identity.displayVersion,
		upstreamVersion: identity.upstreamVersion, packageRevision: identity.packageRevision,
		displayVersion: identity.displayVersion, packageVersion: identity.packageVersion,
		architecture: arch, releaseTag: tag, metadataUrl: url } };
}

function fetch_metadata(provider) {
	let url = metadata_url(provider), quotedUrl = literal(url);
	if (url == null || quotedUrl == null) return error('ESECURITY', 'Metadata URL не входит в allowlist.');
	let file = '/tmp/zapret2-manager/proxy-provider-metadata.' + provider + '.' + time();
	let quotedFile = literal(file);
	let result = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager/proxy -O ' + quotedFile + ' ' + quotedUrl);
	let info = stat(file);
	if (result.rc != 0 || info == null) { try { unlink(file); } catch (e) { } return error('ENETWORK', 'Не удалось проверить обновления.'); }
	if (info.size < 2 || info.size > MAX_METADATA) { try { unlink(file); } catch (e) { } return error('EMETADATA', 'Ответ upstream имеет недопустимый размер.'); }
	let document = read_json(file, null);
	try { unlink(file); } catch (e) { }
	return document != null ? { ok: true, document: document } : error('EMETADATA', 'Ответ upstream повреждён.');
}

function exact_asset(assets, name) {
	if (type(assets) != 'array') return null;
	for (let i = 0; i < length(assets); i++)
		if (type(assets[i]) == 'object' && assets[i] != null && assets[i].name == name) return assets[i];
	return null;
}

function package_name(providerId) {
	return providerId == 'rust' ? 'luci-app-tg-ws-proxy-rs' : providerId == 'go' ? 'tg-ws-proxy' : null;
}

function target_arch(providerId, arch) {
	if (providerId == 'rust') return substr(arch, 0, 8) == 'aarch64_' ? 'aarch64' : arch;
	if (substr(arch, 0, 8) == 'aarch64_' || arch == 'aarch64') return 'aarch64';
	if (arch == 'x86_64') return 'x86_64';
	if (substr(arch, 0, 4) == 'arm_' || substr(arch, 0, 5) == 'armv7') return 'armv7';
	if (substr(arch, 0, 8) == 'mipsel_') return 'mipsel_24kc';
	if (substr(arch, 0, 5) == 'mips_') return 'mips_24kc';
	return arch;
}

function release_prefix(providerId, tag) {
	return providerId == 'rust'
		? 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/' + tag + '/'
		: 'https://github.com/d0mhate/-tg-ws-proxy-Manager-go/releases/download/' + tag + '/';
}

function release_page_url(providerId, tag) {
	return providerId == 'rust'
		? 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/' + tag
		: 'https://github.com/d0mhate/-tg-ws-proxy-Manager-go/releases/tag/' + tag;
}

function public_release_assets(release, prefix) {
	let result = [];
	if (type(release.assets) != 'array') return result;
	for (let i = 0; i < length(release.assets) && length(result) < MAX_RELEASE_ASSETS; i++) {
		let asset = release.assets[i];
		if (type(asset) != 'object' || type(asset.name) != 'string' || length(asset.name) > 128 ||
			!match(asset.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/) || asset.state != 'uploaded') continue;
		let url = prefix + asset.name, digest = safe_digest(asset.digest);
		if (asset.browser_download_url != url || +asset.size < 1 || +asset.size > 33554432) continue;
		push(result, { name: asset.name, size: +asset.size, digest: digest, downloadUrl: url });
	}
	return result;
}

function usable_asset(asset, prefix, name) {
	return asset != null && asset.state == 'uploaded' && +asset.size >= 1 && +asset.size <= 33554432 &&
		asset.browser_download_url == prefix + name;
}

function release_body(release) {
	if (type(release.body) != 'string' || release.body == '') return null;
	return substr(release.body, 0, MAX_RELEASE_BODY);
}

function sort_versions(rows) {
	for (let i = 1; i < length(rows); i++) {
		let current = rows[i], j = i - 1;
		while (j >= 0) {
			let comparison = compare_versions(current.version, rows[j].version);
			let preferCurrent = comparison != null && comparison > 0;
			if (!preferCurrent && comparison == 0 && current.sourceId == SOURCE_GITHUB && rows[j].sourceId != SOURCE_GITHUB)
				preferCurrent = true;
			if (!preferCurrent) break;
			rows[j + 1] = rows[j];
			j--;
		}
		rows[j + 1] = current;
	}
	return rows;
}

function release_candidate(providerId, arch, release) {
	if (type(release) != 'object' || release == null || release.draft !== false || release.prerelease !== false) return null;
	let tag = release.tag_name;
	if (type(tag) != 'string') return null;
	let identity = release_identity(providerId, tag);
	if (identity == null) return null;
	let version = identity.displayVersion, packageVersion = identity.packageVersion, assetName = null, artifactFormat = null;
	let apkAssetName = null, directAssetName = null, binaryPath = null;
	let keyAssetName = null;
	if (providerId == 'rust') {
		apkAssetName = 'luci-app-tg-ws-proxy-rs-' + version + '-r1.apk';
		let target = target_arch(providerId, arch);
		if (target == 'aarch64') directAssetName = 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz';
		else if (target == 'x86_64') directAssetName = 'tg-ws-proxy-x86_64-unknown-linux-musl.tar.gz';
		else if (substr(target, 0, 4) == 'arm_') directAssetName = 'tg-ws-proxy-armv7-unknown-linux-musleabihf.tar.gz';
		else if (substr(target, 0, 8) == 'mipsel_') directAssetName = 'tg-ws-proxy-mipsel-unknown-linux-musl.tar.gz';
		else if (substr(target, 0, 5) == 'mips_') directAssetName = 'tg-ws-proxy-mips-unknown-linux-musl.tar.gz';
		binaryPath = BINARY_PATH;
	} else if (providerId == 'go') {
		let targetArch = target_arch(providerId, arch);
		directAssetName = 'tg-ws-proxy-openwrt-' + targetArch;
		binaryPath = BINARY_PATH;
	}
	if (!safe_package_version(version) || !safe_package_version(packageVersion)) return null;
	let prefix = release_prefix(providerId, tag);
	let apkAsset = apkAssetName != null ? exact_asset(release.assets, apkAssetName) : null;
	let directAsset = directAssetName != null ? exact_asset(release.assets, directAssetName) : null;
	let apkAvailable = usable_asset(apkAsset, prefix, apkAssetName);
	let directBinaryAvailable = usable_asset(directAsset, prefix, directAssetName);
	if (directBinaryAvailable && providerId == 'rust') { assetName = directAssetName; artifactFormat = 'binary'; }
	else if (apkAvailable) { assetName = apkAssetName; artifactFormat = 'apk'; }
	else if (directBinaryAvailable) {
		assetName = directAssetName;
		artifactFormat = providerId == 'go' ? 'binary' : 'tar.gz';
	}
	let asset = assetName != null ? exact_asset(release.assets, assetName) : null;
	let digest = asset != null ? safe_digest(asset.digest) : null;
	let keyAsset = keyAssetName != null ? exact_asset(release.assets, keyAssetName) : null;
	let keyDigest = keyAsset != null ? safe_digest(keyAsset.digest) : null;
	let keyUrl = keyAsset != null ? prefix + keyAssetName : null;
	let keyUsable = keyAssetName != null && keyAsset != null && keyAsset.state == 'uploaded' && keyDigest != null &&
		+keyAsset.size >= 128 && +keyAsset.size <= 65536 && keyAsset.browser_download_url == keyUrl;
	let architectureCompatible = apkAvailable || directBinaryAvailable;
	let artifactAvailable = apkAvailable || directBinaryAvailable;
	let packageMatchesTarget = artifactAvailable;
	let checksumAvailable = digest != null;
	let apkSignatureTrusted = keyUsable;
	let trustMode = apkAvailable ? (keyUsable ? 'upstream-key' : 'sha256-only') : directBinaryAvailable ? 'sha256-only' : null;
	let installable = architectureCompatible && checksumAvailable && trustMode != null &&
		(artifactFormat == 'apk' || (artifactFormat == 'binary' && binaryPath == BINARY_PATH));
	let reportedPackageVersion = artifactFormat == 'binary' ? null : packageVersion;
	let unavailableReason = !architectureCompatible
		? 'Для target ' + arch + ' в релизе нет артефакта этой архитектуры.'
		: !artifactAvailable
			? 'В официальном релизе нет проверяемого артефакта.'
			: artifactFormat != 'apk' && artifactFormat != 'binary'
				? 'Найден direct binary для target, но canonical installer поддерживает только APK.'
				: !checksumAvailable
					? 'У APK отсутствует проверяемый SHA-256.'
					: null;
	return { provider: providerId, version: version, upstreamVersion: identity.upstreamVersion,
		packageRevision: identity.packageRevision, displayVersion: identity.displayVersion, releaseTag: identity.tag,
		releaseExists: true, provider: providerId, packageVersion: reportedPackageVersion, runtimeVersion: version, architecture: arch,
		sourceId: SOURCE_GITHUB, sourceKind: source_kind(SOURCE_GITHUB), artifactFormat: artifactFormat,
		packageName: package_name(providerId), architectureCompatible: architectureCompatible,
		artifactAvailable: artifactAvailable, packageMatchesTarget: packageMatchesTarget,
		apkAvailable: apkAvailable, directBinaryAvailable: directBinaryAvailable,
		checksumAvailable: checksumAvailable, apkSignatureTrusted: apkSignatureTrusted,
		assetName: assetName, assetSha256: digest, assetSize: asset != null ? +asset.size : null, releaseId: '' + release.id,
		releaseName: type(release.name) == 'string' && release.name != '' ? substr(release.name, 0, 256) : tag,
		releaseBody: release_body(release), releaseUrl: release_page_url(providerId, tag),
		assets: public_release_assets(release, prefix), publishedAt: release.published_at, metadataUrl: github_api_url(providerId),
		downloadUrl: assetName != null ? prefix + assetName : null, trustMode: trustMode, keyAssetName: keyAssetName, keyAssetSha256: keyDigest,
		keyAssetSize: keyAsset != null ? +keyAsset.size : null, keyDownloadUrl: keyUrl,
		binaryPath: binaryPath,
		installable: installable, unavailableReason: unavailableReason, incompatibilityReason: unavailableReason };
}

function clone_public(provider) {
	return {
		id: provider.id,
		title: provider.title,
		short: provider.short,
		feature: provider.feature
	};
}

function provider_by_id(id) {
	for (let i = 0; i < length(PROVIDERS); i++)
		if (PROVIDERS[i].id == id) return PROVIDERS[i];
	return null;
}

function load_state() {
	let raw = readfile(STATE_FILE);
	if (!raw) return { activeProvider: null, activeVersion: null, changedAt: null };
	try {
		let parsed = json(raw);
		if (type(parsed) == 'object' && parsed != null) return parsed;
	} catch (e) { }
	return { activeProvider: null, activeVersion: null, changedAt: null, malformed: true };
}

function save_state(providerId, versionId, packageVersion, sourceId) {
	let tmp = STATE_FILE + '.tmp.' + time();
	let payload = {
		schema: 'proxy-provider.v2',
		activeProvider: providerId,
		activeVersion: versionId,
		activePackageVersion: packageVersion != null ? packageVersion : null,
		activeSourceId: sourceId != null ? sourceId : null,
		changedAt: time()
	};
	writefile(tmp, sprintf('%J', payload) + '\n');
	let mv = run('mv -f ' + tmp + ' ' + STATE_FILE);
	if (mv.rc != 0) {
		try { unlink(tmp); } catch (e) { }
		return false;
	}
	return stat(STATE_FILE) != null;
}

function provider_package_names(provider) {
	let names = [provider.package];
	if (provider.id == 'rust') push(names, 'luci-app-tg-ws-proxy-rs');
	if (provider.id == 'go') push(names, 'tg-ws-proxy');
	return names;
}

function provider_installed(provider) {
	let names = provider_package_names(provider);
	for (let i = 0; i < length(names); i++) if (package_present(names[i])) return true;
	return false;
}

function package_present(packageName) {
	return run('apk info -e ' + packageName).rc == 0;
}

function installed_package_version(packageName) {
	if (!package_present(packageName)) return null;
	let r = run('apk info -v ' + packageName + ' | head -n 1');
	let line = trim(r.out);
	let prefix = packageName + '-';
	if (substr(line, 0, length(prefix)) == prefix)
		line = substr(line, length(prefix));
	return safe_package_version(line) ? line : null;
}

function installed_package_name(status, providerId) {
	if (status == null || type(status.packages) != 'array') return null;
	for (let i = 0; i < length(status.packages); i++) {
		let row = status.packages[i];
		if (type(row) == 'object' && row != null && row.provider == providerId &&
			type(row.package) == 'string' && row.package != '') return row.package;
	}
	return null;
}

function running() {
	return trim(run('pidof tg-ws-proxy').out) != '';
}

function service(action) {
	if (stat(INIT_PATH) == null) return 0;
	return run(INIT_PATH + ' ' + action).rc;
}

function wait_for_service_ready() {
	for (let i = 0; i < 6; i++) {
		let health = proxycfg_health({ upstream: false });
		if (health != null && health.ok === true) return true;
		if (i < 5) run('sleep 1');
	}
	return false;
}

function acquire_lock() {
	return run('mkdir ' + LOCK_DIR).rc == 0;
}

function release_lock() {
	run('rmdir ' + LOCK_DIR);
}

function safe_operation_id(value) {
	return type(value) == 'string' && match(value, /^tg-[0-9]+-[a-f0-9]{12}$/) ? value : null;
}

function operation_path(operationId) {
	return safe_operation_id(operationId) != null ? OP_DIR + '/' + operationId + '.json' : null;
}

function operation_read(operationId) {
	let path = operation_path(operationId);
	return path != null ? read_json(path, null) : null;
}

function operation_write(operation) {
	let path = operation_path(operation != null ? operation.operationId : null);
	return path != null && atomic_json(path, operation);
}

function operation_active() {
	// An active operation is the single backend mutation owner.
	let active = read_json(OP_ACTIVE, null);
	if (active == null || safe_operation_id(active.operationId) == null) return null;
	let operation = operation_read(active.operationId);
	if (operation == null) return null;
	if (operation.status != 'RUNNING' && operation.status != 'ROLLING_BACK') return null;
	return operation_reconcile(operation);
}

function operation_stage_index(stage) {
	for (let i = 0; i < length(OP_STAGES); i++) if (OP_STAGES[i] == stage) return i;
	return -1;
}

function operation_stage_timeout(stage) {
	return OP_STAGE_TIMEOUTS[stage] != null ? +OP_STAGE_TIMEOUTS[stage] : 120;
}

function operation_worker_alive(pid) {
	return pid != null && match('' + pid, /^[0-9]+$/) && run('kill -0 ' + pid).rc == 0;
}

function operation_reconcile(operation) {
	if (operation == null || (operation.status != 'RUNNING' && operation.status != 'ROLLING_BACK')) return operation;
	let now = time(), stageStartedAt = +operation.stageStartedAt || +operation.updatedAt || +operation.startedAt || now;
	let overdue = now - stageStartedAt > operation_stage_timeout(operation.currentStage);
	let workerKnown = operation.workerPid != null;
	let workerDead = workerKnown && !operation_worker_alive(operation.workerPid) && now - (+operation.updatedAt || now) > 2;
	if (!overdue && !workerDead) return operation;
	let failedStage = operation.currentStage, workerFailure = workerDead;
	operation.status = 'FAILED';
	operation.failedStage = failedStage;
	operation.error = {
		code: workerFailure ? 'EWORKER_DEAD' : 'STAGE_TIMEOUT',
		message: workerFailure ? 'Worker TG Proxy завершился без финального состояния.' : 'Стадия TG Proxy превысила допустимый срок.',
		failedStage: failedStage
	};
	operation.rollback = {
		attempted: false,
		status: operation_stage_index(failedStage) >= operation_stage_index('INSTALL') ? 'UNKNOWN' : 'NOT_REQUIRED',
		failures: operation_stage_index(failedStage) >= operation_stage_index('INSTALL') ? [workerFailure ? 'worker-dead' : 'stage-timeout'] : []
	};
	operation.updatedAt = now;
	operation_write(operation);
	return operation;
}

function operation_update(operationId, stage, percent, message, status) {
	let operation = operation_read(operationId);
	if (operation == null) return false;
	if (stage != null && operation_stage_index(stage) < 0 && stage != 'ROLLING_BACK' && stage != 'ROLLED_BACK') return false;
	let previousStage = operation.currentStage, now = time();
	if (stage != null) operation.currentStage = stage;
	if (percent != null) operation.progressPercent = +percent;
	if (status != null) operation.status = status;
	if (stage != null && stage != previousStage) operation.stageStartedAt = now;
	operation.updatedAt = now;
	if (message != null) {
		if (type(operation.events) != 'array') operation.events = [];
		push(operation.events, { sequence: length(operation.events) + 1, stage: operation.currentStage,
			percent: operation.progressPercent, message: message, at: operation.updatedAt });
		while (length(operation.events) > 32) shift(operation.events);
	}
	return operation_write(operation);
}

function operation_terminal(operationId, result) {
	let operation = operation_read(operationId);
	if (operation == null) return false;
	let rolledBack = result != null && result.rollbackFailures != null && length(result.rollbackFailures) == 0;
	let failed = result == null || result.ok !== true;
	if (failed) {
		if (result != null && result.rollbackAttempted === true) {
			operation_update(operationId, 'ROLLED_BACK', 100,
				rolledBack ? 'Предыдущая реализация восстановлена и проверена.' : 'Откат не удалось полностью подтвердить.', rolledBack ? 'ROLLED_BACK' : 'FAILED');
			operation = operation_read(operationId);
			operation.rollback = { attempted: true, status: rolledBack ? 'ROLLED_BACK' : 'FAILED',
				failures: result.rollbackFailures || [] };
		} else {
			operation_update(operationId, operation.currentStage, operation.progressPercent,
				result.error != null ? result.error.message : 'Операция завершилась ошибкой.', 'FAILED');
			operation = operation_read(operationId);
			operation.rollback = { attempted: false, status: 'NOT_REQUIRED', failures: [] };
		}
		operation.error = result.error || { code: 'EINTERNAL', message: 'Операция завершилась ошибкой.' };
		operation.failedStage = operation.currentStage;
	} else {
		operation_update(operationId, 'COMMIT', 100, 'Изменение TG Proxy подтверждено.', 'COMPLETE');
		operation = operation_read(operationId);
		operation.rollback = { attempted: false, status: 'NOT_REQUIRED', failures: [] };
	}
	operation.updatedAt = time();
	return operation_write(operation);
}

function operation_submit(operationType, from, to, input, candidate) {
	ensure_dir('/tmp/zapret2-manager');
	ensure_dir(OP_DIR);
	if (run('mkdir ' + OP_SUBMIT_LOCK).rc != 0) return error('EBUSY', 'Другая операция TG Proxy уже создаётся.');
	let active = operation_active();
	if (active != null) {
		run('rmdir ' + OP_SUBMIT_LOCK);
		return { ok: false, error: { code: 'EBUSY', message: 'Другая операция TG Proxy уже выполняется.' }, operation: active };
	}
	let token = random_token();
	if (safe_token(token) == null) {
		run('rmdir ' + OP_SUBMIT_LOCK);
		return error('EINTERNAL', 'Не удалось создать operation id.');
	}
	let operationId = 'tg-' + time() + '-' + substr(token, 0, 12), now = time();
	let operation = {
		schema: 'tg-operation.v1', operationId: operationId, operationType: operationType,
		from: from || null, to: to || null, startedAt: now, updatedAt: now,
		stageStartedAt: now, currentStage: 'PREPARE', progressPercent: 0, status: 'RUNNING', error: null,
		failedStage: null, workerPid: null, workerStartedAt: null,
		rollback: { attempted: false, status: 'NOT_REQUIRED', failures: [] }, events: [],
		input: input || {}, candidate: candidate || null
	};
	push(operation.events, { sequence: 1, stage: 'PREPARE', percent: 0, message: 'Операция подготовлена.', at: now });
	if (!operation_write(operation) || !atomic_json(OP_ACTIVE, { operationId: operationId })) {
		run('rmdir ' + OP_SUBMIT_LOCK);
		return error('EINTERNAL', 'Не удалось сохранить TG operation.');
	}
	let spawned = run("sh -c '/usr/bin/ucode /usr/libexec/zapret2-manager/proxy-provider-operation.uc " + literal(operationId) + " >/dev/null 2>&1 & echo $!'");
	run('rmdir ' + OP_SUBMIT_LOCK);
	let workerPid = trim(spawned.out), workerStarted = match(workerPid, /^[0-9]+$/);
	if (spawned.rc != 0 || !workerStarted) {
		operation_update(operationId, 'PREPARE', 0, 'Worker TG Proxy не удалось запустить.', 'FAILED');
		return { ok: false, operationId: operationId, error: { code: 'ETARGET', message: 'Worker операции TG Proxy не удалось запустить.' } };
	}
	let submitted = operation_read(operationId);
	if (submitted != null && submitted.status == 'RUNNING') {
		submitted.workerPid = +workerPid;
		submitted.workerStartedAt = time();
		submitted.updatedAt = time();
		operation_write(submitted);
	}
	return { ok: true, operationId: operationId, status: submitted != null ? submitted.status : 'RUNNING', operation: submitted || operation };
}

export const proxy_provider_operation_status = function (input) {
	let operationId = null;
	if (type(input) == 'object' && input != null && input.operationId != null) operationId = input.operationId;
	let operation = operationId != null ? operation_read(operationId) : operation_active();
	operation = operation_reconcile(operation);
	if (operationId != null && operation == null) return error('ENOENT', 'Операция TG Proxy не найдена.');
	return { ok: true, operation: operation, operationId: operation != null ? operation.operationId : null,
		status: operation != null ? operation.status : 'IDLE', events: operation != null ? operation.events : [] };
};

function snapshot_settings() {
	run('rm -rf ' + SNAP_DIR);
	let hadConfig = stat(CONFIG_DIR) != null;
	let hadBinary = stat(BINARY_PATH) != null;
	let ok = true;
	if (hadConfig) {
		if (run('mkdir -p ' + SNAP_DIR + '/config').rc != 0) ok = false;
		else if (run('cp -a ' + CONFIG_DIR + '/. ' + SNAP_DIR + '/config/').rc != 0) ok = false;
	}
	if (hadBinary) {
		if (run('mkdir -p ' + SNAP_DIR).rc != 0 || run('cp -p ' + BINARY_PATH + ' ' + SNAP_DIR + '/binary').rc != 0) ok = false;
	}
	return { ok: ok, hadConfig: hadConfig, hadBinary: hadBinary };
}

function restore_settings(snapshot) {
	if (snapshot == null || snapshot.hadConfig !== true) return true;
	if (stat(SNAP_DIR + '/config') == null) return false;
	if (run('mkdir -p ' + CONFIG_DIR).rc != 0) return false;
	return run('cp -a ' + SNAP_DIR + '/config/. ' + CONFIG_DIR + '/').rc == 0;
}

function restore_binary(snapshot) {
	if (snapshot != null && snapshot.hadBinary === true && stat(SNAP_DIR + '/binary') != null)
		return run('cp -p ' + SNAP_DIR + '/binary ' + BINARY_PATH + ' && chmod 755 ' + BINARY_PATH + ' && chown root:root ' + BINARY_PATH).rc == 0;
	return run('rm -f ' + BINARY_PATH).rc == 0 && stat(BINARY_PATH) == null;
}

function clear_snapshot() {
	run('rm -rf ' + SNAP_DIR);
}

function installed_rows() {
	let rows = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		let names = provider_package_names(provider);
		for (let j = 0; j < length(names); j++) {
			let packageVersion = installed_package_version(names[j]);
			if (packageVersion != null) {
				push(rows, { provider: provider.id, package: names[j], packageVersion: packageVersion });
				break;
			}
		}
	}
	return rows;
}

function feed_available(provider) {
	if (provider.id == 'go') return false;
	let quoted = literal(provider.package);
	if (quoted == null) return false;
	let result = run('apk policy ' + quoted);
	return result.rc == 0 && index(lc(result.out), 'no such package') < 0 && index(lc(result.out), 'unable to select packages') < 0;
}

function feed_version(providerId, arch) {
	let resolved = latest_candidate(providerId, arch);
	if (!resolved.ok) return null;
	let candidate = resolved.candidate;
	candidate.sourceId = SOURCE_APK;
	candidate.sourceKind = source_kind(SOURCE_APK);
	candidate.metadataUrl = source_url(providerId, SOURCE_APK);
	candidate.packageName = package_name(providerId);
	candidate.releaseExists = true;
	candidate.architectureCompatible = true;
	candidate.artifactAvailable = true;
	candidate.packageMatchesTarget = true;
	candidate.apkAvailable = true;
	candidate.directBinaryAvailable = false;
	candidate.checksumAvailable = false;
	candidate.apkSignatureTrusted = true;
	candidate.releaseName = null;
	candidate.releaseBody = null;
	candidate.releaseUrl = candidate.metadataUrl;
	candidate.assets = [];
	candidate.installable = null;
	candidate.unavailableReason = null;
	candidate.incompatibilityReason = null;
	return candidate;
}

function provider_sources(provider, arch) {
	let feed = feed_available(provider);
	let github = fetch_releases(provider.id);
	let sources = [
		{ id: SOURCE_GITHUB, label: 'Official GitHub release', kind: source_kind(SOURCE_GITHUB),
			available: github.ok === true, url: source_url(provider.id, SOURCE_GITHUB),
			reason: github.ok === true ? null : (github.error ? github.error.message : 'Официальный release source недоступен.') },
		{ id: SOURCE_APK, label: 'OpenWrt APK feed', kind: source_kind(SOURCE_APK),
			available: feed, url: source_url(provider.id, SOURCE_APK),
			reason: feed ? null : 'Пакетный менеджер или пакет не найден в настроенном OpenWrt APK feed.' }
	];
	let versions = [];
	if (github.ok === true) {
		for (let i = 0; i < length(github.releases) && length(versions) < MAX_RELEASES + 1; i++) {
			let candidate = release_candidate(provider.id, arch, github.releases[i]);
			if (candidate != null) push(versions, candidate);
		}
	}
	if (feed) {
		let feedCandidate = feed_version(provider.id, arch);
		if (feedCandidate != null) push(versions, feedCandidate);
	}
	sort_versions(versions);
	return { sources: sources, versions: versions, github: github };
}

function versions_for(providerId, arch) {
	let provider = provider_by_id(providerId);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let model = provider_sources(provider, arch);
	return {
		id: provider.id, title: provider.title, package: provider.package,
		sources: model.sources, versions: model.versions
	};
}

export const proxy_provider_versions = function (input) {
	let providerId = null;
	if (type(input) == 'object' && input != null && input.provider != null) providerId = input.provider;
	if (providerId != null && provider_by_id(providerId) == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let arch = architecture();
	if (arch == null) return error('EARCH', 'Архитектура устройства не распознана.');
	let rows = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		if (providerId != null && PROVIDERS[i].id != providerId) continue;
	let row = versions_for(PROVIDERS[i].id, arch);
		if (row.ok === false) return row;
		push(rows, row);
	}
	return { ok: true, schema: 'proxy-provider.versions.v1', architecture: arch,
		maxReleases: MAX_RELEASES, sources: [SOURCE_APK, SOURCE_GITHUB], providers: rows };
};

function state_package_version(providerId, version) {
	if (!safe_package_version(version)) return null;
	if (providerId == 'rust') return version + '-r1';
	if (providerId == 'go') {
		let found = match(version, /^(.+)-([0-9]+)$/);
		return found ? found[1] + '-r' + found[2] : null;
	}
	return null;
}

export const proxy_provider_catalog = function () {
	let out = [];
	for (let i = 0; i < length(PROVIDERS); i++) push(out, clone_public(PROVIDERS[i]));
	return {
		ok: true,
		optional: true,
		providers: out,
		sources: [SOURCE_APK, SOURCE_GITHUB],
		note: 'Версии ограничены allow-listed OpenWrt feed и официальными GitHub release; произвольные URL не принимаются.'
	};
};

export const proxy_provider_status = function () {
	let state = load_state();
	let installed = installed_rows();
	let activeProvider = state.activeProvider;
	let stateProvider = provider_by_id(activeProvider);
	if (length(installed) == 0 && stateProvider != null &&
		safe_package_version(state.activeVersion) && stat(BINARY_PATH) != null) {
		push(installed, {
			provider: stateProvider.id,
			package: null,
			packageVersion: safe_package_version(state.activePackageVersion) ? state.activePackageVersion :
				(state.activeSourceId == SOURCE_GITHUB ? null : state_package_version(stateProvider.id, state.activeVersion)),
			source: 'pinned-release'
		});
	}
	if (activeProvider == null && length(installed) == 1)
		activeProvider = installed[0].provider;

	let activeInstalled = false;
	let activePackageVersion = null;
	for (let i = 0; i < length(installed); i++) {
		if (installed[i].provider == activeProvider) {
			activeInstalled = true;
			activePackageVersion = installed[i].packageVersion;
		}
	}

	let provider = provider_by_id(activeProvider);
	let activeVersion = activeInstalled && state.activeProvider == activeProvider && safe_package_version(state.activeVersion)
		? state.activeVersion : activePackageVersion;
	return {
		ok: true,
		optional: true,
		installed: activeInstalled,
		activeProvider: activeInstalled ? activeProvider : null,
		activeVersion: activeVersion,
		activePackageVersion: activeInstalled ? activePackageVersion : null,
		activeSourceId: activeInstalled && state.activeProvider == activeProvider && source_kind(state.activeSourceId) != null ? state.activeSourceId : null,
		latestVersion: null,
		updateAvailable: null,
		packages: installed,
		binaryPresent: stat(BINARY_PATH) != null,
		running: running(),
		configPreserved: stat(CONFIG_DIR) != null,
		drift: length(installed) > 1 || (length(installed) == 1 && !activeInstalled)
	};
};

function check_input(value) {
	if (type(value) != 'object' || value == null || type(value.provider) != 'string' ||
		type(value.sourceId) != 'string' || type(value.version) != 'string' || provider_by_id(value.provider) == null)
		return false;
	let ks = keys(value);
	return length(ks) == 3 && source_kind(value.sourceId) != null && safe_package_version(value.version);
}

function candidate_package_matches(provider, candidate) {
	return provider != null && candidate != null && candidate.packageName == package_name(provider.id) &&
		(candidate.artifactFormat == 'binary' ? candidate.packageVersion == null :
			candidate.packageVersion != null && safe_package_version(candidate.packageVersion));
}

function load_checked_candidate(providerId, token, sourceId, version) {
	if (provider_by_id(providerId) == null || safe_token(token) == null) return error('EINPUT', 'Некорректный provider или check token.');
	let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null);
	if (record == null || record.token != token || type(record.candidate) != 'object' || record.candidate.provider != providerId)
		return error('ECHECKTOKEN', 'Сначала выполните проверку обновлений.');
	if (+record.expiresAt < time()) { try { unlink(path); } catch (e) { } return error('ECHECKEXPIRED', 'Результат проверки устарел. Повторите проверку.'); }
	let candidate = record.candidate;
	if (candidate.sourceId != sourceId || candidate.version != version || source_kind(candidate.sourceId) == null)
		return error('EINPUT', 'Проверенный источник или версия не совпадает с запросом установки.');
	if (!safe_package_version(candidate.version) || (candidate.artifactFormat != 'binary' && !safe_package_version(candidate.packageVersion)) ||
		candidate.packageName != package_name(providerId) ||
		(candidate.sourceId == SOURCE_GITHUB && (candidate.artifactFormat != 'apk' && candidate.artifactFormat != 'binary' ||
		(candidate.artifactFormat == 'binary' && ((providerId != 'go' && providerId != 'rust') || candidate.binaryPath != BINARY_PATH)) ||
			safe_digest(candidate.assetSha256) == null || candidate.downloadUrl == null ||
			(candidate.trustMode != 'sha256-only' && (candidate.trustMode != 'upstream-key' || safe_digest(candidate.keyAssetSha256) == null ||
				candidate.keyDownloadUrl == null || +candidate.keyAssetSize < 128 || +candidate.keyAssetSize > 65536)))) || candidate.installable !== true)
		return error('EINCOMPATIBLE', candidate.incompatibilityReason || 'Проверенная версия недоступна для установки на этой архитектуре.');
	try { unlink(path); } catch (e) { }
	return { ok: true, candidate: candidate };
}

function remove_packages() {
	let failures = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		let names = provider_package_names(provider);
		for (let j = 0; j < length(names); j++) {
			if (!package_present(names[j])) continue;
			let r = run('apk del --no-interactive ' + names[j]);
			if (r.rc != 0 || package_present(names[j])) push(failures, names[j]);
		}
	}
	return failures;
}

function remove_direct_binary() {
	let state = load_state();
	if (state.activeProvider != 'go' || state.activeSourceId != SOURCE_GITHUB) return true;
	return run('rm -f ' + BINARY_PATH).rc == 0 && stat(BINARY_PATH) == null;
}

function download_candidate(candidate, token) {
	let provider = provider_by_id(candidate.provider);
	let binary = candidate.artifactFormat == 'binary';
	if (!candidate_package_matches(provider, candidate) || candidate.sourceId != SOURCE_GITHUB ||
		(candidate.artifactFormat != 'apk' && !binary) ||
		(binary && (provider == null || (provider.id != 'go' && provider.id != 'rust') || candidate.binaryPath != BINARY_PATH || candidate.trustMode != 'sha256-only')) ||
		type(candidate.downloadUrl) != 'string' || safe_digest(candidate.assetSha256) == null ||
		(candidate.trustMode != 'sha256-only' && (candidate.trustMode != 'upstream-key' || type(candidate.keyDownloadUrl) != 'string' ||
			safe_digest(candidate.keyAssetSha256) == null)) || safe_token(token) == null)
		return error('EINCOMPATIBLE', candidate.incompatibilityReason || (binary ? 'У выбранного релиза нет поддерживаемого проверенного binary.' : 'У выбранного релиза нет поддерживаемого проверенного APK.'));
	let url = literal(candidate.downloadUrl);
	let keyUrl = candidate.trustMode == 'upstream-key' ? literal(candidate.keyDownloadUrl) : null;
	if (url == null || (candidate.trustMode == 'upstream-key' && keyUrl == null) || substr(candidate.downloadUrl, 0, 19) != 'https://github.com/' ||
		(candidate.trustMode == 'upstream-key' && substr(candidate.keyDownloadUrl, 0, 19) != 'https://github.com/')) return error('ESECURITY', 'URL артефакта или ключа не входит в allowlist.');
	let file = '/tmp/zapret2-manager/tg-provider-' + token +
		(binary ? (candidate.provider == 'rust' ? '.tar.gz' : '.bin') : '.apk'), quotedFile = literal(file);
	if (binary) {
		let fetched = run('ulimit -f 32768; uclient-fetch -q -T 30 --user-agent zapret2-manager-proxy -O ' + quotedFile + ' ' + url);
		let info = stat(file);
		if (fetched.rc != 0 || info == null || +info.size != +candidate.assetSize) {
			try { unlink(file); } catch (e) { }
			return error('ENETWORK', 'Проверенный upstream binary не удалось скачать полностью.');
		}
		let digest = trim(run('sha256sum ' + quotedFile + ' | cut -d " " -f 1').out);
		if (digest != candidate.assetSha256) {
			try { unlink(file); } catch (e) { }
			return error('EVERIFY', 'SHA-256 upstream binary не совпал.');
		}
		if (candidate.provider == 'rust') {
			let extractDir = file + '.extract', stagedFile = file + '.bin';
			let quotedExtract = literal(extractDir), quotedStaged = literal(stagedFile);
			let extracted = quotedExtract == null || quotedStaged == null ? { rc: -1 } :
				run('rm -rf ' + quotedExtract + ' && mkdir -p ' + quotedExtract +
					' && test "$(tar -tzf ' + quotedFile + ' | wc -l)" = 1' +
					' && tar -xzf ' + quotedFile + ' -C ' + quotedExtract +
					' && test -f ' + quotedExtract + '/tg-ws-proxy' +
					' && cp -p ' + quotedExtract + '/tg-ws-proxy ' + quotedStaged +
					' && chmod 755 ' + quotedStaged);
			if (extracted.rc != 0) {
				try { unlink(file); } catch (e) { }
				run('rm -rf ' + (quotedExtract || "''"));
				try { unlink(stagedFile); } catch (e) { }
				return error('EVERIFY', 'Проверенный Rust runtime archive имеет недопустимое содержимое.');
			}
			return { ok: true, file: stagedFile, archive: file, extractDir: extractDir, keysDir: null, trustMode: 'sha256-only', artifactFormat: 'binary' };
		}
		return { ok: true, file: file, keysDir: null, trustMode: 'sha256-only', artifactFormat: 'binary' };
	}
	let keysDir = '/tmp/zapret2-manager/tg-provider-' + token + '-keys', quotedKeysDir = literal(keysDir);
	if (quotedFile == null || quotedKeysDir == null || run('mkdir -p ' + quotedKeysDir + ' && cp -p /etc/apk/keys/* ' + quotedKeysDir + '/').rc != 0)
		return error('EINTERNAL', 'Не удалось подготовить временное хранилище ключей APK.');
	let fetched = run('ulimit -f 32768; uclient-fetch -q -T 30 --user-agent zapret2-manager-proxy -O ' + quotedFile + ' ' + url);
	let info = stat(file);
	if (fetched.rc != 0 || info == null || +info.size != +candidate.assetSize) {
		try { unlink(file); } catch (e) { }
		run('rm -rf ' + quotedKeysDir);
		return error('ENETWORK', 'Проверенный upstream APK не удалось скачать полностью.');
	}
	let digest = trim(run('sha256sum ' + quotedFile + ' | cut -d " " -f 1').out);
	if (digest != candidate.assetSha256) {
		try { unlink(file); } catch (e) { }
		run('rm -rf ' + quotedKeysDir);
		return error('EVERIFY', 'SHA-256 upstream артефакта не совпал.');
	}
	if (candidate.trustMode == 'upstream-key') {
		let keyFile = keysDir + '/tg-ws-proxy.pem', quotedKeyFile = literal(keyFile);
		let keyFetched = run('ulimit -f 64; uclient-fetch -q -T 30 --user-agent zapret2-manager-proxy -O ' + quotedKeyFile + ' ' + keyUrl);
		let keyInfo = stat(keyFile);
		if (keyFetched.rc != 0 || keyInfo == null || +keyInfo.size != +candidate.keyAssetSize) {
			try { unlink(file); } catch (e) { }
			try { unlink(keyFile); } catch (e) { }
			run('rm -rf ' + quotedKeysDir);
			return error('ENETWORK', 'Проверенный ключ подписи upstream не удалось скачать полностью.');
		}
		let keyDigest = trim(run('sha256sum ' + quotedKeyFile + ' | cut -d " " -f 1').out);
		if (keyDigest != candidate.keyAssetSha256) {
			try { unlink(file); } catch (e) { }
			try { unlink(keyFile); } catch (e) { }
			run('rm -rf ' + quotedKeysDir);
			return error('EVERIFY', 'SHA-256 ключа подписи upstream не совпал.');
		}
	}
	return { ok: true, file: file, keysDir: keysDir, trustMode: candidate.trustMode };
}

function cleanup_download(downloaded) {
	if (downloaded == null) return;
	if (downloaded.file != null) { try { unlink(downloaded.file); } catch (e) { } }
	if (downloaded.archive != null) { try { unlink(downloaded.archive); } catch (e) { } }
	if (downloaded.extractDir != null) {
		let quoted = literal(downloaded.extractDir);
		if (quoted != null) run('rm -rf ' + quoted);
	}
	if (downloaded.keysDir != null) {
		let quoted = literal(downloaded.keysDir);
		if (quoted != null) run('rm -rf ' + quoted);
	}
}

function prepare_candidate(candidate, token) {
	if (candidate.sourceId == SOURCE_APK) return { ok: true, feed: true, file: null, keysDir: null };
	let downloaded = download_candidate(candidate, token);
	if (!downloaded.ok) return downloaded;
	if (candidate.artifactFormat == 'binary') {
		let quoted = literal(downloaded.file);
		let probe = candidate.provider == 'rust'
			? quoted + ' --version 2>&1 | grep -q "^tg-ws-proxy "'
			: quoted + ' --help 2>&1 | grep -q "Usage of tg-ws-proxy"';
		if (quoted == null || run('chmod 755 ' + quoted + ' && ' + probe).rc != 0) {
			cleanup_download(downloaded);
			return error('EVERIFY', 'Проверенный binary не прошёл локальную валидацию.');
		}
		downloaded.validated = true;
	}
	return downloaded;
}

export const proxy_provider_check_updates = function (input) {
	if (!check_input(input)) return error('EINPUT', 'Нужно выбрать реализацию, источник и версию TG Proxy.');
	let arch = architecture();
	if (arch == null) return error('EARCH', 'Архитектура устройства не распознана.');
	let resolved = null;
	if (input.sourceId == SOURCE_APK) {
		let feedCandidate = feed_version(input.provider, arch);
		if (feedCandidate == null || feedCandidate.version != input.version)
			return error('EVERSION', 'Выбранная версия отсутствует в текущем OpenWrt APK feed.');
		resolved = { ok: true, candidate: feedCandidate };
	} else {
		let fetched = fetch_releases(input.provider);
		if (!fetched.ok) return fetched;
		for (let i = 0; i < length(fetched.releases); i++) {
			let found = release_candidate(input.provider, arch, fetched.releases[i]);
			if (found != null && found.version == input.version) { resolved = { ok: true, candidate: found }; break; }
		}
		if (resolved == null) return error('EVERSION', 'Выбранная официальная версия не содержит проверяемого артефакта для этой архитектуры.');
	}
	let candidate = resolved.candidate;
	let provider = provider_by_id(input.provider);
	if (!candidate_package_matches(provider, candidate))
		return error('EINCOMPATIBLE', 'Проверенный APK не соответствует каноническому пакету провайдера.');
	if (candidate.sourceId == SOURCE_APK) {
		let simulated = run('apk add --simulate --no-interactive ' + provider.package + '=' + candidate.packageVersion);
		candidate.installable = simulated.rc == 0;
		candidate.unavailableReason = candidate.installable ? null : 'Пакет отсутствует или несовместим с настроенными APK feed/архитектурой.';
		candidate.incompatibilityReason = candidate.unavailableReason;
	} else if (candidate.artifactFormat != 'apk' && candidate.artifactFormat != 'binary') {
		candidate.installable = false;
		candidate.unavailableReason = 'Найден direct binary для target, но canonical installer поддерживает только APK.';
		candidate.incompatibilityReason = candidate.unavailableReason;
	} else if (candidate.installable === true) {
		let staged = download_candidate(candidate, random_token());
		if (!staged.ok) {
			candidate.installable = false;
			candidate.unavailableReason = staged.error.message;
			candidate.incompatibilityReason = candidate.unavailableReason;
		} else if (candidate.artifactFormat == 'binary') {
			cleanup_download(staged);
			candidate.installable = true;
			candidate.unavailableReason = null;
			candidate.incompatibilityReason = null;
		} else {
			let trustFlag = staged.trustMode == 'sha256-only' ? '--allow-untrusted ' : '';
			let simulated = run('apk ' + trustFlag + '--keys-dir ' + literal(staged.keysDir) + ' add --simulate --no-interactive ' + literal(staged.file));
			cleanup_download(staged);
			candidate.installable = simulated.rc == 0;
			candidate.unavailableReason = candidate.installable ? null : 'APK подпись/идентичность подтверждены, но пакет несовместим с target или его зависимостями.';
			candidate.incompatibilityReason = candidate.unavailableReason;
		}
	}
	let token = random_token();
	if (safe_token(token) == null) return error('EINTERNAL', 'Не удалось создать token проверки.');
	ensure_dir(CHECK_DIR);
	let now = time();
	let record = { schema: 'proxy-provider-check.v1', token: token, checkedAt: now, expiresAt: now + CHECK_TTL, candidate: candidate };
	if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return error('EINTERNAL', 'Не удалось сохранить результат проверки.');
	let status = proxy_provider_status();
	let same = status.installed && status.activeProvider == input.provider;
	let comparison = same ? compare_versions(status.activePackageVersion || status.activeVersion,
		candidate.packageVersion || candidate.version) : null;
	return {
		ok: true,
		checkToken: token,
		checkedAt: now,
		expiresAt: now + CHECK_TTL,
		provider: input.provider,
		installedVersion: same ? status.activePackageVersion : null,
		latestVersion: candidate.version,
		latestPackageVersion: candidate.packageVersion,
		updateAvailable: same && comparison != null && comparison < 0,
		providerSwitch: status.installed && !same,
		installable: candidate.installable,
		candidate: candidate
	};
};

function install_candidate(provider, candidate, token, prepared) {
	if (candidate.sourceId == SOURCE_APK)
		return run('apk add --no-interactive ' + provider.package + '=' + candidate.packageVersion);
	let downloaded = prepared != null ? prepared : download_candidate(candidate, token);
	if (!downloaded.ok) return downloaded;
	if (candidate.artifactFormat == 'binary') {
		let tmp = BINARY_PATH + '.tmp.' + token, quotedTmp = literal(tmp), quotedFile = literal(downloaded.file);
		let result = quotedTmp == null || quotedFile == null ? { rc: -1, out: '' } :
			run('cp -p ' + quotedFile + ' ' + quotedTmp + ' && chmod 755 ' + quotedTmp + ' && chown root:root ' + quotedTmp + ' && mv -f ' + quotedTmp + ' ' + BINARY_PATH);
		if (result.rc != 0) run('rm -f ' + (quotedTmp || "''"));
		if (prepared == null || downloaded.file != null) cleanup_download(downloaded);
		return result;
	}
	let quoted = literal(downloaded.file), keys = literal(downloaded.keysDir);
	let trustFlag = downloaded.trustMode == 'sha256-only' ? '--allow-untrusted ' : '';
	let result = run('apk ' + trustFlag + '--keys-dir ' + keys + ' add --no-interactive ' + quoted);
	cleanup_download(downloaded);
	return result;
}

function restore_previous(previous, wasRunning, settingsSnapshot) {
	let failures = remove_packages();
	let binaryRestored = false;
	if (previous.activeProvider != null && previous.packageInstalled === true && previous.packageVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		if (provider == null || !safe_package_version(previous.packageVersion)) {
			push(failures, 'previous-provider-unknown');
		} else {
			let add = run('apk add --no-interactive ' + provider.package + '=' + previous.packageVersion);
			if (add.rc != 0 || !package_present(provider.package)) push(failures, 'previous-package-restore');
			else if (!save_state(provider.id, previous.activeVersion, previous.packageVersion, previous.sourceId)) push(failures, 'previous-state-restore');
		}
	} else if (previous.activeProvider != null) {
		binaryRestored = restore_binary(settingsSnapshot);
		if (!binaryRestored) push(failures, 'binary-restore');
		else if (!save_state(previous.activeProvider, previous.activeVersion, previous.packageVersion, previous.sourceId)) push(failures, 'previous-state-restore');
	} else if (!save_state(null, null, null)) push(failures, 'empty-state-restore');
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (!binaryRestored && !restore_binary(settingsSnapshot)) push(failures, 'binary-restore');
	if (wasRunning && length(failures) == 0 &&
		(service('restart') != 0 || !wait_for_service_ready())) push(failures, 'previous-service-restore');
	return failures;
}

function input_provider_only(value) {
	if (type(value) != 'object' || value == null) return false;
	let ks = keys(value);
	if (length(ks) != 2 || type(value.provider) != 'string' || type(value.checkToken) != 'string') return false;
	return (ks[0] == 'provider' && ks[1] == 'checkToken') || (ks[0] == 'checkToken' && ks[1] == 'provider');
}

function input_provider_version(value) {
	if (type(value) != 'object' || value == null) return false;
	let ks = keys(value);
	if (length(ks) != 4 || type(value.provider) != 'string' || type(value.checkToken) != 'string' ||
		type(value.sourceId) != 'string' || type(value.version) != 'string') return false;
	return provider_by_id(value.provider) != null && source_kind(value.sourceId) != null && safe_package_version(value.version);
}

export const proxy_provider_install_transaction = function (provider, latest, token, operationId) {
	let previousStatus = proxy_provider_status();
	let previous = {
		activeProvider: previousStatus.activeProvider,
		activeVersion: previousStatus.activeVersion,
		packageVersion: previousStatus.activePackageVersion,
		sourceId: previousStatus.activeSourceId,
		packageInstalled: installed_package_name(previousStatus, previousStatus.activeProvider) != null
	};
	let wasRunning = previousStatus.running === true;
	let settingsSnapshot = snapshot_settings();
	let result = null;
	let prepared = null;
	try {
		operation_update(operationId, 'PREFLIGHT', 8, 'Проверяется выбранный релиз и архитектура.');
		prepared = prepare_candidate(latest, token);
		if (!prepared.ok) {
			result = prepared;
		} else {
			operation_update(operationId, 'DOWNLOAD', 22, latest.artifactFormat == 'binary' ? 'Загружен direct binary выбранного релиза.' : 'Подготовлен выбранный APK.');
			operation_update(operationId, 'VERIFY', 34, 'Размер, SHA-256 и формат артефакта подтверждены.');
		}
		let alreadyLatest = previousStatus.installed &&
			previous.activeProvider == provider.id &&
			previous.packageVersion == latest.packageVersion && previous.sourceId == latest.sourceId;
		if (result != null && result.ok === false) {
			// Preparation failed before the running provider was touched.
		} else if (!settingsSnapshot.ok) {
			result = error('ESTATE', 'Настройки не удалось сохранить; установка не начата.');
		} else if (alreadyLatest) {
			result = { ok: true, changed: false, status: previousStatus };
		} else {
			operation_update(operationId, 'BACKUP', 42, 'Создан snapshot текущего provider, binary и конфигурации.');
		}
		if (result == null && wasRunning && service('stop') != 0) {
			result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
		} else if (result == null) {
			let removeFailures = remove_packages();
			if (length(removeFailures) > 0) {
				operation_update(operationId, 'ROLLING_BACK', 78, 'Удаление текущей реализации не удалось; выполняется откат.', 'ROLLING_BACK');
				let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
				result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить текущую реализацию.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
			} else {
				operation_update(operationId, 'INSTALL', 58, 'Устанавливается выбранная реализация атомарно.');
				let add = install_candidate(provider, latest, token, prepared);
				cleanup_download(prepared);
				let runtimePresent = latest.artifactFormat == 'binary'
					? latest.binaryPath == BINARY_PATH && stat(BINARY_PATH) != null
					: provider_installed(provider);
				if (add.ok === false || add.rc != 0 || !runtimePresent || stat(BINARY_PATH) == null) {
					operation_update(operationId, 'ROLLING_BACK', 78, 'Новая реализация не прошла проверку; выполняется откат.', 'ROLLING_BACK');
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: latest.incompatibilityReason || 'Выбранный пакет недоступен на устройстве.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
				} else if (!restore_settings(settingsSnapshot)) {
					operation_update(operationId, 'ROLLING_BACK', 80, 'Конфигурация не прошла проверку; выполняется откат.', 'ROLLING_BACK');
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
				} else if (!save_state(provider.id, latest.version, latest.packageVersion, latest.sourceId)) {
					operation_update(operationId, 'ROLLING_BACK', 84, 'Состояние provider не сохранилось; выполняется откат.', 'ROLLING_BACK');
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось сохранить выбранную реализацию.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
				} else if (wasRunning && (service('restart') != 0 || !wait_for_service_ready())) {
					operation_update(operationId, 'ROLLING_BACK', 88, 'Новая реализация не запустилась; выполняется откат.', 'ROLLING_BACK');
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Новая реализация установлена, но не прошла запуск.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
				} else {
					operation_update(operationId, 'CONFIG_VALIDATE', 72, 'Конфигурация восстановлена и проверена.');
					operation_update(operationId, 'RESTART', 84, wasRunning ? 'Сервис перезапущен.' : 'Сервис оставлен остановленным.');
					let health = proxycfg_health({ upstream: true });
					if (health == null || health.ok !== true) {
						operation_update(operationId, 'ROLLING_BACK', 90, 'Healthcheck не подтвердил новый provider; выполняется откат.', 'ROLLING_BACK');
						let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
						result = { ok: false, error: { code: 'EHEALTH', message: 'Новая реализация не прошла проверку процесса, listener или Telegram.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
					}
				}
				if (result == null) {
					operation_update(operationId, 'HEALTHCHECK', 94, 'Процесс, listener и Telegram healthcheck подтверждены.');
					let reread = proxy_provider_status();
					result = {
						ok: reread.installed && reread.activeProvider == provider.id &&
							reread.activePackageVersion == latest.packageVersion,
						changed: true,
						provider: provider.id,
						version: latest.version,
						status: reread,
						settingsPreserved: settingsSnapshot.hadConfig === true
					};
					if (!result.ok) result.error = { code: 'EVERIFY', message: 'Установка не подтверждена повторным чтением.' };
				}
			}
		}
	} catch (e) {
		operation_update(operationId, 'ROLLING_BACK', 90, 'Сбой транзакции; выполняется откат.', 'ROLLING_BACK');
		let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
		result = { ok: false, error: { code: 'EINTERNAL', message: 'Сбой транзакции установки.' }, rollbackFailures: rollbackFailures, rollbackAttempted: true };
	}
	cleanup_download(prepared);
	clear_snapshot();
	release_lock();
	return result;
};

export const proxy_provider_install = function (input) {
	if (!input_provider_version(input))
		return error('EINPUT', 'Установка требует provider, sourceId, version и token свежей проверки.');
	let provider = provider_by_id(input.provider);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let activeOperation = operation_active();
	if (activeOperation != null)
		return { ok: false, error: { code: 'EBUSY', message: 'Другая операция TG Proxy уже выполняется.' }, operation: activeOperation };
	let checked = load_checked_candidate(provider.id, input.checkToken, input.sourceId, input.version);
	if (!checked.ok) return checked;
	let latest = checked.candidate, previousStatus = proxy_provider_status();
	let from = previousStatus.activeProvider != null ? { provider: previousStatus.activeProvider, version: previousStatus.activeVersion, packageVersion: previousStatus.activePackageVersion } : null;
	let comparison = previousStatus.activeProvider == provider.id ? compare_versions(previousStatus.activePackageVersion || previousStatus.activeVersion,
		latest.packageVersion || latest.version) : null;
	let operationType = !previousStatus.installed ? 'INSTALL' : previousStatus.activeProvider != provider.id ? 'PROVIDER_SWITCH' : comparison != null && comparison > 0 ? 'DOWNGRADE' : 'UPDATE';
	return operation_submit(operationType, from, { provider: provider.id, version: latest.version, packageVersion: latest.packageVersion }, input, latest);
};

export const proxy_provider_remove_transaction = function (input, operationId) {
	if (type(input) != 'object' || input == null || input.confirm != 'REMOVE')
		return error('EINPUT', 'Удаление требует подтверждение REMOVE.');
	let wasRunning = running();
	let settingsSnapshot = snapshot_settings();
	let result = null;
	try {
		operation_update(operationId, 'PREFLIGHT', 8, 'Проверяется состояние установленного TG Proxy.');
		if (!settingsSnapshot.ok) result = error('ESTATE', 'Настройки не удалось сохранить; удаление не начато.');
		else if (wasRunning && service('stop') != 0) result = error('ETARGET', 'Не удалось остановить TG Proxy.');
		else {
			operation_update(operationId, 'BACKUP', 30, 'Создан snapshot конфигурации перед удалением.');
			let failures = remove_packages();
			if (length(failures) > 0) result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить пакет TG Proxy.' }, failures: failures, rollbackFailures: [] };
			else if (!remove_direct_binary()) result = error('ETARGET', 'Не удалось удалить binary TG Proxy.');
			else if (!restore_settings(settingsSnapshot)) result = error('ETARGET', 'Пакет удалён, но настройки восстановить не удалось.');
		else if (!save_state(null, null, null)) result = error('ETARGET', 'Не удалось обновить состояние после удаления.');
			else result = { ok: true, installed: false, settingsPreserved: settingsSnapshot.hadConfig === true, running: false };
		}
	} catch (e) {
		result = error('EINTERNAL', 'Сбой удаления TG Proxy.');
	}
	operation_update(operationId, result != null && result.ok === true ? 'HEALTHCHECK' : 'ROLLING_BACK', result != null && result.ok === true ? 85 : 75,
		result != null && result.ok === true ? 'Удаление проверено повторным чтением.' : 'Удаление завершилось ошибкой.', result != null && result.ok === true ? null : 'ROLLING_BACK');
	clear_snapshot();
	return result;
};

export const proxy_provider_remove = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'REMOVE')
		return error('EINPUT', 'Удаление требует подтверждение REMOVE.');
	let status = proxy_provider_status();
	return operation_submit('UNINSTALL', status.activeProvider != null ? { provider: status.activeProvider, version: status.activeVersion } : null, null, input, null);
};

export const proxy_provider_purge_transaction = function (input, operationId) {
	if (type(input) != 'object' || input == null || input.confirm != 'PURGE')
		return error('EINPUT', 'Полная очистка требует подтверждение PURGE.');
	let removed = proxy_provider_remove_transaction({ confirm: 'REMOVE' }, operationId);
	if (!removed.ok) return removed;
	operation_update(operationId, 'INSTALL', 92, 'Удаляется сохранённая конфигурация и secret.');
	let rm = run('rm -rf ' + CONFIG_DIR + ' ' + STATE_FILE);
	if (rm.rc != 0 || stat(CONFIG_DIR) != null) return error('ETARGET', 'Пакет удалён, но настройки очистить не удалось.');
	return { ok: true, installed: false, settingsPreserved: false, purged: true };
};

export const proxy_provider_purge = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'PURGE')
		return error('EINPUT', 'Полная очистка требует подтверждение PURGE.');
	let status = proxy_provider_status();
	return operation_submit('PURGE', status.activeProvider != null ? { provider: status.activeProvider, version: status.activeVersion } : null, null, input, null);
};

export const proxy_provider_operation_run = function (operationId) {
	let operation = operation_read(operationId);
	if (operation == null) return error('ENOENT', 'Операция TG Proxy не найдена.');
	if (!acquire_lock()) {
		let busy = error('EBUSY', 'Другая операция TG Proxy уже выполняется.');
		operation_terminal(operationId, busy);
		return busy;
	}
	let result = null;
	try {
		if (operation.operationType == 'UNINSTALL') result = proxy_provider_remove_transaction(operation.input, operationId);
		else if (operation.operationType == 'PURGE') result = proxy_provider_purge_transaction(operation.input, operationId);
		else {
			let provider = provider_by_id(operation.to != null ? operation.to.provider : null);
			if (provider == null || operation.candidate == null) result = error('EINPUT', 'Операция не содержит проверенного кандидата.');
			else result = proxy_provider_install_transaction(provider, operation.candidate,
				operation.input != null ? operation.input.checkToken : null, operationId);
		}
	} catch (e) { result = error('EINTERNAL', 'Worker TG Proxy завершился с исключением.'); }
	if (result == null) result = error('EINTERNAL', 'Worker TG Proxy не вернул результат.');
	operation_terminal(operationId, result);
	release_lock();
	return result;
};
