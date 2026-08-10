'use strict';

// Avatar Strategy-owned persistence. The legacy Profile document is not read
// here: this module owns only /etc/zapret2-manager/strategies and selection
// state for those Strategies.

import { readfile, writefile, stat, readlink, unlink, mkdir, lsdir, popen } from 'fs';
import { strategy_validate as model_validate, strategy_normalize } from './strategy-model.uc';
import { strategy_catalog_load } from './strategy-catalog.uc';

const STORAGE_ROOT = getenv('Z2M_STRATEGY_ROOT') || '/etc/zapret2-manager';
const STRATEGY_DIR = getenv('Z2M_STRATEGY_DIR') || '/etc/zapret2-manager/strategies';
const STATE_PATH = getenv('Z2M_STRATEGY_STATE') || '/etc/zapret2-manager/strategy-state.json';
const RECONCILE_PATH = getenv('Z2M_STRATEGY_RECONCILIATION') || '/tmp/zapret2-manager/strategy-reconciliation.json';
const LOCK_PATH = getenv('Z2M_STRATEGY_LOCK') || '/tmp/zapret2-manager/strategy-state.lock';
const CATALOG_ROOT = getenv('Z2M_STRATEGY_CATALOG_ROOT') || '/usr/share/zapret2-manager/catalog/avatar';
const EXTENSION_MANIFEST_PATH = getenv('Z2M_STRATEGY_EXTENSION_MANIFEST') || '/usr/share/zapret2-manager/strategies/extensions.json';
const MAX_BYTES = 521028;
const MAX_ID = 128;
const MAX_NAME = 256;
const MAX_PROFILES = 256;
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_TEXT = 4096;
const LOCK_STALE_SECONDS = 300;
const PRIVATE_DIR_MODE = 448; // 0700
const PRIVATE_FILE_MODE = 384; // 0600

function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (extra != null) for (let key in extra) result.error[key] = extra[key];
	return result;
}

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function bounded_string(value, maximum) { return is_string(value) && length(value) > 0 && length(value) <= maximum; }
function sha256(value) { return is_string(value) && match(value, /^[a-f0-9]{64}$/); }

function safe_id(value) {
	if (!is_string(value) || length(value) < 1 || length(value) > MAX_ID ||
		!match(value, /^[A-Za-z0-9][A-Za-z0-9._-]*$/) || value == '.' || value == '..') return false;
	return substr(value, -5) != '.json';
}

function builtin_id(id) {
	return is_string(id) && (match(id, /^z2k_/) && substr(id, -5) != '_copy' || match(id, /^builtin([._-]|$)/));
}

let catalog_ids = {};
let catalog_loaded = false;
let catalog_available = false;
let extension_ids = {};
let extensions_loaded = false;
let extensions_available = false;

function load_catalog_ids() {
	if (catalog_loaded) return catalog_available;
	catalog_loaded = true;
	let loaded = null;
	try { loaded = strategy_catalog_load(CATALOG_ROOT); } catch (e) { loaded = null; }
	if (!is_object(loaded) || loaded.ok != true || !is_object(loaded.catalog) ||
		!is_object(loaded.catalog.winners)) return false;
	for (let id in loaded.catalog.winners) catalog_ids[id] = true;
	catalog_available = true;
	return true;
}

function load_extension_ids() {
	if (extensions_loaded) return extensions_available;
	extensions_loaded = true;
	let metadata = null, raw = null, manifest = null;
	try { metadata = stat(EXTENSION_MANIFEST_PATH); } catch (e) { metadata = null; }
	if (metadata == null || metadata.type != 'file' || readlink(EXTENSION_MANIFEST_PATH) != null ||
		type(metadata.size) != 'int' || metadata.size > MAX_BYTES || metadata.mode % 512 != 420) return false;
	try { raw = readfile(EXTENSION_MANIFEST_PATH); manifest = json(raw); } catch (e) { return false; }
	if (!is_object(manifest) || manifest.schema !== 1 || type(manifest.extensions) != 'array' ||
		!load_catalog_ids()) return false;
	let seen = {};
	for (let id in manifest.extensions) {
		if (!bounded_string(id, MAX_ID) || seen[id] || catalog_ids[id]) return false;
		seen[id] = true;
		extension_ids[id] = true;
	}
	extensions_available = true;
	return true;
}

