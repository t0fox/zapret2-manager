'use strict';

export const EINPUT = 'EINPUT';
export const ESCHEMA = 'ESCHEMA';
export const ECONFLICT = 'ECONFLICT';
export const ELOCKED = 'ELOCKED';
export const EDEPENDENCY = 'EDEPENDENCY';
export const EOWNERSHIP = 'EOWNERSHIP';
export const EPREFLIGHT = 'EPREFLIGHT';
export const EAPPLY = 'EAPPLY';
export const EVERIFY = 'EVERIFY';
export const EROLLBACK = 'EROLLBACK';
export const ECANCELLED = 'ECANCELLED';
export const EINTERNAL = 'EINTERNAL';

const PUBLIC_CODES = {
	EINPUT,
	ESCHEMA,
	ECONFLICT,
	ELOCKED,
	EDEPENDENCY,
	EOWNERSHIP,
	EPREFLIGHT,
	EAPPLY,
	EVERIFY,
	EROLLBACK,
	ECANCELLED,
	EINTERNAL
};

const DEFAULT_MESSAGE = 'Native backend operation failed.';
const MAX_MESSAGE_BYTES = 512;
const MAX_DETAILS_BYTES = 4096;

function continuation_byte(value) {
	let byte = ord(value);
	return byte >= 128 && byte <= 191;
}

function bounded_string(value, limit, fallback) {
	if (type(value) != 'string' || !length(value)) return fallback;
	if (length(value) <= limit) return value;

	let end = limit;
	while (end > 0 && continuation_byte(substr(value, end, 1))) end--;
	return substr(value, 0, end);
}

function safe_details(value) {
	if (type(value) != 'object' || value == null) return null;

	try {
		let serialized = sprintf('%J', value);
		if (length(serialized) > MAX_DETAILS_BYTES) return null;
		return value;
	}
	catch (e) {
		return null;
	}
}

export const normalize_error = function(value) {
	let source = type(value) == 'object' && value != null ? value : {};
	let code = type(source.code) == 'string' && PUBLIC_CODES[source.code] != null
		? source.code
		: EINTERNAL;
	let error = {
		code,
		message: bounded_string(source.message, MAX_MESSAGE_BYTES, DEFAULT_MESSAGE),
		retryable: source.retryable === true
	};
	let details = safe_details(source.details);
	if (details != null) error.details = details;
	return error;
};

// Compatibility for native modules that still construct bare error values.
export const error_value = function(code, message, details, retryable) {
	return normalize_error({
		code,
		message,
		details,
		retryable
	});
};
