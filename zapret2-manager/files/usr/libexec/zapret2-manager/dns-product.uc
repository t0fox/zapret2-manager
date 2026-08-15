'use strict';
// Canonical DNS product coordinator. The existing modules remain the only
// mutation owners; this file only validates, normalizes, and delegates.

import { dns_global_get, dns_global_set, dns_global_preview, dns_global_apply, dns_global_rollback } from './dns-global.uc';
import { dns_get, dns_set, dns_validate, dns_apply_preview, dns_apply_run, dns_rollback } from './dns.uc';
import { dnsprov_providers } from './dnsprov.uc';
import { service_dns_providers, service_dns_status, service_dns_preview, service_dns_set, service_dns_apply, service_dns_rollback } from './service-dns.uc';

const SCOPES = ['global', 'overrides', 'service_dns'];
const MODES = ['system', 'doh', 'dot', 'udp'];
const FORBIDDEN = ['command', 'cmd', 'shell', 'path', 'package', 'init', 'service'];

function is_object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function is_array(value) { return type(value) == 'array'; }
function has(value, key) { return is_object(value) && value[key] != null; }
function copy_array(value) {
	let out = [];
	if (!is_array(value)) return out;
	for (let i = 0; i < length(value); i++) push(out, value[i]);
	return out;
}
function copy_object(value) {
	let out = {};
	if (!is_object(value)) return out;
	for (let key in value) out[key] = value[key];
	return out;
}
function error(category, message, details) {
	let out = { ok: false, error: { code: category, message: message } };
	if (is_object(details)) out.details = details;
	return out;
}
function normalize_error(value, fallback) {
	let raw = is_object(value) && is_object(value.error) ? value.error : value;
	let code = is_object(raw) ? raw.code : null;
	let message = is_object(raw) ? raw.message : null;
	let category = 'internal';
	if (code == 'EINPUT') category = 'invalid_request';
	else if (code == 'ECONFLICT') category = 'stale_revision';
	else if (code == 'ETARGET') category = 'dependency_missing';
	else if (code == 'EPROVIDER' || code == 'EMETADATA') category = 'provider_unavailable';
	else if (code == 'ENOENT' || code == 'EAPPLYBUSY') category = 'runtime_unavailable';
	else if (code == 'EDOMAINCONFLICT') category = 'foreign_state';
	else if (code == 'EAPPLYTIMEOUT' || code == 'EVERIFY' || code == 'EROLLBACK') category = 'apply_failed';
	return error(category, message || fallback || 'DNS operation failed', { sourceCode: code || null });
}
function request_object(input) {
	if (!is_object(input)) return null;
	if (is_object(input.args)) return input.args;
	return input;
}
function value_object(input) {
	if (!is_object(input)) return {};
	if (is_object(input.value)) return input.value;
	if (is_object(input.edit)) return input.edit;
	if (input.scope == 'global' && is_object(input.global)) return input.global;
	if (input.scope == 'overrides' && is_object(input.overrides)) return input.overrides;
	if (input.scope == 'service_dns' && is_object(input.service_dns)) return input.service_dns;
	return input;
}
function scope_of(input) {
	let scope = is_object(input) ? input.scope : null;
	if (type(scope) != 'string') return null;
	for (let i = 0; i < length(SCOPES); i++) if (scope == SCOPES[i]) return scope;
	return null;
}
function forbidden_input(input) {
	if (!is_object(input)) return null;
	for (let i = 0; i < length(FORBIDDEN); i++) if (input[FORBIDDEN[i]] != null) return FORBIDDEN[i];
	return null;
}
function revision_of(input) {
	if (!is_object(input)) return null;
	let value = input.expectedRevision != null ? input.expectedRevision : input.revision;
	return type(value) == 'int' && value >= 0 ? value : null;
}
function scope_error(input, required) {
	if (forbidden_input(input) != null) return error('invalid_request', 'arbitrary command, path, package, or service input is not accepted');
	if (required && scope_of(input) == null) return error('invalid_request', 'scope must be one of global, overrides, service_dns');
	if (!required && input.scope != null && scope_of(input) == null) return error('invalid_request', 'scope is not supported');
	return null;
}
function provider_public(value) {
	return {
		id: value.id || null,
		name: value.name || value.title || value.upstreamName || value.id || null,
		category: value.category || null,
		ipv4: copy_array(value.ipv4),
		ipv6: copy_array(value.ipv6),
		doh: value.doh || null,
		reviewed: value.reviewed || value.reviewedAt || null
	};
}
function profile_public(value) {
	return {
		id: value.id || null,
		providerId: value.providerId || null,
		serviceId: value.serviceId || null,
		requiredDomains: copy_array(value.requiredDomains),
		optionalDomains: copy_array(value.optionalDomains),
		diagnosticTargets: copy_array(value.diagnosticTargets),
		mechanism: value.mechanism || null,
		limitations: value.limitations || null
	};
}
function catalog() {
	let resolver = dnsprov_providers();
	let services = service_dns_providers({});
	if (!resolver || resolver.ok !== true) return normalize_error(resolver, 'DNS provider catalog is unavailable');
	if (!services || services.ok !== true) return normalize_error(services, 'Service DNS catalog is unavailable');
	let providers = [], profiles = [];
	for (let i = 0; i < length(resolver.providers || []); i++) push(providers, provider_public(resolver.providers[i]));
	for (let j = 0; j < length(services.profiles || []); j++) push(profiles, profile_public(services.profiles[j]));
	return { ok: true, providers: providers, profiles: profiles, services: copy_array(services.providers), schema: 'dns-product.catalog.v2' };
}
function provider_exists(id, providers) {
	if (id == null || id == '') return true;
	for (let i = 0; i < length(providers || []); i++) if (providers[i].id == id) return true;
	return false;
}
function profile_for(id, profiles) {
	for (let i = 0; i < length(profiles || []); i++) if (profiles[i].id == id) return profiles[i];
	return null;
}
function current_state(scope) {
	if (scope == 'global') {
		let value = dns_global_get();
		return value && value.ok === true ? { ok: true, revision: value.draft && value.draft.revision || 0, value: value } : value;
	}
	if (scope == 'overrides') {
		let value = dns_get();
		return value && value.ok === true ? { ok: true, revision: value.revision || 0, value: value } : value;
	}
	let value = service_dns_status();
	return value && value.ok === true ? { ok: true, revision: value.draftRevision || 0, value: value } : value;
}
function check_revision(input, scope) {
	let expected = revision_of(input);
	if (expected == null) return null;
	let current = current_state(scope);
	if (!current || current.ok !== true) return normalize_error(current, 'DNS state is unavailable');
	if (expected != current.revision) return error('stale_revision', 'DNS revision changed; reload the product state', { expected: expected, actual: current.revision, scope: scope });
	return null;
}
function validate_global(input, value, cat) {
	if (value.mode != null && MODES.indexOf(value.mode) < 0) return error('invalid_request', 'global mode is unsupported');
	if (!provider_exists(value.primary, cat.providers) || !provider_exists(value.secondary, cat.providers)) return error('invalid_request', 'global provider id is not in the catalog');
	return { ok: true, scope: 'global', valid: true, revision: input.revision != null ? input.revision : null };
}
function validate_overrides(input, value) {
	let result = dns_validate(is_array(value.entries) ? value : null);
	if (!result || result.ok !== true) return normalize_error(result, 'DNS overrides validation failed');
	if (result.valid !== true) return error('invalid_request', 'DNS override entries are invalid', { errors: result.errors || [] });
	return { ok: true, scope: 'overrides', valid: true, revision: input.revision != null ? input.revision : null, checkedEntries: result.checkedEntries || 0, resolverConflicts: result.resolverConflicts || [] };
}
function validate_service(input, value, cat) {
	if (!is_object(value.selections)) return error('invalid_request', 'service_dns selections must be an object');
	for (let serviceId in value.selections) {
		let selected = value.selections[serviceId];
		if (selected == '' || selected == 'off' || selected == null) continue;
		let profile = profile_for(selected, cat.profiles);
		if (!profile || profile.serviceId != serviceId) return error('invalid_request', 'service or profile id is not in the catalog', { serviceId: serviceId, profileId: selected });
	}
	return { ok: true, scope: 'service_dns', valid: true, revision: input.revision != null ? input.revision : null };
}
function validate_input(input) {
	let bad = scope_error(input, true);
	if (bad) return bad;
	let scope = scope_of(input), value = value_object(input), cat = catalog();
	if (!cat || cat.ok !== true) return cat;
	if (scope == 'global') return validate_global(input, value, cat);
	if (scope == 'overrides') return validate_overrides(input, value);
	return validate_service(input, value, cat);
}
function read_model() {
	let global = dns_global_get(), overrides = dns_get(), serviceDns = service_dns_status(), cat = catalog();
	if (!global || global.ok !== true) return normalize_error(global, 'Global DNS state is unavailable');
	if (!overrides || overrides.ok !== true) return normalize_error(overrides, 'DNS overrides state is unavailable');
	if (!serviceDns || serviceDns.ok !== true) return normalize_error(serviceDns, 'Service DNS state is unavailable');
	if (!cat || cat.ok !== true) return cat;
	return {
		ok: true,
		schema: 'dns-product.v2',
		product: 'dns',
		desired: { global: global.draft || {}, overrides: overrides.draft || {}, service_dns: serviceDns.selections || {} },
		applied: { global: global.applied || {}, overrides: overrides.applied || [], service_dns: serviceDns.applied || {} },
		observed: { resolver: overrides.resolver || {}, dnsmasq: overrides.dnsmasq || {}, service_dns: serviceDns.runtime || {} },
		revision: { global: global.draft && global.draft.revision || 0, overrides: overrides.revision || 0, service_dns: serviceDns.draftRevision || 0 },
		appliedRevision: { overrides: overrides.appliedRevision || 0, service_dns: serviceDns.appliedRevision || 0 },
		ownership: { global: 'dns-global', overrides: 'dns-overrides', service_dns: 'service-dns' },
		rollback: { global: global.rollbackAvailable === true, overrides: overrides.rollbackAvailable === true, service_dns: serviceDns.rollbackAvailable === true },
		providers: cat.providers,
		profiles: cat.profiles,
		services: cat.services
	};
}