function catalog_id(id) { return load_catalog_ids() && catalog_ids[id] == true; }
function extension_id(id) { return load_extension_ids() && extension_ids[id] == true; }
function protected_id(id) { return catalog_id(id) || extension_id(id); }

function exact_fields(value, fields) {
	if (!is_object(value) || length(value) != length(fields)) return false;
	for (let field in fields) if (!exists(value, field)) return false;
	return true;
}

function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}

function path_for(id) { return safe_id(id) ? STRATEGY_DIR + '/' + id + '.json' : null; }

function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}

function command(value) {
	let process = null;
	try { process = popen(value, 'r'); } catch (e) { return { ok: false, output: '', rc: -1 }; }
	if (!process) return { ok: false, output: '', rc: -1 };
	let output = process.read('all') || '', rc = process.close();
	return { ok: rc == 0, output: output, rc: rc };
}

function ensure_directory(path, mode) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata != null) {
		if (readlink(path) != null || metadata.type != 'directory') return false;
		return metadata.mode % 512 == mode;
	}
	let made = command('umask 077; mkdir ' + shell_quote(path) + ' 2>/dev/null');
	if (!made.ok) return false;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	return metadata != null && readlink(path) == null && metadata.type == 'directory' && metadata.mode % 512 == mode;
}

function ensure_storage() {
	let metadata = null;
	try { metadata = stat(STORAGE_ROOT); } catch (e) { metadata = null; }
	if (metadata == null || metadata.type != 'directory' || readlink(STORAGE_ROOT) != null) return false;
	return ensure_directory(STRATEGY_DIR, PRIVATE_DIR_MODE);
}

function process_start_marker(pid) {
	if (!is_string(pid) || !match(pid, /^[0-9]{1,16}$/)) return null;
	let raw = null;
	try { raw = readfile('/proc/' + pid + '/stat'); } catch (e) { return null; }
	let fields = split(trim(raw || ''), /[ \t]+/);
	return length(fields) > 21 && match(fields[21], /^[0-9]+$/) ? fields[21] : null;
}

function owner_identity() {
	let pid = null;
	try { pid = readlink('/proc/self'); } catch (e) { pid = null; }
	let marker = process_start_marker(pid);
	return marker == null ? null : pid + ':' + marker;
}

function lock_owner_alive() {
	let ownerPath = LOCK_PATH + '/owner', metadata = null;
	try { metadata = stat(ownerPath); } catch (e) { metadata = null; }
	if (metadata == null || metadata.type != 'file' || readlink(ownerPath) != null ||
		type(metadata.size) != 'int' || metadata.size < 3 || metadata.size > 64 ||
		metadata.mode % 512 != PRIVATE_FILE_MODE) return false;
	let raw = null;
	try { raw = readfile(ownerPath); } catch (e) { return false; }
	let fields = split(trim(raw || ''), ':');
	return length(fields) == 2 && process_start_marker(fields[0]) == fields[1];
}

function lock_is_old(metadata) {
	return metadata != null && type(metadata.mtime) == 'int' && time() >= metadata.mtime &&
		time() - metadata.mtime > LOCK_STALE_SECONDS;
}

function create_lock() {
	let identity = owner_identity();
	if (identity == null) return false;
	let ownerPath = LOCK_PATH + '/owner';
	try { writefile(ownerPath, identity); } catch (e) {
		command('rmdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null');
		return false;
	}
	if (!command('chmod 0600 ' + shell_quote(ownerPath) + ' 2>/dev/null').ok) {
		try { unlink(ownerPath); } catch (ignored) { }
		command('rmdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null');
		return false;
	}
	return true;
}

