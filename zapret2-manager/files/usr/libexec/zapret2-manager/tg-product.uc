'use strict';

// Canonical Telegram Proxy facade.  The existing proxy, config, and provider
// modules remain the only owners of runtime state and mutations.
import { proxy_capabilities, proxy_status } from './proxy.uc';
import { proxycfg_get, proxycfg_validate, proxycfg_preview, proxycfg_apply,
	proxycfg_health, proxycfg_start, proxycfg_stop, proxycfg_restart } from './proxycfg.uc';
import { proxy_provider_catalog, proxy_provider_status,
	proxy_provider_versions, proxy_provider_check_updates, proxy_provider_install,
	proxy_provider_remove, proxy_provider_purge, proxy_provider_operation_status } from './proxy-provider.uc';
import { proxy_provider_preflight } from './proxy-provider-preflight.uc';

const SCHEMA = 'tg-product.v2';
const PROVIDERS = [ 'go', 'rust' ];
const STATUS_CACHE_TTL_SEC = 3;
let STATUS_CACHE = null;

function invalidate_status_cache() { STATUS_CACHE = null; }

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
	// Product status is polled alongside the dedicated health RPC. Keep this
	// read local so every status refresh does not repeat the bounded upstream
	// TCP probe; the dedicated health RPC remains the explicit network path.
	let health = proxycfg_health({ upstream: false }), selected = providers.activeProvider, installed = [];
	for (let i = 0; i < length(providers.packages); i++) {
		let item = providers.packages[i];
		push(installed, { provider: item.provider, package: item.package,
			packageVersion: item.packageVersion, installed: true, selected: item.provider == selected });
	}
	let observed = runtime && runtime.detectedProvider ? runtime.detectedProvider.id : null;
	let running = providers.running === true || runtime.running === true;
	let eff = health != null && health.effectiveRuntime != null ? health.effectiveRuntime : null;
	let runtimeDrift = eff != null && eff.drift === true;
	let readinessDrift = providers.drift === true || runtimeDrift === true;
	// If effective runtime drifts while enabled, the service cannot be considered healthy —
	// overview must not claim «Работает» (text/messages alone are not acceptance).
	let effectiveStatus = running ? (runtimeDrift ? 'degraded' : 'running') : (providers.installed === true ? 'stopped' : 'not-installed');
	return {
		ok: providers.ok === true && runtime.ok === true && config.ok === true,
		schema: SCHEMA,
		product: 'telegram-proxy',
		optional: true,
		selected: { provider: selected, desired: selected },
		installed: installed,
		observed: { provider: observed, running: running },
		status: effectiveStatus,
		sharedConfig: { present: config.ok === true && config.configFile && config.configFile.exists === true,
			state: config.ok === true ? config.state : null, appliedRevision: config.appliedRevision, redacted: true },
		readiness: { installed: providers.installed === true, binaryPresent: providers.binaryPresent === true,
			configPreserved: providers.configPreserved === true, ready: providers.installed === true && providers.binaryPresent === true && config.ok === true && !runtimeDrift,
			drift: readinessDrift, runtimeDrift: runtimeDrift },
		health: health,
		effectiveRuntime: eff,
		activeProvider: selected,
		activeVersion: providers.activeVersion,
		activePackageVersion: providers.activePackageVersion,
		binaryPresent: providers.binaryPresent === true,
		configPreserved: providers.configPreserved === true,
		drift: readinessDrift,
		packages: providers.packages
	};
}

export const tg_product_catalog = function () { return catalog_model(); };
export const tg_product_status = function () {
	let now = time();
	if (STATUS_CACHE != null && now - STATUS_CACHE.at < STATUS_CACHE_TTL_SEC)
		return { ...STATUS_CACHE.value, statusCacheHit: true };
	let value = status_model();
	STATUS_CACHE = { at: now, value: value };
	return { ...value, statusCacheHit: false };
};
export const tg_product_get = function () { return tg_product_status(); };
export const tg_product_versions = function () {
	let source = proxy_provider_versions(), rows = [];
	for (let i = 0; i < length(source.providers); i++) {
		let row = source.providers[i], versions = [];
		for (let j = 0; j < length(row.versions); j++) {
			let item = row.versions[j];
			push(versions, { provider: row.provider, version: item.version, packageVersion: item.packageVersion,
				sourceId: item.sourceId, artifactAvailable: item.artifactAvailable === true,
				installable: item.installable === true, architecture: item.architecture || source.architecture,
				architectureCompatible: item.architectureCompatible === true, directBinaryAvailable: item.directBinaryAvailable === true,
				apkAvailable: item.apkAvailable === true, checksumAvailable: item.checksumAvailable === true,
				trustMode: item.trustMode, releaseName: item.releaseName, releaseBody: item.releaseBody,
				releaseUrl: item.releaseUrl, publishedAt: item.publishedAt, assetName: item.assetName,
				assetSha256: item.assetSha256, assetSize: item.assetSize, installMode: item.installMode,
				unavailableReason: item.unavailableReason });
		}
		push(rows, { id: row.id, provider: row.provider, versions: versions, latest: row.latest });
	}
	return { ok: source.ok === true, optional: true, latestOnly: false, architecture: source.architecture, providers: rows };
};
export const tg_product_operation_status = function (input) {
	let answer = proxy_provider_operation_status(type(input) == 'object' && input != null ? input : {});
	if (answer == null || answer.operation == null)
		return { ok: true, operation: null, state: 'idle' };
	return { ok: true, operation: answer.operation, state: answer.operation.state };
};
export const tg_product_validate = function (input) { return proxycfg_validate(input); };
export const tg_product_preview = function (input) { return proxycfg_preview(input); };
export const tg_product_apply = function (input) { invalidate_status_cache(); return proxycfg_apply(input); };
export const tg_product_health = function (input) { return proxycfg_health(input || {}); };
export const tg_product_check_updates = function (input) { return proxy_provider_check_updates(input); };
export const tg_product_switch = function (input) { invalidate_status_cache(); return proxy_provider_install(input); };
export const tg_product_install = function (input) { invalidate_status_cache(); return proxy_provider_install(input); };
export const tg_product_update = function (input) { invalidate_status_cache(); return proxy_provider_install(input); };
export const tg_product_remove = function (input) { invalidate_status_cache(); return proxy_provider_remove(input); };
export const tg_product_purge = function (input) { invalidate_status_cache(); return proxy_provider_purge(input); };
export const tg_product_start = function () { invalidate_status_cache(); return proxycfg_start(); };
export const tg_product_stop = function () { invalidate_status_cache(); return proxycfg_stop(); };
export const tg_product_restart = function () { invalidate_status_cache(); return proxycfg_restart(); };
