'use strict';
// Optional TG Proxy provider manager (variant 1: feed-authoritative).
//
// The browser sends only an allow-listed provider id and release identity. It
// cannot choose an arbitrary version, package name, URL or shell fragment.
// BOTH providers are distributed exclusively as signed Z2M provider APKs,
// resolved from the Z2M provider-feed manifest. GitHub upstream metadata is a
// discovery/build-input source only and is never the runtime install
// authority.

import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';

const STATE_FILE = getenv('Z2M_TGPROVIDER_STATE') || '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = getenv('Z2M_TGPROVIDER_LOCK') || '/tmp/zapret2-manager-proxy-provider.lock';
const SNAP_DIR = getenv('Z2M_TGPROVIDER_SNAP') || '/tmp/zapret2-manager-proxy-provider-snapshot';
const INIT_PATH = getenv('Z2M_TGPROVIDER_INIT') || '/etc/init.d/tg-ws-proxy';
const CONFIG_DIR = getenv('Z2M_TGPROVIDER_CONFIG') || '/etc/tg-ws-proxy';
const SECRET_PATH = CONFIG_DIR + '/secret.conf';
const BINARY_PATH = getenv('Z2M_TGPROVIDER_BINARY') || '/usr/bin/tg-ws-proxy';
const CHECK_DIR = getenv('Z2M_TGPROVIDER_CHECK') || '/tmp/zapret2-manager/proxy-provider-checks';
const CHECK_TTL = 600;
const MAX_METADATA = 4194304;
// Manager-owned shared TG lifecycle surface (independent of any provider).
// Keys must stay within proxycfg's CONF_KEY_MAP (LOGLEVEL is not one).
const DEFAULT_CONFIG_BODY = '# Default Telegram MTProto WebSocket proxy configuration (manager-owned).\n' +
	'# Provider updates preserve this file.\n\nHOST=127.0.0.1\nPORT=1443\n';
// Secret storage uses proxycfg's canonical `SECRET=<32hex>` format so both
// subsystems parse the same file; the init layer maps it to TG_* env vars.
const DEFAULT_INIT_BODY = '#!/bin/sh /etc/rc.common\n' +
	'START=99\nSTOP=10\nUSE_PROCD=1\n' +
	'start_service() {\n\tlocal secret host port\n' +
	'\tsecret="$(cat /etc/tg-ws-proxy/secret.conf 2>/dev/null | sed -n \'s/^SECRET=//p\' | head -n 1)"\n' +
	'\thost="$(cat /etc/tg-ws-proxy/config.conf 2>/dev/null | sed -n \'s/^HOST=//p\' | head -n 1)"\n' +
	'\tport="$(cat /etc/tg-ws-proxy/config.conf 2>/dev/null | sed -n \'s/^PORT=//p\' | head -n 1)"\n' +
	'\t[ -n "$secret" ] || return 1\n' +
	'\tprocd_open_instance\n\tprocd_set_param command ' + BINARY_PATH + '\n' +
	'\tprocd_set_param env TG_SECRET="$secret" TG_HOST="$host" TG_PORT="$port"\n' +
	'\tprocd_set_param file /etc/tg-ws-proxy/config.conf\n' +
	'\tprocd_set_param respawn 3600 5 0\n\tprocd_close_instance\n}\n';

