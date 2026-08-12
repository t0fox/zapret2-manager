'use strict';

// Server-owned Strategy Catalog planning. This module stops at immutable
// candidate descriptions: it does not build commands or touch runtime state.

import { scanner_target_profile } from './scanner-targets.uc';
import { avatar_tokenize } from './strategy-model.uc';
import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';
import { strategy_user_list } from './strategy-state.uc';
import { strategy_candidate, strategy_compiler_authority } from './strategy-compiler.uc';

const AUTHORITY_MARKER = 'z2m-scanner-authority.v1';
const GENERATOR_MARKER = 'z2m-scanner-generator.v1';
const AUTHORITATIVE_CATALOG_REPOSITORY = 'avatarDD/zapret-gui';
const AUTHORITATIVE_CATALOG_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';

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

function valid_digest(value) { return is_string(value) && match(value, /^[a-f0-9]{64}$/); }

function compiler_digest() {
	let authority = strategy_compiler_authority();
	return is_object(authority) && authority.marker == 'z2m-scanner-compiler.v1'
		&& valid_digest(authority.digest) ? authority.digest : null;
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
		candidate.complexity, candidate.sourcePath || '', integer_value(candidate.sourceOrdinal),
		integer_value(candidate.sectionOrdinal), integer_value(candidate.effectiveOrdinal),
		candidate.strategyId || '', integer_value(candidate.catalogOrder)];
}

function compare_candidates(a, b) {
	let left = candidate_sort_key(a), right = candidate_sort_key(b);
	let result = compare_number(left[0], right[0]);
	if (result != 0) return result;
	result = compare_complexity(left[1], right[1]);
	if (result != 0) return result;
	result = compare_text(left[2], right[2]);
	if (result != 0) return result;
	result = compare_number(left[3], right[3]);
	if (result != 0) return result;
	result = compare_number(left[4], right[4]);
	if (result != 0) return result;
	result = compare_number(left[5], right[5]);
	if (result != 0) return result;
	result = compare_text(left[6], right[6]);
	return result != 0 ? result : compare_number(left[7], right[7]);
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

const SHA_K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function u32(value) {
	let result = value % 4294967296;
	return result < 0 ? result + 4294967296 : result;
}

function shr(value, bits) { return int(u32(value) / (2 ** bits)); }

function xor32(left, right) { return u32(u32(left) ^ u32(right)); }
function and32(left, right) { return u32(u32(left) & u32(right)); }
function not32(value) { return 4294967295 - u32(value); }

function rotr(value, bits) {
	return u32(shr(value, bits) | u32(u32(value) * (2 ** (32 - bits))));
}

function hex32(value) {
	let text = '', number = u32(value);
	for (let i = 7; i >= 0; i--) text += substr('0123456789abcdef', int(number / (2 ** (i * 4))) % 16, 1);
	return text;
}

// Pure SHA-256 for the compiler dependency contract. Input is the authoritative
// JSON serialization produced by this module; no filesystem or process access.
function sha256_text(text) {
	let bytes = [];
	for (let i = 0; i < length(text); i++) {
		let code = ord(substr(text, i, 1));
		if (code <= 0x7f) push(bytes, code);
		else if (code <= 0x7ff) {
			push(bytes, 0xc0 | (code >> 6));
			push(bytes, 0x80 | (code & 0x3f));
		}
		else if (code <= 0xffff) {
			push(bytes, 0xe0 | (code >> 12));
			push(bytes, 0x80 | ((code >> 6) & 0x3f));
			push(bytes, 0x80 | (code & 0x3f));
		}
		else {
			push(bytes, 0xf0 | (code >> 18));
			push(bytes, 0x80 | ((code >> 12) & 0x3f));
			push(bytes, 0x80 | ((code >> 6) & 0x3f));
			push(bytes, 0x80 | (code & 0x3f));
		}
	}
	let bitLength = length(bytes) * 8;
	push(bytes, 128);
	while (length(bytes) % 64 != 56) push(bytes, 0);
	for (let i = 7; i >= 0; i--) push(bytes, int(bitLength / (2 ** (i * 8))) % 256);
	let state = [1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225];
	for (let offset = 0; offset < length(bytes); offset += 64) {
		let words = [];
		for (let i = 0; i < 16; i++) {
			let at = offset + i * 4;
			push(words, u32(bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3]));
		}
		for (let i = 16; i < 64; i++) {
			let x = words[i - 15], y = words[i - 2];
			let sx = xor32(xor32(rotr(x, 7), rotr(x, 18)), shr(x, 3));
			let sy = xor32(xor32(rotr(y, 17), rotr(y, 19)), shr(y, 10));
			push(words, u32(sx + words[i - 16] + sy + words[i - 7]));
		}
		let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
		for (let i = 0; i < 64; i++) {
			let s1 = xor32(xor32(rotr(e, 6), rotr(e, 11)), rotr(e, 25));
			let choose = xor32(and32(e, f), and32(not32(e), g));
			let temp1 = u32(h + s1 + choose + SHA_K[i] + words[i]);
			let s0 = xor32(xor32(rotr(a, 2), rotr(a, 13)), rotr(a, 22));
			let majority = xor32(xor32(and32(a, b), and32(a, c)), and32(b, c));
			let temp2 = u32(s0 + majority);
			h = g; g = f; f = e; e = u32(d + temp1); d = c; c = b; b = a; a = u32(temp1 + temp2);
		}
		state[0] = u32(state[0] + a); state[1] = u32(state[1] + b); state[2] = u32(state[2] + c); state[3] = u32(state[3] + d);
		state[4] = u32(state[4] + e); state[5] = u32(state[5] + f); state[6] = u32(state[6] + g); state[7] = u32(state[7] + h);
	}
	let result = '';
	for (let i = 0; i < 8; i++) result += hex32(state[i]);
	return result;
}

