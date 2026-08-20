'use strict';
// M6 Unified Routing owner.
//
// The first real method is a delegated service-DNS route. This module owns the
// Route aggregate, revisions, journals, selector references, and reconciliation
// evidence. It never writes dnsmasq/UCI/nft/Strategy state directly: runtime
// mutation is delegated to service-dns.uc, the existing DNS writer.

import { readfile, writefile, stat, readlink, unlink, mkdir, popen, lsdir } from 'fs';
import { asset_registry_resolve, asset_registry_set_references } from './asset-registry.uc';
import { service_dns_providers, service_dns_status, service_dns_set, service_dns_apply } from './service-dns.uc';

const STATE_PATH = getenv('Z2M_ROUTE_STATE') || '/etc/zapret2-manager/routes.json';
const JOURNAL_ROOT = getenv('Z2M_ROUTE_JOURNAL') || '/etc/zapret2-manager/routes-journal';
const MAX_STATE_BYTES = 512 * 1024;
const MAX_ROUTES = 128;
const MAX_SELECTORS = 32;
const MAX_METHODS = 8;
const TEST_MODE = getenv('Z2M_ROUTE_SERVER_TEST') == '1';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function fail(code, message, details) {
	let error = { code: code, message: message };
	if (object(details)) for (let key in details) error[key] = details[key];
	return { ok: false, error: error };
}
function ok(value) { let result = { ok: true }; for (let key in value || {}) result[key] = value[key]; return result; }
function clone(value) { try { return json(sprintf('%J', value)); } catch (e) { return null; } }
function safe_id(value) { return string(value) && match(value, /^route:[a-z][a-z0-9._-]{0,95}$/); }
function safe_method_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/); }
function now() { let p = popen('date -u +%Y-%m-%dT%H:%M:%SZ', 'r'); if (!p) return '1970-01-01T00:00:00Z'; let value = trim(p.read('all') || ''); p.close(); return value; }
function shell_quote(value) { let result = "'"; for (let i = 0; i < length(value); i++) result += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1); return result + "'"; }
function run(command) { let p = popen(command + ' 2>&1', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { let meta = null; try { meta = stat(path); } catch (e) { return false; } return object(meta) && meta.type == 'file' && readlink(path) == null && integer(meta.size); }
function directory(path) { let meta = null; try { meta = stat(path); } catch (e) { return false; } return object(meta) && meta.type == 'directory' && readlink(path) == null; }

function atomic_write(path, value) {
	let slash = rindex(path, '/'), parent = slash > 0 ? substr(path, 0, slash) : null;
	if (parent && !directory(parent)) { try { mkdir(parent); } catch (e) {} }
	if (parent && !directory(parent)) return false;
	let temp = path + '.tmp.' + time();
	try { writefile(temp, value); } catch (e) { return false; }
	if (!regular(temp)) { try { unlink(temp); } catch (e) {} return false; }
	let moved = run('mv -f ' + shell_quote(temp) + ' ' + shell_quote(path));
	if (moved.rc != 0 || !regular(path) || readfile(path) != value) { try { unlink(temp); } catch (e) {} return false; }
	return true;
}

function empty_state() { return { schema: 1, revision: 0, routes: [] }; }
function load_state() {
	let raw = readfile(STATE_PATH);
	if (!raw) return empty_state();
	if (length(raw) > MAX_STATE_BYTES) return null;
	let value = null;
	try { value = json(raw); } catch (e) { return null; }
	if (!object(value) || value.schema != 1 || !integer(value.revision) || type(value.routes) != 'array' || length(value.routes) > MAX_ROUTES) return null;
	return value;
}
function save_state(state) { return atomic_write(STATE_PATH, sprintf('%J', state) + '\n'); }
function find_route(state, id) { for (let i = 0; i < length(state.routes); i++) if (state.routes[i].id == id) return state.routes[i]; return null; }
function route_index(state, id) { for (let i = 0; i < length(state.routes); i++) if (state.routes[i].id == id) return i; return -1; }
function journal_path(id) { return JOURNAL_ROOT + '/' + substr(id, length('route:')) + '.json'; }
function journal_write(id, value) { return atomic_write(journal_path(id), sprintf('%J', value) + '\n'); }
function journal_read(id) { let raw = readfile(journal_path(id)); if (!raw) return null; try { let value = json(raw); return object(value) && value.schema == 1 ? value : null; } catch (e) { return null; } }
function journal_list() { let values = []; if (!directory(JOURNAL_ROOT)) return values; let names = lsdir(JOURNAL_ROOT) || []; for (let i = 0; i < length(names); i++) if (string(names[i]) && substr(names[i], -5) == '.json') { let raw = readfile(JOURNAL_ROOT + '/' + names[i]); try { let value = json(raw); if (object(value) && value.schema == 1) push(values, value); } catch (e) {} } return values; }

function normalize_domain(value) {
	if (!string(value)) return null;
	let result = '';
	for (let i = 0; i < length(value); i++) { let code = ord(substr(value, i, 1)); result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1); }
	result = trim(result);
	while (substr(result, 0, 1) == '.') result = substr(result, 1);
	while (substr(result, length(result) - 1, 1) == '.') result = substr(result, 0, length(result) - 1);
	if (!length(result) || length(result) > 253) return null;
	let labels = split(result, '.');
	for (let label in labels) {
		if (!length(label) || length(label) > 63) return null;
		let first = ord(substr(label, 0, 1)), last = ord(substr(label, length(label) - 1, 1));
		if (!((first >= 48 && first <= 57) || (first >= 97 && first <= 122)) || !((last >= 48 && last <= 57) || (last >= 97 && last <= 122))) return null;
		for (let i = 0; i < length(label); i++) { let code = ord(substr(label, i, 1)); if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code == 45)) return null; }
	}
	return result;
}
function asset_entries(asset) {
	let raw = readfile(asset.path);
	if (raw == null) return null;
	let entries = [], seen = {};
	for (let line in split(raw, '\n')) {
		line = trim(line);
		if (!length(line) || substr(line, 0, 1) == '#') continue;
		let domain = normalize_domain(line);
		if (domain == null) return null;
		if (!seen[domain]) { seen[domain] = true; push(entries, domain); }
	}
	return entries;
}
function has_entry(entries, wanted) { for (let i = 0; i < length(entries); i++) if (entries[i] == wanted) return true; return false; }

