'use strict';
// Pure Avatar Strategy aggregate model.
//
// This boundary owns Strategy/Profile shape and Avatar's quote-aware token
// semantics. It deliberately has no filesystem, process, or runtime imports.

function error_result(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}

function is_object(value) {
	return type(value) == 'object' && value != null;
}

function is_whitespace(ch) {
	return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
}

function canonical_tokens(tokens) {
	let result = '';
	for (let i = 0; i < length(tokens); i++) {
		if (i > 0) result += ' ';
		result += tokens[i].value;
	}
	return result;
}

function isCircular(strategy) {
	if (!is_object(strategy)) return false;
	if (strategy.circular === true || strategy.isCircular === true) return true;
	let profiles = type(strategy.profiles) == 'array' ? strategy.profiles : [];
	for (let profile in profiles) {
		if (is_object(profile) && type(profile.args) == 'string'
			&& index(profile.args, '--lua-desync=circular') >= 0) return true;
	}
	let id = strategy.id == null ? '' : lc('' + strategy.id);
	let name = strategy.name == null ? '' : lc('' + strategy.name);
	let description = strategy.description == null ? '' : lc('' + strategy.description);
	return index(id, 'circular') >= 0 || index(id, 'autocircular') >= 0
		|| index(name, 'circular') >= 0 || index(name, 'autocircular') >= 0
		|| index(description, 'circular') >= 0 || index(description, 'autocircular') >= 0;
}

// Split only on Avatar's four separators outside matching quotes. Quotes are
// data, not shell syntax, so they remain in each token and unmatched quotes
// are retained in the final token.
export const avatar_tokenize = function(text) {
	if (type(text) != 'string')
		return error_result('EINPUT', 'Profile args must be a string', 'args');

	let tokens = [];
	let quote = null;
	let i = 0;
	let n = length(text);
	while (i < n) {
		while (i < n && is_whitespace(substr(text, i, 1))) i++;
		if (i >= n) break;

		let start = i;
		let value = '';
		while (i < n) {
			let ch = substr(text, i, 1);
			if (quote == null && is_whitespace(ch)) break;
			if (ch == chr(39) || ch == chr(34)) {
				if (quote == null) quote = ch;
				else if (quote == ch) quote = null;
			}
			value += ch;
			i++;
		}
		push(tokens, { value: value, start: start, end: i });
	}

	return { ok: true, tokens: tokens };
};

function validate_strategy(input, mode) {
	if (!is_object(input) || type(input.id) != 'string' || length(input.id) == 0)
		return error_result('EINPUT', 'Strategy id is required', 'id');
	if (type(input.name) != 'string' || length(input.name) == 0)
		return error_result('EINPUT', 'Strategy name is required', 'name');
	if (type(input.profiles) != 'array')
		return error_result('EINPUT', 'Strategy profiles must be an array', 'profiles');
	if (mode == 'create' && length(input.profiles) == 0)
		return error_result('EINPUT', 'Strategy create requires at least one Profile', 'profiles');

	for (let i = 0; i < length(input.profiles); i++) {
		let profile = input.profiles[i];
		let profilePath = 'profiles[' + i + ']';
		if (!is_object(profile))
			return error_result('EINPUT', 'Profile must be an object', profilePath);
		if (type(profile.id) != 'string' || length(profile.id) == 0)
			return error_result('EINPUT', 'Profile id is required', profilePath + '.id');
		if (profile.args == null || type(profile.args) != 'string')
			return error_result('EINPUT', 'Profile args are required', profilePath + '.args');
		if (profile.enabled != null && type(profile.enabled) != 'bool')
			return error_result('EINPUT', 'Profile enabled must be boolean', profilePath + '.enabled');
	}

	return { ok: true, diagnostics: [] };
}

export const strategy_validate = function(input, mode) {
	return validate_strategy(input, mode == null ? 'structural' : mode);
};

export const strategy_normalize = function(input, origin) {
	let valid = validate_strategy(input, 'structural');
	if (!valid.ok) return valid;

	let strategy = {};
	for (let key in input) strategy[key] = input[key];
	if (origin != null) strategy.origin = origin;
	let circularFlags = { circular: isCircular(input), isCircular: isCircular(input) };
	strategy.isCircular = circularFlags.isCircular;
	strategy.circular = circularFlags.circular;

	let profiles = [];
	let tokens = [];
	for (let i = 0; i < length(input.profiles); i++) {
		let inputProfile = input.profiles[i];
		let profile = {};
		for (let key in inputProfile) profile[key] = inputProfile[key];

		let tokenized = avatar_tokenize(inputProfile.args);
		let values = tokenized.tokens;
		for (let j = 0; j < length(values); j++) push(tokens, values[j].value);
		profile.args = canonical_tokens(values);
		profile.enabled = inputProfile.enabled == null ? true : inputProfile.enabled;
		push(profiles, profile);
	}
	strategy.profiles = profiles;

	return { ok: true, strategy: strategy, tokens: tokens, diagnostics: valid.diagnostics };
};

function copy_values(values) {
	let result = [];
	if (type(values) != 'array') return result;
	for (let i = 0; i < length(values); i++) push(result, values[i]);
	return result;
}

function catalog_field(entry, name, fallback) {
	let metadata = is_object(entry.metadata) ? entry.metadata : entry;
	return metadata[name] == null ? fallback : metadata[name];
}

function catalog_protocol(entry) {
	return entry.protocol == 'udp' ? 'udp' : 'tcp';
}

function starts_with(value, prefix) {
	return type(value) == 'string' && length(value) >= length(prefix)
		&& substr(value, 0, length(prefix)) == prefix;
}

