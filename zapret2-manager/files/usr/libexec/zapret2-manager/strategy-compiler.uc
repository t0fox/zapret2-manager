'use strict';
// strategy-compiler.uc — Avatar Strategy compatibility adapter.
//
// This module owns only Avatar-facing transforms. Profile parsing, validation,
// full-set joining and transaction admission stay in the existing Profile
// modules. Missing assets are reported for inspection; native preflight and
// Apply decide whether an otherwise structural candidate may execute.

import { avatar_tokenize, strategy_normalize, strategy_enabled_profiles } from './strategy-model.uc';
import { z2m_parse, z2m_validate, z2m_fragment } from './profiles.uc';
import { profiles_render_candidate, profiles_candidate_round_trip } from './profiles-apply.uc';
import { popen } from 'fs';

const ENGINE_PATH = '/opt/zapret2/nfq2/nfqws2';

function is_object(value) {
	return type(value) == 'object' && value != null;
}

function starts_with(value, prefix) {
	return type(value) == 'string' && length(value) >= length(prefix)
		&& substr(value, 0, length(prefix)) == prefix;
}

function trim_ws(value) {
	let a = 0, b = length(value);
	while (a < b) {
		let c = substr(value, a, 1);
		if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
		a++;
	}
	while (b > a) {
		let c = substr(value, b - 1, 1);
		if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
		b--;
	}
	return substr(value, a, b - a);
}

function error_result(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (is_object(extra)) for (let key in extra) result[key] = extra[key];
	return result;
}

function option_info(token) {
	if (!starts_with(token, '--')) return { name: null, value: null, hasEquals: false };
	let body = substr(token, 2), eq = index(body, '=');
	if (eq < 0) return { name: body, value: null, hasEquals: false };
	return { name: substr(body, 0, eq), value: substr(body, eq + 1), hasEquals: true };
}

function copy_array(value) {
	let result = [];
	if (type(value) != 'array') return result;
	for (let i = 0; i < length(value); i++) push(result, value[i]);
	return result;
}

function safe_path_text(value) {
	if (type(value) != 'string') return false;
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		if (c == '\n' || c == '\r' || c == '\t' || c == ';' || c == '\'' || c == '"' || c == '`' || c == '$' || c == '\\') return false;
	}
	return true;
}

function safe_absolute_path(value) {
	if (!safe_path_text(value) || !starts_with(value, '/') || value == '/' || index(value, '//') >= 0) return false;
	let parts = split(value, '/');
	for (let i = 0; i < length(parts); i++) if (parts[i] == '..' || parts[i] == '.') return false;
	return true;
}

function path_join(root, value) {
	if (!safe_absolute_path(root) || type(value) != 'string' || starts_with(value, '/') || value == '') return null;
	if (!safe_path_text(value)) return null;
	let parts = split(value, '/');
	for (let i = 0; i < length(parts); i++) if (parts[i] == '..' || parts[i] == '.') return null;
	return root + '/' + value;
}

function resolve_path(value, paths, kind) {
	if (value == null || value == '') return value;
	if (starts_with(value, '/')) return kind == 'list' || kind == 'hostlist' || kind == 'ipset'
		? (safe_absolute_path(value) ? value : null) : null;
	let root = kind == 'lua' ? paths.luaRoot
		: (kind == 'blob' ? paths.blobRoot
			: (kind == 'ipset' ? paths.ipsetRoot : paths.listRoot));
	if (kind == 'lua' && starts_with(value, '@lua/')) return path_join(root, substr(value, 5));
	if (kind == 'blob' && starts_with(value, '@bin/')) return path_join(root, substr(value, 5));
	if (kind == 'blob' && starts_with(value, '0x')) return value;
	if ((kind == 'list' || kind == 'hostlist' || kind == 'ipset') && starts_with(value, 'lists/'))
		return path_join(root, substr(value, 6));
	if (kind == 'lua' || kind == 'blob' || kind == 'list' || kind == 'hostlist' || kind == 'ipset')
		return path_join(root, value);
	return value;
}

