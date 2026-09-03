'use strict';

// Canonical effective DNS provider catalog.
//
// The package catalog is immutable input. User edits live only in the
// persistent overlay and are published through this owner. This module has no
// resolver/UCI dependency: saving a provider changes metadata, never runtime
// DNS state.

import { readfile, writefile, stat, readlink, unlink, mkdir, popen } from 'fs';

const BASELINE_PATH = getenv('Z2M_DNS_PROVIDER_BASELINE') || '/usr/libexec/zapret2-manager/catalog/dns-providers.json';
const OVERLAY_PATH = getenv('Z2M_DNS_PROVIDER_OVERLAY') || '/etc/zapret2-manager/dns-provider-overrides.json';
const SCHEMA = 'z2m.dns-provider-overrides.v1';
const PROVIDER_SCHEMA = 1;
const MAX_OVERLAY_BYTES = 256 * 1024;
const MAX_PROVIDER_NAME = 160;
const MAX_NOTES = 4096;
const MAX_DOH = 1024;
const CATEGORIES = {
	anycast: 1, privacy: 1, filtered: 1, regional: 1, isp: 1,
	'Популярные': 1, 'Безопасные': 1, 'Для ИИ': 1, 'Пользовательские': 1
};
const EDITABLE_FIELDS = { name: 1, category: 1, ipv4: 1, ipv6: 1, doh: 1, notes: 1, reviewed: 1 };

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function copy(value) {
	if (value == null) return value;
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (object(extra)) for (let key in extra) result[key] = extra[key];
	return result;
}
function command(text) {
	let p = popen(text + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '', rc = p.close();
	return { rc: rc, out: out };
}
function regular(path) {
	let value = null;
	try { value = stat(path); } catch (e) { return false; }
	return object(value) && value.type == 'file' && readlink(path) == null;
}
function directory(path) {
	let value = null;
	try { value = stat(path); } catch (e) { return false; }
	return object(value) && value.type == 'directory' && readlink(path) == null;
}
function shell_quote(value) {
	let result = "'";
	for (let i = 0; i < length(value); i++) result += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return result + "'";
}
function ensure_parent(path) {
	let slash = rindex(path, '/');
	if (slash <= 0) return true;
	let parent = substr(path, 0, slash), missing = [], current = parent;
	while (length(missing) < 6 && !directory(current)) {
		push(missing, current);
		let cut = rindex(current, '/');
		if (cut <= 0) break;
		current = substr(current, 0, cut);
	}
	for (let i = length(missing) - 1; i >= 0; i--) {
		try { mkdir(missing[i]); } catch (e) {}
		if (!directory(missing[i]) && command('mkdir -p ' + shell_quote(missing[i])).rc != 0) return false;
	}
	return directory(parent);
}
function atomic_write(path, value) {
	if (!ensure_parent(path)) return false;
	let temp = path + '.tmp.' + time();
	try { writefile(temp, value); } catch (e) { return false; }
	if (!regular(temp)) { try { unlink(temp); } catch (e) {} return false; }
	if (command('chmod 600 ' + shell_quote(temp)).rc != 0) { try { unlink(temp); } catch (e) {} return false; }
	let moved = command('mv -f ' + shell_quote(temp) + ' ' + shell_quote(path));
	if (moved.rc != 0 || !regular(path) || readfile(path) != value) { try { unlink(temp); } catch (e) {} return false; }
	command('(sync -f ' + shell_quote(path) + ' 2>/dev/null || sync)');
	return true;
}
function valid_id(value, prefix) {
	if (type(value) != 'string' || length(value) < 2 || length(value) > 64) return false;
	return prefix ? match(value, /^user:[a-z][a-z0-9-]{1,31}$/) : match(value, /^[a-z][a-z0-9-]{1,31}$/);
}
function valid_ipv4(value) {
	if (type(value) != 'string') return false;
	let parts = split(value, '.');
	if (length(parts) != 4) return false;
	for (let i = 0; i < 4; i++) {
		let part = parts[i];
		if (length(part) == 0 || length(part) > 3 || (length(part) > 1 && substr(part, 0, 1) == '0') || !match(part, /^[0-9]+$/) || +part > 255) return false;
	}
	return true;
}
function valid_hextet(value) { return length(value) >= 1 && length(value) <= 4 && match(value, /^[0-9A-Fa-f]+$/); }
function valid_ipv6(value) {
	if (type(value) != 'string' || length(value) < 2 || length(value) > 45 || index(value, '.') >= 0 || !match(value, /^[0-9A-Fa-f:]+$/)) return false;
	let marker = index(value, '::');
	if (marker >= 0) {
		if (index(substr(value, marker + 2), '::') >= 0) return false;
		let left = substr(value, 0, marker), right = substr(value, marker + 2), count = 0;
		if (left != '') {
			let parts = split(left, ':');
			for (let i = 0; i < length(parts); i++) { if (!valid_hextet(parts[i])) return false; count++; }
		}
		if (right != '') {
			let parts = split(right, ':');
			for (let i = 0; i < length(parts); i++) { if (!valid_hextet(parts[i])) return false; count++; }
		}
		return count < 8;
	}
	let parts = split(value, ':');
	if (length(parts) != 8) return false;
	for (let i = 0; i < length(parts); i++) if (!valid_hextet(parts[i])) return false;
	return true;
}
function valid_date(value) { return type(value) == 'string' && match(value, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/); }
function provider_errors(provider, custom) {
	let errors = [];
	if (!object(provider)) return ['provider must be an object'];
	if (!valid_id(provider.id, custom === true)) push(errors, 'id must be a stable provider ID');
	if (type(provider.name) != 'string' || length(trim(provider.name)) == 0 || length(provider.name) > MAX_PROVIDER_NAME) push(errors, 'name is required and bounded');
	if (!CATEGORIES[provider.category]) push(errors, 'category is invalid');
	if (!array(provider.ipv4) || length(provider.ipv4) == 0 || length(provider.ipv4) > 8) push(errors, 'ipv4 must contain 1..8 addresses');
	else for (let i = 0; i < length(provider.ipv4); i++) if (!valid_ipv4(provider.ipv4[i])) push(errors, 'invalid IPv4 address: ' + provider.ipv4[i]);
	if (!array(provider.ipv6) || length(provider.ipv6) > 8) push(errors, 'ipv6 must be an array of at most 8 addresses');
	else for (let i = 0; i < length(provider.ipv6); i++) if (!valid_ipv6(provider.ipv6[i])) push(errors, 'invalid IPv6 address: ' + provider.ipv6[i]);
	if (provider.doh != null && (type(provider.doh) != 'string' || length(provider.doh) > MAX_DOH || !match(provider.doh, /^https:\/\//))) push(errors, 'doh must be an https:// URL or null');
	if (type(provider.notes) != 'string' || length(provider.notes) == 0 || length(provider.notes) > MAX_NOTES) push(errors, 'notes are required and bounded');
	if (provider.reviewed != null && !valid_date(provider.reviewed)) push(errors, 'reviewed must be an ISO date');
	return errors;
}
function read_json(path) {
	let raw = readfile(path);
	if (raw == null) return { ok: false, absent: true, value: null };
	try { return { ok: true, absent: false, value: json(raw) }; }
	catch (e) { return { ok: false, absent: false, value: null }; }
}
function merge_fields(base, patch) {
	let result = copy(base) || {};
	if (!object(patch)) return result;
	for (let key in patch) if (EDITABLE_FIELDS[key]) result[key] = copy(patch[key]);
	return result;
}
function load_baseline() {
	let result = read_json(BASELINE_PATH);
	if (!result.ok || result.absent || !object(result.value) || result.value.schema != PROVIDER_SCHEMA || type(result.value.providers) != 'array')
		return error('ETARGET', 'package DNS provider catalog is unavailable or invalid', { path: BASELINE_PATH });
	let byId = {}, errors = [];
	for (let i = 0; i < length(result.value.providers); i++) {
		let provider = result.value.providers[i], providerErrors = provider_errors(provider, false);
		for (let j = 0; j < length(providerErrors); j++) push(errors, provider.id + ': ' + providerErrors[j]);
		if (byId[provider.id] != null) push(errors, 'duplicate provider ID: ' + provider.id);
		byId[provider.id] = provider;
	}
	if (length(errors)) return error('ETARGET', 'package DNS provider catalog failed validation', { errors: errors });
	return { ok: true, document: result.value, byId: byId };
}
function empty_overlay() { return { schema: SCHEMA, revision: 0, overrides: {}, custom: [] }; }
function load_overlay(baseline) {
	let result = read_json(OVERLAY_PATH);
	if (result.absent) return { ok: true, state: empty_overlay() };
	if (!result.ok || !object(result.value)) return error('ESTATE', 'DNS provider overlay is malformed JSON', { path: OVERLAY_PATH });
	let state = result.value, errors = [];
	if (state.schema != SCHEMA) push(errors, 'schema must be ' + SCHEMA);
	if (type(state.revision) != 'int' || state.revision < 0) push(errors, 'revision must be a non-negative integer');
	if (!object(state.overrides)) push(errors, 'overrides must be an object');
	if (!array(state.custom)) push(errors, 'custom must be an array');
	if (regular(OVERLAY_PATH) && stat(OVERLAY_PATH).size > MAX_OVERLAY_BYTES) push(errors, 'overlay exceeds the bounded size');
	if (!length(errors) && object(state.overrides)) {
		for (let id in state.overrides) {
			if (baseline.byId[id] == null || !valid_id(id, false)) { push(errors, 'override targets an unknown built-in provider: ' + id); continue; }
			let merged = merge_fields(baseline.byId[id], state.overrides[id]);
			let providerErrors = provider_errors(merged, false);
			for (let i = 0; i < length(providerErrors); i++) push(errors, id + ': ' + providerErrors[i]);
		}
	}
	let seen = {};
	if (!length(errors) && array(state.custom)) for (let i = 0; i < length(state.custom); i++) {
		let provider = state.custom[i];
		if (seen[provider.id] != null || baseline.byId[provider.id] != null) push(errors, 'duplicate provider ID: ' + provider.id);
		seen[provider.id] = true;
		let providerErrors = provider_errors(provider, true);
		for (let j = 0; j < length(providerErrors); j++) push(errors, provider.id + ': ' + providerErrors[j]);
	}
	if (length(errors)) return error('ESTATE', 'DNS provider overlay failed validation', { errors: errors, path: OVERLAY_PATH });
	return { ok: true, state: state };
}
function editable_record(provider) {
	let result = {};
	for (let key in EDITABLE_FIELDS) if (exists(provider, key)) result[key] = copy(provider[key]);
	return result;
}
function effective_builtin(provider, patch, revision) {
	let result = merge_fields(provider, patch), overridden = object(patch) && length(keys(patch)) > 0;
	result.id = provider.id;
	result.origin = 'builtin';
	result.overridden = overridden;
	result.revision = revision;
	result.provenance = copy(provider.provenance) || [];
	if (overridden) {
		push(result.provenance, { kind: 'user-overlay', path: OVERLAY_PATH });
		result.baseline = copy(provider);
	}
	return result;
}
function effective_custom(provider, revision) {
	let result = copy(provider);
	result.origin = 'custom';
	result.overridden = false;
	result.revision = revision;
	return result;
}
function catalog_state() {
	let baseline = load_baseline();
	if (!baseline.ok) return baseline;
	let overlay = load_overlay(baseline);
	if (!overlay.ok) return overlay;
	return { ok: true, baseline: baseline, state: overlay.state };
}
function effective_providers(context) {
	let result = [];
	for (let i = 0; i < length(context.baseline.document.providers); i++) {
		let provider = context.baseline.document.providers[i], patch = context.state.overrides[provider.id];
		push(result, effective_builtin(provider, patch, context.state.revision));
	}
	for (let i = 0; i < length(context.state.custom); i++) push(result, effective_custom(context.state.custom[i], context.state.revision));
	return result;
}
function revision_ok(state, expected) {
	return type(expected) == 'int' && expected == state.revision;
}
function conflict(state, expected) { return error('ECONFLICT', 'DNS provider catalog revision is stale', { expectedRevision: expected, actualRevision: state.revision }); }
function save_next(context, state) {
	state.revision = context.state.revision + 1;
	if (!atomic_write(OVERLAY_PATH, sprintf('%J', state) + '\n')) return error('EWRITE', 'DNS provider overlay could not be published atomically');
	return { ok: true, revision: state.revision, state: state };
}
function normalized_custom(input, id, previous) {
	let result = merge_fields(previous || {}, input);
	result.id = id;
	if (result.category == null) result.category = 'Пользовательские';
	if (result.ipv6 == null) result.ipv6 = [];
	if (!exists(result, 'doh')) result.doh = null;
	if (result.provenance == null) result.provenance = [{ kind: 'user', source: 'dns-provider-overlay' }];
	return result;
}
function stable_name_suffix(value) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		hash = hash ^ code;
		hash = hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24));
	}
	let suffix = '';
	for (let i = 0; i < 8; i++) suffix += substr('0123456789abcdef', (hash >> ((7 - i) * 4)) & 0xf, 1);
	return suffix;
}
function stable_custom_id(input) {
	let value = object(input) && type(input.id) == 'string' ? trim(input.id) : '';
	if (substr(value, 0, 5) == 'user:') return valid_id(value, true) ? value : null;
	if (value == '') value = type(input.name) == 'string' ? trim(input.name) : '';
	let slug = '', non_ascii = false;
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		if (ord(c) > 127) non_ascii = true;
		if (match(c, /^[A-Za-z0-9]$/)) slug += lc(c);
		else if (length(slug) && substr(slug, -1) != '-') slug += '-';
	}
	while (substr(slug, -1) == '-') slug = substr(slug, 0, length(slug) - 1);
	if (non_ascii || length(slug) < 2) {
		if (value == '') return null;
		slug = 'dns-' + stable_name_suffix(value);
	}
	if (length(slug) > 32) slug = substr(slug, 0, 32);
	return valid_id('user:' + slug, true) ? 'user:' + slug : null;
}