function resolve_asset(reference) {
	if (TEST_MODE) {
		let raw = getenv('Z2M_ROUTE_TEST_ASSETS');
		if (raw != null) { try { let assets = json(raw), asset = assets[reference.id]; if (asset == null) return fail('EDEPENDENCY', 'asset dependency is missing'); if (asset.type != reference.type) return fail('ETYPE', 'asset type does not match reference'); if (reference.revision != asset.revision) return fail('ECONFLICT', 'asset reference is stale'); return ok({ asset: asset, entries: asset.entries || [] }); } catch (e) { return fail('ESTATE', 'route test assets are invalid'); } }
	}
	if (!object(reference) || (reference.type != 'hostlist' && reference.type != 'hosts')) return fail('EUNSUPPORTED_SELECTOR', 'route supports only hostlist/hosts assets');
	let resolved = asset_registry_resolve(reference);
	if (!resolved.ok) return resolved;
	let entries = asset_entries(resolved.asset);
	if (entries == null || length(entries) == 0) return fail('EVALIDATION', 'domain asset is empty or invalid');
	return ok({ asset: resolved.asset, entries: entries });
}
function selector_key(reference) { return reference.type + ':' + reference.id; }
function references_for(route) { let result = []; for (let i = 0; i < length(route.selectors); i++) { let ref = route.selectors[i].asset; push(result, { type: ref.type, id: ref.id, revision: ref.revision, contentSha256: ref.contentSha256 }); } return result; }

