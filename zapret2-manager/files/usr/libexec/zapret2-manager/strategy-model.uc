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
