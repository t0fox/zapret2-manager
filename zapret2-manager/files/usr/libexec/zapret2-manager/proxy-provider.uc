'use strict';
// Optional TG Proxy provider manager.
//
// The browser sends only an allow-listed provider id. It cannot choose an old
// version, package name, URL or shell fragment. The backend always installs
// the single latest router-compatible package published in the configured
// signed APK feed. Missing providers are a normal state.

import { readfile, writefile, stat, unlink, popen } from 'fs';

const STATE_FILE = '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = '/tmp/zapret2-manager-proxy-provider.lock';
const SNAP_DIR = '/tmp/zapret2-manager-proxy-provider-snapshot';
const INIT_PATH = '/etc/init.d/tg-ws-proxy';
const CONFIG_DIR = '/etc/tg-ws-proxy';
const BINARY_PATH = '/usr/bin/tg-ws-proxy';

const PROVIDERS = [
	{
		id: 'rust',
		title: 'Rust',
		short: 'Легче и экономнее',
		feature: 'Низкое потребление RAM',
		package: 'tg-ws-proxy-rs',
		latest: { id: '1.7.1', label: '1.7.1', packageVersion: '1.7.1-r1' }
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Больше совместимости',
		feature: 'Совместимая OpenWrt-линия',
		package: 'tg-ws-proxy-go',
		latest: { id: '0.9.3-2', label: '0.9.3-2', packageVersion: '0.9.3-r2' }
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

function clone_public(provider) {
	return {
		id: provider.id,
		title: provider.title,
		short: provider.short,
		feature: provider.feature,
		latestVersion: provider.latest.id,
		latestLabel: provider.latest.label
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

function save_state(providerId, versionId) {
	let tmp = STATE_FILE + '.tmp.' + time();
	let payload = {
		schema: 'proxy-provider.v2',
		activeProvider: providerId,
		activeVersion: versionId,
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
	if (!hadConfig) return { ok: true, hadConfig: false };
	if (run('mkdir -p ' + SNAP_DIR + '/config').rc != 0)
		return { ok: false, hadConfig: true };
	let copied = run('cp -a ' + CONFIG_DIR + '/. ' + SNAP_DIR + '/config/');
	return { ok: copied.rc == 0, hadConfig: true };
}

function restore_settings(snapshot) {
	if (snapshot == null || snapshot.hadConfig !== true) return true;
	if (stat(SNAP_DIR + '/config') == null) return false;
	if (run('mkdir -p ' + CONFIG_DIR).rc != 0) return false;
	return run('cp -a ' + SNAP_DIR + '/config/. ' + CONFIG_DIR + '/').rc == 0;
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

function display_version(provider, packageVersion) {
	if (provider == null || packageVersion == null) return null;
	return packageVersion == provider.latest.packageVersion ? provider.latest.id : packageVersion;
}

export const proxy_provider_catalog = function () {
	let out = [];
	for (let i = 0; i < length(PROVIDERS); i++) push(out, clone_public(PROVIDERS[i]));
	return {
		ok: true,
		optional: true,
		latestOnly: true,
		providers: out,
		note: 'Для каждой реализации предлагается только последний совместимый пакет из доверенного feed.'
	};
};

export const proxy_provider_status = function () {
	let state = load_state();
	let installed = installed_rows();
	let activeProvider = state.activeProvider;
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
	let activeVersion = activeInstalled ? display_version(provider, activePackageVersion) : null;
	let latestVersion = provider != null ? provider.latest.id : null;
	let updateAvailable = activeInstalled && provider != null &&
		activePackageVersion != provider.latest.packageVersion;

	return {
		ok: true,
		optional: true,
		latestOnly: true,
		installed: activeInstalled,
		activeProvider: activeInstalled ? activeProvider : null,
		activeVersion: activeVersion,
		activePackageVersion: activeInstalled ? activePackageVersion : null,
		latestVersion: latestVersion,
		updateAvailable: updateAvailable,
		packages: installed,
		binaryPresent: stat(BINARY_PATH) != null,
		running: running(),
		configPreserved: stat(CONFIG_DIR) != null,
		drift: length(installed) > 1 || (length(installed) == 1 && !activeInstalled)
	};
};

function remove_packages() {
	let failures = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let provider = PROVIDERS[i];
		if (!package_present(provider.package)) continue;
		let r = run('apk del --no-interactive ' + provider.package);
		if (r.rc != 0 || package_present(provider.package)) push(failures, provider.package);
	}
	return failures;
}

function restore_previous(previous, wasRunning, settingsSnapshot) {
	let failures = remove_packages();
	if (previous.activeProvider != null && previous.packageVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		if (provider == null || !safe_package_version(previous.packageVersion)) {
			push(failures, 'previous-provider-unknown');
		} else {
			let add = run('apk add --no-interactive ' + provider.package + '=' + previous.packageVersion);
			if (add.rc != 0 || !package_present(provider.package)) push(failures, 'previous-package-restore');
			else if (!save_state(provider.id, previous.activeVersion)) push(failures, 'previous-state-restore');
		}
	} else if (!save_state(null, null)) push(failures, 'empty-state-restore');
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (wasRunning && length(failures) == 0 && service('start') != 0) push(failures, 'previous-service-restore');
	return failures;
}

function input_provider_only(value) {
	if (type(value) != 'object' || value == null) return false;
	let ks = keys(value);
	if (length(ks) != 1 || ks[0] != 'provider') return false;
	return type(value.provider) == 'string';
}

export const proxy_provider_install = function (input) {
	if (!input_provider_only(input))
		return error('EINPUT', 'Передайте только provider; версия всегда выбирается автоматически.');
	let provider = provider_by_id(input.provider);
	if (provider == null) return error('EINPUT', 'Неизвестная реализация TG Proxy.');
	let latest = provider.latest;
	if (!acquire_lock()) return error('EBUSY', 'Установка TG Proxy уже выполняется.');

	let previousStatus = proxy_provider_status();
	let previous = {
		activeProvider: previousStatus.activeProvider,
		activeVersion: previousStatus.activeVersion,
		packageVersion: previousStatus.activePackageVersion
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
				let add = run('apk add --no-interactive ' + provider.package + '=' + latest.packageVersion);
				if (add.rc != 0 || !package_present(provider.package) || stat(BINARY_PATH) == null) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Последний совместимый пакет недоступен в доверенном feed.' }, rollbackFailures: rollbackFailures };
				} else if (!restore_settings(settingsSnapshot)) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: rollbackFailures };
				} else if (!save_state(provider.id, latest.id)) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось сохранить выбранную реализацию.' }, rollbackFailures: rollbackFailures };
				} else if (wasRunning && service('start') != 0) {
					let rollbackFailures = restore_previous(previous, wasRunning, settingsSnapshot);
					result = { ok: false, error: { code: 'ETARGET', message: 'Новая реализация установлена, но не прошла запуск.' }, rollbackFailures: rollbackFailures };
				} else {
					let reread = proxy_provider_status();
					result = {
						ok: reread.installed && reread.activeProvider == provider.id && !reread.updateAvailable,
						changed: true,
						provider: provider.id,
						version: latest.id,
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
			else if (!save_state(null, null)) result = error('ETARGET', 'Не удалось обновить состояние после удаления.');
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
