'use strict';

// Server-owned Strategy Catalog planning. This module stops at immutable
// candidate descriptions: it does not build commands or touch runtime state.

import { scanner_target_profile } from './scanner-targets.uc';
import { avatar_tokenize } from './strategy-model.uc';
import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';
import { strategy_user_list } from './strategy-state.uc';
import { strategy_candidate } from './strategy-compiler.uc';
import { popen } from 'fs';

const KNOWN_DPI = {
	tls_dpi: { must: ['filter-l7=tls', 'tls_client_hello'], bad: ['filter-l7=quic', 'quic_initial'] },
	clienthello_dpi: { must: ['filter-l7=tls', 'tls_client_hello'], bad: ['filter-l7=quic'] },
	tcp_reset: { must: ['filter-l7=tls'], bad: [] },
	quic_block: { must: ['filter-l7=quic', 'quic_initial'], bad: ['filter-l7=tls'] },
	http_inject: { must: ['filter-l7=http', 'http_req'], bad: ['filter-l7=tls'] },
	isp_page: { must: [], bad: [] },
	tls_mitm: { must: [], bad: [] },
	tcp_16_20: { must: ['filter-l7=tls'], bad: [] },
	stun_block: { must: ['filter-udp'], bad: [] },
	throttled: { must: [], bad: [] },
	dns_fake: { skip: true },
	ip_block: { skip: true },
	full_block: { skip: true },
};

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }

function error_result(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}

function copy(value) {
	if (type(value) == 'array') {
		let result = [];
		for (let i = 0; i < length(value); i++) push(result, copy(value[i]));
		return result;
	}
	if (is_object(value)) {
		let result = {};
		for (let key in value) result[key] = copy(value[key]);
		return result;
	}
	return value;
}

function lower(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}

function starts_with(value, prefix) {
	return is_string(value) && length(value) >= length(prefix)
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

function valid_hostname(value) {
	if (!is_string(value)) return false;
	let host = lower(trim_ws(value));
	if (substr(host, -1) == '.') host = substr(host, 0, length(host) - 1);
	if (length(host) < 1 || length(host) > 253 || index(host, ':') >= 0) return false;
	let labels = split(host, '.');
	if (length(labels) < 2) return false;
	if (length(labels) == 4) {
		let numeric = true;
		for (let i = 0; i < length(labels); i++) for (let j = 0; j < length(labels[i]); j++) {
			let code = ord(substr(labels[i], j, 1));
			if (code < 48 || code > 57) numeric = false;
		}
		if (numeric) return false;
	}
	for (let i = 0; i < length(labels); i++) {
		let label = labels[i];
		if (length(label) < 1 || length(label) > 63 || substr(label, 0, 1) == '-'
			|| substr(label, -1) == '-') return false;
		for (let j = 0; j < length(label); j++) {
			let code = ord(substr(label, j, 1));
			if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code == 45)) return false;
		}
	}
	return true;
}

function request_normalize(input) {
	if (!is_object(input)) return error_result('EINPUT', 'Scanner request is an object with only public fields.', 'request');
	for (let key in input) if (!{ target: true, protocol: true, mode: true, resume: true, dpi_type: true }[key])
		return error_result('EINPUT', 'Scanner request contains an unknown field.', key);
	if (!is_string(input.target)) return error_result('EINPUT', 'Scanner target must be a strict hostname.', 'target');
	let target = lower(trim_ws(input.target));
	if (!valid_hostname(target)) return error_result('EINPUT', 'Scanner target must be a strict hostname.', 'target');
	if (substr(target, -1) == '.') target = substr(target, 0, length(target) - 1);
	let protocol = input.protocol == null ? 'tcp' : lower(trim_ws('' + input.protocol));
	if (protocol != 'tcp' && protocol != 'udp') return error_result('EINPUT', 'Scanner protocol must be tcp or udp.', 'protocol');
	let mode = input.mode == null ? 'quick' : lower(trim_ws('' + input.mode));
	if (mode != 'quick' && mode != 'standard' && mode != 'full') return error_result('EINPUT', 'Scanner mode must be quick, standard, or full.', 'mode');
	let resume = input.resume == null ? false : input.resume;
	if (type(resume) != 'bool') return error_result('EINPUT', 'Scanner resume must be boolean.', 'resume');
	let dpi = input.dpi_type;
	if (dpi == null) dpi = null;
	else {
		if (!is_string(dpi)) return error_result('EINPUT', 'Scanner dpi_type must be bounded text.', 'dpi_type');
		dpi = lower(trim_ws(dpi));
		if (dpi == '') dpi = null;
		else if (length(dpi) > 64) return error_result('EINPUT', 'Scanner dpi_type has invalid bounded syntax.', 'dpi_type');
		else for (let i = 0; i < length(dpi); i++) {
			let code = ord(substr(dpi, i, 1));
			if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57)
				|| (i > 0 && (code == 45 || code == 95))))
				return error_result('EINPUT', 'Scanner dpi_type has invalid bounded syntax.', 'dpi_type');
		}
	}
	return { ok: true, value: { target: target, protocol: protocol, mode: mode, resume: resume, dpi_type: dpi } };
}