export const dns_product_get = function() { return read_model(); };
export const dns_product_providers = function() { return catalog(); };
export const dns_product_status = function() {
	let model = read_model();
	if (!model || model.ok !== true) return model;
	model.statusRead = true;
	return model;
};
export const dns_product_validate = function(input) {
	input = request_object(input);
	if (!input) return error('invalid_request', 'request must be a JSON object');
	let bad = scope_error(input, true);
	if (bad) return bad;
	let revisionError = check_revision(input, scope_of(input));
	if (revisionError) return revisionError;
	return validate_input(input);
};
export const dns_product_preview = function(input) {
	input = request_object(input);
	if (!input) return error('invalid_request', 'request must be a JSON object');
	let bad = scope_error(input, true);
	if (bad) return bad;
	let scope = scope_of(input), revisionError = check_revision(input, scope);
	if (revisionError) return revisionError;
	let validation = validate_input(input);
	if (!validation || validation.ok !== true) return validation;
	let current = current_state(scope), result = null;
	if (!current || current.ok !== true) return normalize_error(current, 'DNS state is unavailable');
	if (scope == 'global') result = dns_global_preview();
	else if (scope == 'overrides') result = dns_apply_preview();
	else result = service_dns_preview({ args: {} });
	if (!result || result.ok !== true) return normalize_error(result, 'DNS preview is unavailable');
	return { ok: true, scope: scope, mode: 'preview', zeroWrites: true, revision: current.revision, requested: value_object(input), delegated: result, ownership: current.value ? (scope == 'global' ? 'dns-global' : scope == 'overrides' ? 'dns-overrides' : 'service-dns') : null };
};
function with_revision(value, revision) {
	let out = copy_object(value);
	if (revision != null) out.revision = revision;
	return out;
}
function delegated_apply(scope, result) {
	if (!result || result.ok !== true) return normalize_error(result, 'DNS apply failed');
	return { ok: true, scope: scope, mode: 'apply', delegated: result, ownership: scope == 'global' ? 'dns-global' : scope == 'overrides' ? 'dns-overrides' : 'service-dns' };
}
export const dns_product_apply = function(input) {
	input = request_object(input);
	if (!input) return error('invalid_request', 'request must be a JSON object');
	let bad = scope_error(input, true);
	if (bad) return bad;
	let scope = scope_of(input), revisionError = check_revision(input, scope);
	if (revisionError) return revisionError;
	let validation = validate_input(input);
	if (!validation || validation.ok !== true) return validation;
	let value = value_object(input), revision = revision_of(input), setResult = null, result = null;
	if (scope == 'global') {
		if (is_object(value) && (value.mode != null || value.primary != null || value.secondary != null || value.hijack != null || value.cache != null)) {
			setResult = dns_global_set(with_revision(value, revision));
			if (!setResult || setResult.ok !== true) return normalize_error(setResult, 'Global DNS draft was not accepted');
		}
		result = dns_global_apply();
	} else if (scope == 'overrides') {
		if (is_array(value.entries)) {
			setResult = dns_set(with_revision(value, revision));
			if (!setResult || setResult.ok !== true) return normalize_error(setResult, 'DNS override draft was not accepted');
		}
		result = dns_apply_run();
	} else {
		if (is_object(value.selections)) {
			setResult = service_dns_set({ args: value });
			if (!setResult || setResult.ok !== true) return normalize_error(setResult, 'Service DNS draft was not accepted');
			revision = setResult.draftRevision;
		}
		result = service_dns_apply({ args: { revision: revision } });
	}
	return delegated_apply(scope, result);
};
export const dns_product_rollback = function(input) {
	input = request_object(input);
	if (!input) return error('invalid_request', 'request must be a JSON object');
	let bad = scope_error(input, true);
	if (bad) return bad;
	let scope = scope_of(input), revisionError = check_revision(input, scope);
	if (revisionError) return revisionError;
	let result = scope == 'global' ? dns_global_rollback() : scope == 'overrides' ? dns_rollback() : service_dns_rollback({});
	if (!result || result.ok !== true) {
		let mapped = normalize_error(result, 'DNS rollback failed');
		if (mapped.error.code == 'dependency_missing') mapped.error.code = 'foreign_state';
		return mapped;
	}
	return { ok: true, scope: scope, mode: 'rollback', delegated: result, ownership: scope == 'global' ? 'dns-global' : scope == 'overrides' ? 'dns-overrides' : 'service-dns' };
};