export const dns_provider_catalog_get = function() {
	let context = catalog_state();
	if (!context.ok) return context;
	return { ok: true, schema: SCHEMA, providerSchema: PROVIDER_SCHEMA, version: context.baseline.document.version || null, revision: context.state.revision, providers: effective_providers(context) };
};

export const dns_provider_catalog_upsert_override = function(input) {
	input = object(input) ? input : {};
	let context = catalog_state();
	if (!context.ok) return context;
	if (!valid_id(input.id, false) || context.baseline.byId[input.id] == null) return error('ENOENT', 'built-in DNS provider does not exist');
	if (!revision_ok(context.state, input.revision)) return conflict(context.state, input.revision);
	let merged = merge_fields(context.baseline.byId[input.id], input), providerErrors = provider_errors(merged, false);
	if (length(providerErrors)) return error('EINPUT', 'DNS provider override is invalid', { errors: providerErrors });
	let next = copy(context.state), patch = editable_record(merged);
	// Keep only user values that differ from the immutable baseline.
	for (let key in editable_record(context.baseline.byId[input.id]))
		if (sprintf('%J', patch[key]) == sprintf('%J', context.baseline.byId[input.id][key])) delete patch[key];
	if (length(keys(patch)) == 0) delete next.overrides[input.id];
	else next.overrides[input.id] = patch;
	let saved = save_next(context, next);
	if (!saved.ok) return saved;
	return { ok: true, revision: saved.revision, provider: effective_builtin(context.baseline.byId[input.id], next.overrides[input.id], saved.revision) };
};

