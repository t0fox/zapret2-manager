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
const RUST_URL = 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/v2.0.0/tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz';
const RUST_SHA256 = '4ccb0d3216edfc9a9a85a215eae5a817b6fe368fd12a796d793880a0055b3602';
const RUST_INIT_URL = 'https://raw.githubusercontent.com/t0fox/zapret2-manager/0c9919aa143f86f8e079305249403f05226bfbef/tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy';
const RUST_INIT_SHA256 = 'f1c60e49cc5e7884c57a53d2f006da222b9aed5f3f4032f600b6cdb0dfbfa280';
const GO_APK_URL = 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/download/0.9.3-rev2/tg-ws-proxy_0.9.3-r2_openwrt_aarch64_cortex-a53.apk';
const GO_APK_SHA256 = '8f9a569fb98f627d605a32f78c3d750deb97140c55a1fa427ba885cf3f367910';
const GO_KEY_URL = 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/download/0.9.3-rev2/tg-ws-proxy.pem';
const GO_KEY_SHA256 = 'b1b8effc68227de75179c8e00b28057887c5a0944fd732d227cb3ffcec5f33ab';
const GO_INIT_PATH = '/usr/libexec/zapret2-manager/proxy-provider-go-init.sh';
const GO_INIT_SHA256 = '7f28974df0acd9a6cf936dc1a49cc775231d842d6e544da2567082407b7f0c0c';

