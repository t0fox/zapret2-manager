'use strict';
// Optional TG Proxy provider manager.
//
// The browser never supplies package names, URLs or shell fragments. It sends
// only an allow-listed provider id and version id. Installation uses the
// router's configured signed APK feeds, exact package versions and no custom
// trust bypass. Missing providers are a normal state: zapret2-manager remains
// fully usable without either package.

import { readfile, writefile, stat, unlink, popen } from 'fs';

const STATE_FILE = '/etc/zapret2-manager/proxy-provider.json';
const LOCK_DIR = '/tmp/zapret2-manager-proxy-provider.lock';
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
		recommended: '1.7.1',
		versions: [
			{ id: '1.7.1', label: '1.7.1', packageVersion: '1.7.1-r1', recommended: true },
			{ id: '1.6.5', label: '1.6.5', packageVersion: '1.6.5-r2', recommended: false }
		]
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Больше совместимости',
		feature: 'Проверенная Go-версия',
		package: 'tg-ws-proxy-go',
		recommended: '0.9.3-2',
		versions: [
			{ id: '0.9.3-2', label: '0.9.3-2', packageVersion: '0.9.3-r2', recommended: true }
		]
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

function clone_public(provider) {
	let versions = [];
	for (let i = 0; i < length(provider.versions); i++) {
		let item = provider.versions[i];
		push(versions, {
			id: item.id,
			label: item.label,
			recommended: item.recommended === true
		});
	}
	return {
		id: provider.id,
		title: provider.title,
		short: provider.short,
		feature: provider.feature,
		recommended: provider.recommended,
		versions: versions
	};
}

function provider_by_id(id) {
	for (let i = 0; i < length(PROVIDERS); i++)
		if (PROVIDERS[i].id == id) return PROVIDERS[i];
	return null;
}

