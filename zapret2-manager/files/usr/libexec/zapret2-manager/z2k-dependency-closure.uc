'use strict';

// One typed dependency closure for an official Z2K compile.  This module is
// deliberately pure: it consumes the compiler output and a caller-provided
// canonical runtime inventory, but never discovers, downloads, writes, or
// repairs resources.  Asset Registry/runtime-composition remain the inventory
// authorities; this module only resolves references against them.

import { popen, unlink, writefile } from 'fs';
import { avatar_tokenize } from './strategy-model.uc';

const SCHEMA = 'z2m.z2k-dependency-closure.v1';
const LIST_OPTIONS = ['hostlist', 'hostlist-domains', 'hostlist-auto', 'hostlist-exclude', 'hostlist-exclude-domains'];
const IPSET_OPTIONS = ['ipset', 'ipset-ip', 'ipset-exclude', 'ipset-exclude-ip'];

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int'; }
function has(value, wanted) { return string(value) && index(value, wanted) >= 0; }
function starts(value, prefix) { return string(value) && length(value) >= length(prefix) && substr(value, 0, length(prefix)) == prefix; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }
function contains(values, wanted) { for (let value in values || []) if (value == wanted) return true; return false; }
function option_info(token) {
	if (!starts(token, '--')) return { name: null, value: null, hasEquals: false };
	let body = substr(token, 2), separator = index(body, '=');
	if (separator < 0) return { name: body, value: null, hasEquals: false };
	return { name: substr(body, 0, separator), value: substr(body, separator + 1), hasEquals: true };
}
function safe_path(value) {
	return string(value) && length(value) > 0 && length(value) <= 512 && substr(value, 0, 1) == '/'
		&& index(value, '..') < 0 && index(value, '\\') < 0 && !match(value, /[\r\n\t]/);
}
function canonical_path(value) {
	if (!string(value)) return null;
	let raw = value, sigil = substr(raw, 0, 1);
	if (sigil == '@' || sigil == '+') raw = substr(raw, 1);
	if (!safe_path(raw)) return null;
	if (starts(raw, '/runtime-assets/')) return raw;
	if (starts(raw, '/opt/zapret2/files/fake/')) return '/runtime-assets/bin/' + substr(raw, length('/opt/zapret2/files/fake/'));
	if (starts(raw, '/opt/zapret2/lua/')) return '/runtime-assets/lua/' + substr(raw, length('/opt/zapret2/lua/'));
	if (starts(raw, '/opt/zapret2/lists/')) return '/runtime-assets/lists/' + substr(raw, length('/opt/zapret2/lists/'));
	if (starts(raw, '/opt/zapret2/ipset/')) return '/runtime-assets/ipset/' + substr(raw, length('/opt/zapret2/ipset/'));
	return raw;
}
function descriptor_available(value) {
	if (value === true) return true;
	if (!object(value)) return false;
	if (value.available != null) return value.available === true;
	if (value.present != null) return value.present === true;
	return false;
}
function descriptor_class(value, fallback) {
	if (!object(value)) return fallback;
	if (string(value.class) && (starts(value.class, 'hostlist-') || starts(value.class, 'ipset-') || starts(value.class, 'blob-') || value.class == 'lua' || value.class == 'lua-function')) return value.class;
	if (string(value.dependencyClass) && (starts(value.dependencyClass, 'hostlist-') || starts(value.dependencyClass, 'ipset-') || starts(value.dependencyClass, 'blob-') || value.dependencyClass == 'lua' || value.dependencyClass == 'lua-function')) return value.dependencyClass;
	if (value.kind == 'blob' && value.role == 'runtime-generated') return 'blob-runtime';
	if (value.kind == 'blob' && value.role == 'engine-builtin') return 'blob-engine-builtin';
	if (string(value.kind) && value.kind == 'hostlist') return 'hostlist-static';
	if (string(value.kind) && value.kind == 'ipset') return 'ipset-static';
	if (string(value.kind) && value.kind == 'lua') return 'lua';
	return fallback;
}
function descriptor_reference(value, fallback) {
	if (!object(value)) return fallback;
	return value.reference || value.runtimeTarget || value.path || value.id || fallback;
}
function descriptor_from_map(map, key) {
	if (!object(map) || !string(key)) return null;
	if (map[key] != null) return map[key];
	if (starts(key, 'blob:') && map[substr(key, 5)] != null) return map[substr(key, 5)];
	if (starts(key, 'lua:') && map[substr(key, 4)] != null) return map[substr(key, 4)];
	return null;
}
function all_assets(input) {
	let result = [];
	for (let name in ['assets', 'runtimeAssets', 'packageAssets']) {
		let values = input[name];
		for (let value in values || []) if (object(value)) push(result, value);
	}
	return result;
}
function find_asset(assets, reference, name) {
	let canonical = canonical_path(reference), wantedId = name == null ? null : 'blob:' + name;
	for (let asset in assets) {
		if (canonical != null && asset.runtimeTarget == canonical) return asset;
		if (string(reference) && (asset.id == reference || asset.id == wantedId)) return asset;
		if (object(asset.aliases) && contains(asset.aliases, name)) return asset;
		if (array(asset.aliases) && contains(asset.aliases, name)) return asset;
	}
	return null;
}
function map_descriptor(input, mapName, reference, name) {
	let map = input[mapName], value = descriptor_from_map(map, reference);
	if (value == null && name != null) value = descriptor_from_map(map, name);
	return value;
}
function asset_item(asset, fallbackClass, reference) {
	if (!object(asset)) return null;
	let klass = descriptor_class(asset, fallbackClass), available = descriptor_available(asset);
	if (asset.present == null && asset.available == null) available = valid_digest(asset.contentSha256) && integer(asset.byteSize) && asset.byteSize >= 0;
	return {
		class: klass, kind: asset.kind || null, type: asset.type || null, reference: reference,
		id: asset.id || null, owner: asset.owner || asset.ownership || null, role: asset.role || null,
		runtimeTarget: asset.runtimeTarget || canonical_path(reference), sourcePath: asset.sourcePath || null,
		contentSha256: valid_digest(asset.contentSha256) ? lc(asset.contentSha256) : null,
		byteSize: integer(asset.byteSize) ? asset.byteSize : null, available: available,
		reason: available ? null : 'dependency asset is unavailable'
	};
}
function dynamic_item(input, reference) {
	let values = input.dynamic, canonical = canonical_path(reference);
	for (let item in values || []) {
		if (!object(item)) continue;
		if (item.reference == reference || item.runtimeTarget == reference || item.id == reference
			|| (canonical != null && (canonical_path(item.reference) == canonical || canonical_path(item.runtimeTarget) == canonical))) return item;
	}
	return null;
}
function resolve_list(input, reference, fallbackClass) {
	let dynamic = dynamic_item(input, reference), assets = all_assets(input), asset = find_asset(assets, reference, null), descriptor = dynamic;
	if (descriptor == null) descriptor = asset;
	if (descriptor == null) descriptor = map_descriptor(input, 'lists', reference, null);
	if (descriptor == null && fallbackClass == 'hostlist-static') descriptor = map_descriptor(input, 'hostlists', reference, null);
	if (descriptor == null && fallbackClass == 'ipset-static') descriptor = map_descriptor(input, 'ipsets', reference, null);
	if (descriptor != null) {
		let item = asset_item(descriptor, fallbackClass, reference);
		if (item != null) {
			if (dynamic != null) item.class = descriptor_class(dynamic, fallbackClass == 'ipset-static' ? 'ipset-dynamic' : 'hostlist-dynamic');
			if (item.class == 'hostlist-static' && fallbackClass == 'ipset-static') item.class = 'ipset-static';
			if (item.class == 'ipset-static' && fallbackClass == 'hostlist-static') item.class = 'hostlist-static';
			return item;
		}
	}
	return {
		class: dynamic != null ? descriptor_class(dynamic, fallbackClass == 'ipset-static' ? 'ipset-dynamic' : 'hostlist-dynamic') : fallbackClass,
		kind: fallbackClass == 'ipset-static' ? 'ipset' : 'hostlist', type: null, reference: reference,
		id: dynamic && dynamic.id || null, owner: dynamic && (dynamic.owner || dynamic.ownership) || null,
		role: dynamic && dynamic.role || null, runtimeTarget: dynamic && dynamic.runtimeTarget || canonical_path(reference),
		sourcePath: null, contentSha256: null, byteSize: null, available: false,
		reason: 'unknown consumed dependency'
	};
}
function resolve_lua(input, reference) {
	let assets = all_assets(input), asset = find_asset(assets, reference, null), descriptor = asset || map_descriptor(input, 'lua', reference, null);
	let item = asset_item(descriptor, 'lua', reference);
	if (item != null) { item.class = 'lua'; return item; }
	return { class: 'lua', kind: 'lua', type: null, reference: reference, id: null, owner: null, role: 'lua-init',
		runtimeTarget: canonical_path(reference), sourcePath: null, contentSha256: null, byteSize: null,
		available: false, reason: 'unknown consumed dependency' };
}
function resolve_blob(input, name, source) {
	if ((source != null && match(source, /^0x[0-9A-Fa-f]+$/)) || (source == null && match(name, /^0x[0-9A-Fa-f]+$/))) return {
		class: 'blob-inline', kind: 'blob', type: null, reference: name, id: null, owner: 'strategy', role: 'inline',
		runtimeTarget: null, sourcePath: null, contentSha256: null, byteSize: null, available: true, reason: null
	};
	let reference = source != null && (starts(source, '@/') || starts(source, '+/')) ? substr(source, 1) : name;
	let assets = all_assets(input), asset = find_asset(assets, reference, name), descriptor = null;
	// Explicit runtime/builtin ownership outranks a legacy filename alias. This
	// keeps engine-provided blobs from being misreported as file-backed assets.
	descriptor = map_descriptor(input, 'runtime', name, name);
	if (descriptor == null) descriptor = map_descriptor(input, 'builtins', name, name);
	if (descriptor == null) descriptor = asset;
	if (descriptor == null) descriptor = map_descriptor(input, 'blobs', reference, name);
	let item = asset_item(descriptor, 'blob-file', reference);
	if (item != null) {
		let klass = descriptor_class(descriptor, 'blob-file');
		item.class = klass == 'blob-runtime' || klass == 'blob-engine-builtin' ? klass : 'blob-file';
		item.reference = name;
		return item;
	}
	return { class: 'unknown-consumed', kind: 'blob', type: null, reference: name, id: null, owner: null, role: 'dependency',
		runtimeTarget: canonical_path(reference), sourcePath: null, contentSha256: null, byteSize: null,
		available: false, reason: 'unknown consumed dependency' };
}
function resolve_function(input, name) {
	let descriptor = map_descriptor(input, 'functions', name, name);
	if (descriptor == null) descriptor = map_descriptor(input, 'luaFunctions', name, name);
	return { class: 'lua-function', kind: 'lua-function', type: null, reference: name, id: name,
		owner: object(descriptor) && (descriptor.owner || descriptor.ownership) || null,
		role: 'function', runtimeTarget: object(descriptor) && descriptor.runtimeTarget || null,
		sourcePath: object(descriptor) && descriptor.sourcePath || null,
		contentSha256: object(descriptor) && valid_digest(descriptor.contentSha256) ? lc(descriptor.contentSha256) : null,
		byteSize: object(descriptor) && integer(descriptor.byteSize) ? descriptor.byteSize : null,
		available: descriptor_available(descriptor), reason: descriptor == null ? 'unknown consumed dependency' : descriptor_available(descriptor) ? null : 'Lua function is unavailable'
	};
}
function add_item(state, item) {
	if (!object(item)) return;
	let key = item.class + ':' + item.reference;
	if (state.seen[key]) return;
	state.seen[key] = true;
	push(state.items, item);
	if (item.available !== true) push(state.missing, item);
	if (item.class == 'hostlist-static' || item.class == 'hostlist-dynamic') state.counts.hostlists++;
	if (item.class == 'ipset-static' || item.class == 'ipset-dynamic') state.counts.ipsets++;
	if (starts(item.class, 'blob-')) state.counts.blobs++;
	if (item.class == 'lua') state.counts.lua++;
	if (item.class == 'hostlist-dynamic' || item.class == 'ipset-dynamic') state.counts.dynamic++;
	if (item.class == 'blob-runtime') state.counts.runtime++;
	if (item.class == 'blob-engine-builtin') state.counts.builtins++;
}
function digest_text(text) {
	let path = '/tmp/z2m-z2k-closure-sha.' + time();
	let digest = null;
	try {
		if (!writefile(path, '' + text)) { try { unlink(path); } catch (ignored) { } return null; }
		let process = popen("sha256sum '" + path + "' 2>/dev/null | awk '{print $1}'", 'r');
		digest = process ? trim(process.read('all') || '') : '';
		if (process) process.close();
	} catch (e) {
		digest = null;
	}
	try { unlink(path); } catch (ignored) { }
	return match(digest, /^[a-f0-9]{64}$/) ? digest : null;
}