function acquire_lock() {
	let parent = substr(LOCK_PATH, 0, rindex(LOCK_PATH, '/'));
	if (!ensure_directory(parent, PRIVATE_DIR_MODE)) return false;
	let created = command('umask 077; mkdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null');
	if (created.ok) return create_lock();
	let metadata = null;
	try { metadata = stat(LOCK_PATH); } catch (e) { metadata = null; }
	if (metadata == null || metadata.type != 'directory' || lock_owner_alive() || !lock_is_old(metadata)) return false;
	try { unlink(LOCK_PATH + '/owner'); } catch (e) { }
	if (!command('rmdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null').ok) return false;
	if (!command('umask 077; mkdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null').ok) return false;
	return create_lock();
}

function release_lock() {
	try { unlink(LOCK_PATH + '/owner'); } catch (e) { }
	command('rmdir ' + shell_quote(LOCK_PATH) + ' 2>/dev/null');
}

// Production CLI callers may hold the package-standard flock -x boundary;
// direct module callers use an atomic private mkdir lock.
function locked(operation) {
	if (getenv('Z2M_STRATEGY_LOCKED') == '1') return operation();
	if (!acquire_lock()) return error('ELOCKED', 'Strategy storage is locked.');
	let result;
	try { result = operation(); } catch (e) { result = error('EINTERNAL', 'Strategy storage operation failed.'); }
	release_lock();
	return result;
}

function regular_metadata(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return null; }
	if (metadata == null || metadata.type != 'file' || readlink(path) != null ||
		type(metadata.size) != 'int' || metadata.size > MAX_BYTES || metadata.mode % 512 != PRIVATE_FILE_MODE) return null;
	return metadata;
}

function hash_text(value) {
	let temporary = command('umask 077; mktemp /tmp/z2m-strategy-hash.XXXXXX 2>/dev/null');
	let path = trim(temporary.output);
	if (!temporary.ok || index(path, '/tmp/z2m-strategy-hash.') != 0) return null;
	try { writefile(path, value); } catch (e) { try { unlink(path); } catch (ignored) { } return null; }
	let result = command('sha256sum ' + shell_quote(path) + " 2>/dev/null | awk '{print $1}'");
	try { unlink(path); } catch (e) { }
	let digest = trim(result.output);
	return sha256(digest) ? digest : null;
}

function read_document(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata == null) return { ok: false, missing: true };
	if (readlink(path) != null || metadata.type != 'file' || type(metadata.size) != 'int' ||
		metadata.size > MAX_BYTES || metadata.mode % 512 != PRIVATE_FILE_MODE)
		return error('EINPUT', 'Strategy storage is not a bounded private regular file.');
	let raw = readfile(path);
	if (raw == null || length(raw) != metadata.size) return error('EIO', 'Strategy storage could not be read.');
	if (raw == '') return { ok: true, empty: true, raw: raw, value: null, hash: null };
	let value = null;
	try { value = json(raw); } catch (e) { return error('EINPUT', 'Strategy storage is not valid JSON.'); }
	return { ok: true, raw: raw, value: value, hash: hash_text(raw) };
}

function hash_file(path) {
	let result = command('sha256sum ' + shell_quote(path) + " 2>/dev/null | awk '{print $1}'");
	let digest = trim(result.output);
	return sha256(digest) ? digest : null;
}

function temporary_path(target) {
	let slash = rindex(target, '/'), directory = substr(target, 0, slash);
	let result = command('umask 077; mktemp ' + shell_quote(directory + '/.strategy-state.XXXXXX') + ' 2>/dev/null');
	let path = trim(result.output);
	return result.ok && index(path, directory + '/.strategy-state.') == 0 ? path : null;
}

