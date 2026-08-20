'use strict';

// Canonical Telegram Proxy facade.  The existing proxy, config, and provider
// modules remain the only owners of runtime state and mutations.
import { proxy_capabilities, proxy_status } from './proxy.uc';
import { proxycfg_get, proxycfg_validate, proxycfg_preview, proxycfg_apply,
	proxycfg_health, proxycfg_start, proxycfg_stop, proxycfg_restart } from './proxycfg.uc';
import { proxy_provider_catalog, proxy_provider_status,
	proxy_provider_check_updates, proxy_provider_install, proxy_provider_remove,
	proxy_provider_purge } from './proxy-provider.uc';
import { proxy_provider_preflight } from './proxy-provider-preflight.uc';

const SCHEMA = 'tg-product.v2';
const PROVIDERS = [ 'go', 'rust' ];

function provider_row(row, preflight) {
	let available = null;
	for (let i = 0; i < length(preflight.providers); i++)
		if (preflight.providers[i].provider == row.id) available = preflight.providers[i];
	return {
		id: row.id,
		provider: row.id,
		title: row.title,
		package: row.id == 'rust' ? 'tg-ws-proxy-rs' : 'tg-ws-proxy-go',
		available: available != null ? available.available : null,
		availabilityReason: available != null ? available.reason : 'provider is not in the catalog'
	};
}

function catalog_model() {
	let source = proxy_provider_catalog(), preflight = proxy_provider_preflight(), rows = [];
	for (let i = 0; i < length(PROVIDERS); i++)
		for (let j = 0; j < length(source.providers); j++)
			if (source.providers[j].id == PROVIDERS[i]) push(rows, provider_row(source.providers[j], preflight));
	return {
		ok: source.ok === true && preflight.ok === true,
		schema: SCHEMA,
		product: 'telegram-proxy',
		optional: true,
		providers: rows,
		architecture: preflight.architecture,
		latestOnly: source.latestOnly === true,
		readOnly: true
	};
}

function status_model() {
	let providers = proxy_provider_status(), runtime = proxy_status(), config = proxycfg_get();
	let health = proxycfg_health({}), selected = providers.activeProvider, installed = [];
	for (let i = 0; i < length(providers.packages); i++) {
		let item = providers.packages[i];
		push(installed, { provider: item.provider, package: item.package,
			packageVersion: item.packageVersion, installed: true, selected: item.provider == selected });
	}
	let observed = runtime && runtime.detectedProvider ? runtime.detectedProvider.id : null;
	let running = providers.running === true || runtime.running === true;
	return {
		ok: providers.ok === true && runtime.ok === true && config.ok === true,
		schema: SCHEMA,
		product: 'telegram-proxy',
		optional: true,
		selected: { provider: selected, desired: selected },
		installed: installed,
		observed: { provider: observed, running: running },
		status: running ? 'running' : (providers.installed === true ? 'stopped' : 'not-installed'),
		sharedConfig: { present: config.ok === true && config.configFile && config.configFile.exists === true,
			state: config.ok === true ? config.state : null, appliedRevision: config.appliedRevision, redacted: true },
		readiness: { installed: providers.installed === true, binaryPresent: providers.binaryPresent === true,
			configPreserved: providers.configPreserved === true, ready: providers.installed === true && providers.binaryPresent === true && config.ok === true,
			drift: providers.drift === true },
		health: health,
		activeProvider: selected,
		activeVersion: providers.activeVersion,
		activePackageVersion: providers.activePackageVersion,
		binaryPresent: providers.binaryPresent === true,
		configPreserved: providers.configPreserved === true,
		drift: providers.drift === true,
		packages: providers.packages
	};
}

export const tg_product_catalog = function () { return catalog_model(); };
export const tg_product_status = function () { return status_model(); };
export const tg_product_get = function () { return status_model(); };
export const tg_product_versions = function () {
	let status = proxy_provider_status(), rows = [];
	for (let i = 0; i < length(PROVIDERS); i++) {
		let versions = [];
		for (let j = 0; j < length(status.packages); j++)
			if (status.packages[j].provider == PROVIDERS[i])
				push(versions, { version: status.packages[j].packageVersion, packageVersion: status.packages[j].packageVersion,
					provider: PROVIDERS[i], installed: true, installable: true });
		push(rows, { id: PROVIDERS[i], provider: PROVIDERS[i], versions: versions, latest: null });
	}
	return { ok: status.ok === true, optional: true, latestOnly: status.latestOnly === true, providers: rows };
};
export const tg_product_operation_status = function () { return { ok: true, operation: null, state: 'idle' }; };
export const tg_product_validate = function (input) { return proxycfg_validate(input); };
export const tg_product_preview = function (input) { return proxycfg_preview(input); };
export const tg_product_apply = function (input) { return proxycfg_apply(input); };
export const tg_product_health = function (input) { return proxycfg_health(input || {}); };
export const tg_product_check_updates = function (input) { return proxy_provider_check_updates(input); };
export const tg_product_switch = function (input) { return proxy_provider_install(input); };
export const tg_product_install = function (input) { return proxy_provider_install(input); };
export const tg_product_update = function (input) { return proxy_provider_install(input); };
export const tg_product_remove = function (input) { return proxy_provider_remove(input); };
export const tg_product_purge = function (input) { return proxy_provider_purge(input); };
export const tg_product_start = function () { return proxycfg_start(); };
export const tg_product_stop = function () { return proxycfg_stop(); };
export const tg_product_restart = function () { return proxycfg_restart(); };