function bundle_digest(items) {
	let rows = [];
	for (let item in items) if (item.available === true && item.class != 'blob-inline')
		push(rows, item.class + '|' + (item.id || '') + '|' + (item.reference || '') + '|' + (item.runtimeTarget || '') + '|' + (item.contentSha256 || '') + '|' + (item.byteSize == null ? '' : item.byteSize) + '|' + (item.owner || '') + '|' + (item.role || ''));
	sort(rows);
	return digest_text(join('\n', rows));
}

export const z2k_dependency_closure = function(input) {
	input = object(input) ? input : {};
	let state = { items: [], missing: [], seen: {}, counts: { lua: 0, blobs: 0, hostlists: 0, ipsets: 0, dynamic: 0, runtime: 0, builtins: 0, missing: 0 } };
	let args = [];
	if (string(input.args)) push(args, input.args);
	if (string(input.nfqws2Opt)) push(args, input.nfqws2Opt);
	for (let profile in input.profiles || []) if (object(profile) && string(profile.args)) push(args, profile.args);
	for (let textValue in args) {
		let tokenized = avatar_tokenize(textValue);
		if (!tokenized.ok) continue;
		for (let token in tokenized.tokens) {
			let info = option_info(token.value);
			if (!info.hasEquals) continue;
			if (contains(LIST_OPTIONS, info.name)) add_item(state, resolve_list(input, info.value, 'hostlist-static'));
			else if (contains(IPSET_OPTIONS, info.name)) add_item(state, resolve_list(input, info.value, 'ipset-static'));
			else if (info.name == 'lua-init' && (starts(info.value, '@/') || starts(info.value, '/'))) add_item(state, resolve_lua(input, info.value));
			else if (info.name == 'blob') {
				let colon = index(info.value, ':'), name = colon < 0 ? info.value : substr(info.value, 0, colon), source = colon < 0 ? null : substr(info.value, colon + 1);
				add_item(state, resolve_blob(input, name, source));
			}
			else if (info.name == 'lua-desync') {
				let fields = split(info.value, ':'), functionName = length(fields) ? fields[0] : '';
				if (functionName != '') add_item(state, resolve_function(input, functionName));
				for (let field in fields) if (starts(field, 'blob=')) {
					let raw = substr(field, 5), colon = index(raw, ':'), name = colon < 0 ? raw : substr(raw, 0, colon), source = colon < 0 ? null : substr(raw, colon + 1);
					add_item(state, resolve_blob(input, name, source));
				}
			}
		}
	}
	// Lua-init files are consumed by every executable candidate through the
	// canonical runtime composition, even when the official flat compiler
	// output leaves those argv bindings to Z2M. Include them in the same typed
	// closure so the bundle digest covers the actual loaded Lua runtime.
	for (let asset in all_assets(input)) {
		if (!object(asset) || asset.kind != 'lua' || asset.role != 'lua-init' || !string(asset.runtimeTarget)) continue;
		let reference = canonical_path(asset.runtimeTarget), item = asset_item(asset, 'lua', reference);
		if (reference != null && item != null) { item.class = 'lua'; add_item(state, item); }
	}
	state.counts.missing = length(state.missing);
	state.available = state.counts.missing == 0;
	sort(state.items, function(a, b) { let left = a.class + ':' + a.reference, right = b.class + ':' + b.reference; return left == right ? 0 : left < right ? -1 : 1; });
	return {
		schema: SCHEMA, available: state.available, resolution: 'complete', items: state.items, missing: state.missing,
		counts: state.counts, runtimeBundleDigest: bundle_digest(state.items),
		sourceCommit: input.sourceCommit || null, compilerSnapshotDigest: input.compilerSnapshotDigest || null,
		nfqws2OptSha256: input.nfqws2OptSha256 || null, structurallyCompilable: true
	};
};

export const z2k_dependency_closure_schema = function() { return SCHEMA; };