function upper_ascii(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 97 && code <= 122 ? chr(code - 32) : substr(value, i, 1);
	}
	return result;
}

function canonical_values(values) {
	let result = '';
	for (let i = 0; i < length(values); i++) {
		if (i > 0) result += ' ';
		result += values[i];
	}
	return result;
}

function profile_identity(tokens, index) {
	for (let i = 0; i < length(tokens); i++) {
		let value = tokens[i];
		if (starts_with(value, '--filter-tcp=')) {
			let ports = substr(value, length('--filter-tcp='));
			if (ports == '80') return { id: 'http' + (index + 1), name: 'HTTP (порт 80)' };
			return { id: 'tcp' + (index + 1), name: 'TCP (порты ' + ports + ')' };
		}
		if (starts_with(value, '--filter-udp=')) {
			let ports = substr(value, length('--filter-udp='));
			return { id: 'udp' + (index + 1), name: 'UDP (порты ' + ports + ')' };
		}
		if (starts_with(value, '--filter-l3=')) {
			let version = substr(value, length('--filter-l3='));
			return { id: version + '_' + (index + 1), name: upper_ascii(version) };
		}
	}
	return { id: 'profile' + (index + 1), name: 'Profile ' + (index + 1) };
}

function copy_catalog_provenance(strategy, entry) {
	if (entry.canonicalId != null) strategy.canonicalId = entry.canonicalId;
	if (entry.sourceId != null) strategy.sourceId = entry.sourceId;
	if (entry.sourceSnapshotId != null) strategy.sourceSnapshotId = entry.sourceSnapshotId;
	if (entry.sourceCommit != null) strategy.sourceCommit = entry.sourceCommit;
	if (entry.contentDigest != null) strategy.contentDigest = entry.contentDigest;
	if (entry.provenance != null) strategy.provenance = entry.provenance;
	if (entry.sourceFile != null) strategy.sourceFile = entry.sourceFile;
	if (entry.sourceOrdinal != null) strategy.sourceOrdinal = entry.sourceOrdinal;
	if (entry.cacheKey != null) strategy.cacheKey = entry.cacheKey;
	if (entry.cacheOrdinal != null) strategy.cacheOrdinal = entry.cacheOrdinal;
	if (entry.duplicateGroup != null) strategy.duplicateGroup = entry.duplicateGroup;
	if (entry.winner != null) strategy.winner = entry.winner;
	if (entry.effectiveOrdinal != null) strategy.effectiveOrdinal = entry.effectiveOrdinal;
	if (entry.rawArgs != null) strategy.rawArgs = entry.rawArgs;
	if (entry.dependencyClosure != null) strategy.dependencyClosure = entry.dependencyClosure;
	if (entry.runtimeBundleDigest != null) strategy.runtimeBundleDigest = entry.runtimeBundleDigest;
}

// Convert one physical CatalogEntry without applying compiler transforms. The
// catalog parser owns WinDivert line filtering; this boundary only tokenizes
// the already parsed args and preserves all other tokens as Profile data.
export const catalog_entry_to_strategy = function(entry) {
	if (!is_object(entry)) return null;
	let strategyId = entry.id != null ? entry.id : entry.sectionId;
	if (type(strategyId) != 'string' || length(strategyId) == 0) return null;

	let args = entry.args == null ? '' : entry.args;
	let tokenized = avatar_tokenize(args);
	if (!tokenized.ok || length(tokenized.tokens) == 0) return null;

	let sections = [], current = [];
	for (let i = 0; i < length(tokenized.tokens); i++) {
		let value = tokenized.tokens[i].value;
		if (value == '--new') {
			if (length(current) > 0) push(sections, current);
			current = [];
		} else push(current, value);
	}
	if (length(current) > 0) push(sections, current);
	if (length(sections) == 0) return null;

	let profiles = [];
	for (let i = 0; i < length(sections); i++) {
		let identity = profile_identity(sections[i], i);
		push(profiles, {
			id: identity.id,
			name: identity.name,
			enabled: true,
			args: canonical_values(sections[i])
		});
	}
	let strategyName = catalog_field(entry, 'name', strategyId);
	if (type(strategyName) != 'string' || length(strategyName) == 0) strategyName = strategyId;

	let strategy = {
		id: strategyId,
		name: strategyName,
		description: catalog_field(entry, 'description', ''),
		type: length(profiles) > 1 ? 'combined' : 'single',
		version: 1,
		is_builtin: entry.is_builtin === false ? false : true,
		source: 'catalog',
		level: entry.level == null ? '' : entry.level,
		label: catalog_field(entry, 'label', ''),
		author: catalog_field(entry, 'author', ''),
		protocol: catalog_protocol(entry),
		featured: catalog_field(entry, 'featured', false),
		blobs: copy_values(catalog_field(entry, 'blobs', [])),
		profiles: profiles
	};
	let recommended = catalog_field(entry, 'recommended', null);
	let pinned = catalog_field(entry, 'pinned', null);
	if (recommended != null) strategy.recommended = recommended;
	if (pinned != null) strategy.pinned = pinned;
	copy_catalog_provenance(strategy, entry);

	let normalized = strategy_normalize(strategy);
	return normalized.ok ? normalized.strategy : null;
};

export const strategy_enabled_profiles = function(strategy) {
	let result = [];
	if (!is_object(strategy) || type(strategy.profiles) != 'array') return result;
	for (let i = 0; i < length(strategy.profiles); i++) {
		let profile = strategy.profiles[i];
		if (is_object(profile) && (profile.enabled == null || profile.enabled == true))
			push(result, profile);
	}
	return result;
};

export const strategy_profile_count = function(strategy) {
	return length(strategy_enabled_profiles(strategy));
};
