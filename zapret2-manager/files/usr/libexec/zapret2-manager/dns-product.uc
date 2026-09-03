'use strict';

// Canonical DNS product facade. It coordinates the existing DNS owners; it
// does not replace their state or write paths.
import { dns_get, dns_set, dns_validate, dns_apply_preview, dns_apply_run, dns_rollback } from './dns.uc';
import { dns_global_get, dns_global_set, dns_global_preview, dns_global_apply, dns_global_rollback } from './dns-global.uc';
import { dns_provider_catalog_get } from './dns-provider-catalog.uc';
import { dns_provider_catalog_upsert_override, dns_provider_catalog_reset_override, dns_provider_catalog_create, dns_provider_catalog_update, dns_provider_catalog_delete } from './dns-provider-catalog.uc';
import { service_dns_providers, service_dns_status, service_dns_preview, service_dns_set, service_dns_apply, service_dns_rollback } from './service-dns.uc';

function object(value) { return type(value) == 'object' && value != null ? value : {}; }
function request_value(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) == 'string') { try { let parsed = json(edit); if (type(parsed) == 'object' && parsed != null) return parsed; } catch (e) { } }
	return object(req && req.args ? req.args : req);
}
function scope_input(req) {
	let value = request_value(req), scope = value.scope || 'overrides';
	return { scope: scope, value: object(value.value), revision: value.revision };
}
function error(code, message) { return { ok: false, error: { code: code, message: message } }; }

export const dns_product_get = function() {
	let dns = dns_get(), global = dns_global_get(), service = service_dns_status(), providerCatalog = dns_provider_catalog_get(), providers = providerCatalog.ok === true ? providerCatalog.providers : [];
	let globalDraft = object(global.draft), globalApplied = object(global.applied);
	return {
		ok: dns.ok !== false && global.ok !== false && service.ok !== false && providerCatalog.ok !== false,
		applied: { overrides: dns.applied || [], global: globalApplied, service_dns: service.applied || {} },
		desired: { overrides: dns.draft && dns.draft.entries || [], global: globalDraft, service_dns: service.selections || {} },
		revision: {
			overrides: dns.revision || 0,
			global: globalDraft.revision || 0,
			service_dns: service.draftRevision || 0
		},
		providers: providers,
		providerCatalog: providerCatalog,
		service: { providers: service_dns_providers() },
		dns: dns,
		global: global,
		service_dns: service
	};
};

export const dns_product_providers = function() {
	let result = dns_provider_catalog_get();
	return { ok: result.ok === true, schema: result.schema || null, revision: result.revision || 0, providers: result.providers || [], generatedAt: result.generatedAt || null, error: result.error || null };
};

function provider_input(req) {
	let input = request_value(req);
	if (!object(input)) return {};
	return exists(input, 'value') && object(input.value) ? input.value : input;
}

function add_provider_reference(references, reference) {
	for (let i = 0; i < length(references); i++) {
		if (sprintf('%J', references[i]) == sprintf('%J', reference)) return;
	}
	push(references, reference);
}

function provider_for_id(catalog, id) {
	if (!catalog || catalog.ok !== true) return null;
	for (let i = 0; i < length(catalog.providers || []); i++)
		if (catalog.providers[i].id == id) return catalog.providers[i];
	return null;
}

export const dns_product_provider_save = function(req) {
	let input = provider_input(req), id = input.id;
	let catalog = dns_provider_catalog_get();
	if (catalog.ok !== true) return catalog;
	if (type(id) == 'string' && trim(id) != '') {
		let provider = provider_for_id(catalog, id);
		if (!provider) return error('ENOENT', 'DNS provider does not exist in the effective catalog');
		if (provider.origin == 'builtin') return dns_provider_catalog_upsert_override(input);
		if (provider.origin == 'custom') return dns_provider_catalog_update(input);
		return error('EINPUT', 'DNS provider has an unsupported origin');
	}
	return dns_provider_catalog_create(input);
};

export const dns_product_provider_reset = function(req) {
	let input = provider_input(req);
	return dns_provider_catalog_reset_override(input.id, input.revision);
};

export const dns_product_provider_delete = function(req) {
	let input = provider_input(req), id = input.id, references = [], catalog = dns_provider_catalog_get(), provider = provider_for_id(catalog, id), global = dns_global_get(), service = service_dns_status();
	if (global && global.draft) {
		let fields = ['primary', 'secondary'];
		for (let i = 0; i < length(fields); i++) if (global.draft[fields[i]] == id) add_provider_reference(references, { scope: 'global', field: fields[i], id: id });
	}
	if (global && global.applied && provider && type(global.applied.servers) == 'array') {
		for (let i = 0; i < length(provider.ipv4 || []); i++) if (index(global.applied.servers, provider.ipv4[i]) >= 0)
			add_provider_reference(references, { scope: 'global', field: 'applied.server', address: provider.ipv4[i], id: id });
	}
	if (service && service.selections) for (let serviceId in service.selections) if (service.selections[serviceId] == id)
		add_provider_reference(references, { scope: 'service_dns', state: 'desired', serviceId: serviceId, id: id });
	if (service && service.applied) for (let appliedServiceId in service.applied) if (service.applied[appliedServiceId] == id)
		add_provider_reference(references, { scope: 'service_dns', state: 'applied', serviceId: appliedServiceId, id: id });
	return dns_provider_catalog_delete(id, input.revision, references);
};

export const dns_product_status = function() {
	return { ok: true, generatedAt: time(), dns: dns_get(), global: dns_global_get(), service_dns: service_dns_status() };
};

export const dns_product_validate = function(req) {
	let input = scope_input(req);
	if (input.scope == 'overrides') return dns_validate({ entries: input.value.entries || [], revision: input.revision });
	if (input.scope == 'service_dns') {
		if (type(input.value.selections) != 'object' || input.value.selections == null)
			return error('EINPUT', 'service_dns selections must be an object');
		return { ok: true, valid: true, scope: input.scope, revision: input.revision };
	}
	if (input.scope == 'global') return { ok: true, valid: true, scope: input.scope, revision: input.revision };
	return error('EINPUT', 'unsupported DNS product scope');
};

export const dns_product_preview = function(req) {
	let input = scope_input(req);
	if (input.scope == 'overrides') return dns_apply_preview();
	if (input.scope == 'service_dns') return service_dns_preview();
	if (input.scope == 'global') return dns_global_preview();
	return error('EINPUT', 'unsupported DNS product scope');
};

export const dns_product_apply = function(req) {
	let input = scope_input(req);
	if (input.scope == 'overrides') {
		let saved = dns_set({ entries: input.value.entries || [], revision: input.revision });
		return saved.ok === true ? dns_apply_run() : saved;
	}
	if (input.scope == 'service_dns') {
		let saved = service_dns_set({ args: { selections: input.value.selections || {} } });
		return saved.ok === true ? service_dns_apply({ args: { revision: saved.draftRevision } }) : saved;
	}
	if (input.scope == 'global') {
		let saved = dns_global_set(Object.assign({}, input.value, { revision: input.revision }));
		return saved.ok === true ? dns_global_apply() : saved;
	}
	return error('EINPUT', 'unsupported DNS product scope');
};

export const dns_product_rollback = function(req) {
	let input = scope_input(req);
	if (input.scope == 'overrides') return dns_rollback();
	if (input.scope == 'service_dns') return service_dns_rollback();
	if (input.scope == 'global') return dns_global_rollback();
	return error('EINPUT', 'unsupported DNS product scope');
};