function method_identity(method) { return object(method) && method.kind == 'service_dns' && safe_method_id(method.service_id) && safe_method_id(method.profile_id); }
function methods_available(methods) {
	let catalog = TEST_MODE ? null : service_dns_providers();
	let profiles = {};
	if (TEST_MODE) { try { profiles = json(getenv('Z2M_ROUTE_TEST_PROFILES') || '{}'); } catch (e) { profiles = {}; } }
	else if (catalog && catalog.ok == true) for (let i = 0; i < length(catalog.profiles || []); i++) profiles[catalog.profiles[i].id] = catalog.profiles[i];
	let result = [];
	for (let i = 0; i < length(methods); i++) {
		let method = methods[i], profile = profiles[method.profile_id];
		if (!profile) {
			if (i == 0) return fail('EDEPENDENCY', 'primary service DNS method profile is missing', { method: method });
			push(result, { kind: 'service_dns', service_id: method.service_id, profile_id: method.profile_id, profile: null, state: 'unavailable' });
			continue;
		}
		push(result, { kind: 'service_dns', service_id: method.service_id, profile_id: method.profile_id, profile: profile, state: 'available' });
	}
	return ok({ methods: result });
}
function method_covers(route, profile, resolved) {
	for (let i = 0; i < length(profile.requiredDomains || []); i++) {
		let wanted = normalize_domain(profile.requiredDomains[i]), found = false;
		for (let j = 0; j < length(resolved); j++) if (has_entry(resolved[j].entries, wanted)) { found = true; break; }
		if (!found) return false;
	}
	return true;
}

function normalize_route(input, mode, current) {
	if (!object(input) || !safe_id(input.id)) return fail('ESCHEMA', 'route id is invalid');
	if (!string(input.description) || !length(trim(input.description)) || length(input.description) > 256) return fail('ESCHEMA', 'route description is invalid');
	if (input.enabled != true && input.enabled != false) return fail('ESCHEMA', 'route enabled must be boolean');
	if (type(input.selectors) != 'array' || length(input.selectors) == 0 || length(input.selectors) > MAX_SELECTORS) return fail('ESELECTOR', 'route requires a bounded selector set');
	if (!object(input.primary_method) || type(input.ordered_fallbacks) != 'array' || length(input.ordered_fallbacks) >= MAX_METHODS) return fail('ESCHEMA', 'route method order is invalid');
	let selectors = [], resolved = [], seen = {};
	for (let i = 0; i < length(input.selectors); i++) {
		let item = input.selectors[i];
		if (!object(item) || item.kind != 'asset' || !object(item.asset)) return fail('EUNSUPPORTED_SELECTOR', 'selector shape is unsupported');
		if (item.asset.type != 'hostlist' && item.asset.type != 'hosts') return fail('EUNSUPPORTED_SELECTOR', 'route supports only hostlist/hosts assets');
		let key = selector_key(item.asset); if (seen[key]) return fail('EDUPLICATE', 'duplicate selector'); seen[key] = true;
		let reference = { type: item.asset.type, id: item.asset.id, revision: item.asset.revision, contentSha256: item.asset.contentSha256 };
		let checked = resolve_asset(reference); if (!checked.ok) return checked;
		push(selectors, { kind: 'asset', asset: { type: reference.type, id: reference.id, revision: checked.asset.revision, contentSha256: checked.asset.contentSha256 } });
		push(resolved, checked);
	}
	let methods = [input.primary_method]; for (let i = 0; i < length(input.ordered_fallbacks); i++) push(methods, input.ordered_fallbacks[i]);
	let method_keys = {}, normalized_methods = [];
	for (let i = 0; i < length(methods); i++) {
		if (!method_identity(methods[i])) return fail('EUNSUPPORTED_METHOD', 'method identity is unsupported');
		let key = methods[i].service_id + ':' + methods[i].profile_id; if (method_keys[key]) return fail('EDUPLICATE', 'primary and fallback method overlap'); method_keys[key] = true;
		push(normalized_methods, { kind: 'service_dns', service_id: methods[i].service_id, profile_id: methods[i].profile_id });
	}
	let available = methods_available(normalized_methods); if (!available.ok) return available;
	for (let i = 0; i < length(available.methods); i++) if (available.methods[i].profile != null && !method_covers(input, available.methods[i].profile, resolved)) return fail('ESELECTOR', 'selector assets do not cover method domains', { method: normalized_methods[i] });
	let route = {
		schema: 1, id: input.id, revision: mode == 'create' ? 1 : current.revision + 1,
		description: trim(input.description), enabled: input.enabled, selectors: selectors,
		primary_method: normalized_methods[0], ordered_fallbacks: [], desired_state: input.enabled ? 'enabled' : 'disabled',
		observed_state: mode == 'update' && current.observed_state ? clone(current.observed_state) : { state: 'unapplied', revision: null, selected_method: null, observed_at: now() },
		ownership: mode == 'update' && current.ownership ? clone(current.ownership) : { owner: 'm6.route', route_id: input.id, applied_revision: null, delegated_owner: 'service-dns', delegated_scope: null },
		createdAt: mode == 'update' ? current.createdAt : now(), updatedAt: now()
	};
	for (let i = 1; i < length(normalized_methods); i++) push(route.ordered_fallbacks, normalized_methods[i]);
	return ok({ route: route, resolved: resolved, methods: available.methods });
}