const PROVIDERS = [
	{
		id: 'rust',
		title: 'Rust',
		short: 'Лучше обходит сложные блокировки',
		feature: 'Автоматически пробует разные способы подключения; рекомендуется большинству пользователей',
		repository: 'valnesfjord/tg-ws-proxy-rs',
		package: 'tg-ws-proxy-rs'
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Простой базовый вариант',
		feature: 'Подходит для обычного подключения и поддерживает основные способы обхода блокировок',
		repository: 'spatiumstas/tg-ws-proxy-go',
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
	return found ? lc(found[1]) : null;
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
	let quoted = literal(path);
	if (quoted == null) return false;
	if (stat(path) == null) run('mkdir -p ' + quoted);
	run('chmod 700 ' + quoted);
	return stat(path) != null;
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

function random_hex32() {
	return substr(trim(run("(cat /proc/sys/kernel/random/uuid; cat /proc/sys/kernel/random/uuid) | tr -cd 'a-f0-9' | cut -c1-32").out), 0, 32);
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
	return 'https://api.github.com/repos/' + provider.repository + '/releases?per_page=30';
}

function fetch_metadata(provider) {
	let url = metadata_url(provider), quotedUrl = literal(url);
	if (url == null || quotedUrl == null) return error('ESECURITY', 'Metadata URL не входит в allowlist.');
	let file = '/tmp/zapret2-manager/proxy-provider-metadata.' + provider.id + '.' + time();
	run('mkdir -p /tmp/zapret2-manager');
	let quotedFile = literal(file);
	let result = run('ulimit -f 8192; uclient-fetch -q -T 20 --user-agent zapret2-manager/proxy -O ' + quotedFile + ' ' + quotedUrl);
	let info = stat(file);
	if (result.rc != 0 || info == null) { try { unlink(file); } catch (e) { } return error('ENETWORK', 'Не удалось проверить обновления.'); }
	if (info.size < 2 || info.size > MAX_METADATA) { try { unlink(file); } catch (e) { } return error('EMETADATA', 'Ответ upstream имеет недопустимый размер.'); }
	let document = read_json(file, null);
	try { unlink(file); } catch (e) { }
	if (document == null || type(document) != 'array')
		return error('EMETADATA', 'Ответ upstream повреждён.');
	return { ok: true, document: document };
}

// Map a release to the provider-specific install artifact for this router.
// Rust upstream ships static musl binary tar.gz archives; Go upstream ships
// OpenWrt APK assets. Returns null when no compatible asset exists.
function provider_asset(providerId, arch, tag, assetName) {
	let target = substr(arch, 0, 8) == 'aarch64_' ? 'aarch64' : arch;
	if (providerId == 'rust') {
		if (target == 'aarch64') return assetName == 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (target == 'x86_64') return assetName == 'tg-ws-proxy-x86_64-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 4) == 'arm_') return assetName == 'tg-ws-proxy-armv7-unknown-linux-musleabihf.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 8) == 'mipsel_') return assetName == 'tg-ws-proxy-mipsel-unknown-linux-musl.tar.gz' ? 'archive' : null;
		if (substr(target, 0, 5) == 'mips_') return assetName == 'tg-ws-proxy-mips-unknown-linux-musl.tar.gz' ? 'archive' : null;
		return null;
	}
	// go: OpenWrt APK asset named tg-ws-proxy_<pkgver>_openwrt_<arch>.apk
	if (substr(assetName, 0, 12) == 'tg-ws-proxy_' &&
		substr(assetName, length(assetName) - (13 + length(arch))) == '_openwrt_' + arch + '.apk')
		return 'apk';
	return null;
}

function parse_release(providerId, providerRepo, arch, release) {
	if (type(release) != 'object' || release == null || release.draft === true) return null;
	let tag = release.tag_name;
	if (type(tag) != 'string' || !match(tag, /^v?[0-9][0-9A-Za-z._-]*$/)) return null;
	let version = substr(tag, 1) != '' && substr(tag, 0, 1) == 'v' ? substr(tag, 1) : tag;
	if (!safe_package_version(version)) return null;
	let prerelease = release.prerelease === true;
	let assets = type(release.assets) == 'array' ? release.assets : [];
	for (let i = 0; i < length(assets); i++) {
		let asset = assets[i];
		if (type(asset) != 'object' || asset == null || asset.state != 'uploaded') continue;
		let name = asset.name;
		if (type(name) != 'string') continue;
		let kind = provider_asset(providerId, arch, tag, name);
		if (kind == null) continue;
		let digest = safe_digest(asset.digest != null ? asset.digest : '');
		let prefix = 'https://github.com/' + providerRepo + '/releases/download/' + tag + '/';
		if (type(asset.browser_download_url) != 'string' || asset.browser_download_url != prefix + name)
			continue; // asset must belong to THIS exact release
		return {
			provider: providerId,
			version: version,
			tag: tag,
			releaseId: release.id != null ? '' + release.id : '',
			publishedAt: release.published_at != null ? release.published_at : null,
			prerelease: prerelease,
			artifactKind: kind,
			artifactName: name,
			assetSha256: digest,
			assetSize: asset.size != null ? +asset.size : 0,
			downloadUrl: asset.browser_download_url,
			metadataUrl: metadata_url({ repository: providerRepo }),
			releaseUrl: release.html_url != null ? release.html_url : null
		};
	}
	return null;
}

// Parse the full releases list into installable candidates (stable first).
function release_candidates(provider, arch, document) {
	let found = [];
	for (let i = 0; i < length(document); i++) {
		let candidate = parse_release(provider.id, provider.repository, arch, document[i]);
		if (candidate != null) push(found, candidate);
	}
	for (let j = 1; j < length(found); j++) {
		let cur = found[j];
		for (let k = j - 1; k >= 0; k--) {
			let cmp = compare_versions(cur.version, found[k].version);
			if (cmp == 0 || cmp == null) cmp = cur.version < found[k].version ? -1 : 1;
			if (cmp > 0) { found[k + 1] = found[k]; found[k] = cur; } else break;
		}
	}
	return found;
}