function atomic_write(path, value, allow_create) {
	let link = null, existing = null;
	try { link = readlink(path); } catch (e) { link = null; }
	try { existing = stat(path); } catch (e) { existing = null; }
	if (link != null || (existing != null && existing.type != 'file'))
		return error('EINPUT', 'Strategy state destination must not be a symlink or non-file.');
	let raw = sprintf('%J', value);
	if (length(raw) > MAX_BYTES) return error('EINPUT', 'Strategy state exceeds the bounded size.');
	let temporary = temporary_path(path);
	if (temporary == null) return error('EIO', 'Could not create same-directory temporary state.');
	try { writefile(temporary, raw); } catch (e) { try { unlink(temporary); } catch (ignored) { } return error('EIO', 'Could not write temporary state.'); }
	if (!command('chmod 0600 ' + shell_quote(temporary)).ok) { try { unlink(temporary); } catch (ignored) { } return error('EIO', 'Could not secure temporary state.'); }
	let move = command('mv -f ' + shell_quote(temporary) + ' ' + shell_quote(path) + ' 2>/dev/null');
	if (!move.ok) { try { unlink(temporary); } catch (ignored) { } return error('EIO', 'Could not atomically publish state.'); }
	return { ok: true, hash: hash_text(raw), created: allow_create == true };
}

function profile_valid(profile) {
	return is_object(profile) && bounded_string(profile.id, MAX_ID) && is_string(profile.args) &&
		(profile.enabled == null || type(profile.enabled) == 'bool');
}

function metadata_value_valid(value) {
	if (is_string(value)) return length(value) <= MAX_METADATA_TEXT;
	if (type(value) == 'bool') return true;
	if (type(value) != 'array' || length(value) > MAX_PROFILES) return false;
	for (let item in value) if (!is_string(item) || length(item) > MAX_METADATA_TEXT) return false;
	return true;
}

function metadata_valid(value) {
	if (!is_object(value) || length(value) > MAX_METADATA_KEYS) return false;
	for (let key in value) if (!bounded_string(key, MAX_ID) || !metadata_value_valid(value[key])) return false;
	return true;
}

function user_input_valid(strategy, require_profiles) {
	if (!is_object(strategy) || !safe_id(strategy.id) || !bounded_string(strategy.name, MAX_NAME) ||
		type(strategy.profiles) != 'array' || length(strategy.profiles) > MAX_PROFILES ||
		(require_profiles && length(strategy.profiles) == 0)) return false;
	if (!load_catalog_ids()) return false;
	let metadata = exists(strategy, 'metadata') ? strategy.metadata : {};
	if (!metadata_valid(metadata)) return false;
	if (strategy.is_builtin == true || builtin_id(strategy.id) || strategy.origin == 'avatar_builtin' || strategy.origin == 'catalog') return false;
	if (catalog_id(strategy.id) || strategy.is_extension == true || extension_id(strategy.id) || strategy.origin == 'extension') return false;
	for (let profile in strategy.profiles) if (!profile_valid(profile)) return false;
	return model_validate(strategy, 'structural').ok;
}

function record_valid(value) {
	if (!exact_fields(value, ['schema', 'id', 'revision', 'name', 'origin', 'is_builtin', 'metadata', 'profiles', 'updatedAt']) ||
		value.schema !== 1 || !safe_id(value.id) || !integer(value.revision) || value.revision < 1 ||
		!bounded_string(value.name, MAX_NAME) || value.origin != 'user' || value.is_builtin != false || !metadata_valid(value.metadata) ||
		type(value.profiles) != 'array' || length(value.profiles) > MAX_PROFILES || !integer(value.updatedAt)) return false;
	for (let profile in value.profiles) if (!profile_valid(profile)) return false;
	return true;
}

function state_default() { return { schema: 1, revision: 0, favorites: [], selected: null }; }

function identity_verified(id, origin) {
	if (origin == 'user') {
		let result = read_document(path_for(id));
		return result.ok && record_valid(result.value) && result.value.id == id;
	}
	if (origin == 'avatar_builtin') return catalog_id(id);
	if (origin == 'extension') return extension_id(id);
	return false;
}

function selected_valid(value) {
	return value == null || (exact_fields(value, ['id', 'origin', 'revision', 'candidateSha256']) &&
		safe_id(value.id) && (value.origin == 'user' || value.origin == 'avatar_builtin' || value.origin == 'extension') &&
		integer(value.revision) && sha256(value.candidateSha256) && identity_verified(value.id, value.origin));
}