export const dns_provider_catalog_reset_override = function(id, revision) {
	let context = catalog_state();
	if (!context.ok) return context;
	if (!valid_id(id, false) || context.baseline.byId[id] == null) return error('ENOENT', 'built-in DNS provider does not exist');
	if (!revision_ok(context.state, revision)) return conflict(context.state, revision);
	if (context.state.overrides[id] == null) return error('ENOENT', 'built-in DNS provider has no override');
	let next = copy(context.state);
	delete next.overrides[id];
	let saved = save_next(context, next);
	return saved.ok ? { ok: true, revision: saved.revision, provider: effective_builtin(context.baseline.byId[id], null, saved.revision) } : saved;
};

export const dns_provider_catalog_create = function(input) {
	input = object(input) ? input : {};
	let context = catalog_state();
	if (!context.ok) return context;
	if (!revision_ok(context.state, input.revision)) return conflict(context.state, input.revision);
	let id = stable_custom_id(input);
	if (id == null) return error('EINPUT', 'custom DNS provider ID must resolve to a stable user:<slug> ID');
	if (context.baseline.byId[id] != null) return error('ECONFLICT', 'provider ID collides with the built-in catalog', { id: id });
	for (let i = 0; i < length(context.state.custom); i++) if (context.state.custom[i].id == id) return error('ECONFLICT', 'custom DNS provider already exists', { id: id });
	let provider = normalized_custom(input, id, null), providerErrors = provider_errors(provider, true);
	if (length(providerErrors)) return error('EINPUT', 'custom DNS provider is invalid', { errors: providerErrors });
	let next = copy(context.state);
	push(next.custom, provider);
	let saved = save_next(context, next);
	return saved.ok ? { ok: true, revision: saved.revision, provider: effective_custom(provider, saved.revision) } : saved;
};