function resolve_blob_value(value, paths) {
	let colon = index(value, ':');
	if (colon < 0) return value;
	let name = substr(value, 0, colon), source = substr(value, colon + 1);
	let resolved = resolve_path(source, paths, 'blob');
	return name + ':' + (resolved != null ? resolved : source);
}

function resolve_token(token, environment) {
	let info = option_info(token), paths = is_object(environment.paths) ? environment.paths : {};
	if (!info.hasEquals) return token;
	if (info.name == 'lua-init') {
		let resolvedLua = resolve_path(info.value, paths, 'lua');
		return '--lua-init=' + (resolvedLua != null ? resolvedLua : info.value);
	}
	if (info.name == 'blob') return '--blob=' + resolve_blob_value(info.value, paths);
	if (info.name == 'hostlist' || info.name == 'hostlist-domains'
		|| info.name == 'hostlist-exclude' || info.name == 'hostlist-exclude-domains'
		|| info.name == 'hostlist-auto')
		return '--' + info.name + '=' + resolve_path(info.value, paths, 'hostlist');
	if (info.name == 'ipset' || info.name == 'ipset-ip'
		|| info.name == 'ipset-exclude' || info.name == 'ipset-exclude-ip')
		return '--' + info.name + '=' + resolve_path(info.value, paths, 'ipset');
	return token;
}

function has_name(tokens, names) {
	for (let i = 0; i < length(tokens); i++) {
		let info = option_info(tokens[i]);
		for (let j = 0; j < length(names); j++) if (info.name == names[j]) return true;
	}
	return false;
}

function first_payload(tokens) {
	for (let i = 0; i < length(tokens); i++) {
		let info = option_info(tokens[i]);
		if (info.name == 'payload' && info.hasEquals) return { index: i, value: info.value };
	}
	return null;
}

function last_filter_index(tokens) {
	let indexOfFilter = -1;
	for (let i = 0; i < length(tokens); i++) {
		let name = option_info(tokens[i]).name;
		if (name == 'filter-tcp' || name == 'filter-udp' || name == 'filter-l7') indexOfFilter = i;
	}
	return indexOfFilter;
}

function has_lua_desync(tokens) {
	return has_name(tokens, ['lua-desync']);
}

function autowrap(tokens) {
	if (!has_lua_desync(tokens)
		|| has_name(tokens, ['filter-tcp', 'filter-udp', 'filter-l7'])) return tokens;
	let payload = first_payload(tokens);
	if (payload == null) return tokens;
	let value = payload.value, prefix = null;
	if (value == 'tls_client_hello') prefix = ['--filter-tcp=443', '--filter-l7=tls'];
	else if (value == 'http_req' || value == 'http_reply') prefix = ['--filter-tcp=80', '--filter-l7=http'];
	else if (value == 'quic_initial') prefix = ['--filter-udp=443', '--filter-l7=quic'];
	if (prefix == null) return tokens;
	let result = [];
	for (let i = 0; i < length(prefix); i++) push(result, prefix[i]);
	for (let i = 0; i < length(tokens); i++) push(result, tokens[i]);
	return result;
}

function list_descriptor(environment, key) {
	if (!is_object(environment.lists)) return null;
	return environment.lists[key];
}

function descriptor_path(descriptor, fallback) {
	if (type(descriptor) == 'string') return descriptor;
	if (is_object(descriptor) && descriptor.path != null) return descriptor.path;
	return fallback;
}

function descriptor_present(descriptor, defaultValue) {
	if (is_object(descriptor) && descriptor.present != null) return descriptor.present == true;
	return defaultValue;
}

function descriptor_safe(descriptor) {
	return !is_object(descriptor) || (descriptor.symlink != true && descriptor.safe != false);
}

function list_descriptor_for(environment, reference) {
	if (!is_object(environment.lists)) return null;
	let keys = [reference];
	if (starts_with(reference, '/')) push(keys, substr(reference, 1));
	if (starts_with(reference, 'lists/')) push(keys, substr(reference, 6));
	for (let i = 0; i < length(keys); i++) if (environment.lists[keys[i]] != null) return environment.lists[keys[i]];
	return null;
}