const PROVIDERS = [
	{
		id: 'rust',
		title: 'Rust',
		short: 'Легче и экономнее',
		feature: 'Низкое потребление RAM',
		package: 'tg-ws-proxy-rs',
		latest: { id: '2.0.0', label: '2.0.0', packageVersion: '2.0.0-r1' }
	},
	{
		id: 'go',
		title: 'Go',
		short: 'Совместимая OpenWrt-линия',
		feature: 'spatiumstas MTProto; secret передаётся через argv',
		package: 'tg-ws-proxy',
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
	let r = run("apk list --installed '" + packageName + "' | head -n 1 | awk '{print $1}'");
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

function config_value(text, key) {
	let lines = split(text != null ? '' + text : '', '\n');
	let prefix = key + '=';
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (substr(line, 0, length(prefix)) == prefix) return trim(substr(line, length(prefix)));
	}
	return null;
}

function listener_verified() {
	let config = readfile(CONFIG_DIR + '/config.conf');
	let host = config_value(config, 'HOST');
	let port = config_value(config, 'PORT');
	if (host == null || port == null) return false;
	let expected = host + ':' + port;
	for (let attempt = 0; attempt < 6; attempt++) {
		let output = run('netstat -tlnp').out;
		let lines = split(output, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (index(line, expected) >= 0 && index(line, 'LISTEN') >= 0 && index(line, '/tg-ws-proxy') >= 0) return true;
		}
		run('sleep 1');
	}
	return false;
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
	let state = load_state();
	if (state.activeProvider == 'rust' && stat(BINARY_PATH) != null && stat(INIT_PATH) != null &&
		!package_present('tg-ws-proxy-rs'))
		push(rows, { provider: 'rust', package: null, packageVersion: state.activeVersion == '2.0.0' ? '2.0.0-r1' : '1.7.1-r1', source: 'pinned-release' });
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
		note: 'Rust устанавливается из pinned release с SHA-256. Go устанавливается из подписанного spatiumstas APK с pinned key/hash.'
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

function sha256(path) {
	let result = run("sha256sum '" + path + "' | awk '{print $1}'");
	return result.rc == 0 ? trim(result.out) : null;
}

function download(url, path) {
	let result = run("uclient-fetch -q -T 30 -O '" + path + "' '" + url + "'");
	return result.rc == 0 && stat(path) != null;
}

function snapshot_runtime() {
	if (run('mkdir -p ' + SNAP_DIR + '/runtime').rc != 0) return false;
	if (stat(BINARY_PATH) != null && run('cp -p ' + BINARY_PATH + ' ' + SNAP_DIR + '/runtime/tg-ws-proxy').rc != 0) return false;
	if (stat(INIT_PATH) != null && run('cp -p ' + INIT_PATH + ' ' + SNAP_DIR + '/runtime/tg-ws-proxy.init').rc != 0) return false;
	if (stat(STATE_FILE) != null && run('cp -p ' + STATE_FILE + ' ' + SNAP_DIR + '/runtime/provider.json').rc != 0) return false;
	return true;
}

function restore_runtime() {
	let failures = [];
	if (stat(SNAP_DIR + '/runtime/tg-ws-proxy') != null) {
		if (run('cp -p ' + SNAP_DIR + '/runtime/tg-ws-proxy ' + BINARY_PATH).rc != 0) push(failures, 'binary-restore');
	} else run('rm -f ' + BINARY_PATH);
	if (stat(SNAP_DIR + '/runtime/tg-ws-proxy.init') != null) {
		if (run('cp -p ' + SNAP_DIR + '/runtime/tg-ws-proxy.init ' + INIT_PATH).rc != 0) push(failures, 'init-restore');
	} else run('rm -f ' + INIT_PATH);
	if (stat(SNAP_DIR + '/runtime/provider.json') != null) {
		if (run('cp -p ' + SNAP_DIR + '/runtime/provider.json ' + STATE_FILE).rc != 0) push(failures, 'state-restore');
	} else run('rm -f ' + STATE_FILE);
	return failures;
}

function rollback_update(previous, settingsSnapshot, wasRunning) {
	let failures = [];
	if (previous.activeProvider == 'go' && !package_present('tg-ws-proxy')) {
		let restoredGo = install_go_release();
		if (!restoredGo.ok) push(failures, 'go-package-restore');
	}
	let runtimeFailures = restore_runtime();
	for (let i = 0; i < length(runtimeFailures); i++) push(failures, runtimeFailures[i]);
	if (!restore_settings(settingsSnapshot)) push(failures, 'settings-restore');
	if (wasRunning) {
		service('stop');
		if (service('start') != 0 || !listener_verified()) push(failures, 'previous-listener-restore');
	}
	return failures;
}

function install_rust_release() {
	let dir = '/tmp/z2m-proxy-rust.' + time();
	if (run('mkdir -p ' + dir).rc != 0) return error('ETARGET', 'Не удалось создать временный каталог установки.');
	let archive = dir + '/provider.tar.gz', init = dir + '/tg-ws-proxy.init';
	if (!download(RUST_URL, archive) || sha256(archive) != RUST_SHA256) {
		run('rm -rf ' + dir); return error('EHASH', 'Rust release недоступен или не прошёл SHA-256.');
	}
	if (!download(RUST_INIT_URL, init) || sha256(init) != RUST_INIT_SHA256) {
		run('rm -rf ' + dir); return error('EHASH', 'Manager init script не прошёл SHA-256.');
	}
	if (run('tar -xzf ' + archive + ' -C ' + dir).rc != 0 || stat(dir + '/tg-ws-proxy') == null) {
		run('rm -rf ' + dir); return error('EFORMAT', 'Rust release archive имеет неожиданный формат.');
	}
	if (run('cp ' + dir + '/tg-ws-proxy ' + BINARY_PATH + '.new').rc != 0 ||
		run('chmod 0755 ' + BINARY_PATH + '.new').rc != 0 ||
		run('cp ' + init + ' ' + INIT_PATH + '.new').rc != 0 ||
		run('chmod 0755 ' + INIT_PATH + '.new').rc != 0 ||
		run('mv -f ' + BINARY_PATH + '.new ' + BINARY_PATH).rc != 0 ||
		run('mv -f ' + INIT_PATH + '.new ' + INIT_PATH).rc != 0) {
		run('rm -rf ' + dir); return error('ETARGET', 'Не удалось атомарно установить Rust runtime.');
	}
	run('rm -rf ' + dir);
	return { ok: true };
}

function install_go_release() {
	let dir = '/tmp/z2m-proxy-go.' + time();
	if (run('mkdir -p ' + dir + '/keys').rc != 0) return error('ETARGET', 'Не удалось создать временный каталог установки.');
	let apk = dir + '/provider.apk', key = dir + '/keys/tg-ws-proxy.pem';
	if (!download(GO_APK_URL, apk) || sha256(apk) != GO_APK_SHA256) { run('rm -rf ' + dir); return error('EHASH', 'Go APK недоступен или не прошёл SHA-256.'); }
	if (!download(GO_KEY_URL, key) || sha256(key) != GO_KEY_SHA256) { run('rm -rf ' + dir); return error('EHASH', 'Go signing key не прошёл SHA-256.'); }
	if (stat(GO_INIT_PATH) == null || sha256(GO_INIT_PATH) != GO_INIT_SHA256) { run('rm -rf ' + dir); return error('EHASH', 'Manager Go init не прошёл SHA-256.'); }
	let add = run('apk add --no-interactive --keys-dir ' + dir + '/keys ' + apk);
	if (add.rc != 0 || !package_present('tg-ws-proxy')) { run('rm -rf ' + dir); return error('ETARGET', 'Подписанный Go APK не установлен.'); }
	if (run('chmod 0600 ' + CONFIG_DIR + '/config.conf ' + CONFIG_DIR + '/secret.conf').rc != 0) {
		run('apk del --no-interactive tg-ws-proxy'); run('rm -rf ' + dir); return error('ETARGET', 'Go package создал config/secret с небезопасными permissions.');
	}
	if (run('cp ' + GO_INIT_PATH + ' ' + INIT_PATH + '.new').rc != 0 || run('chmod 0755 ' + INIT_PATH + '.new').rc != 0 || run('mv -f ' + INIT_PATH + '.new ' + INIT_PATH).rc != 0) {
		run('apk del --no-interactive tg-ws-proxy'); run('rm -rf ' + dir); return error('ETARGET', 'Go package установлен, но manager init не применён.');
	}
	run('rm -rf ' + dir);
	return { ok: true };
}

function manager_config_present() {
	let text = readfile(CONFIG_DIR + '/config.conf');
	return text != null && index(text, '# tg-ws-proxy configuration — manager-owned') >= 0;
}

function write_safe_manager_config() {
	if (manager_config_present()) return true;
	let lan = trim(run("ip -o -4 addr show br-lan | awk '{print $4}' | cut -d/ -f1 | head -n 1").out);
	if (lan == '') return false;
	let text = '# tg-ws-proxy configuration — manager-owned (zapret2-manager).\n' +
		'# Provider-native config was migrated during implementation switch.\n' +
		'ENABLED=0\nHOST=' + lan + '\nPORT=1443\nLINK_IP=' + lan + '\n' +
		'POOL_SIZE=4\nBUF_KB=256\nMAX_CONNECTIONS=\nQUIET=1\nVERBOSE=0\n' +
		'FAKETLS_DOMAIN=\nDC_IPS=\nCF_DOMAINS=\nCF_WORKER_DOMAINS=\n' +
		'CF_PRIORITY=0\nCF_BALANCE=0\nDEFAULT_DOMAINS=1\n' +
		'MTPROTO_PROXIES=\nOUTBOUND_PROXY=\nNO_PROXY=\n';
	let tmp = CONFIG_DIR + '/config.conf.provider.' + time();
	writefile(tmp, text);
	let moved = run('chmod 0600 ' + tmp + ' && mv -f ' + tmp + ' ' + CONFIG_DIR + '/config.conf');
	return moved.rc == 0 && manager_config_present();
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
	let runtimeSnapshot = settingsSnapshot.ok ? snapshot_runtime() : false;
	let result = null;
	try {
		let alreadyLatest = previousStatus.installed &&
			previous.activeProvider == provider.id &&
			previous.packageVersion == latest.packageVersion;
		if (!settingsSnapshot.ok || !runtimeSnapshot) {
			result = error('ESTATE', 'Настройки не удалось сохранить; установка не начата.');
		} else if (alreadyLatest) {
			if (!write_safe_manager_config()) result = error('ETARGET', 'Provider config не удалось мигрировать в manager schema.');
			else result = { ok: true, changed: false, status: proxy_provider_status(), settingsMigrated: true };
		} else if (wasRunning && service('stop') != 0) {
			result = error('ETARGET', 'Не удалось остановить текущий TG Proxy.');
		} else {
			let removeFailures = [];
			if (provider.id == 'rust' && package_present('tg-ws-proxy')) {
				let removed = run('apk del --no-interactive tg-ws-proxy');
				if (removed.rc != 0 || package_present('tg-ws-proxy')) push(removeFailures, 'tg-ws-proxy');
			}
			if (provider.id == 'go' && package_present('tg-ws-proxy-rs')) {
				let removed = run('apk del --no-interactive tg-ws-proxy-rs');
				if (removed.rc != 0 || package_present('tg-ws-proxy-rs')) push(removeFailures, 'tg-ws-proxy-rs');
			}
			if (length(removeFailures) > 0) {
				result = { ok: false, error: { code: 'ECONFLICT', message: 'Сначала удалите установленный Go package через package manager.' }, rollbackFailures: [] };
			} else {
				let installed = provider.id == 'rust' ? install_rust_release() : install_go_release();
				if (!installed.ok || stat(BINARY_PATH) == null || stat(INIT_PATH) == null) {
					let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
					result = { ok: false, error: installed.error || { code: 'ETARGET', message: 'Rust release не установлен.' }, rollbackFailures: rollbackFailures };
				} else if (!restore_settings(settingsSnapshot)) {
					let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось восстановить настройки после установки.' }, rollbackFailures: rollbackFailures };
				} else if (!write_safe_manager_config()) {
					let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
					result = { ok: false, error: { code: 'ETARGET', message: 'Provider config не удалось мигрировать в manager schema.' }, rollbackFailures: rollbackFailures };
				} else if (!save_state(provider.id, latest.id)) {
					let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
					result = { ok: false, error: { code: 'ETARGET', message: 'Не удалось сохранить выбранную реализацию.' }, rollbackFailures: rollbackFailures };
				} else if (wasRunning && (service('start') != 0 || !listener_verified())) {
					let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
					result = { ok: false, error: { code: 'EVERIFY', message: 'Обновление не прошло проверку listener; предыдущая версия восстановлена.' }, rollbackFailures: rollbackFailures };
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
		let rollbackFailures = rollback_update(previous, settingsSnapshot, wasRunning);
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
			let state = load_state();
			if (state.activeProvider == 'rust' && !package_present('tg-ws-proxy-rs')) {
				if (run('rm -f ' + BINARY_PATH + ' ' + INIT_PATH).rc != 0 || stat(BINARY_PATH) != null) push(failures, 'rust-runtime');
			}
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