export const dns_provider_catalog_update = function(input) {
	input = object(input) ? input : {};
	let context = catalog_state();
	if (!context.ok) return context;
	if (!valid_id(input.id, true)) return error('EINPUT', 'custom DNS provider ID must use the user:<slug> namespace');
	if (!revision_ok(context.state, input.revision)) return conflict(context.state, input.revision);
	let position = -1;
	for (let i = 0; i < length(context.state.custom); i++) if (context.state.custom[i].id == input.id) { position = i; break; }
	if (position < 0) return error('ENOENT', 'custom DNS provider does not exist');
	let provider = normalized_custom(input, input.id, context.state.custom[position]), providerErrors = provider_errors(provider, true);
	if (length(providerErrors)) return error('EINPUT', 'custom DNS provider is invalid', { errors: providerErrors });
	let next = copy(context.state);
	next.custom[position] = provider;
	let saved = save_next(context, next);
	return saved.ok ? { ok: true, revision: saved.revision, provider: effective_custom(provider, saved.revision) } : saved;
};

export const dns_provider_catalog_delete = function(id, revision, references) {
	let context = catalog_state();
	if (!context.ok) return context;
	if (!revision_ok(context.state, revision)) return conflict(context.state, revision);
	if (!valid_id(id, true)) return error('EINPUT', 'only custom user:<slug> providers can be deleted');
	let position = -1;
	for (let i = 0; i < length(context.state.custom); i++) if (context.state.custom[i].id == id) { position = i; break; }
	if (position < 0) return error('ENOENT', 'custom DNS provider does not exist');
	if (!array(references)) references = [];
	if (length(references)) return error('EDEPENDENCY', 'DNS provider is still referenced by active or desired configuration', { id: id, dependencies: copy(references) });
	let next = copy(context.state), kept = [];
	for (let i = 0; i < length(next.custom); i++) if (i != position) push(kept, next.custom[i]);
	next.custom = kept;
	let saved = save_next(context, next);
	return saved.ok ? { ok: true, revision: saved.revision, deleted: id } : saved;
};