function list_reference(environment, reference, kind) {
	let paths = is_object(environment.paths) ? environment.paths : {};
	let descriptor = list_descriptor_for(environment, reference), raw = descriptor_path(descriptor, reference);
	let resolved = resolve_path(raw, paths, kind == 'ipset' ? 'ipset' : 'list');
	let available = descriptor != null && descriptor_safe(descriptor)
		&& descriptor_present(descriptor, false) && resolved != null;
	return {
		reference: reference,
		available: available,
		path: resolved,
		reason: descriptor == null ? 'list descriptor is missing'
			: (!descriptor_safe(descriptor) ? 'list descriptor resolves through a symlink'
				: (resolved == null ? 'list path is outside the bounded native root' : 'list file is missing')),
	};
}

function list_flags(environment, tokens) {
	let mode = environment.listMode == null ? 'none' : environment.listMode;
	let paths = is_object(environment.paths) ? environment.paths : {};
	let result = [];
	let hasHostlist = has_name(tokens, ['hostlist', 'hostlist-domains']);
	let hasHostlistAuto = has_name(tokens, ['hostlist-auto']);
	let hasExclude = has_name(tokens, ['hostlist-exclude', 'hostlist-exclude-domains']);

	if (mode == 'explicit' && !hasHostlist) {
			let path = environment.listPath;
			let list = path == null ? null : list_reference(environment, path, 'list');
			if (list != null && list.available) push(result, '--hostlist=' + list.path);
	} else if ((mode == 'auto' || mode == 'autohostlist') && !hasHostlistAuto) {
			if (safe_absolute_path(paths.autoHostlist)) push(result, '--hostlist-auto=' + paths.autoHostlist);
	}
	if (!hasExclude && mode != 'ipset' && safe_absolute_path(paths.hostlistExclude))
		push(result, '--hostlist-exclude=' + paths.hostlistExclude);
	return result;
}

function insert_lists(tokens, injected) {
	if (length(injected) == 0) return tokens;
	let payload = first_payload(tokens), at = payload != null ? payload.index : length(tokens);
	let filter = last_filter_index(tokens);
	if (filter >= 0 && filter + 1 > at) at = filter + 1;
	let result = [];
	for (let i = 0; i < length(tokens); i++) {
		if (i == at) for (let j = 0; j < length(injected); j++) push(result, injected[j]);
		push(result, tokens[i]);
	}
	if (at >= length(tokens)) for (let j = 0; j < length(injected); j++) push(result, injected[j]);
	return result;
}

function add_dependency(dependencies, kind, reference, available, reason) {
	let key = kind + ':' + reference;
	for (let i = 0; i < length(dependencies.items); i++)
		if (dependencies.items[i].key == key) return;
	let item = { key: key, kind: kind, reference: reference, available: available == true };
	if (!item.available) {
		item.reason = reason != null ? reason : 'dependency is unavailable';
		push(dependencies.missing, item);
	}
	push(dependencies.items, item);
}

function lua_dependency(environment, reference) {
	let name = reference, root = is_object(environment.paths) ? environment.paths.luaRoot : null;
	if (starts_with(name, '@lua/')) name = substr(name, 5);
	else if (root != null && starts_with(name, root + '/')) name = substr(name, length(root) + 1);
	let descriptor = is_object(environment.lua) ? environment.lua[name] : null;
	let source = descriptor_path(descriptor, name), resolved = resolve_path(source, is_object(environment.paths) ? environment.paths : {}, 'lua');
	return {
		name: name,
		available: descriptor != null && descriptor_safe(descriptor)
			&& descriptor_present(descriptor, false) && resolved != null,
		reason: descriptor == null ? 'Lua descriptor is missing'
			: (!descriptor_safe(descriptor) ? 'Lua descriptor resolves through a symlink'
				: (resolved == null ? 'Lua path is outside the bounded native root' : 'Lua file is missing')),
	};
}