// Fetch and parse the full compatible release list for a provider.
function list_candidates(providerId, arch) {
	let provider = null;
	for (let i = 0; i < length(PROVIDERS); i++)
		if (PROVIDERS[i].id == providerId) { provider = PROVIDERS[i]; break; }
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let fetched = fetch_metadata(provider);
	if (!fetched.ok) return fetched;
	let candidates = release_candidates(provider, arch, fetched.document);
	if (length(candidates) == 0)
		return error('EMETADATA', 'Для архитектуры устройства нет подходящих официальных артефактов.');
	for (let i = 0; i < length(candidates); i++) {
		candidates[i].sourceId = 'official-github-release';
		candidates[i].installable = true;
	}
	return { ok: true, candidates: candidates };
}

function public_version_row(candidate, installedVersion) {
	return {
		version: candidate.version,
		prerelease: candidate.prerelease === true,
		artifactKind: candidate.artifactKind,
		installable: candidate.installable === true && candidate.assetSha256 != null,
		reason: candidate.assetSha256 == null ? 'Upstream не предоставил digest для этого asset.' : null,
		update: installedVersion != null && compare_versions(candidate.version, installedVersion) > 0
	};
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

function save_state(providerId, versionId, packageVersion) {
	let tmp = STATE_FILE + '.tmp.' + time();
	let payload = {
		schema: 'proxy-provider.v2',
		activeProvider: providerId,
		activeVersion: versionId,
		activePackageVersion: packageVersion != null ? packageVersion : null,
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

function running() {
	return trim(run('pidof tg-ws-proxy').out) != '';
}

function service(action) {
	if (stat(INIT_PATH) == null) return 0;
	return run(INIT_PATH + ' ' + action).rc;
}

function acquire_lock() {
	return run('mkdir ' + LOCK_DIR).rc == 0;
}

function release_lock() {
	run('rmdir ' + LOCK_DIR);
}

function snapshot_settings() {
	run('rm -rf ' + SNAP_DIR);
	let hadConfig = stat(CONFIG_DIR) != null;
	let hadBinary = stat(BINARY_PATH) != null;
	if (hadConfig && run('mkdir -p ' + SNAP_DIR + '/config').rc != 0)
		return { ok: false, hadConfig: true, hadBinary: hadBinary };
	if (hadConfig && run('cp -a ' + CONFIG_DIR + '/. ' + SNAP_DIR + '/config/').rc != 0)
		return { ok: false, hadConfig: true, hadBinary: hadBinary };
	if (hadBinary && run('cp -a ' + literal(BINARY_PATH) + ' ' + literal(SNAP_DIR + '/binary')).rc != 0)
		return { ok: false, hadConfig: hadConfig, hadBinary: true };
	return { ok: true, hadConfig: hadConfig, hadBinary: hadBinary };
}

function restore_settings(snapshot) {
	if (snapshot == null || snapshot.hadConfig !== true) return true;
	if (stat(SNAP_DIR + '/config') == null) return false;
	if (run('mkdir -p ' + CONFIG_DIR).rc != 0) return false;
	return run('cp -a ' + SNAP_DIR + '/config/. ' + CONFIG_DIR + '/').rc == 0;
}

function restore_binary(snapshot) {
	if (snapshot == null || snapshot.hadBinary !== true) return true;
	if (stat(SNAP_DIR + '/binary') == null) return false;
	return run('cp -a ' + literal(SNAP_DIR + '/binary') + ' ' + literal(BINARY_PATH) +
		' && chmod 755 ' + literal(BINARY_PATH)).rc == 0;
}

function clear_snapshot() {
	run('rm -rf ' + SNAP_DIR);
}

function installed_rows() {
	let rows = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		let packageVersion = installed_package_version(provider.package);
		if (packageVersion != null)
			push(rows, { provider: provider.id, package: provider.package, packageVersion: packageVersion });
	}
	return rows;
}

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
		latestOnly: false,
		providers: out,
		note: 'Показывается установленная версия и последний совместимый официальный release.'
	};
};

