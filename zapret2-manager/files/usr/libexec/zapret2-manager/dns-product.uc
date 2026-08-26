'use strict';

// Canonical DNS product facade. It coordinates the existing DNS owners; it
// does not replace their state or write paths.
import { dns_get, dns_set, dns_validate, dns_apply_preview, dns_apply_run, dns_rollback } from './dns.uc';
import { dns_global_get, dns_global_set, dns_global_preview, dns_global_apply, dns_global_rollback } from './dns-global.uc';
import { dnsprov_providers } from './dnsprov.uc';
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
	let dns = dns_get(), global = dns_global_get(), service = service_dns_status(), providers = dnsprov_providers();
	let globalDraft = object(global.draft), globalApplied = object(global.applied);
	return {
		ok: dns.ok !== false && global.ok !== false && service.ok !== false && providers.ok !== false,
		applied: { overrides: dns.applied || [], global: globalApplied, service_dns: service.applied || {} },
		desired: { overrides: dns.draft && dns.draft.entries || [], global: globalDraft, service_dns: service.selections || {} },
		revision: {
			overrides: dns.revision || 0,
			global: globalDraft.revision || 0,
			service_dns: service.draftRevision || 0
		},
		providers: providers.providers || [],
		service: { providers: service_dns_providers() },
		dns: dns,
		global: global,
		service_dns: service
	};
};

export const dns_product_providers = function() {
	let result = dnsprov_providers();
	return { ok: result.ok !== false, providers: result.providers || [], generatedAt: result.generatedAt || null };
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