function blob_dependency(environment, reference, sourceOverride) {
	let descriptor = is_object(environment.blobs) ? environment.blobs[reference] : null;
	let source = sourceOverride != null ? sourceOverride : descriptor_path(descriptor, null), resolved = source == null ? null
		: resolve_path(source, is_object(environment.paths) ? environment.paths : {}, 'blob');
	return {
		available: descriptor != null && descriptor_safe(descriptor)
			&& descriptor_present(descriptor, false) && resolved != null,
		descriptor: descriptor,
		reason: descriptor == null ? 'Blob descriptor is missing'
			: (!descriptor_safe(descriptor) ? 'Blob descriptor resolves through a symlink'
				: (resolved == null ? 'Blob path is outside the bounded native root' : 'Blob file is missing')),
	};
}

function collect_list_option_dependencies(dependencies, tokens, environment) {
	for (let ti = 0; ti < length(tokens); ti++) {
		let info = option_info(tokens[ti].value);
		if (!info.hasEquals) continue;
		let kind = null;
		if (info.name == 'hostlist' || info.name == 'hostlist-domains' || info.name == 'hostlist-auto'
			|| info.name == 'hostlist-exclude' || info.name == 'hostlist-exclude-domains') kind = 'hostlist';
		else if (info.name == 'ipset' || info.name == 'ipset-ip' || info.name == 'ipset-exclude' || info.name == 'ipset-exclude-ip') kind = 'ipset';
		if (kind == null) continue;
		let list = list_reference(environment, info.value, kind);
		add_dependency(dependencies, kind, info.value, list.available, list.reason);
	}
}

function collect_environment_list_dependencies(dependencies, fragments, environment) {
	let hasHostlist = false, hasHostlistAuto = false, hasExclude = false;
	for (let fi = 0; fi < length(fragments); fi++) {
		let tokens = avatar_tokenize(fragments[fi]).tokens;
		for (let ti = 0; ti < length(tokens); ti++) {
			let name = option_info(tokens[ti].value).name;
			if (name == 'hostlist' || name == 'hostlist-domains') hasHostlist = true;
			if (name == 'hostlist-auto') hasHostlistAuto = true;
			if (name == 'hostlist-exclude' || name == 'hostlist-exclude-domains') hasExclude = true;
		}
	}
	let mode = environment.listMode == null ? 'none' : environment.listMode;
	if (mode == 'explicit' && !hasHostlist && environment.listPath != null) {
		let list = list_reference(environment, environment.listPath, 'list');
		add_dependency(dependencies, 'hostlist', environment.listPath, list.available, list.reason);
	}
	let paths = is_object(environment.paths) ? environment.paths : {};
	if ((mode == 'auto' || mode == 'autohostlist') && !hasHostlistAuto && paths.autoHostlist != null)
		add_dependency(dependencies, 'hostlist', paths.autoHostlist, safe_absolute_path(paths.autoHostlist), 'auto hostlist path is unsafe');
	if (mode != 'ipset' && !hasExclude && paths.hostlistExclude != null)
		add_dependency(dependencies, 'hostlist', paths.hostlistExclude, safe_absolute_path(paths.hostlistExclude), 'hostlist exclusion path is unsafe');
}

function collect_raw_lua_dependencies(dependencies, rawFragments, environment) {
	let marker = '--lua-init=@lua/';
	for (let fi = 0; fi < length(rawFragments); fi++) {
		let raw = rawFragments[fi], cursor = 0;
		while (cursor < length(raw)) {
			let found = index(substr(raw, cursor), marker);
			if (found < 0) break;
			let start = cursor + found + length(marker), end = start;
			while (end < length(raw)) {
				let c = substr(raw, end, 1);
				if (c == ' ' || c == '\t' || c == '\r' || c == '\n') break;
				end++;
			}
			let name = substr(raw, start, end - start), lua = lua_dependency(environment, '@lua/' + name);
			add_dependency(dependencies, 'lua', lua.name, lua.available, lua.reason);
			cursor = end;
		}
	}
}