function state_valid(value) {
	if (!exact_fields(value, ['schema', 'revision', 'favorites', 'selected']) || value.schema !== 1 ||
		!integer(value.revision) || type(value.favorites) != 'array' || !selected_valid(value.selected)) return false;
	let seen = {};
	for (let id in value.favorites) if (!safe_id(id) || seen[id]) return false; else seen[id] = true;
	return true;
}

function read_state() {
	let result = read_document(STATE_PATH);
	if (result.missing) return { ok: true, state: state_default(), raw: null, hash: null, absent: true };
	if (!result.ok) return result;
	if (result.empty) return { ok: true, state: state_default(), raw: '', hash: null, absent: true };
	if (!state_valid(result.value)) return error('EINPUT', 'Strategy state schema is invalid.');
	return { ok: true, state: result.value, raw: result.raw, hash: result.hash, absent: false };
}

function write_state(current, next, expected) {
	if (!current.ok || current.state.revision != expected) return error('ECONFLICT', 'Strategy state revision is stale.');
	let latest = read_state();
	if (!latest.ok || latest.state.revision != current.state.revision || latest.hash != current.hash)
		return error('ECONFLICT', 'Strategy state changed during mutation.');
	let result = atomic_write(STATE_PATH, next, current.absent);
	if (result.ok) { result.state = next; result.revision = next.revision; }
	return result;
}

function state_mutate(expected, transform) {
	let current = read_state();
	if (!current.ok) return current;
	if (current.state.revision != expected) return error('ECONFLICT', 'Strategy state revision is stale.');
	let next = copy(current.state);
	try { next = transform(next); } catch (e) { return error('EINPUT', 'Strategy state mutation is invalid.'); }
	if (!state_valid(next)) return error('EINPUT', 'Strategy state mutation is invalid.');
	next.revision = current.state.revision + 1;
	return write_state(current, next, expected);
}

function read_user(id) {
	if (!safe_id(id)) return error('EINPUT', 'Strategy id is unsafe.');
	let path = path_for(id), result = read_document(path);
	if (result.missing) return error('ENOENT', 'User Strategy was not found.');
	if (!result.ok) return result;
	if (!record_valid(result.value) || result.value.id != id) return error('EINPUT', 'User Strategy schema is invalid.');
	return { ok: true, strategy: result.value, hash: result.hash, raw: result.raw };
}

function build_user(strategy, revision) {
	let normalized = strategy_normalize(strategy, 'user');
	if (!normalized.ok) return null;
	return {
		schema: 1, id: normalized.strategy.id, revision: revision,
		name: normalized.strategy.name, origin: 'user', is_builtin: false,
		metadata: copy(normalized.strategy.metadata || {}),
		profiles: copy(normalized.strategy.profiles), updatedAt: time()
	};
}

function ensure_create_directory() {
	return ensure_storage();
}

export const strategy_user_get = function(input) {
	let id = is_object(input) ? input.id : input;
	let result = read_user(id);
	if (!result.ok) return result;
	return { ok: true, strategy: result.strategy };
};

export const strategy_user_list = function() {
	if (!ensure_create_directory()) return error('EIO', 'User Strategy directory is unavailable.');
	let names = [];
	try { names = lsdir(STRATEGY_DIR) || []; } catch (e) { return error('EIO', 'User Strategy directory could not be read.'); }
	let result = [];
	for (let name in names) {
		if (!is_string(name) || length(name) < 6 || substr(name, -5) != '.json') continue;
		let id = substr(name, 0, length(name) - 5), user = read_user(id);
		if (!user.ok) return user;
		push(result, user.strategy);
	}
	for (let i = 1; i < length(result); i++) {
		let item = result[i], j = i - 1;
		while (j >= 0 && result[j].id > item.id) { result[j + 1] = result[j]; j--; }
		result[j + 1] = item;
	}
	return { ok: true, strategies: result };
};

