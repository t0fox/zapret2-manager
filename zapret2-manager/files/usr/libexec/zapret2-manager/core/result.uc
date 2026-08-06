'use strict';

import { error_value, normalize_error as normalize_error_value } from './errors.uc';

const SCHEMA_VERSION = 1;

function generation_from(meta) {
	return type(meta) == 'object' && meta != null &&
		type(meta.generation) == 'int' && meta.generation >= 0
		? meta.generation
		: 0;
}

export const ok = function(data, meta) {
	return {
		ok: true,
		schemaVersion: SCHEMA_VERSION,
		generation: generation_from(meta),
		data: type(data) == 'object' && data != null ? data : {}
	};
};

export const fail = function(code, message, details, retryable) {
	return {
		ok: false,
		schemaVersion: SCHEMA_VERSION,
		generation: 0,
		error: error_value(code, message, details, retryable)
	};
};

export const normalize_error = function(value) {
	return normalize_error_value(value);
};

export const result_ok = function(generation, data) {
	if (type(generation) != 'int' || generation < 0)
		return result_error(0, 'EINTERNAL', 'Invalid result generation.');
	return ok(data, { generation });
};

export const result_error = function(generation, code, message, details, retryable) {
	let result = fail(code, message, details, retryable);
	result.generation = type(generation) == 'int' && generation >= 0 ? generation : 0;
	return result;
};