function service_call(name, input) {
	if (TEST_MODE) {
		let raw = getenv('Z2M_ROUTE_TEST_SERVICE');
		if (raw != null) { try { let hook = json(raw); if (hook[name] != null) return hook[name]; } catch (e) { return fail('ESTATE', 'route test service is invalid'); } }
	}
	if (name == 'status') return service_dns_status();
	if (name == 'set') return service_dns_set(input);
	if (name == 'apply') return service_dns_apply(input);
	return fail('EINPUT', 'unknown delegated service operation');
}
function service_status() { let status = service_call('status'); return object(status) && status.ok == true ? status : fail('ETARGET', 'service DNS status unavailable', { cause: status }); }

function asset_references_set(route, refs) {
	if (TEST_MODE) return { ok: true };
	return asset_registry_set_references('route/' + route.id, refs);
}
function validate_revision(route, expected) { return expected == route.revision ? { ok: true } : fail('ECONFLICT', 'route revision is stale', { expectedRevision: expected, actualRevision: route.revision }); }

export const route_list = function() { let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid'); return ok({ schema: 1, revision: state.revision, routes: clone(state.routes) || [] }); };
export const route_get = function(input) { let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid'); let route = find_route(state, input && input.id); return route == null ? fail('EDEPENDENCY', 'route is missing') : ok({ route: clone(route) }); };
export const route_create = function(input) {
	let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid');
	if (length(state.routes) >= MAX_ROUTES) return fail('ELIMIT', 'route limit reached');
	if (find_route(state, input && input.id) != null) return fail('ECONFLICT', 'route id already exists');
	let checked = normalize_route(input, 'create', null); if (!checked.ok) return checked;
	let refs = references_for(checked.route), linked = asset_references_set(checked.route, refs); if (!linked.ok) return linked;
	push(state.routes, checked.route); state.revision++;
	if (!save_state(state)) { asset_references_set(checked.route, []); return fail('EWRITE', 'route state publication failed'); }
	return ok({ route: clone(checked.route), revision: state.revision });
};
export const route_update = function(input) {
	let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid');
	let current = find_route(state, input && input.id); if (current == null) return fail('EDEPENDENCY', 'route is missing');
	let cas = validate_revision(current, input.expectedRevision); if (!cas.ok) return cas;
	if (!object(input.route) || input.route.id != current.id) return fail('EINPUT', 'route update cannot change route identity');
	let checked = normalize_route(input.route, 'update', current); if (!checked.ok) return checked;
	let oldRefs = references_for(current), newRefs = references_for(checked.route), linked = asset_references_set(checked.route, newRefs); if (!linked.ok) return linked;
	let index = route_index(state, current.id), old = state.routes[index]; state.routes[index] = checked.route; state.revision++;
	if (!save_state(state)) { state.routes[index] = old; asset_references_set(current, oldRefs); return fail('EWRITE', 'route state publication failed'); }
	return ok({ route: clone(checked.route), revision: state.revision });
};

function route_plan(route) {
	let checked = normalize_route(route, 'existing', route); if (!checked.ok) return checked;
	let status = service_status(); if (!status.ok) return status;
	let method = checked.methods[0], managed = type(status.managedServerEntries) == 'array' ? status.managedServerEntries : [];
	return ok({ route: route, status: status, method: { kind: method.kind, state: method.state, service_id: method.service_id, profile_id: method.profile_id }, methods: checked.methods, resources: { toCreate: [], toChange: [{ service_id: method.service_id, from: (status.selections || {})[method.service_id] || '', to: method.profile_id }], toRemove: [], currentlyManaged: managed }, resolved: checked.resolved });
}
export const route_preview = function(input) { let result = route_get(input); if (!result.ok) return result; let cas = validate_revision(result.route, input.expectedRevision); if (!cas.ok) return cas; let plan = route_plan(result.route); if (!plan.ok) return plan; return ok({ mutated: false, safe: true, method: plan.method, selectors: plan.resolved, resources: plan.resources, delegated_owner: 'service-dns', existing: { serviceDns: plan.status } }); };
export const route_validate = function(input) { return route_preview(input); };

export const route_apply = function(input) {
	let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid'); let route = find_route(state, input && input.id); if (route == null) return fail('EDEPENDENCY', 'route is missing');
	let cas = validate_revision(route, input.expectedRevision); if (!cas.ok) return cas; let plan = route_plan(route); if (!plan.ok) return plan;
	let method = plan.method, current = plan.status.selections || {}, previous = current[method.service_id] == null ? '' : current[method.service_id];
	let existing = route.ownership && route.ownership.delegated_scope;
	if (existing != null && previous != existing.applied_selection && previous != existing.previous_selection) return fail('ERESOURCECOLLISION', 'service DNS selection is foreign');
	let journal = { schema: 1, phase: 'prepared', operation: 'apply', route_id: route.id, route_revision: route.revision, service_id: method.service_id, previous_selection: previous, applied_selection: method.profile_id, createdAt: now() };
	if (!journal_write(route.id, journal)) return fail('EWRITE', 'route journal could not be prepared');
	let selections = clone(current) || {}; selections[method.service_id] = method.profile_id; let set = service_call('set', { selections: selections });
	if (!set || set.ok != true) return fail('EAPPLY', 'delegated service DNS draft was rejected', { cause: set });
	journal.phase = 'delegated'; journal.draftRevision = set.draftRevision; if (!journal_write(route.id, journal)) return fail('EUNCERTAIN', 'route journal publication is uncertain');
	let applied = service_call('apply', { draftRevision: set.draftRevision });
	if (!applied || applied.ok != true) return fail('EAPPLY', 'delegated service DNS apply failed', { cause: applied });
	route.observed_state = { state: 'applied', revision: route.revision, selected_method: { kind: method.kind, service_id: method.service_id, profile_id: method.profile_id }, observed_at: now() };
	route.ownership = { owner: 'm6.route', route_id: route.id, applied_revision: route.revision, delegated_owner: 'service-dns', delegated_scope: { service_id: method.service_id, previous_selection: previous, applied_selection: method.profile_id, operation_id: applied.operationId || null, resource_ids: applied.managedServerEntries || [] } };
	route.updatedAt = now(); state.routes[route_index(state, route.id)] = route; state.revision++; if (!save_state(state)) return fail('EUNCERTAIN', 'route state publication failed after delegated apply');
	journal.phase = 'committed'; journal.operationId = applied.operationId || null; journal.resource_ids = applied.managedServerEntries || []; journal_write(route.id, journal);
	return ok({ route: clone(route), operation: applied });
};

export const route_status = function(input) {
	let result = route_get(input); if (!result.ok) return result; let route = result.route, scope = route.ownership && route.ownership.delegated_scope;
	if (scope == null || !route.observed_state || route.observed_state.state != 'applied') return ok({ status: clone(route.observed_state) });
	let service = service_status(); if (!service.ok) return service; let current = (service.selections || {})[scope.service_id];
	let state = current == scope.applied_selection ? 'applied' : (current == scope.previous_selection ? 'runtime_missing' : 'foreign');
	return ok({ status: { state: state, route_revision: route.revision, applied_revision: route.ownership.applied_revision, current_selection: current, selected_method: route.observed_state.selected_method } });
};

export const route_remove = function(input) {
	let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid'); let route = find_route(state, input && input.id);
	if (route == null) return ok({ removed: false, id: input && input.id }); let cas = validate_revision(route, input.expectedRevision); if (!cas.ok) return cas;
	let scope = route.ownership && route.ownership.delegated_scope;
	if (scope != null && route.observed_state && route.observed_state.state == 'applied') {
		let service = service_status(); if (!service.ok) return service;
		if ((service.selections || {})[scope.service_id] != scope.applied_selection) return fail('ERESOURCECOLLISION', 'service DNS selection is foreign');
		let journal = journal_read(route.id) || { schema: 1, operation: 'remove', route_id: route.id, route_revision: route.revision };
		journal.phase = 'prepared-remove'; if (!journal_write(route.id, journal)) return fail('EWRITE', 'route removal journal could not be prepared');
		let selections = clone(service.selections) || {}; selections[scope.service_id] = scope.previous_selection; let set = service_call('set', { selections: selections });
		if (!set || set.ok != true) return fail('EROLLBACK', 'delegated service DNS restore was rejected', { cause: set });
		let applied = service_call('apply', { draftRevision: set.draftRevision }); if (!applied || applied.ok != true) return fail('EROLLBACK', 'delegated service DNS restore failed', { cause: applied });
		journal.phase = 'removed'; journal.removedAt = now(); if (!journal_write(route.id, journal)) return fail('EUNCERTAIN', 'route removal journal publication is uncertain');
	}
	let refs = references_for(route), cleared = asset_references_set(route, []); if (!cleared.ok) return cleared;
	let kept = []; for (let i = 0; i < length(state.routes); i++) if (state.routes[i].id != route.id) push(kept, state.routes[i]); state.routes = kept; state.revision++;
	if (!save_state(state)) { asset_references_set(route, refs); return fail('EUNCERTAIN', 'route removal state publication failed'); }
	return ok({ removed: true, id: route.id, restored: scope != null, previousReferences: refs });
};

function reconcile_orphan(journal) {
	if (journal.phase != 'removed' && journal.phase != 'delegated' && journal.phase != 'prepared-remove') return { ok: true, cleaned: false };
	let service = service_status(); if (!service.ok) return service; let current = (service.selections || {})[journal.service_id];
	if (current != journal.applied_selection) return { ok: true, cleaned: false };
	let selections = clone(service.selections) || {}; selections[journal.service_id] = journal.previous_selection; let set = service_call('set', { selections: selections }); if (!set || set.ok != true) return fail('EROLLBACK', 'orphan restore draft failed'); let applied = service_call('apply', { draftRevision: set.draftRevision }); if (!applied || applied.ok != true) return fail('EROLLBACK', 'orphan restore failed'); journal.phase = 'reconciled'; journal.reconciledAt = now(); if (!journal_write(journal.route_id, journal)) return fail('EUNCERTAIN', 'orphan journal publication is uncertain'); return { ok: true, cleaned: true };
}
export const route_reconcile = function() {
	let state = load_state(); if (state == null) return fail('ESTATE', 'route state is invalid'); let journals = journal_list(), cleaned = 0, uncertain = 0;
	for (let i = 0; i < length(journals); i++) { let journal = journals[i], route = find_route(state, journal.route_id); if (route == null) { let result = reconcile_orphan(journal); if (!result.ok) return result; if (result.cleaned) cleaned++; } else if (journal.route_revision == route.revision && journal.phase == 'delegated') { let status = route_status({ id: route.id }); if (status.ok && status.status.state == 'applied') { journal.phase = 'committed'; journal_write(route.id, journal); } else if (status.ok && status.status.state == 'foreign') uncertain++; } }
	return ok({ reconciled: true, orphansCleaned: cleaned, uncertain: uncertain });
};