export const strategy_user_create = function(input) {
	return locked(function() {
		let strategy = is_object(input) ? input.strategy : null;
		if (!user_input_valid(strategy, true)) {
			if (strategy != null && (strategy.is_builtin == true || builtin_id(strategy.id) || catalog_id(strategy.id) || strategy.origin == 'avatar_builtin' || strategy.origin == 'catalog' ||
				strategy.is_extension == true || extension_id(strategy.id) || strategy.origin == 'extension'))
				return error('ECONFLICT', 'Builtin Strategies are immutable.');
			return error('EINPUT', 'User Strategy input is invalid.');
		}
		if (!ensure_create_directory()) return error('EIO', 'User Strategy directory is unavailable.');
		let path = path_for(strategy.id);
		if (regular_metadata(path) != null || stat(path) != null) return error('ECONFLICT', 'User Strategy id already exists.');
		let record = build_user(strategy, 1);
		if (record == null || !record_valid(record)) return error('EINPUT', 'User Strategy normalization failed.');
		let write = atomic_write(path, record, true);
		return write.ok ? { ok: true, strategy: record } : write;
	});
};

export const strategy_user_update = function(input) {
	return locked(function() {
		if (!is_object(input) || !safe_id(input.id) || !integer(input.expectedRevision)) return error('EINPUT', 'Strategy update requires id and expectedRevision.');
		if (protected_id(input.id)) return error('EIMMUTABLE', 'Builtin or extension Strategies are immutable.');
		let current = read_user(input.id);
		if (!current.ok) return current;
		if (current.strategy.revision != input.expectedRevision) return error('ECONFLICT', 'Strategy revision is stale.');
		let latest = read_user(input.id);
		if (!latest.ok || latest.hash != current.hash) return error('ECONFLICT', 'Strategy changed during update.');
		if (!user_input_valid(input.strategy, false) || input.strategy.id != input.id) return error('EINPUT', 'User Strategy update is invalid.');
		let record = build_user(input.strategy, current.strategy.revision + 1);
		let write = atomic_write(path_for(input.id), record, false);
		return write.ok ? { ok: true, strategy: record } : write;
	});
};

export const strategy_user_delete = function(input) {
	return locked(function() {
		if (!is_object(input) || !safe_id(input.id) || !integer(input.expectedRevision)) return error('EINPUT', 'Strategy delete requires id and expectedRevision.');
		if (protected_id(input.id)) return error('EIMMUTABLE', 'Builtin or extension Strategies are immutable.');
		let current = read_user(input.id);
		if (!current.ok) return current;
		if (current.strategy.revision != input.expectedRevision) return error('ECONFLICT', 'Strategy revision is stale.');
		let state = read_state();
		if (!state.ok) return state;
		let next = copy(state.state), filtered = [];
		for (let id in next.favorites) if (id != input.id) push(filtered, id);
		next.favorites = filtered;
		if (next.selected != null && next.selected.id == input.id) next.selected = null;
		let state_result = null;
		if (length(filtered) != length(state.state.favorites) || (state.state.selected != null && next.selected == null)) {
			next.revision = state.state.revision + 1;
			let saved = write_state(state, next, state.state.revision);
			if (!saved.ok) return saved;
			state_result = saved;
		}
		try { unlink(path_for(input.id)); } catch (e) { return error('EIO', 'User Strategy deletion failed.'); }
		return { ok: true, id: input.id, state: state_result == null ? state.state : state_result.state,
			revision: state_result == null ? state.state.revision : state_result.revision };
	});
};

