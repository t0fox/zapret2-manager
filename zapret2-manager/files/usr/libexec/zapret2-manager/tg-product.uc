'use strict';

// Canonical Telegram Proxy v2 facade.  The existing proxycfg and provider
// modules remain the sole writers; this module only composes their truthful
// read models and delegates mutations to them.
import { proxy_capabilities, proxy_status } from './proxy.uc';
import { proxycfg_get, proxycfg_validate, proxycfg_preview, proxycfg_apply,
	proxycfg_health, proxycfg_start, proxycfg_stop, proxycfg_restart } from './proxycfg.uc';
import { proxy_provider_catalog, proxy_provider_status,
	proxy_provider_check_updates, proxy_provider_install, proxy_provider_remove,
	proxy_provider_purge } from './proxy-provider.uc';
import { proxy_provider_preflight } from './proxy-provider-preflight.uc';

const SCHEMA = 'tg-product.v2';
const IDS = [ 'go', 'rust' ];

function provider_row(row, preflight) {
	let id = row != null ? row.id : null;
	let available = null;
	for (let i = 0; i < length(preflight.providers); i++)
		if (preflight.providers[i].provider == id) available = preflight.providers[i];
	return {
		id: id,
		provider: id,
		title: row.title,
		package: id == 'rust' ? 'tg-ws-proxy-rs' : 'tg-ws-proxy-go',
		binary: '/usr/bin/tg-ws-proxy',
		service: '/etc/init.d/tg-ws-proxy',
		available: available != null ? available.available : null,
		availabilityReason: available != null ? available.reason : 'provider is not in the canonical catalog'
	};
}

function catalog_model() {
	let source = proxy_provider_catalog();
	let preflight = proxy_provider_preflight();
	let rows = [];
	for (let i = 0; i < length(IDS); i++) {
		let found = null;
		for (let j = 0; j < length(source.providers); j++)
			if (source.providers[j].id == IDS[i]) found = source.providers[j];
		if (found != null) push(rows, provider_row(found, preflight));
	}
	return {
		ok: source.ok === true && preflight.ok === true,
		schema: SCHEMA,
		product: 'telegram-proxy',
		providers: rows,
		architecture: preflight.architecture,
		latestOnly: source.latestOnly === true,
		readOnly: true
	};
}

function status_model() {
	let providers = proxy_provider_status();
	let runtime = proxy_status();
	let config = proxycfg_get();
	let health = proxycfg_health({});
	let selected = providers.activeProvider;
	let installed = [];
	for (let i = 0; i < length(providers.packages); i++) {
		let p = providers.packages[i];
		push(installed, {
			provider: p.provider,
			package: p.package != null ? p.package : (p.provider == 'rust' ? 'tg-ws-proxy-rs' : 'tg-ws-proxy-go'),
			version: p.packageVersion,
			installed: true,
			selected: p.provider == selected
		});
	}
	let observed = runtime != null && runtime.detectedProvider != null
		? (runtime.detectedProvider.id == 'tg-ws-proxy-rs' ? 'rust' : runtime.detectedProvider.id == 'tg-ws-proxy-go' ? 'go' : runtime.detectedProvider.id) : null;
	let running = providers.running === true || (runtime != null && runtime.running === true);
	let ready = providers.installed === true && providers.binaryPresent === true && config.ok === true;
	return {
		ok: providers.ok === true && runtime.ok === true && config.ok === true,
		schema: SCHEMA,
		product: 'telegram-proxy',
		selected: { provider: selected, desired: selected },
		installed: installed,
		observed: { provider: observed, running: running },
		status: running ? 'running' : (providers.installed === true ? 'stopped' : 'not-installed'),
		sharedConfig: {
			present: config.ok === true && config.configFile != null && config.configFile.exists === true,
			state: config.ok === true ? config.state : null,
			appliedRevision: config.ok === true ? config.appliedRevision : null,
			redacted: true
		},
		providerConfig: { package: providers.activePackageVersion, binaryPresent: providers.binaryPresent === true },
		readiness: {
			installed: providers.installed === true,
			binaryPresent: providers.binaryPresent === true,
			configPreserved: providers.configPreserved === true,
			ready: ready,
			drift: providers.drift === true
		},
		health: health,
		runtime: runtime,
		// Compatibility projection for the existing provider cards.  The UI now
		// obtains this from the canonical product RPC, not the old RPC object.
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