function collect_dependencies(strategy, fragments, environment, rawFragments) {
	let dependencies = { available: true, items: [], missing: [] };
	let metadataBlobs = type(strategy.blobs) == 'array' ? strategy.blobs : [];
	for (let i = 0; i < length(metadataBlobs); i++) {
		let name = metadataBlobs[i];
		let blob = blob_dependency(environment, name);
		add_dependency(dependencies, 'blob', name, blob.available, blob.reason);
	}
	if (rawFragments != null) collect_raw_lua_dependencies(dependencies, rawFragments, environment);
	let scanFragments = rawFragments != null ? rawFragments : fragments;
	collect_environment_list_dependencies(dependencies, scanFragments, environment);
	for (let fi = 0; fi < length(scanFragments); fi++) {
		let tokens = avatar_tokenize(scanFragments[fi]).tokens;
		for (let ti = 0; ti < length(tokens); ti++) {
			let info = option_info(tokens[ti].value);
			if (info.name == 'lua-init' && info.hasEquals
				&& (starts_with(info.value, '@lua/') || substr(info.value, length(info.value) - 4) == '.lua')) {
				let lua = lua_dependency(environment, info.value);
				add_dependency(dependencies, 'lua', lua.name, lua.available, lua.reason);
			}
			if (info.name == 'blob' && info.hasEquals) {
				let value = info.value, name = value, source = null, colon = index(value, ':');
				if (colon >= 0) {
					name = substr(value, 0, colon);
					source = substr(value, colon + 1);
				}
				let blob = blob_dependency(environment, name, source);
				add_dependency(dependencies, 'blob', name, blob.available, blob.reason);
			}
			if (info.name == 'lua-desync' && info.hasEquals) {
				let parts = split(info.value, ':');
				for (let pi = 1; pi < length(parts); pi++) if (starts_with(parts[pi], 'blob=')) {
					let name = substr(parts[pi], 5), blob = blob_dependency(environment, name);
					add_dependency(dependencies, 'blob', name, blob.available, blob.reason);
				}
			}
		}
		collect_list_option_dependencies(dependencies, tokens, environment);
	}
	dependencies.available = length(dependencies.missing) == 0;
	return dependencies;
}

function blob_declarations(strategy, fragments, environment) {
	let declarations = [], declared = {};
	for (let fi = 0; fi < length(fragments); fi++) {
		let tokens = avatar_tokenize(fragments[fi]).tokens;
		for (let ti = 0; ti < length(tokens); ti++) {
			let info = option_info(tokens[ti].value);
			if (info.name == 'blob' && info.hasEquals) {
				let value = info.value, colon = index(value, ':');
				let name = colon >= 0 ? substr(value, 0, colon) : value;
				declared[name] = true;
			}
		}
	}
	if (type(strategy.blobs) != 'array') return declarations;
	let paths = is_object(environment.paths) ? environment.paths : {};
	for (let i = 0; i < length(strategy.blobs); i++) {
		let name = strategy.blobs[i];
		if (declared[name]) continue;
		let descriptor = is_object(environment.blobs) ? environment.blobs[name] : null;
		let source = descriptor_path(descriptor, null);
		if (source == null) continue;
		let resolved = resolve_path(source, paths, 'blob');
		if (descriptor_safe(descriptor) && descriptor_present(descriptor, false) && resolved != null)
			push(declarations, '--blob=' + name + ':' + resolved);
		declared[name] = true;
	}
	return declarations;
}

function insert_global_declarations(fragments, declarations) {
	if (length(declarations) == 0 || length(fragments) == 0) return fragments;
	let result = [];
	let first = [];
	for (let i = 0; i < length(declarations); i++) push(first, declarations[i]);
	let tokens = avatar_tokenize(fragments[0]).tokens;
	for (let i = 0; i < length(tokens); i++) push(first, tokens[i].value);
	push(result, join(' ', first));
	for (let i = 1; i < length(fragments); i++) push(result, fragments[i]);
	return result;
}