function token_values(value) {
	let tokenized = avatar_tokenize(value);
	if (!tokenized.ok) return [];
	let result = [];
	for (let i = 0; i < length(tokenized.tokens); i++)
		push(result, tokenized.tokens[i].value);
	return result;
}

function token_stream(value) {
	let tokens = type(value) == 'array' ? value : token_values(value), result = '';
	for (let i = 0; i < length(tokens); i++) {
		if (i > 0) result += ' ';
		result += tokens[i];
	}
	return result;
}

function option_name(token) {
	if (!starts_with(token, '--')) return null;
	let body = substr(token, 2), equals = index(body, '=');
	return equals < 0 ? body : substr(body, 0, equals);
}

function full_preset(value) {
	let tokens = token_values(value);
	for (let i = 0; i < length(tokens); i++) {
		let token = tokens[i], name = option_name(token);
		if (token == '--new' || name == 'filter-tcp' || name == 'filter-udp'
			|| name == 'hostlist' || name == 'hostlist-domains'
			|| name == 'ipset' || name == 'ipset-exclude' || name == 'blob') return true;
	}
	return false;
}

function integer_value(value) {
	return type(value) == 'int' && value >= 0 ? value : 0;
}

function complexity(value) {
	let tokens = type(value) == 'array' ? value : token_values(value);
	let actions = 0, repeats = 0, multi = 0;
	for (let i = 0; i < length(tokens); i++) {
		let token = tokens[i];
		if (starts_with(token, '--lua-desync=')) actions++;
		if (token == '--new' || starts_with(token, '--lua-desync=send')) multi = 1;
		let repeatAt = index(token, 'repeats=');
		if (repeatAt >= 0) {
			let text = substr(token, repeatAt + 8), end = index(text, ':');
			if (end >= 0) text = substr(text, 0, end);
			let parsed = int(text);
			if (parsed > repeats) repeats = parsed;
		}
	}
	return [actions, repeats, multi];
}