function installed_version_row(status, providerId) {
	for (let i = 0; i < length(status.packages); i++) {
		let item = status.packages[i];
		if (item.provider == providerId)
			return {
				provider: providerId,
				version: status.activeProvider == providerId && status.activeVersion != null
					? status.activeVersion : item.packageVersion,
				packageVersion: item.packageVersion,
				installed: true,
				sourceId: 'installed-runtime',
				artifactAvailable: true,
				installable: true,
				architectureCompatible: true,
				unavailableReason: null
			};
	}
	return null;
}

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
			packageVersion: safe_package_version(state.activePackageVersion) ? state.activePackageVersion : state_package_version(stateProvider.id, state.activeVersion),
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
		latestOnly: false,
		installed: activeInstalled,
		activeProvider: activeInstalled ? activeProvider : null,
		activeVersion: activeVersion,
		activePackageVersion: activeInstalled ? activePackageVersion : null,
		latestVersion: null,
		updateAvailable: null,
		packages: installed,
		binaryPresent: stat(BINARY_PATH) != null,
		running: running(),
		configPreserved: stat(CONFIG_DIR) != null,
		drift: length(installed) > 1 || (length(installed) == 1 && !activeInstalled)
	};
};

export const proxy_provider_versions = function () {
	let status = proxy_provider_status(), arch = architecture(), rows = [], allOk = arch != null;
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i], versions = [], installed = installed_version_row(status, provider.id), latest = null;
		if (arch != null) {
			let resolved = latest_candidate(provider.id, arch);
			if (resolved.ok) {
				latest = resolved.candidate;
				push(versions, latest);
			} else if (installed == null) {
				allOk = false;
			}
		}
		if (installed != null) push(versions, installed);
		push(rows, { id: provider.id, provider: provider.id, versions: versions, latest: latest,
			architecture: arch, error: latest == null && installed == null ? 'Версия недоступна.' : null });
	}
	return { ok: status.ok === true && allOk, optional: true, latestOnly: false, architecture: arch, providers: rows };
};

function check_input(value) {
	if (type(value) != 'object' || value == null || type(value.provider) != 'string' || provider_by_id(value.provider) == null)
		return false;
	let ks = keys(value);
	if (length(ks) == 1) return true;
	if (length(ks) == 2 && type(value.version) == 'string' && safe_package_version(value.version)) return true;
	return length(ks) == 3 && type(value.sourceId) == 'string' &&
		(value.sourceId == 'z2m-provider-feed' || value.sourceId == 'official-github-release') &&
		type(value.version) == 'string' && safe_package_version(value.version);
}

export const proxy_provider_check_updates = function (input) {
	if (!check_input(input)) return error('EINPUT', 'Нужно выбрать Rust или Go.');
	let arch = architecture();
	if (arch == null) return error('EARCH', 'Архитектура устройства не распознана.');
	let resolved = list_candidates(input.provider, arch);
	if (!resolved.ok) return resolved;
	let candidates = resolved.candidates;
	let status = proxy_provider_status();
	let installedVersion = status.installed && status.activeProvider == input.provider
		? status.activeVersion : null;
	let versions = [];
	for (let i = 0; i < length(candidates); i++)
		push(versions, public_version_row(candidates[i], installedVersion));
	let latest = null;
	for (let j = 0; j < length(candidates); j++)
		if (candidates[j].prerelease !== true && (latest == null ||
			compare_versions(candidates[j].version, latest.version) > 0))
			latest = candidates[j];
	if (input.version != null) {
		let exact = null;
		for (let k = 0; k < length(candidates); k++)
			if (candidates[k].version == input.version) { exact = candidates[k]; break; }
		if (exact == null)
			return error('EVERSION', 'Выбранная версия недоступна для этой архитектуры.');
	}
	let token = random_token();
	if (safe_token(token) == null) return error('EINTERNAL', 'Не удалось создать token проверки.');
	ensure_dir(CHECK_DIR);
	let now = time();
	let record = { schema: 'proxy-provider-check.v2', token: token, checkedAt: now,
		expiresAt: now + CHECK_TTL, provider: input.provider, candidates: candidates };
	if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return error('EINTERNAL', 'Не удалось сохранить результат проверки.');
	return {
		ok: true,
		checkToken: token,
		checkedAt: now,
		expiresAt: now + CHECK_TTL,
		provider: input.provider,
		installedVersion: installedVersion,
		latestVersion: latest != null ? latest.version : null,
		availableVersions: versions,
		updateAvailable: installedVersion != null && latest != null &&
			compare_versions(latest.version, installedVersion) > 0,
		providerSwitch: status.installed && status.activeProvider != input.provider
	};
};

