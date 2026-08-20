'use strict';
// Optional TG Proxy provider manager.
//
// The browser sends only an allow-listed provider id and release identity. It
// cannot choose an arbitrary version, package name, URL or shell fragment.
// Rust is distributed as a signed-by-digest official GitHub release archive;
// Go remains package based until its OpenWrt artifact is available.

import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';

const STATE_FILE = '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = '/tmp/zapret2-manager-proxy-provider.lock';
const SNAP_DIR = '/tmp/zapret2-manager-proxy-provider-snapshot';
const INIT_PATH = '/etc/init.d/tg-ws-proxy';
const CONFIG_DIR = '/etc/tg-ws-proxy';
const BINARY_PATH = '/usr/bin/tg-ws-proxy';
const CHECK_DIR = '/tmp/zapret2-manager/proxy-provider-checks';
const CHECK_TTL = 600;
const MAX_METADATA = 4194304;

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
	if (provider == 'rust') return 'https://api.github.com/repos/valnesfjord/tg-ws-proxy-rs/releases/latest';
	if (provider == 'go') return 'https://api.github.com/repos/spatiumstas/tg-ws-proxy-go/releases/latest';
	return null;
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

function release_candidate(providerId, arch, release) {
	if (type(release) != 'object' || release == null || release.draft !== false || release.prerelease !== false) return null;
	let tag = release.tag_name;
	if (type(tag) != 'string') return null;
	let version = null, packageVersion = null, assetName = null;
	if (providerId == 'rust') {
		if (!match(tag, /^v[0-9][0-9A-Za-z._-]*$/)) return null;
		version = substr(tag, 1);
		let target = substr(arch, 0, 8) == 'aarch64_' ? 'aarch64' : arch;
		if (target == 'aarch64') assetName = 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz';
		else if (target == 'x86_64') assetName = 'tg-ws-proxy-x86_64-unknown-linux-musl.tar.gz';
		else if (substr(target, 0, 4) == 'arm_') assetName = 'tg-ws-proxy-armv7-unknown-linux-musleabihf.tar.gz';
		else if (substr(target, 0, 8) == 'mipsel_') assetName = 'tg-ws-proxy-mipsel-unknown-linux-musl.tar.gz';
		else if (substr(target, 0, 5) == 'mips_') assetName = 'tg-ws-proxy-mips-unknown-linux-musl.tar.gz';
		packageVersion = version + '-r1';
	} else if (providerId == 'go') {
		let found = match(tag, /^([0-9][0-9A-Za-z._-]*)-rev([0-9]+)$/);
		if (!found) return null;
		version = found[1] + '-' + found[2];
		packageVersion = found[1] + '-r' + found[2];
		assetName = 'tg-ws-proxy_' + packageVersion + '_openwrt_' + arch + '.apk';
	}
	if (!safe_package_version(version) || !safe_package_version(packageVersion) || assetName == null) return null;
	let asset = exact_asset(release.assets, assetName), digest = asset != null ? safe_digest(asset.digest) : null;
	let prefix = providerId == 'rust'
		? 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/' + tag + '/'
		: 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/download/' + tag + '/';
	if (asset == null || asset.state != 'uploaded' || digest == null || +asset.size < 1024 || +asset.size > 33554432 || asset.browser_download_url != prefix + assetName) return null;
	return { provider: providerId, version: version, packageVersion: packageVersion, architecture: arch,
		assetName: assetName, assetSha256: digest, assetSize: +asset.size, releaseId: '' + release.id,
		publishedAt: release.published_at, metadataUrl: metadata_url(providerId),
		releaseName: release.name || null, releaseBody: release.body || null,
		releaseUrl: release.html_url || null,
		 downloadUrl: asset.browser_download_url };
}

function latest_candidate(providerId, arch) {
	let fetched = fetch_metadata(providerId);
	if (!fetched.ok) return fetched;
	let candidate = release_candidate(providerId, arch, fetched.document);
	if (candidate == null) return error('EMETADATA', 'Для архитектуры устройства нет подходящего официального артефакта.');
	candidate.sourceId = 'official-github-release';
	candidate.artifactAvailable = true;
	candidate.architectureCompatible = true;
	candidate.checksumAvailable = true;
	candidate.trustMode = 'sha256-only';
	candidate.directBinaryAvailable = providerId == 'rust';
	candidate.apkAvailable = providerId == 'go';
	candidate.installMode = providerId == 'rust' ? 'direct-release' : 'apk-package';
	candidate.installable = providerId == 'rust';
	return { ok: true, candidate: candidate };
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
	return length(ks) == 3 && type(value.sourceId) == 'string' && value.sourceId == 'official-github-release' &&
		type(value.version) == 'string' && safe_package_version(value.version);
}