function validate_fragment(fragment, id, includeWarnings) {
	let diagnostics = [];
	if (includeWarnings == null) includeWarnings = true;
	if (fragment == '') {
		push(diagnostics, { severity: 'error', code: 'MANAGER_EMPTY_PROFILE', message: 'Profile ' + id + ' is empty' });
		return diagnostics;
	}
	if (index(fragment, '\n') >= 0 || index(fragment, '\r') >= 0) {
		push(diagnostics, { severity: 'error', code: 'MANAGER_FRAGMENT_MULTILINE', message: 'Profile ' + id + ' is multiline' });
		return diagnostics;
	}
	let model = z2m_parse(fragment), parsed = model.diagnostics;
	for (let i = 0; i < length(parsed); i++)
		if (includeWarnings || parsed[i].severity == 'error') push(diagnostics, parsed[i]);
	let validated = z2m_validate(model);
	for (let i = 0; i < length(validated); i++)
		if (includeWarnings || validated[i].severity == 'error') push(diagnostics, validated[i]);
	if (length(model.profiles) != 1 || length(model.trailingTokens) > 0)
		push(diagnostics, { severity: 'error', code: 'MANAGER_FRAGMENT_NOT_SINGLE_PROFILE', message: 'Profile ' + id + ' is not one native profile' });
	return diagnostics;
}

function shell_quote(value) {
	let result = "'";
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == "'" ? "'\\''" : c;
	}
	return result + "'";
}

function digest_text(text) {
	let process = null;
	try { process = popen('printf %s ' + shell_quote(text) + ' | sha256sum 2>/dev/null', 'r'); }
	catch (e) { return null; }
	if (!process) return null;
	let output = process.read('all') || '', rc = process.close();
	let fields = split(trim_ws(output), /[ \t]+/);
	return rc == 0 && length(fields) > 0 ? fields[0] : null;
}

function compile_normalized(strategy, environment) {
	let enabled = strategy_enabled_profiles(strategy), fragments = [], rawFragments = [], diagnostics = [];
	for (let i = 0; i < length(enabled); i++) {
		push(rawFragments, enabled[i].args);
		let tokenized = avatar_tokenize(enabled[i].args), tokens = [];
		for (let ti = 0; ti < length(tokenized.tokens); ti++) {
			if (tokenized.tokens[ti].value == '--new')
				return error_result('EINPUT', 'Profile ' + enabled[i].id + ' contains a reserved --new separator');
			push(tokens, resolve_token(tokenized.tokens[ti].value, environment));
		}
		tokens = autowrap(tokens);
		tokens = insert_lists(tokens, list_flags(environment, tokens));
		let values = [];
		for (let ti = 0; ti < length(tokens); ti++) push(values, tokens[ti]);
		let fragment = trim_ws(join(' ', values));
		let fragmentDiagnostics = validate_fragment(fragment, enabled[i].id);
		for (let di = 0; di < length(fragmentDiagnostics); di++) push(diagnostics, fragmentDiagnostics[di]);
		push(fragments, fragment);
	}
	let declarations = blob_declarations(strategy, fragments, environment);
	fragments = insert_global_declarations(fragments, declarations);
	let dependencies = collect_dependencies(strategy, fragments, environment, rawFragments);
	for (let i = 0; i < length(fragments); i++) {
		let post = validate_fragment(fragments[i], enabled[i].id, false);
		for (let j = 0; j < length(post); j++) push(diagnostics, post[j]);
	}
	if (length(diagnostics) > 0) {
		let hasError = false;
		for (let i = 0; i < length(diagnostics); i++) if (diagnostics[i].severity == 'error') hasError = true;
		if (hasError) return error_result('EINPUT', 'one or more transformed Profiles are structurally invalid', { diagnostics: diagnostics });
	}
	if (length(fragments) == 0) {
		let digest = digest_text('');
		if (digest == null) return error_result('EINTERNAL', 'SHA-256 is unavailable for candidate identity');
		return {
			ok: true, strategyArgs: '', fragments: [], profilesCount: 0,
			dependencies: dependencies, diagnostics: diagnostics, applicable: false,
			digest: digest, candidateSha256: digest, expectedHash: digest
		};
	}
	let drafts = [];
	for (let i = 0; i < length(fragments); i++) push(drafts, { id: enabled[i].id, opt: fragments[i] });
	let rendered = profiles_render_candidate(drafts);
	if (!rendered.ok) return error_result('EINPUT', 'Profile renderer refused transformed fragments', { renderer: rendered });
	if (!profiles_candidate_round_trip(rendered.candidate, rendered.fragments))
		return error_result('EINTERNAL', 'Profile renderer round-trip proof failed');
	let digest = digest_text(rendered.candidate);
	if (digest == null) return error_result('EINTERNAL', 'SHA-256 is unavailable for candidate identity');
	return {
		ok: true,
		strategyArgs: rendered.candidate,
		fragments: rendered.fragments,
		profilesCount: length(rendered.fragments),
		dependencies: dependencies,
		diagnostics: diagnostics,
		applicable: dependencies.available,
		digest: digest,
		candidateSha256: digest,
		expectedHash: digest
	};
}