function load_checked_candidate(providerId, token, version) {
	if (provider_by_id(providerId) == null || safe_token(token) == null) return error('EINPUT', 'Некорректный provider или check token.');
	let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null);
	if (record == null || record.token != token || record.provider != providerId)
		return error('ECHECKTOKEN', 'Сначала выполните проверку обновлений.');
	if (+record.expiresAt < time()) { try { unlink(path); } catch (e) { } return error('ECHECKEXPIRED', 'Результат проверки устарел. Повторите проверку.'); }
	if (type(version) != 'string' || !safe_package_version(version))
		return error('EINPUT', 'Требуется точная выбранная версия.');
	let candidate = null;
	for (let i = 0; i < length(record.candidates); i++)
		if (record.candidates[i].version == version) { candidate = record.candidates[i]; break; }
	if (candidate == null || candidate.installable !== true)
		return error('EINCOMPATIBLE', 'Выбранная версия недоступна или небезопасна для установки.');
	try { unlink(path); } catch (e) { }
	return { ok: true, candidate: candidate };
}

function remove_packages() {
	let failures = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		if (!package_present(provider.package)) continue;
		let r = run('apk del --no-interactive ' + provider.package);
		if (r.rc != 0 || package_present(provider.package)) push(failures, provider.package);
	}
	let state = load_state();
	if (length(failures) == 0 && state.activeProvider != null && stat(BINARY_PATH) != null) {
		let removed = run('rm -f ' + literal(BINARY_PATH));
		if (removed.rc != 0 || stat(BINARY_PATH) != null) push(failures, 'direct-binary-remove');
	}
	return failures;
}

function restore_previous(previous, wasRunning, settingsSnapshot) {
	let failures = remove_packages();
	if (previous.activeProvider != null && previous.packageVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		if (provider == null || !safe_package_version(previous.packageVersion)) {
			push(failures, 'previous-provider-unknown');
		} else if (previous.package != null && !package_present(previous.package)) {
			let add = run('apk add --no-interactive --allow-untrusted ' + previous.package + '=' + previous.packageVersion);
			if (add.rc != 0 || !package_present(previous.package)) push(failures, 'previous-package-restore');
			else if (!save_state(previous.activeProvider, previous.activeVersion, previous.packageVersion))
				push(failures, 'previous-state-restore');
		} else if (!save_state(previous.activeProvider, previous.activeVersion, previous.packageVersion)) {
			push(failures, 'previous-state-restore');
		}
	} else if (!save_state(null, null, null)) push(failures, 'empty-state-restore');
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (!restore_binary(settingsSnapshot)) push(failures, 'binary-restore');
	if (wasRunning && length(failures) == 0 && service('start') != 0) push(failures, 'previous-service-restore');
	return failures;
}

// Manager-owned shared TG lifecycle surface. Guarantees init script,
// default config and secret exist BEFORE any provider install runs, so a
// clean router never hits "no service owner -> cannot install".
// Repair semantics (design §5: manager-owned surface, repaired at runtime):
//  - init script is rewritten whenever its content drifts from
//    DEFAULT_INIT_BODY (e.g. after package update changes the body);
//  - secret.conf missing OR in the legacy `TG_SECRET=` format is migrated to
//    the canonical `SECRET=<32hex>` without changing ownership/mode;
//  - config.conf is only created when missing (user edits are preserved).
function ensure_shared_lifecycle() {
	let failures = [];
	let noRepair = getenv('Z2M_TGPROVIDER_NO_REPAIR') == '1';
	if (!noRepair) {
		if (stat(INIT_PATH) != null) {
			let cur = readfile(INIT_PATH);
			if (cur == null || cur != DEFAULT_INIT_BODY) {
				let tmp = INIT_PATH + '.z2m.new';
				if (!writefile(tmp, DEFAULT_INIT_BODY)) push(failures, 'init-repair-write');
				else if (run('chmod 755 ' + literal(tmp) + ' && mv -f ' + literal(tmp) + ' ' + literal(INIT_PATH)).rc != 0)
					push(failures, 'init-repair');
			}
		}
	}
	if (stat(INIT_PATH) == null) {
		run('mkdir -p ' + literal(substr(INIT_PATH, 0, INIT_PATH.lastIndexOf('/'))));
		if (!writefile(INIT_PATH, DEFAULT_INIT_BODY)) push(failures, 'init-write');
		else if (run('chmod 755 ' + literal(INIT_PATH)).rc != 0) push(failures, 'init-chmod');
	}
	if (stat(CONFIG_DIR + '/config.conf') == null) {
		run('mkdir -p ' + literal(CONFIG_DIR));
		if (!writefile(CONFIG_DIR + '/config.conf', DEFAULT_CONFIG_BODY))
			push(failures, 'config-write');
	}
	let secretRaw = stat(SECRET_PATH) != null ? readfile(SECRET_PATH) : null;
	let canonical = match(secretRaw != null ? secretRaw : '', /(^|\n)SECRET=[a-f0-9]{32}(\n|$)/) != null;
	if (!canonical) {
		// Migrate the legacy TG_SECRET=48hex form by reusing its first 32 hex
		// characters; otherwise generate a fresh CSPRNG secret.
		let legacy = match(secretRaw != null ? secretRaw : '', /TG_SECRET=([a-f0-9]{48})/);
		let token = legacy != null ? substr(legacy[1], 0, 32) : random_hex32();
		run('mkdir -p ' + literal(CONFIG_DIR));
		if (token == null || !writefile(SECRET_PATH, '# MTProto secret for tg-ws-proxy — managed by zapret2-manager.\nSECRET=' + token + '\n'))
			push(failures, 'secret-write');
		else if (run('chmod 600 ' + literal(SECRET_PATH)).rc != 0) push(failures, 'secret-chmod');
	}
	return length(failures) == 0 ? { ok: true } : error('ESTATE', 'Не удалось подготовить shared lifecycle: ' + join(',', failures));
}

