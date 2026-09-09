'use strict';

// Manager-owned identity for the upstream-compatible five-column state.tsv.
// The TSV remains unchanged; this sidecar binds learned rows to the semantic
// pool that produced them.
import { readfile, writefile, stat, unlink, popen } from 'fs';

const IDENTITY_PATH = '/etc/zapret2-manager/state/autocircular/pool-identity.json';
let temp_sequence = 0;

function object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function shell_quote(value) {
	let out = "'", input = text(value);
	for (let i = 0; i < length(input); i++) out += substr(input, i, 1) == "'" ? "'\\''" : substr(input, i, 1);
	return out + "'";
}
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }
function fail(code, message, extra) { return { ok: false, error: { code: code, message: message, ...(extra || {}) } }; }

// Pool parsing currently exposes exactly these fields as the semantic pool
// contract.  Deliberately do not hash aliases, display metadata, timestamps,
// or object-key order; strategy array order is semantic because index selects
// the arm persisted in state.tsv.
function semantic_pool(pool) {
	if (!object(pool) || !string(pool.key) || !string(pool.runtimeKey) || !string(pool.protocol)
		|| type(pool.size) != 'int' || !array(pool.strategies)) return null;
	return { key: pool.key, runtimeKey: pool.runtimeKey, protocol: pool.protocol, size: pool.size, strategies: pool.strategies };
}
function canonical(value) {
	if (value == null || string(value) || type(value) == 'int' || type(value) == 'double' || type(value) == 'bool') return sprintf('%J', value);
	if (array(value)) {
		let parts = [];
		for (let item in value) push(parts, canonical(item));
		return '[' + join(',', parts) + ']';
	}
	if (object(value)) {
		let names = keys(value); sort(names);
		let parts = [];
		for (let name in names) push(parts, sprintf('%J', name) + ':' + canonical(value[name]));
		return '{' + join(',', parts) + '}';
	}
	return sprintf('%J', text(value));
}
function sha256_text(value) {
	let temporary = '/tmp/z2m-autocircular-identity.' + time() + '.' + (++temp_sequence);
	try { writefile(temporary, value); } catch (e) { return null; }
	let process = popen('sha256sum ' + shell_quote(temporary) + ' 2>/dev/null | awk \'{print $1}\'', 'r');
	let digest = process ? trim(process.read('all') || '') : '';
	if (process) process.close();
	try { unlink(temporary); } catch (e) { }
	return match(digest, /^[a-f0-9]{64}$/) ? digest : null;
}

export const z2k_pool_semantic_digest = function(pool) {
	let semantic = semantic_pool(pool);
	if (semantic == null) return null;
	return sha256_text('z2k-autocircular-pool-v1\n' + canonical(semantic) + '\n');
};

function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function identity_map(value) {
	if (value == null) return null;
	let source = value;
	if (object(value) && value.schema == 1 && object(value.pools)) source = value.pools;
	if (!object(source)) return null;
	let result = {};
	for (let key in keys(source)) {
		if (!string(key) || !digest(source[key])) return null;
		result[key] = source[key];
	}
	return result;
}
function unique_push(values, value) { if (index(values, value) < 0) push(values, value); }

export const z2k_learned_state_reconcile = function(oldIdentity, newIdentity, rows) {
	if (!array(rows)) return fail('EINPUT', 'autocircular rows must be an array');
	let next = identity_map(newIdentity);
	if (next == null) return fail('ESTATE', 'autocircular pool identity is malformed; refusing to reset learned state');
	let previous = identity_map(oldIdentity);
	if (oldIdentity != null && previous == null) return fail('ESTATE', 'stored autocircular pool identity is malformed; refusing to reset learned state');
	let reset = [], resetAllLegacy = previous == null;
	if (resetAllLegacy) {
		for (let row in rows) if (object(row) && string(row.key)) unique_push(reset, row.key);
		return { ok: true, reset: reset, resetAllLegacy: true, rows: [] };
	}
	let kept = [];
	for (let row in rows) {
		if (!object(row) || !string(row.key)) continue;
		let wasBound = previous[row.key] != null || next[row.key] != null;
		if (wasBound && previous[row.key] != next[row.key]) unique_push(reset, row.key);
		else push(kept, copy(row));
	}
	return { ok: true, reset: reset, resetAllLegacy: false, rows: kept };
};

function ensure_parent() {
	let directory = '/etc/zapret2-manager/state/autocircular';
	let process = popen('mkdir -p ' + shell_quote(directory) + ' 2>/dev/null', 'r');
	if (!process) return false;
	process.read('all');
	return process.close() == 0;
}
function valid_map(value) { return identity_map(value) != null; }

export const z2k_autocircular_identity_load = function() {
	let raw = null;
	try { raw = readfile(IDENTITY_PATH); } catch (e) { return { ok: true, identity: null, legacy: true, present: false, path: IDENTITY_PATH }; }
	if (raw == null || !string(raw) || !length(trim(raw))) return { ok: true, identity: null, legacy: true, present: false, path: IDENTITY_PATH };
	let value = null;
	try { value = json(raw); } catch (e) { return { ...fail('ESTATE', 'autocircular pool identity sidecar is malformed'), path: IDENTITY_PATH }; }
	if (!object(value) || value.schema != 1 || !valid_map(value.pools)) return { ...fail('ESTATE', 'autocircular pool identity sidecar has an unsupported schema'), path: IDENTITY_PATH };
	return { ok: true, identity: value.pools, legacy: false, present: true, path: IDENTITY_PATH };
};

export const z2k_autocircular_identity_save = function(identity) {
	let pools = identity_map(identity);
	if (pools == null) return fail('EINPUT', 'autocircular pool identity is invalid');
	if (!ensure_parent()) return fail('EWRITE', 'autocircular identity directory could not be created');
	let temporary = IDENTITY_PATH + '.tmp.' + time() + '.' + (++temp_sequence);
	try { writefile(temporary, sprintf('%J', { schema: 1, pools: pools }) + '\n'); } catch (e) { return fail('EWRITE', 'autocircular pool identity sidecar could not be staged'); }
	let process = popen('mv -f ' + shell_quote(temporary) + ' ' + shell_quote(IDENTITY_PATH) + ' 2>/dev/null', 'r');
	if (!process) { try { unlink(temporary); } catch (e) { } return fail('EWRITE', 'autocircular pool identity sidecar could not be committed'); }
	process.read('all');
	if (process.close() != 0) { try { unlink(temporary); } catch (e) { } return fail('EWRITE', 'autocircular pool identity sidecar could not be committed'); }
	return { ok: true, schema: 1, pools: pools, path: IDENTITY_PATH };
};

export const z2k_autocircular_identity_restore = function(snapshot) {
	if (!object(snapshot) || snapshot.present !== true && snapshot.present !== false) return fail('EINPUT', 'autocircular identity restore evidence is incomplete');
	if (snapshot.present === true) return z2k_autocircular_identity_save(snapshot.identity);
	try { unlink(IDENTITY_PATH); } catch (e) { }
	return stat(IDENTITY_PATH) == null ? { ok: true, removed: true, path: IDENTITY_PATH } : fail('ERECOVERY_REQUIRED', 'autocircular identity sidecar could not be removed during rollback');
};