export const strategy_compile = function(input, environment) {
	let normalized = strategy_normalize(input);
	if (!normalized.ok) return normalized;
	return compile_normalized(normalized.strategy, is_object(environment) ? environment : {});
};

export const strategy_candidate = function(input, environment) {
	let result = strategy_compile(input, environment);
	if (!result.ok) return result;
	return {
		ok: true,
		candidate: result.strategyArgs,
		strategyArgs: result.strategyArgs,
		fragments: result.fragments,
		profilesCount: result.profilesCount,
		dependencies: result.dependencies,
		applicable: result.applicable,
		digest: result.digest,
		candidateSha256: result.digest,
		expectedHash: result.digest,
	};
};

export const strategy_effective_argv = function(strategyArgs, runtimeInputs) {
	if (type(strategyArgs) != 'string' || !is_object(runtimeInputs))
		return error_result('EINPUT', 'strategy args and live runtime inputs are required');
	if (runtimeInputs.source != 'live' || runtimeInputs.command != null || runtimeInputs.argv != null)
		return error_result('EINPUT', 'effective command requires captured live runtime inputs, not client-composed argv');
	if (runtimeInputs.enginePath != ENGINE_PATH)
		return error_result('EINPUT', 'effective command engine path is not the pinned zapret2 engine');
	let argv = [ENGINE_PATH];
	let baseArgs = runtimeInputs.baseArgs;
	if (type(baseArgs) != 'array') return error_result('EINPUT', 'live base args are required');
	for (let i = 0; i < length(baseArgs); i++) {
		if (type(baseArgs[i]) != 'string') return error_result('EINPUT', 'live base args must be strings');
		push(argv, baseArgs[i]);
	}
	let luaInit = runtimeInputs.luaInit;
	if (type(luaInit) != 'array') return error_result('EINPUT', 'live Lua-init inputs are required');
	for (let i = 0; i < length(luaInit); i++) {
		if (type(luaInit[i]) != 'string') return error_result('EINPUT', 'live Lua-init inputs must be strings');
		push(argv, '--lua-init=' + luaInit[i]);
	}
	let hostlists = runtimeInputs.hostlists;
	if (type(hostlists) != 'array') return error_result('EINPUT', 'live hostlist inputs are required');
	for (let i = 0; i < length(hostlists); i++) {
		if (type(hostlists[i]) != 'string') return error_result('EINPUT', 'live hostlist inputs must be strings');
		push(argv, '--hostlist=' + hostlists[i]);
	}
	let tokenized = avatar_tokenize(strategyArgs);
	if (!tokenized.ok) return tokenized;
	for (let i = 0; i < length(tokenized.tokens); i++) push(argv, tokenized.tokens[i].value);
	let command = '';
	for (let i = 0; i < length(argv); i++) {
		if (i > 0) command += ' ';
		command += shell_quote(argv[i]);
	}
	return { ok: true, argv: argv, command: command };
};