function download_verified_artifact(candidate) {
	if (type(candidate.downloadUrl) != 'string' || substr(candidate.downloadUrl, 0, 8) != 'https://')
		return error('ESECURITY', 'Ссылка release не прошла allowlist.');
	if (candidate.assetSize != null && (+candidate.assetSize < 1024 || +candidate.assetSize > 33554432))
		return error('EINCOMPATIBLE', 'Размер артефакта вне допустимых границ.');
	let archive = '/tmp/zapret2-manager/tg-proxy.' + time() + '.artifact';
	run('mkdir -p /tmp/zapret2-manager');
	let archiveQ = literal(archive), urlQ = literal(candidate.downloadUrl);
	if (archiveQ == null || urlQ == null) return error('ESECURITY', 'Ссылка release не прошла allowlist.');
	let download = run('ulimit -f 65536; uclient-fetch -q -T 60 --user-agent zapret2-manager/tg-proxy -O ' + archiveQ + ' ' + urlQ);
	if (download.rc != 0 || stat(archive) == null) {
		run('rm -f ' + archiveQ);
		return error('ENETWORK', 'Не удалось загрузить официальный release.');
	}
	if (candidate.assetSha256 != null) {
		let digest = trim(run('sha256sum ' + archiveQ + " | awk '{print $1}'").out);
		if (lc(digest) != lc(candidate.assetSha256)) {
			run('rm -f ' + archiveQ);
			return error('EVERIFY', 'SHA-256 артефакта не совпал с digest из GitHub release.');
		}
	}
	return { ok: true, path: archive };
}

// RustAdapter: tar.gz -> validated extraction in private staging ->
// atomic binary replace. Rejects absolute paths and ../ traversal.
function install_rust_archive(candidate) {
	let fetched = download_verified_artifact(candidate);
	if (!fetched.ok) return fetched;
	let archiveQ = literal(fetched.path);
	let staging = '/tmp/zapret2-manager/tg-proxy-extract.' + time();
	let stagingQ = literal(staging);
	if (stagingQ == null) { run('rm -f ' + archiveQ); return error('EINTERNAL', 'Staging недоступен.'); }
	let listing = run('tar -tzf ' + archiveQ);
	if (listing.rc != 0) { run('rm -rf ' + archiveQ + ' ' + stagingQ); return error('EVERIFY', 'Архив повреждён.'); }
	let rows = split(listing.out, '\n');
	for (let i = 0; i < length(rows); i++) {
		let entry = trim(rows[i]);
		if (entry == '') continue;
		if (substr(entry, 0, 1) == '/' || index(entry, '../') >= 0 || index(entry, '..\\') >= 0) {
			run('rm -rf ' + archiveQ + ' ' + stagingQ);
			return error('EVERIFY', 'Архив содержит небезопасные пути.');
		}
	}
	if (run('mkdir ' + stagingQ + ' && tar -xzf ' + archiveQ + ' -C ' + stagingQ).rc != 0) {
		run('rm -rf ' + archiveQ + ' ' + stagingQ);
		return error('EVERIFY', 'Архив не удалось распаковать.');
	}
	let binary = trim(run("find " + stagingQ + " -type f -name tg-ws-proxy | head -n 1").out);
	let binaryQ = literal(binary), staged = literal(BINARY_PATH + '.new');
	let bad = binaryQ == null || stat(binary) == null ||
		run('chmod 755 ' + binaryQ + ' && cp -f ' + binaryQ + ' ' + staged +
			' && chmod 755 ' + staged + ' && mv -f ' + staged + ' ' + literal(BINARY_PATH)).rc != 0;
	run('rm -rf ' + archiveQ + ' ' + stagingQ);
	if (bad) return error('ETARGET', 'Не удалось установить tg-ws-proxy binary.');
	return { ok: true };
}