export const strategy_duplicate = function(input) {
	return locked(function() {
		let source = is_object(input) ? input.strategy : null;
		if (!is_object(source) || !safe_id(source.id) || !bounded_string(source.name, MAX_NAME) || type(source.profiles) != 'array')
			return error('EINPUT', 'Duplicate source Strategy is invalid.');
		let sourceMetadata = exists(source, 'metadata') ? source.metadata : {};
		if (!metadata_valid(sourceMetadata)) return error('EINPUT', 'Duplicate source metadata is invalid.');
		let duplicate = {
			id: source.id + '_copy', name: source.name + ' (копия)', origin: 'user', is_builtin: false,
			metadata: copy(sourceMetadata), profiles: copy(source.profiles)
		};
		if (!user_input_valid(duplicate, true)) return error('EINPUT', 'Duplicate source cannot be stored.');
		if (!ensure_create_directory()) return error('EIO', 'User Strategy directory is unavailable.');
		if (stat(path_for(duplicate.id)) != null) return error('ECONFLICT', 'Duplicate Strategy id already exists.');
		let record = build_user(duplicate, 1), write = atomic_write(path_for(record.id), record, true);
		return write.ok ? { ok: true, strategy: record } : write;
	});
};

export const strategy_favorite = function(input) {
	return locked(function() {
		if (!is_object(input) || !integer(input.expectedRevision)) return error('EINPUT', 'Favorite mutation requires expectedRevision.');
		if (input.id != null && !safe_id(input.id)) return error('EINPUT', 'Favorite identity is unsafe.');
		if (input.id != null && input.favorite != true && input.favorite != false)
			return error('EINPUT', 'Favorite mutation requires a boolean favorite value.');
		if (!load_catalog_ids()) return error('EVERIFY', 'Verified catalog is unavailable.');
		if (input.id != null && !(protected_id(input.id) || read_user(input.id).ok))
			return error('ENOENT', 'Favorite Strategy was not found.');
		return state_mutate(input.expectedRevision, function(next) {
			let values = [], seen = {};
			for (let id in next.favorites) if ((protected_id(id) || read_user(id).ok) && !seen[id]) { seen[id] = true; push(values, id); }
			if (input.id != null && input.favorite == true && !seen[input.id]) { push(values, input.id); seen[input.id] = true; }
			if (input.id != null && input.favorite == false) {
				let kept = [];
				for (let id in values) if (id != input.id) push(kept, id);
				values = kept;
			}
			next.favorites = values;
			return next;
		});
	});
};

export const strategy_selection_get = function() {
	let state = read_state();
	return state.ok ? { ok: true, revision: state.state.revision, selected: state.state.selected } : state;
};

export const strategy_selection_set = function(input) {
	return locked(function() {
		if (!is_object(input) || !integer(input.expectedRevision)) return error('EINPUT', 'Selection requires expectedRevision.');
		let selected = input.selected;
		if (selected != null) {
			if (!selected_valid(selected)) return error('EINPUT', 'Selection identity is invalid.');
			selected = { id: selected.id, origin: selected.origin, revision: selected.revision, candidateSha256: selected.candidateSha256 };
		}
		return state_mutate(input.expectedRevision, function(next) { next.selected = selected; return next; });
	});
};

export const strategy_reconcile_record = function(input) {
	return locked(function() {
		if (!is_object(input) || !safe_id(input.id) || !sha256(input.hash) || !bounded_string(input.reason, 128)) return error('EINPUT', 'Reconciliation record is invalid.');
		let record = { id: input.id, hash: input.hash, reason: input.reason };
		let write = atomic_write(RECONCILE_PATH, { schema: 1, id: record.id, hash: record.hash, reason: record.reason }, true);
		return write.ok ? { ok: true, record: record } : write;
	});
};

export const strategy_reconcile_get = function() {
	let result = read_document(RECONCILE_PATH);
	if (result.missing) return { ok: true, record: null };
	if (!result.ok || !is_object(result.value) || result.value.schema !== 1 || !safe_id(result.value.id) || !sha256(result.value.hash) || !bounded_string(result.value.reason, 128))
		return error('EINPUT', 'Reconciliation record is invalid.');
	return { ok: true, record: { id: result.value.id, hash: result.value.hash, reason: result.value.reason } };
};

export const strategy_reconcile_clear = function() {
	return locked(function() {
		if (stat(RECONCILE_PATH) == null) return { ok: true, cleared: false };
		try { unlink(RECONCILE_PATH); } catch (e) { return error('EIO', 'Reconciliation record could not be cleared.'); }
		return { ok: true, cleared: true };
	});
};