function dependency_digest(strategy, catalog, source, closure) {
	if (closure == null) return null;
	let computed = sha256_text(sprintf('%J', closure));
	if (!valid_digest(computed)) return null;
	let supplied = is_object(source) && is_string(source.dependencyDigest) ? source.dependencyDigest
		: (is_string(strategy.dependencyDigest) ? strategy.dependencyDigest
			: (is_object(catalog.dependencyDigests) ? catalog.dependencyDigests[strategy.id] : null));
	return supplied == null ? computed : (supplied == computed ? computed : null);
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

function dependency_closure(value) {
	let source = is_object(value) ? value : {};
	if (type(source.available) != 'bool' || type(source.structurallyCompilable) != 'bool'
		|| type(source.items) != 'array' || type(source.missing) != 'array') return null;
	for (let i = 0; i < length(source.items); i++) {
		let item = source.items[i];
		if (!is_object(item) || !is_string(item.key) || !is_string(item.kind)
			|| !is_string(item.id) || !is_string(item.reference)
			|| type(item.available) != 'bool' || !exists(item, 'reason')
			|| (item.reason != null && !is_string(item.reason))) return null;
	}
	for (let i = 0; i < length(source.missing); i++) {
		let item = source.missing[i];
		if (!is_object(item) || !is_string(item.key) || !is_string(item.kind)
			|| !is_string(item.id) || !is_string(item.reference)
			|| type(item.available) != 'bool' || item.available == true || !exists(item, 'reason')
			|| !is_string(item.reason)) return null;
	}
	let missing = {}, unavailable = false;
	for (let i = 0; i < length(source.missing); i++) missing[source.missing[i].key] = true;
	for (let i = 0; i < length(source.items); i++) {
		let item = source.items[i];
		if (!item.available) {
			unavailable = true;
			if (!missing[item.key]) return null;
		}
	}
	if (source.available == unavailable || source.structurallyCompilable != true) return null;
	return {
		available: source.available, items: copy(source.items), missing: copy(source.missing),
		structurallyCompilable: source.structurallyCompilable,
	};
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
	if (closure == null) return null;
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
	if (closure == null) return null;
	return { stream: token_stream(tokens), closure: closure,
		tokens: tokens, compiledDigest: result.candidateSha256,
		dependencyDigest: null };
}

function identity_view(existing, environment) {
	if (!is_object(existing)) return null;
	let strategy = is_object(existing.strategy) ? existing.strategy : existing;
	if (!is_string(strategy.id) || !is_string(strategy.name) || type(strategy.profiles) != 'array'
		|| length(strategy.profiles) == 0 || strategy.origin != 'user' || type(strategy.revision) != 'int') return null;
	for (let i = 0; i < length(strategy.profiles); i++) {
		let profile = strategy.profiles[i];
		if (!is_object(profile) || !is_string(profile.id) || !is_string(profile.args) || type(profile.enabled) != 'bool') return null;
	}
	let compiled = compile_view(strategy, environment);
	return compiled == null ? null : { stream: compiled.stream, closure: compiled.closure };
}

function generated_identity(candidate, existingStrategies, environment) {
	if (reject_raw_candidate(candidate)) return error_result('EINPUT', 'Scanner candidates cannot contain client command arguments.');
	if (type(existingStrategies) != 'object' || existingStrategies.serverOwned != true
		|| !is_object(existingStrategies.authority)
		|| existingStrategies.authority.marker != AUTHORITY_MARKER
		|| existingStrategies.authority.repository != AUTHORITATIVE_CATALOG_REPOSITORY
		|| existingStrategies.authority.commit != AUTHORITATIVE_CATALOG_COMMIT
		|| existingStrategies.authority.catalogDigest != '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1'
		|| !valid_digest(existingStrategies.authority.catalogEnvelopeDigest)
		|| !is_object(existingStrategies.authority.catalog)
		|| existingStrategies.authority.catalog.serverOwned != true
		|| existingStrategies.authority.catalog.marker != 'z2m-scanner-catalog.v1'
		|| existingStrategies.authority.catalog.repository != AUTHORITATIVE_CATALOG_REPOSITORY
		|| existingStrategies.authority.catalog.commit != AUTHORITATIVE_CATALOG_COMMIT
		|| existingStrategies.authority.catalog.catalogDigest != existingStrategies.authority.catalogDigest
		|| existingStrategies.authority.catalog.catalogEnvelopeDigest != existingStrategies.authority.catalogEnvelopeDigest
		|| candidate.compilerDigest != compiler_digest()
		|| candidate.catalogDigest != existingStrategies.authority.catalogDigest
		|| existingStrategies.authority.compilerDigest != compiler_digest())
		return error_result('EVERIFY', 'User Strategies are not authoritative.');
	let existing = type(existingStrategies) == 'object' ? existingStrategies.strategies : existingStrategies;
	if (type(existing) != 'array') return error_result('EVERIFY', 'User Strategies are not authoritative.');
	let generated = canonical_view(candidate);
	if (generated == null) return error_result('EINPUT', 'Generated candidate identity is incomplete.');
	let computedDependencyDigest = sha256_text(sprintf('%J', generated.closure));
	if (!valid_digest(computedDependencyDigest)
		|| (candidate.dependencyDigest != null && candidate.dependencyDigest != computedDependencyDigest))
		return error_result('EVERIFY', 'Scanner dependency digest does not match the validated closure.');
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
		environment, generated, existingStrategies, catalog, generatedInput) {
	let compiled = compile_view(strategy, environment);
	if (compiled == null || compiled.compiledDigest == null) return null;
	let dependencyDigest = dependency_digest(strategy, catalog, generatedInput, compiled.closure);
	if (dependencyDigest == null) return error_result('EVERIFY', 'Scanner dependency authority is unavailable or mismatched.');
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
		dependencyDigest: dependencyDigest,
		catalogDigest: catalog.aggregateDigest,
		compilerDigest: compiler_digest(),
		ordinal: ordinal,
		complexity: complexity(compiled.tokens),
		recommended: recommended,
		fullPreset: full,
		saveRequired: generated,
	};
	candidate.sourceOrdinal = integer_value(strategy.sourceOrdinal);
	candidate.sectionOrdinal = integer_value(strategy.sectionOrdinal != null ? strategy.sectionOrdinal
		: source_metadata(strategy, 'sectionOrdinal', 0));
	candidate.effectiveOrdinal = integer_value(strategy.effectiveOrdinal);
	candidate.catalogOrder = ordinal;
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

function catalog_aggregate_digest(catalog) {
	if (!is_object(catalog) || type(catalog.files) != 'array') return null;
	let aggregate = '';
	for (let i = 0; i < length(catalog.files); i++) {
		let file = catalog.files[i];
		if (!is_object(file) || !is_string(file.path) || !valid_digest(file.sha256)) return null;
		aggregate += file.sha256 + '  catalogs/' + file.path + '\n';
	}
	return sha256_text(aggregate);
}

function catalog_envelope_digest(catalog) {
	if (!is_object(catalog)) return null;
	let envelope = { source: catalog.source, aggregateDigest: catalog.aggregateDigest,
		files: catalog.files, winnerOrder: catalog.winnerOrder, sets: catalog.sets, winners: catalog.winners };
	let digest = sha256_text(sprintf('%J', envelope));
	return valid_digest(digest) ? digest : null;
}

function target_profile_valid(profile) {
	return is_object(profile) && is_string(profile.profileKey) && is_string(profile.primaryHost)
		&& type(profile.testHosts) == 'array' && type(profile.hostlistDomains) == 'array'
		&& type(profile.expectedHostlists) == 'array' && is_object(profile.tcp)
		&& is_object(profile.udp) && is_string(profile.probeUrl);
}

function authority_valid(catalog) {
	let compilerDigest = compiler_digest();
	let envelopeDigest = catalog_envelope_digest(catalog);
	return is_object(catalog) && catalog.serverOwned == true && is_object(catalog.authority)
		&& catalog_aggregate_digest(catalog) == catalog.aggregateDigest
		&& catalog.authority.marker == AUTHORITY_MARKER
		&& catalog.authority.repository == AUTHORITATIVE_CATALOG_REPOSITORY
		&& catalog.authority.commit == AUTHORITATIVE_CATALOG_COMMIT
		&& catalog.authority.catalogDigest == catalog.aggregateDigest
		&& valid_digest(catalog.authority.catalogEnvelopeDigest)
		&& is_object(catalog.authority.catalog)
		&& catalog.authority.catalog.serverOwned == true
		&& catalog.authority.catalog.marker == 'z2m-scanner-catalog.v1'
		&& catalog.authority.catalog.repository == AUTHORITATIVE_CATALOG_REPOSITORY
		&& catalog.authority.catalog.commit == AUTHORITATIVE_CATALOG_COMMIT
		&& catalog.authority.catalog.catalogDigest == catalog.aggregateDigest
		&& catalog.authority.catalog.catalogEnvelopeDigest == catalog.authority.catalogEnvelopeDigest
		&& sprintf('%J', catalog.authority.catalog.source) == sprintf('%J', catalog.source)
		&& sprintf('%J', catalog.authority.catalog.winnerOrder) == sprintf('%J', catalog.winnerOrder)
		&& sprintf('%J', catalog.authority.catalog.sets) == sprintf('%J', catalog.sets)
		&& sprintf('%J', catalog.authority.catalog.winners) == sprintf('%J', catalog.winners)
		&& catalog.authority.compilerDigest == compilerDigest
		&& catalog.compilerDigest == compilerDigest;
}

function generator_valid(catalog) {
	let compilerDigest = compiler_digest();
	return is_object(catalog.generator) && catalog.generator.serverOwned == true
		&& is_object(catalog.generator.authority) && catalog.generator.authority.marker == GENERATOR_MARKER
		&& catalog.generator.authority.repository == AUTHORITATIVE_CATALOG_REPOSITORY
		&& catalog.generator.authority.commit == AUTHORITATIVE_CATALOG_COMMIT
		&& catalog.generator.authority.catalogDigest == catalog.aggregateDigest
		&& catalog.generator.authority.catalogEnvelopeDigest == catalog.authority.catalogEnvelopeDigest
		&& sprintf('%J', catalog.generator.authority.catalog) == sprintf('%J', catalog.authority.catalog)
		&& catalog.generator.authority.compilerDigest == compilerDigest
		&& type(catalog.generator.candidates) == 'array';
}

function records_shape_valid(records, generated) {
	for (let i = 0; i < length(records); i++) {
		let strategy = records[i];
		if (!is_object(strategy) || !is_string(strategy.id) || !is_string(strategy.name)
			|| type(strategy.profiles) != 'array' || length(strategy.profiles) == 0) return false;
		for (let j = 0; j < length(strategy.profiles); j++) {
			let profile = strategy.profiles[j];
			if (!is_object(profile) || !is_string(profile.id) || !is_string(profile.args)
				|| type(profile.enabled) != 'bool') return false;
		}
		if (!generated && (strategy.origin != 'user' || type(strategy.revision) != 'int')) return false;
	}
	return true;
}

function user_records_valid(value, catalog) {
	let compilerDigest = compiler_digest();
	return is_object(value) && value.serverOwned == true && is_object(value.authority)
		&& value.authority.marker == AUTHORITY_MARKER
		&& value.authority.repository == AUTHORITATIVE_CATALOG_REPOSITORY
		&& value.authority.commit == AUTHORITATIVE_CATALOG_COMMIT
		&& value.authority.catalogDigest == catalog.aggregateDigest
		&& value.authority.catalogEnvelopeDigest == catalog.authority.catalogEnvelopeDigest
		&& is_object(value.authority.catalog)
		&& value.authority.catalog.repository == catalog.authority.catalog.repository
		&& value.authority.catalog.commit == catalog.authority.catalog.commit
		&& value.authority.catalog.catalogDigest == catalog.authority.catalog.catalogDigest
		&& value.authority.catalog.catalogEnvelopeDigest == catalog.authority.catalogEnvelopeDigest
		&& value.authority.compilerDigest == compilerDigest
		&& type(value.strategies) == 'array' && records_shape_valid(value.strategies, false);
}

function profile_matches_request(profile, request) {
	if (!is_object(profile) || !is_string(profile.profileKey) || !is_string(profile.primaryHost)
		|| type(profile.testHosts) != 'array' || type(profile.hostlistDomains) != 'array'
		|| type(profile.expectedHostlists) != 'array' || !is_object(profile.tcp)
		|| !is_object(profile.udp) || !is_string(profile.probeUrl)) return false;
	let primary = lower(trim_ws(request.target));
	if (substr(primary, -1) == '.') primary = substr(primary, 0, length(primary) - 1);
	if (lower(profile.primaryHost) != primary || length(profile.testHosts) == 0
		|| length(profile.hostlistDomains) == 0 || profile.probeUrl == '') return false;
	for (let i = 0; i < length(profile.testHosts); i++) if (!valid_hostname(profile.testHosts[i])) return false;
	for (let i = 0; i < length(profile.hostlistDomains); i++) if (!valid_hostname(profile.hostlistDomains[i])) return false;
	for (let i = 0; i < length(profile.expectedHostlists); i++) if (!is_string(profile.expectedHostlists[i])) return false;
	let protocol = request.protocol == 'udp' ? profile.udp : profile.tcp;
	return is_object(protocol) && is_string(protocol.ports) && is_string(protocol.l7)
		&& is_string(protocol.payload)
		&& (request.protocol == 'udp' ? protocol.l7 == 'quic' : protocol.l7 == 'tls');
}

export const scanner_plan_build = function(request, catalogSnapshot, userStrategies) {
	let validated = request_normalize(request);
	if (!validated.ok) return validated;
	let value = validated.value, catalog = catalog_snapshot(catalogSnapshot);
	if (catalog == null) {
		let loaded = strategy_catalog_load(null);
		if (!is_object(loaded) || loaded.ok != true) return error_result('ENOENT', 'Scanner Strategy Catalog is unavailable.');
		catalog = loaded.catalog;
		catalog.serverOwned = true;
		catalog.authority = { marker: AUTHORITY_MARKER, repository: AUTHORITATIVE_CATALOG_REPOSITORY,
			commit: AUTHORITATIVE_CATALOG_COMMIT, catalogDigest: catalog.aggregateDigest,
			compilerDigest: compiler_digest(), catalogEnvelopeDigest: catalog_envelope_digest(catalog),
			catalog: { serverOwned: true, marker: 'z2m-scanner-catalog.v1',
				repository: AUTHORITATIVE_CATALOG_REPOSITORY, commit: AUTHORITATIVE_CATALOG_COMMIT,
				catalogDigest: catalog.aggregateDigest, catalogEnvelopeDigest: catalog_envelope_digest(catalog),
				source: catalog.source, winnerOrder: catalog.winnerOrder, sets: catalog.sets,
				winners: catalog.winners } };
		catalog.compilerDigest = compiler_digest();
	}
	if (!authority_valid(catalog)) return error_result('EVERIFY', 'Scanner Catalog/compiler authority is unavailable or stale.');
	let users = userStrategies;
	if (users == null) {
		let listed = strategy_user_list();
		if (!is_object(listed) || listed.ok != true) return error_result('EIO', 'Scanner user Strategies are unavailable.');
		users = { serverOwned: true, authority: { marker: AUTHORITY_MARKER,
			repository: AUTHORITATIVE_CATALOG_REPOSITORY, commit: AUTHORITATIVE_CATALOG_COMMIT,
			catalogDigest: catalog.aggregateDigest, compilerDigest: compiler_digest(),
			catalogEnvelopeDigest: catalog.authority.catalogEnvelopeDigest, catalog: catalog.authority.catalog }, strategies: listed.strategies };
	}
	if (!user_records_valid(users, catalog)) return error_result('EVERIFY', 'Scanner user Strategies must be server-owned records.');
	let profile = target_profile_valid(catalog.targetProfile) ? copy(catalog.targetProfile) : null;
	if (profile == null) try { profile = scanner_target_profile(value.target); } catch (e) { profile = null; }
	if (profile == null || !profile_matches_request(profile, value)) return error_result('EINPUT', 'Scanner target profile is absent or mismatched.', 'target');
	let environment = is_object(catalog.compilerEnvironment)
		? copy(catalog.compilerEnvironment) : {};
	let entries = selected_entries(catalog, value.protocol, value.mode), catalogCandidates = [], ordinal = 1;
	for (let i = 0; i < length(entries); i++) {
		let strategy = catalog_strategy(entries[i]);
		if (strategy == null) continue;
		let candidate = candidate_from_strategy(strategy, value.protocol, 'catalog',
			strategy.sourceFile || entries[i].sourceFile || 'catalog', ordinal++, environment, false, users, catalog, entries[i]);
		if (candidate != null && candidate.ok == false) return candidate;
		if (candidate != null) push(catalogCandidates, candidate);
	}
	catalogCandidates = dedup_candidates(sort_candidates(catalogCandidates));
	let generatedCandidates = [];
	if ((value.mode == 'standard' || value.mode == 'full') && is_object(catalog.policy)
		&& catalog.policy.useGenerated == true) {
		if (!generator_valid(catalog)) return error_result('EVERIFY', 'Scanner generator authority is unavailable or stale.');
		for (let i = 0; i < length(catalog.generator.candidates); i++) {
			let generated = catalog.generator.candidates[i];
			if (!is_object(generated) || (generated.protocol || value.protocol) != value.protocol
				|| !is_string(generated.id) || !is_object(generated.strategy)
				|| !records_shape_valid([generated.strategy], true))
				return error_result('EVERIFY', 'Scanner generator record is not authoritative.');
			let strategy = is_object(generated.strategy) ? generated.strategy : null;
			if (strategy == null) continue;
			let candidate = candidate_from_strategy(strategy, value.protocol, 'generator', 'generator', ordinal++,
				environment, true, users, catalog, generated);
			if (candidate != null && candidate.ok == false) return candidate;
			if (candidate != null) push(generatedCandidates, candidate);
		}
	}
	let candidates = [];
	for (let i = 0; i < length(catalogCandidates); i++) push(candidates, catalogCandidates[i]);
	for (let i = 0; i < length(generatedCandidates); i++) push(candidates, generatedCandidates[i]);
	candidates = dedup_candidates(candidates);
	let filtered = [];
	for (let i = 0; i < length(candidates); i++) if (dpi_keep(candidates[i], value.dpi_type)) push(filtered, candidates[i]);
	for (let i = 0; i < length(filtered); i++) filtered[i].ordinal = i + 1;
	return { ok: true, plan: {
		schema: 1, request: copy(value), targetProfile: copy(profile),
		catalogDigest: catalog.aggregateDigest || null,
		compilerDigest: catalog.compilerDigest || null,
		candidates: copy(filtered),
	} };
};