function version_by_id(provider, id) {
	if (provider == null) return null;
	for (let i = 0; i < length(provider.versions); i++)
		if (provider.versions[i].id == id) return provider.versions[i];
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
		schema: 'proxy-provider.v1',
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
		return substr(line, length(prefix));
	return line != '' ? line : null;
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

function infer_version(provider, packageVersion) {
	if (provider == null || packageVersion == null) return null;
	for (let i = 0; i < length(provider.versions); i++)
		if (provider.versions[i].packageVersion == packageVersion) return provider.versions[i].id;
	return packageVersion;
}

export const proxy_provider_catalog = function () {
	let out = [];
	for (let i = 0; i < length(PROVIDERS); i++) push(out, clone_public(PROVIDERS[i]));
	return {
		ok: true,
		optional: true,
		providers: out,
		note: 'Компонент необязателен; установка и удаление выполняются из вкладки TG Proxy.'
	};
};

export const proxy_provider_status = function () {
	let state = load_state();
	let installed = installed_rows();
	let activeProvider = state.activeProvider;
	let activeVersion = state.activeVersion;
	if (activeProvider == null && length(installed) == 1) {
		activeProvider = installed[0].provider;
		activeVersion = infer_version(provider_by_id(activeProvider), installed[0].packageVersion);
	}
	let activeInstalled = false;
	for (let i = 0; i < length(installed); i++)
		if (installed[i].provider == activeProvider) activeInstalled = true;
	return {
		ok: true,
		optional: true,
		installed: activeInstalled,
		activeProvider: activeInstalled ? activeProvider : null,
		activeVersion: activeInstalled ? activeVersion : null,
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

function restore_previous(previous, wasRunning) {
	let failures = remove_packages();
	if (previous.activeProvider != null && previous.activeVersion != null) {
		let provider = provider_by_id(previous.activeProvider);
		let version = version_by_id(provider, previous.activeVersion);
		if (provider == null || version == null) push(failures, 'previous-provider-unknown');
		else {
			let add = run('apk add --no-interactive ' + provider.package + '=' + version.packageVersion);
			if (add.rc != 0 || !package_present(provider.package)) push(failures, 'previous-package-restore');
			else if (!save_state(provider.id, version.id)) push(failures, 'previous-state-restore');
		}
	} else if (!save_state(null, null)) push(failures, 'empty-state-restore');
	if (wasRunning && length(failures) == 0 && service('start') != 0) push(failures, 'previous-service-restore');
	return failures;
}

export const proxy_provider_install = function (input) {
	if (type(input) != 'object' || input == null) return error('EINPUT', 'Нужны provider и version.');
	let provider = provider_by_id(input.provider);
	let version = version_by_id(provider, input.version);
	if (provider == null || version == null) return error('EINPUT', 'Неизвестная реализация или версия.');
	if (!acquire_lock()) return error('EBUSY', 'Установка TG Proxy уже выполняется.');

	let previousStatus = proxy_provider_status();
	let previous = {
		activeProvider: previousStatus.activeProvider,
		activeVersion: previousStatus.activeVersion
	};
	let wasRunning = previousStatus.running === true;
	let result = null;
	try {
		if (previousStatus.installed && previous.activeProvider == provider.id && previous.activeVersion == version.id) {
			result = { ok: true, changed: false, status: previousStatus };
		} else {
			if (wasRunning && service('stop') != 0) {
				result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
			} else {
				let removeFailures = remove_packages();
				if (length(removeFailures) > 0) {
					let rollbackFailures = restore_previous(previous, wasRunning);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить текущую реализацию.' }, rollbackFailures: rollbackFailures };
				} else {
					let add = run('apk add --no-interactive ' + provider.package + '=' + version.packageVersion);
					if (add.rc != 0 || !package_present(provider.package) || stat(BINARY_PATH) == null) {
						let rollbackFailures = restore_previous(previous, wasRunning);
						result = { ok: false, error: { code: 'ETARGET', message: 'Пакет выбранной версии недоступен в доверенном feed.' }, rollbackFailures: rollbackFailures };
					} else if (!save_state(provider.id, version.id)) {
						let rollbackFailures = restore_previous(previous, wasRunning);
						result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось сохранить выбранную реализацию.' }, rollbackFailures: rollbackFailures };
					} else if (wasRunning && service('start') != 0) {
						let rollbackFailures = restore_previous(previous, wasRunning);
						result = { ok: false, error: { code: 'ETARGET', message: 'Новая реализация установлена, но не прошла запуск.' }, rollbackFailures: rollbackFailures };
					} else {
						let reread = proxy_provider_status();
						result = {
							ok: reread.installed && reread.activeProvider == provider.id,
							changed: true,
							provider: provider.id,
							version: version.id,
							status: reread
						};
						if (!result.ok) result.error = { code: 'EVERIFY', message: 'Установка не подтверждена повторным чтением.' };
					}
			}
		}
	} catch (e) {
		let rollbackFailures = restore_previous(previous, wasRunning);
		result = { ok: false, error: { code: 'EINTERNAL', message: 'Сбой транзакции установки.' }, rollbackFailures: rollbackFailures };
	}
	release_lock();
	return result;
};

export const proxy_provider_remove = function (input) {
	if (type(input) != 'object' || input == null || input.confirm != 'REMOVE')
		return error('EINPUT', 'Удаление требует подтверждение REMOVE.');
	if (!acquire_lock()) return error('EBUSY', 'Другая операция TG Proxy уже выполняется.');
	let wasRunning = running();
	let result = null;
	try {
		if (wasRunning && service('stop') != 0) result = error('ETARGET', 'Не удалось остановить TG Proxy.');
		else {
			let failures = remove_packages();
			if (length(failures) > 0) result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось удалить пакет TG Proxy.' }, failures: failures };
			else if (!save_state(null, null)) result = error('ETARGET', 'Не удалось обновить состояние после удаления.');
			else result = { ok: true, installed: false, settingsPreserved: stat(CONFIG_DIR) != null, running: false };
		}
	} catch (e) {
		result = error('EINTERNAL', 'Сбой удаления TG Proxy.');
	}
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