function compare_number(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

function compare_text(a, b) {
	if (a == b) return 0;
	return a < b ? -1 : 1;
}

function compare_complexity(a, b) {
	for (let i = 0; i < 3; i++) {
		let result = compare_number(integer_value(a[i]), integer_value(b[i]));
		if (result != 0) return result;
	}
	return 0;
}

function candidate_sort_key(candidate) {
	return [candidate.fullPreset == true ? 0 : (candidate.recommended == true ? 1 : 2),
		candidate.complexity, candidate.sourcePath || '', candidate.strategyId || ''];
}

function compare_candidates(a, b) {
	let left = candidate_sort_key(a), right = candidate_sort_key(b);
	let result = compare_number(left[0], right[0]);
	if (result != 0) return result;
	result = compare_complexity(left[1], right[1]);
	if (result != 0) return result;
	result = compare_text(left[2], right[2]);
	return result != 0 ? result : compare_text(left[3], right[3]);
}

function sort_candidates(values) {
	let result = [];
	for (let i = 0; i < length(values); i++) {
		let item = values[i], position = length(result);
		for (let j = 0; j < length(result); j++) {
			if (compare_candidates(item, result[j]) < 0) { position = j; break; }
		}
		if (position == length(result)) push(result, item);
		else {
			push(result, null);
			for (let j = length(result) - 1; j > position; j--) result[j] = result[j - 1];
			result[position] = item;
		}
	}
	return result;
}

function contains(values, value) {
	for (let i = 0; i < length(values); i++) if (values[i] == value) return true;
	return false;
}

function source_metadata(entry, name, fallback) {
	let metadata = is_object(entry.metadata) ? entry.metadata : entry;
	return metadata[name] == null ? fallback : metadata[name];
}

function raw_entry_ids(catalog, protocol, mode) {
	if (!is_object(catalog.sets) || !is_object(catalog.sets[protocol])
		|| type(catalog.sets[protocol][mode]) != 'array') return [];
	let result = [];
	for (let i = 0; i < length(catalog.sets[protocol][mode]); i++)
		push(result, catalog.sets[protocol][mode][i]);
	return result;
}

function entry_for(catalog, id) {
	if (is_object(catalog.winners) && is_object(catalog.winners[id])) return catalog.winners[id];
	if (type(catalog.physicalEntries) == 'array')
		for (let i = 0; i < length(catalog.physicalEntries); i++)
			if (catalog.physicalEntries[i].id == id && catalog.physicalEntries[i].winner == true)
				return catalog.physicalEntries[i];
	return null;
}

function selected_entries(catalog, protocol, mode) {
	let ids = raw_entry_ids(catalog, protocol, mode), result = [], full = [];
	for (let i = 0; i < length(ids); i++) {
		let entry = entry_for(catalog, ids[i]);
		if (entry != null && entry.protocol == protocol) push(result, entry);
	}
	if (mode == 'quick' || mode == 'standard') {
		let limit = mode == 'quick' ? 10 : 20, order = type(catalog.winnerOrder) == 'array'
			? catalog.winnerOrder : ids;
		for (let i = 0; i < length(order); i++) {
			let entry = entry_for(catalog, order[i]);
			if (entry != null && entry.protocol == protocol && entry.level == 'builtin'
				&& full_preset(entry.args) && !contains(full, entry.id)) push(full, entry.id);
		}
		let prefix = [], tail = [];
		for (let i = 0; i < length(full) && i < limit; i++) push(prefix, full[i]);
		for (let i = 0; i < length(prefix); i++)
			for (let j = 0; j < length(result); j++) if (result[j] != null && result[j].id == prefix[i]) result[j] = null;
		for (let i = 0; i < length(result); i++) if (result[i] != null
			&& !(result[i].level == 'builtin' && full_preset(result[i].args))) push(tail, result[i]);
		result = [];
		for (let i = 0; i < length(prefix); i++) {
			let item = entry_for(catalog, prefix[i]);
			if (item != null) push(result, item);
		}
		let tailLimit = mode == 'quick' ? 30 - length(prefix) : length(tail);
		if (tailLimit < 20) tailLimit = 20;
		for (let i = 0; i < length(tail) && i < tailLimit; i++) push(result, tail[i]);
	}
	return result;
}

function catalog_strategy(entry) {
	return catalog_entry_to_strategy(entry);
}

function generated_strategy(generated, protocol) {
	let args = generated.args;
	if (!is_string(args) && is_string(generated.rawArgs)) args = generated.rawArgs;
	if (!is_string(args)) return null;
	let id = is_string(generated.id) ? generated.id : null;
	if (id == null || id == '') return null;
	return {
		id: id, name: is_string(generated.name) ? generated.name : id,
		profiles: [{ id: 'generated', args: args, enabled: true }],
		metadata: { label: 'generated' }, blobs: generated.blobs || [],
		origin: 'generated', source: 'generator', level: 'generated', protocol: protocol,
	};
}

function dependency_closure(value) {
	let source = is_object(value) ? value : {};
	return {
		available: source.available == true,
		items: type(source.items) == 'array' ? copy(source.items) : [],
		missing: type(source.missing) == 'array' ? copy(source.missing) : [],
		structurallyCompilable: source.structurallyCompilable == true,
	};
}

function shell_quote(value) {
	let result = "'";
	for (let i = 0; i < length(value); i++) result += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return result + "'";
}

function digest(value) {
	let process = null;
	try { process = popen('printf %s ' + shell_quote(value) + ' | sha256sum 2>/dev/null', 'r'); }
	catch (e) { return null; }
	if (!process) return null;
	let output = process.read('all') || '', rc = process.close(), fields = split(trim_ws(output), /[ \t]+/);
	return rc == 0 && length(fields) > 0 ? fields[0] : null;
}

function compiled_values(compiled) {
	if (!is_object(compiled)) return null;
	if (type(compiled.compiledTokens) == 'array') return copy(compiled.compiledTokens);
	if (is_string(compiled.compiledCandidate)) return token_values(compiled.compiledCandidate);
	return null;
}

function reject_raw_candidate(candidate) {
	for (let key in { args: true, rawArgs: true, command: true, argv: true,
		effectiveCommand: true, effectiveArgv: true, strategyArgs: true })
		if (is_object(candidate) && candidate[key] != null) return true;
	return false;
}

function canonical_view(candidate) {
	let tokens = compiled_values(candidate);
	if (tokens == null || !is_object(candidate)) return null;
	let closure = dependency_closure(candidate.dependencyClosure);
	return { stream: token_stream(tokens), closure: closure };
}

function same_view(left, right) {
	return left != null && right != null && left.stream == right.stream
		&& sprintf('%J', left.closure) == sprintf('%J', right.closure);
}

function compile_view(strategy, environment) {
	if (!is_object(strategy)) return null;
	let result = strategy_candidate(strategy, environment);
	if (!is_object(result) || result.ok != true) return null;
	let tokens = token_values(result.candidate);
	let closure = dependency_closure(result.dependencies);
	return { stream: token_stream(tokens), closure: closure,
		tokens: tokens, compiledDigest: result.candidateSha256,
		dependencyDigest: digest(sprintf('%J', closure)) };
}

function identity_view(existing, environment) {
	if (!is_object(existing)) return null;
	let view = canonical_view(existing);
	if (view != null) return view;
	let strategy = is_object(existing.strategy) ? existing.strategy : existing;
	let compiled = compile_view(strategy, environment);
	return compiled == null ? null : { stream: compiled.stream, closure: compiled.closure };
}

function generated_identity(candidate, existingStrategies, environment) {
	if (reject_raw_candidate(candidate)) return error_result('EINPUT', 'Scanner candidates cannot contain client command arguments.');
	let generated = canonical_view(candidate), existing = type(existingStrategies) == 'array' ? existingStrategies : [];
	if (generated != null) {
		for (let i = 0; i < length(existing); i++) {
			let item = existing[i], view = identity_view(item, environment);
			if (candidate.scannerId == item.id || candidate.scannerId == 'generated:' + item.id) continue;
			if (same_view(generated, view)) return {
				identityKind: 'canonicalized', strategyId: item.id == null ? null : item.id,
				strategyRevision: item.revision == null ? null : item.revision, saveRequired: false,
			};
		}
	}
	return { identityKind: 'generated', strategyId: null, strategyRevision: null, saveRequired: true };
}

function strategy_argument_text(strategy) {
	let result = '';
	if (!is_object(strategy) || type(strategy.profiles) != 'array') return result;
	for (let i = 0; i < length(strategy.profiles); i++) {
		let profile = strategy.profiles[i];
		if (!is_object(profile) || profile.enabled == false) continue;
		if (result != '') result += ' --new ';
		result += profile.args || '';
	}
	return result;
}

export const scanner_candidate_canonicalize = function(candidate, existingStrategies) {
	return generated_identity(candidate, existingStrategies, {});
};

function candidate_from_strategy(strategy, protocol, source, sourcePath, ordinal,
		environment, generated, existingStrategies) {
	let compiled = compile_view(strategy, environment);
	if (compiled == null || compiled.compiledDigest == null) return null;
	let full = full_preset(strategy_argument_text(strategy)), recommended = source_metadata(strategy, 'label', '') == 'recommended';
	let candidate = {
		scannerId: (generated ? 'generated:' : '') + strategy.id,
		identityKind: generated ? 'generated' : (source == 'user' ? 'user' : 'catalog'),
		strategyId: generated ? null : strategy.id,
		strategyRevision: generated ? null : (source == 'user' ? strategy.revision : 0),
		source: generated ? 'generator' : source,
		sourcePath: sourcePath,
		protocol: protocol,
		compiledTokens: copy(compiled.tokens),
		compiledDigest: compiled.compiledDigest,
		dependencyClosure: copy(compiled.closure),
		dependencyDigest: compiled.dependencyDigest,
		ordinal: ordinal,
		complexity: complexity(compiled.tokens),
		recommended: recommended,
		fullPreset: full,
		saveRequired: generated,
	};
	if (generated) {
		let identity = generated_identity(candidate, existingStrategies, environment);
		if (identity.ok == false) return identity;
		candidate.identityKind = identity.identityKind;
		candidate.strategyId = identity.strategyId;
		candidate.strategyRevision = identity.strategyRevision;
		candidate.saveRequired = identity.saveRequired;
	}
	return candidate;
}

function candidate_text(candidate) { return lower(token_stream(candidate.compiledTokens)); }

function dpi_keep(candidate, dpi) {
	if (dpi == null || dpi == '') return true;
	let rule = KNOWN_DPI[dpi];
	if (rule == null) return true;
	if (rule.skip == true) return false;
	let text = candidate_text(candidate), hasMust = false;
	for (let i = 0; i < length(rule.must); i++) if (index(text, rule.must[i]) >= 0) { hasMust = true; break; }
	let trick = starts_with(candidate.sourcePath || '', 'basic/')
		|| starts_with(candidate.sourcePath || '', 'direct/');
	if (length(rule.must) > 0 && !hasMust && !candidate.fullPreset && !trick) return false;
	for (let i = 0; i < length(rule.bad); i++) if (index(text, rule.bad[i]) >= 0) return false;
	return true;
}

function dedup_candidates(values) {
	let result = [], seen = {};
	for (let i = 0; i < length(values); i++) {
		let candidate = values[i], key = candidate_text(candidate) + '\u0000' + sprintf('%J', candidate.dependencyClosure);
		if (seen[key]) continue;
		seen[key] = true;
		push(result, candidate);
	}
	return result;
}

function catalog_snapshot(value) {
	if (is_object(value) && value.ok == true && is_object(value.catalog)) return value.catalog;
	return is_object(value) ? value : null;
}

export const scanner_plan_build = function(request, catalogSnapshot, userStrategies) {
	let validated = request_normalize(request);
	if (!validated.ok) return validated;
	let value = validated.value, catalog = catalog_snapshot(catalogSnapshot);
	if (catalog == null) {
		let loaded = strategy_catalog_load(null);
		if (!is_object(loaded) || loaded.ok != true) return error_result('ENOENT', 'Scanner Strategy Catalog is unavailable.');
		catalog = loaded.catalog;
	}
	let users = userStrategies;
	if (users == null) {
		let listed = strategy_user_list();
		if (!is_object(listed) || listed.ok != true) return error_result('EIO', 'Scanner user Strategies are unavailable.');
		users = listed.strategies;
	}
	if (type(users) != 'array') return error_result('EINPUT', 'Scanner user Strategies must be server-owned records.');
	let profile = null;
	try { profile = scanner_target_profile(value.target); } catch (e) { profile = null; }
	let environment = is_object(catalog.compilerEnvironment)
		? copy(catalog.compilerEnvironment) : {};
	let entries = selected_entries(catalog, value.protocol, value.mode), catalogCandidates = [], ordinal = 1;
	for (let i = 0; i < length(entries); i++) {
		let strategy = catalog_strategy(entries[i]);
		if (strategy == null) continue;
		let candidate = candidate_from_strategy(strategy, value.protocol, 'catalog',
			strategy.sourceFile || entries[i].sourceFile || 'catalog', ordinal++, environment, false, users);
		if (candidate != null) push(catalogCandidates, candidate);
	}
	catalogCandidates = dedup_candidates(sort_candidates(catalogCandidates));
	let generatedCandidates = [];
	if ((value.mode == 'standard' || value.mode == 'full') && is_object(catalog.policy)
		&& catalog.policy.useGenerated == true && type(catalog.generatedCandidates) == 'array') {
		for (let i = 0; i < length(catalog.generatedCandidates); i++) {
			let generated = catalog.generatedCandidates[i];
			if (!is_object(generated) || (generated.protocol || value.protocol) != value.protocol) continue;
			let strategy = generated_strategy(generated, value.protocol);
			if (strategy == null) continue;
			let candidate = candidate_from_strategy(strategy, value.protocol, 'generator', 'generator', ordinal++,
				environment, true, users);
			if (candidate != null) push(generatedCandidates, candidate);
		}
	}
	let candidates = [];
	for (let i = 0; i < length(catalogCandidates); i++) push(candidates, catalogCandidates[i]);
	for (let i = 0; i < length(generatedCandidates); i++) push(candidates, generatedCandidates[i]);
	candidates = dedup_candidates(candidates);
	let filtered = [];
	for (let i = 0; i < length(candidates); i++) if (dpi_keep(candidates[i], value.dpi_type)) push(filtered, candidates[i]);
	return { ok: true, plan: {
		schema: 1, request: copy(value), targetProfile: copy(profile),
		catalogDigest: catalog.aggregateDigest || null,
		compilerDigest: catalog.compilerDigest || null,
		candidates: copy(filtered),
	} };
};