// GoAdapter: OpenWrt APK asset -> verified apk add.
function install_go_apk(candidate) {
	let fetched = download_verified_artifact(candidate);
	if (!fetched.ok) return fetched;
	let archiveQ = literal(fetched.path);
	let add = run('apk add --no-interactive --allow-untrusted ' + archiveQ);
	run('rm -f ' + archiveQ);
	if (add.rc != 0 || stat(BINARY_PATH) == null)
		return error('ETARGET', 'Установка Go provider APK не удалась или binary отсутствует.');
	return { ok: true };
}

// Local hard health gate. External Telegram reachability is NEVER part of
// this gate; it is a separate runtime signal. Process/listener detection
// waits bounded seconds for procd to actually fork+exec the binary.
function tg_provider_health(providerId) {
	if (stat(BINARY_PATH) == null) return { ok: false, code: 'EBINARY', message: 'Binary tg-ws-proxy отсутствует.' };
	if (stat(INIT_PATH) == null) return { ok: false, code: 'EINIT', message: 'Init script tg-ws-proxy отсутствует.' };
	if (stat(SECRET_PATH) == null) return { ok: false, code: 'ESECRET', message: 'Secret файл отсутствует.' };
	let lastProcessCode = 'EPROCESS', lastProcessMessage = 'Процесс tg-ws-proxy не найден после запуска.';
	let processes = [], port = null;
	for (let attempt = 0; attempt < 6; attempt++) {
		if (attempt > 0) run('sleep 1');
		processes = [];
		let psLines = split(run('ps w').out, '\n');
		for (let i = 0; i < length(psLines); i++)
			if (index(psLines[i], BINARY_PATH) >= 0) push(processes, psLines[i]);
		if (length(processes) == 0) { lastProcessCode = 'EPROCESS'; lastProcessMessage = 'Процесс tg-ws-proxy не найден после запуска.'; continue; }
		if (length(processes) > 1) { lastProcessCode = 'EPROCESSCOUNT'; lastProcessMessage = 'Запущено более одного процесса tg-ws-proxy.'; break; }
		let pid = trim(split(trim(processes[0]), /\s+/)[0]);
		port = null;
		let netLines = split(run('netstat -tlnp 2>/dev/null').out, '\n');
		for (let j = 0; j < length(netLines); j++) {
			let rowLine = netLines[j];
			// busybox netstat -p prints "PID/basename", never the full path.
			if (index(rowLine, 'LISTEN') < 0) continue;
			if (pid != '' && index(rowLine, pid + '/') < 0 && index(rowLine, ' ' + pid + ' ') < 0) continue;
			let parts = split(trim(rowLine), /\s+/);
			if (length(parts) >= 4) {
				let seg = split(parts[3], ':');
				port = seg[length(seg) - 1];
			}
			break;
		}
		if (port != null)
			return { ok: true, listenerPort: port, processEvidence: trim(processes[0]) };
		lastProcessCode = 'ELISTENER';
		lastProcessMessage = 'Процесс запущен, но не владеет TCP listener.';
	}
	return { ok: false, code: lastProcessCode, message: lastProcessMessage };
}