export const proxy_provider_check_updates = function (input) {
	if (!check_input(input)) return error('EINPUT', 'Нужно выбрать Rust или Go.');
	let arch = architecture();
	if (arch == null) return error('EARCH', 'Архитектура устройства не распознана.');
	let resolved = latest_candidate(input.provider, arch);
	if (!resolved.ok) return resolved;
	let candidate = resolved.candidate;
	if (input.version != null && (input.sourceId != candidate.sourceId || input.version != candidate.version))
		return error('EVERSION', 'Выбранная версия больше не является последним официальным release.');
	let token = random_token();
	if (safe_token(token) == null) return error('EINTERNAL', 'Не удалось создать token проверки.');
	ensure_dir(CHECK_DIR);
	let now = time();
	let record = { schema: 'proxy-provider-check.v1', token: token, checkedAt: now, expiresAt: now + CHECK_TTL, candidate: candidate };
	if (!atomic_json(CHECK_DIR + '/' + token + '.json', record)) return error('EINTERNAL', 'Не удалось сохранить результат проверки.');
	let status = proxy_provider_status();
	let same = status.installed && status.activeProvider == input.provider;
	let comparison = same ? compare_versions(status.activePackageVersion, candidate.packageVersion) : null;
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

function load_checked_candidate(providerId, token) {
	if (provider_by_id(providerId) == null || safe_token(token) == null) return error('EINPUT', 'Некорректный provider или check token.');
	let path = CHECK_DIR + '/' + token + '.json', record = read_json(path, null);
	if (record == null || record.token != token || type(record.candidate) != 'object' || record.candidate.provider != providerId)
		return error('ECHECKTOKEN', 'Сначала выполните проверку обновлений.');
	if (+record.expiresAt < time()) { try { unlink(path); } catch (e) { } return error('ECHECKEXPIRED', 'Результат проверки устарел. Повторите проверку.'); }
	let candidate = record.candidate;
	if (!safe_package_version(candidate.version) || !safe_package_version(candidate.packageVersion) || candidate.installable !== true)
		return error('EINCOMPATIBLE', 'Проверенная официальная версия пока недоступна для установки.');
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

function install_direct_candidate(candidate) {
	if (type(candidate) != 'object' || candidate == null || candidate.installMode != 'direct-release' ||
		type(candidate.downloadUrl) != 'string' || safe_digest('sha256:' + candidate.assetSha256) == null)
		return error('EINCOMPATIBLE', 'Официальный direct release не прошёл проверку.');
	let base = '/tmp/zapret2-manager/tg-proxy.' + time(), archive = base + '.tar.gz', extract = base + '.extract';
	let archiveQ = literal(archive), extractQ = literal(extract), urlQ = literal(candidate.downloadUrl);
	if (archiveQ == null || extractQ == null || urlQ == null) return error('ESECURITY', 'Ссылка release не прошла allowlist.');
	let download = run('mkdir -p ' + literal('/tmp/zapret2-manager') + ' && ulimit -f 65536; uclient-fetch -q -T 30 --user-agent zapret2-manager/tg-proxy -O ' + archiveQ + ' ' + urlQ);
	if (download.rc != 0 || stat(archive) == null) {
		run('rm -rf ' + archiveQ + ' ' + extractQ);
		return error('ENETWORK', 'Не удалось загрузить официальный Rust release.');
	}
	let digest = trim(run('sha256sum ' + archiveQ + ' | awk \'{print $1}\'').out);
	if (lc(digest) != lc(candidate.assetSha256)) {
		run('rm -rf ' + archiveQ + ' ' + extractQ);
		return error('EVERIFY', 'SHA-256 Rust release не совпал с GitHub digest.');
	}
	if (run('mkdir -p ' + extractQ + ' && tar -xzf ' + archiveQ + ' -C ' + extractQ).rc != 0) {
		run('rm -rf ' + archiveQ + ' ' + extractQ);
		return error('EVERIFY', 'Архив Rust release не удалось распаковать.');
	}
	let binary = trim(run('find ' + extractQ + ' -type f -name tg-ws-proxy -print -quit').out);
	let binaryQ = literal(binary), staged = literal(BINARY_PATH + '.new');
	if (binaryQ == null || stat(binary) == null || run('chmod 755 ' + binaryQ + ' && cp -f ' + binaryQ + ' ' + staged + ' && chmod 755 ' + staged + ' && mv -f ' + staged + ' ' + literal(BINARY_PATH)).rc != 0) {
		run('rm -rf ' + archiveQ + ' ' + extractQ + ' ' + staged);
		return error('ETARGET', 'Не удалось заменить Rust binary.');
	}
	run('rm -rf ' + archiveQ + ' ' + extractQ);
	return { ok: true };
}

function restore_previous(previous, wasRunning, settingsSnapshot) {
	let failures = remove_packages();
	if (previous.activeProvider != null && previous.packageVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		if (provider == null || !safe_package_version(previous.packageVersion)) {
			push(failures, 'previous-provider-unknown');
		} else if (previous.package == null && settingsSnapshot.hadBinary === true) {
			if (!save_state(provider.id, previous.activeVersion, previous.packageVersion)) push(failures, 'previous-state-restore');
		} else {
			let add = run('apk add --no-interactive ' + provider.package + '=' + previous.packageVersion);
			if (add.rc != 0 || !package_present(provider.package)) push(failures, 'previous-package-restore');
			else if (!save_state(provider.id, previous.activeVersion, previous.packageVersion)) push(failures, 'previous-state-restore');
		}
	} else if (!save_state(null, null, null)) push(failures, 'empty-state-restore');
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (!restore_binary(settingsSnapshot)) push(failures, 'binary-restore');
	if (wasRunning && length(failures) == 0 && service('start') != 0) push(failures, 'previous-service-restore');
	return failures;
}

function input_provider_only(value) {
	if (type(value) != 'object' || value == null) return false;
	let ks = keys(value);
	if (length(ks) != 2 || type(value.provider) != 'string' || type(value.checkToken) != 'string') return false;
	return (ks[0] == 'provider' && ks[1] == 'checkToken') || (ks[0] == 'checkToken' && ks[1] == 'provider');
}

export const proxy_provider_install = function (input) {
	if (!input_provider_only(input))
		return error('EINPUT', 'Установка требует provider и token свежей проверки.');
	let provider = provider_by_id(input.provider);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let checked = load_checked_candidate(provider.id, input.checkToken);
	if (!checked.ok) return checked;
	let latest = checked.candidate;
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
			previous.packageVersion == latest.packageVersion;
		if (!settingsSnapshot.ok) {
			result = error('ESTATE', 'Настройки не удалось сохранить; установка не начата.');
		} else if (alreadyLatest) {
			result = { ok: true, changed: false, status: previousStatus };
		} else if (wasRunning && service('stop') != 0) {
			result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
		} else {
			let removeFailures = remove_packages();
			if (length(removeFailures) > 0) {
				let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
				result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить текущую реализацию.' }, rollbackFailures: rollbackFailures };
			} else {
				let add = latest.installMode == 'direct-release' ? install_direct_candidate(latest) :
					run('apk add --no-interactive ' + provider.package + '=' + latest.packageVersion);
				let installed = latest.installMode == 'direct-release'
					? add.ok === true
					: add.rc == 0 && package_present(provider.package) && stat(BINARY_PATH) != null;
				if (!installed) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: add.error || { code: 'ETARGET', message: 'Официальный TG Proxy release недоступен на устройстве.' }, rollbackFailures: rollbackFailures };
				} else if (!restore_settings(settingsSnapshot)) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: rollbackFailures };
				} else if (!save_state(provider.id, latest.version, latest.packageVersion)) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось сохранить выбранную реализацию.' }, rollbackFailures: rollbackFailures };
				} else if (wasRunning && service('start') != 0) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Новая реализация установлена, но не прошла запуск.' }, rollbackFailures: rollbackFailures };
				} else {
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
