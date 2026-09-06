'use strict';

export const z2k_release_parse = function(value) {
	if (type(value) != 'string') return null;
	let m = match(value, /^([rp])-([0-9]+)(\.[0-9]+)?$/);
	if (!m) return null;
	return { version: value, family: m[1], major: +m[2], minor: m[3] == null ? 0 : +substr(m[3], 1) };
};

export const z2k_release_valid = function(value) { return z2k_release_parse(value) != null; };

export const z2k_release_same = function(a, b) { return a == b && z2k_release_valid(a); };