// Unified lifecycle transaction for BOTH providers: resolve exact selected
// version -> download+verify -> snapshot -> stop -> adapter install ->
// start -> local hard health gate -> state commit. Failures roll back to
// the previous working provider.
export const proxy_provider_install = function (input) {
	if (type(input) != 'object' || input == null || type(input.provider) != 'string' ||
		type(input.checkToken) != 'string')
		return error('EINPUT', 'Установка требует provider и token свежей проверки.');
	let provider = provider_by_id(input.provider);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let checked = load_checked_candidate(provider.id, input.checkToken, input.version);
	if (!checked.ok) return checked;
	let latest = checked.candidate;
	let shared = ensure_shared_lifecycle();
	if (!shared.ok) return shared;
	if (!acquire_lock()) return error('EBUSY', 'Установка TG Proxy уже выполняется.');

	let previousStatus = proxy_provider_status();
	let previous = {
		activeProvider: previousStatus.activeProvider,
		activeVersion: previousStatus.activeVersion,
		packageVersion: previousStatus.activePackageVersion,
		package: previousStatus.packages && length(previousStatus.packages) ? previousStatus.packages[0].package : null
	};
	let wasRunning = previousStatus.running === true;
	let settingsSnapshot = snapshot_settings();
	let result = null;
	try {
		let alreadyLatest = previousStatus.installed &&
			previous.activeProvider == provider.id &&
			previous.activeVersion == latest.version;
		if (!settingsSnapshot.ok) {
			result = error('ESTATE', 'Настройки не удалось сохранить; установка не начата.');
		} else if (alreadyLatest) {
			result = { ok: true, changed: false, status: previousStatus };
		} else {
			if (wasRunning && service('stop') != 0)
				result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
			else {
				let installed = latest.artifactKind == 'apk' ? install_go_apk(latest) : install_rust_archive(latest);
				if (!installed.ok)
					result = { ok: false, error: installed.error, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
				else if (!restore_settings(settingsSnapshot))
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
				else if (service('enable') != 0 || service('start') != 0)
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось запустить сервис TG Proxy.' }, rollbackFailures: restore_previous(previous, wasRunning, settingsSnapshot) };
				else {
					let health = tg_provider_health(provider.id);
					if (!health.ok) {
						// We started this service; the failed version must not
						// keep running while rollback restores the previous one.
						service('stop');
						let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
						let restartedOk = wasRunning ? service('start') == 0 : true;
						if (!restartedOk) push(rollbackFailures, 'previous-service-restart');
						result = { ok: false, error: { code: 'ETGHEALTH', message: health.message }, health: health, rollbackFailures: rollbackFailures };
					} else {
						save_state(provider.id, latest.version, state_package_version(provider.id, latest.version));
						let reread = proxy_provider_status();
						result = {
							ok: reread.installed && reread.activeProvider == provider.id &&
								reread.activeVersion == latest.version && health.ok,
							changed: true,
							provider: provider.id,
							version: latest.version,
							health: health,
							status: reread,
							settingsPreserved: settingsSnapshot.hadConfig === true
						};
						if (!result.ok) {
							service('stop');
							result.rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
							result.error = { code: 'EVERIFY', message: 'Установка не подтверждена повторным чтением.' };
						}
					}
				}
			}
		}
	} catch (e) {
		let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
		result = { ok: false, error: { code: 'EINTERNAL', message: 'Сбой транзакции установки.' }, rollbackFailures: rollbackFailures };
	}
	clear_snapshot();
	release_lock();
	return result;
};

export const proxy_provider_remove = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'REMOVE')
		return error('EINPUT', 'Удаление требует подтверждение REMOVE.');
	if (!acquire_lock()) return error('EBUSY', 'Другая операция TG Proxy уже выполняется.');
	let wasRunning = running();
	let settingsSnapshot = snapshot_settings();
	let result = null;
	try {
		if (!settingsSnapshot.ok) result = error('ESTATE', 'Настройки не удалось сохранить; удаление не начато.');
		else if (wasRunning && service('stop') != 0) result = error('ETARGET', 'Не удалось остановить TG Proxy.');
		else {
			let failures = remove_packages();
			if (length(failures) > 0) result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить пакет TG Proxy.' }, failures: failures };
			else if (!restore_settings(settingsSnapshot)) result = error('ETARGET', 'Пакет удалён, но настройки восстановить не удалось.');
		else if (!save_state(null, null, null)) result = error('ETARGET', 'Не удалось обновить состояние после удаления.');
			else result = { ok: true, installed: false, settingsPreserved: settingsSnapshot.hadConfig === true, running: false };
		}
	} catch (e) {
		result = error('EINTERNAL', 'Сбой удаления TG Proxy.');
	}
	clear_snapshot();
	release_lock();
	return result;
};

export const proxy_provider_purge = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'PURGE')
		return error('EINPUT', 'Полная очистка требует подтверждение PURGE.');
	let removed = proxy_provider_remove({ confirm: 'REMOVE' });
	if (!removed.ok) return removed;
	let rm = run('rm -rf ' + CONFIG_DIR + ' ' + STATE_FILE);
	if (rm.rc != 0 || stat(CONFIG_DIR) != null) return error('ETARGET', 'Пакет удалён, но настройки очистить не удалось.');
	return { ok: true, installed: false, settingsPreserved: false, purged: true };
};
