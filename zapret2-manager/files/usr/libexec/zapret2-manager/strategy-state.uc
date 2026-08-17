'use strict';

// Avatar Strategy-owned persistence. The legacy Profile document is not read
// here: this module owns only /etc/zapret2-manager/strategies and selection
// state for those Strategies.

import { readfile, writefile, stat, readlink, unlink, mkdir, lsdir, popen } from 'fs';
import { strategy_validate as model_validate, strategy_normalize } from './strategy-model.uc';
import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';

const STORAGE_ROOT = getenv('Z2M_STRATEGY_ROOT') || '/etc/zapret2-manager';
const STRATEGY_DIR = getenv('Z2M_STRATEGY_DIR') || '/etc/zapret2-manager/strategies';
const STATE_PATH = getenv('Z2M_STRATEGY_STATE') || '/etc/zapret2-manager/strategy-state.json';
const RECONCILE_PATH = getenv('Z2M_STRATEGY_RECONCILIATION') || '/tmp/zapret2-manager/strategy-reconciliation.json';
const APPLY_UNCERTAIN_PATH = getenv('Z2M_STRATEGY_APPLY_UNCERTAIN') || '/tmp/zapret2-manager/last-good/strategy-apply-uncertain.json';
const APPLY_LASTGOOD_DIR = getenv('Z2M_STRATEGY_APPLY_LASTGOOD') || '/tmp/zapret2-manager/last-good';
const APPLY_BLOCK_PATH = getenv('Z2M_STRATEGY_APPLY_BLOCK') || APPLY_LASTGOOD_DIR + '/strategy-apply-block.json';
const APPLY_LEASE_PATH = getenv('Z2M_STRATEGY_APPLY_LEASE') || APPLY_LASTGOOD_DIR + '/strategy-apply-lease.json';
const LOCK_PATH = getenv('Z2M_STRATEGY_LOCK') || '/tmp/zapret2-manager/strategy-state.lock';
// Apply guards must hash the same merged Avatar+Forgejo catalog that the
// Strategy CLI resolves. Hashing the legacy Forgejo-only root makes a
// current UI digest look stale and rejects every persisted catalog Apply.
const PACKAGE_CATALOG_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const ACTIVE_CATALOG_ROOT = '/etc/zapret2-manager/catalog/avatar';
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

function catalog_root() {
	let configured = getenv('Z2M_STRATEGY_CATALOG_ROOT');
	if (configured) return configured;
	try { if (stat(ACTIVE_CATALOG_ROOT) != null) return ACTIVE_CATALOG_ROOT; } catch (e) { }
	return PACKAGE_CATALOG_ROOT;
}
const HASH_TAG = getenv('Z2M_STRATEGY_HASH_TAG') || '';
const MAX_APPLY_UNCERTAIN_BYTES = 16384;
const APPLY_BLOCK_MARKER = 'z2m-strategy-apply-block.v1';
const APPLY_LEASE_MARKER = 'z2m-strategy-apply-lease.v1';

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
	try { loaded = strategy_catalog_load(catalog_root()); } catch (e) { loaded = null; }
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

function apply_guard_dir_secure() {
	let metadata = null;
	try { metadata = stat(APPLY_LASTGOOD_DIR); } catch (e) { metadata = null; }
	if (metadata == null) return ensure_directory(APPLY_LASTGOOD_DIR, PRIVATE_DIR_MODE);
	return metadata.type == 'directory' && readlink(APPLY_LASTGOOD_DIR) == null
		&& metadata.mode % 512 == PRIVATE_DIR_MODE;
}

function nonce() {
	let made = command('umask 077; mktemp /tmp/z2m-strategy-apply.XXXXXX 2>/dev/null');
	let value = trim(made.output);
	if (!made.ok || !match(value, /^\/tmp\/z2m-strategy-apply\.[A-Za-z0-9_-]+$/)) return null;
	try { unlink(value); } catch (e) { return null; }
	return value;
}

function apply_lease_valid(value) {
	return is_object(value) && exact_fields(value, ['schema', 'marker', 'nonce', 'owner', 'createdAt'])
		&& value.schema === 1 && value.marker == APPLY_LEASE_MARKER
		&& bounded_string(value.nonce, 256) && bounded_string(value.owner, 128)
		&& integer(value.createdAt);
}

function apply_lease_read() {
	let metadata = null;
	try { metadata = stat(APPLY_LEASE_PATH); } catch (e) { metadata = null; }
	if (metadata == null) return { ok: true, record: null };
	if (metadata.type != 'file' || readlink(APPLY_LEASE_PATH) != null
		|| metadata.mode % 512 != PRIVATE_FILE_MODE || type(metadata.size) != 'int' || metadata.size > 4096)
		return { ok: false, invalid: true };
	let value = null;
	try { value = json(readfile(APPLY_LEASE_PATH)); } catch (e) { value = null; }
	if (!apply_lease_valid(value)) return { ok: false, invalid: true };
	return { ok: true, record: value };
}

function apply_lease_owner_alive(record) {
	let fields = split(record.owner, ':');
	return length(fields) == 2 && process_start_marker(fields[0]) == fields[1];
}

function apply_lease_active() {
	let lease = apply_lease_read();
	if (!lease.ok) return true;
	if (lease.record == null) return false;
	if (apply_lease_owner_alive(lease.record)) return true;
	try { unlink(APPLY_LEASE_PATH); } catch (e) { return true; }
	return false;
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
function locked(operation, applyNonce) {
	let active = apply_lease_read();
	if (!active.ok) return error('ELOCKED', 'Strategy Apply lease is invalid; explicit recovery is required.');
	if (active.record != null && !apply_lease_active()) active = { ok: true, record: null };
	if (active.record != null && active.record.nonce != applyNonce)
		return error('ELOCKED', 'Strategy storage is held by an active Strategy Apply.');
	if (getenv('Z2M_STRATEGY_LOCKED') == '1') return operation();
	if (!acquire_lock()) return error('ELOCKED', 'Strategy storage is locked.');
	let result;
	try { result = operation(); } catch (e) {
		let cause = type(e) == 'string' ? e
			: (type(e) == 'object' && e != null && e.message != null ? '' + e.message : 'uncaught storage operation exception');
		result = error('EINTERNAL', 'Strategy storage operation failed.', { cause: substr(cause, 0, 160) });
	}
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
	let tag = match(HASH_TAG, /^[A-Za-z0-9_-]{1,64}$/) ? '.' + HASH_TAG : '';
	let temporary = command('umask 077; mktemp ' + shell_quote('/tmp/z2m-strategy-hash' + tag + '.XXXXXX') + ' 2>/dev/null');
	let path = trim(temporary.output);
	if (!temporary.ok || index(path, '/tmp/z2m-strategy-hash' + tag + '.') != 0) return null;
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

// Read-only Strategy identity path for inspection/Preview. CAS callers keep
// using read_document() because their hash reread is part of mutation
// concurrency control; inspection must not create a hash temporary.
function read_document_readonly(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata == null) return { ok: false, missing: true };
	if (readlink(path) != null || metadata.type != 'file' || type(metadata.size) != 'int' ||
		metadata.size > MAX_BYTES || metadata.mode % 512 != PRIVATE_FILE_MODE)
		return error('EINPUT', 'Strategy storage is not a bounded regular file.');
	let raw = readfile(path);
	if (raw == null || length(raw) != metadata.size) return error('EIO', 'Strategy storage could not be read.');
	if (raw == '') return { ok: true, empty: true, raw: raw, value: null };
	let value = null;
	try { value = json(raw); } catch (e) { return error('EINPUT', 'Strategy storage is not valid JSON.'); }
	return { ok: true, raw: raw, value: value };
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

function selected_readonly_valid(value) {
	return value == null || (exact_fields(value, ['id', 'origin', 'revision', 'candidateSha256']) &&
		safe_id(value.id) && (value.origin == 'user' || value.origin == 'avatar_builtin' || value.origin == 'extension') &&
		integer(value.revision) && sha256(value.candidateSha256));
}

function state_readonly_valid(value) {
	if (!exact_fields(value, ['schema', 'revision', 'favorites', 'selected']) || value.schema !== 1 ||
		!integer(value.revision) || type(value.favorites) != 'array' || !selected_readonly_valid(value.selected)) return false;
	let seen = {};
	for (let id in value.favorites) if (!safe_id(id) || seen[id]) return false; else seen[id] = true;
	return true;
}

function read_state_readonly() {
	let result = read_document_readonly(STATE_PATH);
	if (result.missing) return { ok: true, state: state_default(), absent: true };
	if (!result.ok) return result;
	if (result.empty) return { ok: true, state: state_default(), absent: true };
	if (!state_readonly_valid(result.value)) return error('EINPUT', 'Strategy state schema is invalid.');
	return { ok: true, state: result.value, absent: false };
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

function read_user_readonly(id) {
	if (!safe_id(id)) return error('EINPUT', 'Strategy id is unsafe.');
	let result = read_document_readonly(path_for(id));
	if (result.missing) return error('ENOENT', 'User Strategy was not found.');
	if (!result.ok) return result;
	if (!record_valid(result.value) || result.value.id != id)
		return error('EINPUT', 'User Strategy schema is invalid.');
	return { ok: true, strategy: result.value };
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

export const strategy_user_get_readonly = function(input) {
	let id = is_object(input) ? input.id : input;
	let result = read_user_readonly(id);
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
		let requested = is_object(input) ? (input.id != null ? input.id
			: is_object(input.strategy) ? input.strategy.id : null) : null;
		if (!safe_id(requested)) return error('EINPUT', 'Duplicate source Strategy id is invalid.');
		let sourceResult = read_user(requested);
		let source = sourceResult.ok ? sourceResult.strategy : null;
		if (source == null && sourceResult.error && sourceResult.error.code != 'ENOENT') return sourceResult;
		if (source == null) {
			let loaded = null;
			try { loaded = strategy_catalog_load(catalog_root()); } catch (e) { loaded = null; }
			let entry = loaded && loaded.ok == true && loaded.catalog && loaded.catalog.winners
				? loaded.catalog.winners[requested] : null;
			try { source = entry == null ? null : catalog_entry_to_strategy(entry); } catch (e) { source = null; }
			if (source != null) { source.origin = 'avatar_builtin'; source.is_builtin = true; }
		}
		if (!is_object(source) || !safe_id(source.id) || !bounded_string(source.name, MAX_NAME) || type(source.profiles) != 'array')
			return error('ENOENT', 'Duplicate source Strategy was not found.');
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
	return state.ok ? { ok: true, revision: state.state.revision, favorites: state.state.favorites, selected: state.state.selected } : state;
};

export const strategy_selection_get_readonly = function() {
	let state = read_state_readonly();
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

function apply_block_valid(value) {
	return is_object(value) && exact_fields(value, ['schema', 'marker', 'nonce', 'state', 'strategyId', 'strategyRevision', 'catalogDigest', 'createdAt', 'oldConfigSha256', 'oldCandidateSha256', 'oldSelected'])
		&& value.schema === 1 && value.marker == APPLY_BLOCK_MARKER
		&& bounded_string(value.nonce, 256) && value.state == 'pending'
		&& safe_id(value.strategyId) && integer(value.strategyRevision)
		&& sha256(value.catalogDigest) && integer(value.createdAt)
		&& (value.oldConfigSha256 == null || sha256(value.oldConfigSha256))
		&& (value.oldCandidateSha256 == null || sha256(value.oldCandidateSha256))
		&& (value.oldSelected == null || selected_valid(value.oldSelected));
}

function apply_block_read() {
	let result = read_document(APPLY_BLOCK_PATH);
	if (result.missing) return { ok: true, record: null };
	if (!result.ok || !apply_block_valid(result.value)) return { ok: false, invalid: true };
	return { ok: true, record: result.value };
}

function apply_block_clear() {
	if (stat(APPLY_BLOCK_PATH) == null) return true;
	try { unlink(APPLY_BLOCK_PATH); } catch (e) { return false; }
	return true;
}

function apply_catalog_digest() {
	let loaded = null;
		try { loaded = strategy_catalog_load(catalog_root()); } catch (e) { loaded = null; }
	return is_object(loaded) && loaded.ok == true && is_object(loaded.catalog)
		&& sha256(loaded.catalog.aggregateDigest) ? loaded.catalog.aggregateDigest : null;
}

export const strategy_apply_guard_status = function() {
	if (!apply_guard_dir_secure()) return { ok: true, blocked: true, reason: 'last-good directory is not private and secure' };
	let block = apply_block_read();
	if (!block.ok) return { ok: true, blocked: true, reason: 'Apply block marker is invalid' };
	if (block.record != null) return { ok: true, blocked: true, reason: 'Strategy Apply is pending or uncertain' };
	if (apply_lease_active()) return { ok: true, blocked: true, reason: 'Strategy Apply lease is active' };
	return { ok: true, blocked: false };
};

export const strategy_apply_begin = function(input) {
	return locked(function() {
		if (!is_object(input) || !safe_id(input.strategyId) || !integer(input.strategyRevision) || !sha256(input.catalogDigest))
			return error('EINPUT', 'Strategy Apply lease identity is invalid.');
		if ((input.oldConfigSha256 != null && !sha256(input.oldConfigSha256))
			|| (input.oldCandidateSha256 != null && !sha256(input.oldCandidateSha256)))
			return error('EINPUT', 'Strategy Apply baseline evidence is invalid.');
		if (!apply_guard_dir_secure()) return error('EUNCERTAIN', 'private last-good directory is unavailable.');
		let status = strategy_apply_guard_status();
		if (!status.ok || status.blocked) return error('EUNCERTAIN', status.reason || 'Strategy Apply is blocked.');
		let digest = apply_catalog_digest();
		if (digest == null || digest != input.catalogDigest) return error('ECONFLICT', 'Strategy catalog digest is stale.');
		let current = read_user(input.strategyId);
		if (current.ok) {
			if (current.strategy.revision != input.strategyRevision) return error('ECONFLICT', 'Strategy revision is stale.');
		} else if (!(current.error && current.error.code == 'ENOENT' && input.strategyRevision == 0 && catalog_id(input.strategyId))) {
			return current;
		}
		let selection = read_state();
		if (!selection.ok) return selection;
		let operationNonce = nonce(), owner = owner_identity();
		if (operationNonce == null || owner == null) return error('EIO', 'Strategy Apply operation nonce is unavailable.');
		let block = {
			schema: 1, marker: APPLY_BLOCK_MARKER, nonce: operationNonce, state: 'pending',
			strategyId: input.strategyId, strategyRevision: input.strategyRevision,
			catalogDigest: input.catalogDigest, createdAt: time(),
			oldConfigSha256: input.oldConfigSha256 == null ? null : input.oldConfigSha256,
			oldCandidateSha256: input.oldCandidateSha256 == null ? null : input.oldCandidateSha256,
			oldSelected: selection == null ? null : selection.state.selected
		};
		let savedBlock = atomic_write(APPLY_BLOCK_PATH, block, true);
		if (!savedBlock.ok) return error('EUNCERTAIN', 'Strategy Apply blocking marker could not be persisted.', { persistence: savedBlock });
		let lease = { schema: 1, marker: APPLY_LEASE_MARKER, nonce: operationNonce, owner: owner, createdAt: time() };
		let savedLease = atomic_write(APPLY_LEASE_PATH, lease, true);
		if (!savedLease.ok) return error('EUNCERTAIN', 'Strategy Apply lease could not be persisted.', { persistence: savedLease });
		return { ok: true, operationNonce: operationNonce, strategyRevision: input.strategyRevision,
			catalogDigest: input.catalogDigest, selectionRevision: selection.state.revision,
			selected: selection.state.selected, oldConfigSha256: block.oldConfigSha256,
			oldCandidateSha256: block.oldCandidateSha256 };
	});
};

export const strategy_apply_end = function(input) {
	let injected = null, raw = getenv('Z2M_STRATEGY_APPLY_END_RESULT');
	if (raw != null && length(raw) <= 4096) try { injected = json(raw); } catch (e) { injected = null; }
	if (is_object(injected)) return injected;
	return locked(function() {
		if (!is_object(input) || !bounded_string(input.applyNonce, 256)) return error('EINPUT', 'Strategy Apply operation nonce is required.');
		let lease = apply_lease_read();
		if (!lease.ok || lease.record == null || lease.record.nonce != input.applyNonce)
			return error('ECONFLICT', 'Strategy Apply lease is not current.');
		try { unlink(APPLY_LEASE_PATH); } catch (e) { return error('EIO', 'Strategy Apply lease could not be released.'); }
		try { unlink(APPLY_BLOCK_PATH); } catch (e) { return error('EIO', 'Strategy Apply blocking marker could not be cleared.'); }
		return { ok: true, released: true };
	}, input && input.applyNonce);
};

function selection_copy(value) {
	return value == null ? null : {
		id: value.id, origin: value.origin, revision: value.revision,
		candidateSha256: value.candidateSha256
	};
}

function apply_uncertain_identity(value) {
	return value == null || selected_valid(value);
}

function same_selection(left, right) {
	if (left == null || right == null) return left == right;
	return left.id == right.id && left.origin == right.origin
		&& left.revision == right.revision && left.candidateSha256 == right.candidateSha256;
}

// Apply commits only the narrow selected identity projection. Config bytes
// remain owned by profiles-apply.uc and are never written here.
export const strategy_selection_apply = function(input) {
	return locked(function() {
		if (!is_object(input) || !integer(input.expectedRevision))
			return error('EINPUT', 'Strategy Apply selection requires expectedRevision.');
		if (input.selected != null && !selected_valid(input.selected))
			return error('EINPUT', 'Strategy Apply selection identity is invalid.');
		return state_mutate(input.expectedRevision, function(next) {
			next.selected = selection_copy(input.selected);
			return next;
		});
	}, input && input.applyNonce);
};

export const strategy_selection_restore = function(input) {
	return strategy_selection_apply(input);
};

export const strategy_apply_revalidate = function(input) {
	return locked(function() {
		if (!is_object(input) || !safe_id(input.strategyId) || !integer(input.strategyRevision)
			|| !sha256(input.catalogDigest) || !integer(input.selectionRevision)
			|| !apply_uncertain_identity(input.expectedSelected))
			return error('EINPUT', 'Strategy Apply revalidation identity is invalid.');
		let digest = apply_catalog_digest();
		if (digest == null || digest != input.catalogDigest) return error('ECONFLICT', 'Strategy catalog digest changed.');
		let current = read_user(input.strategyId);
		if (current.ok) {
			if (current.strategy.revision != input.strategyRevision || input.strategyOrigin != 'user')
				return error('ECONFLICT', 'Strategy revision changed before config mutation.');
		} else if (!(current.error && current.error.code == 'ENOENT' && input.strategyRevision == 0
			&& input.strategyOrigin == 'avatar_builtin' && catalog_id(input.strategyId))) {
			return error('ECONFLICT', 'Strategy identity changed before config mutation.');
		}
		let state = read_state();
		if (!state.ok || state.state.revision != input.selectionRevision
			|| !same_selection(state.state.selected, input.expectedSelected))
			return error('ECONFLICT', 'Strategy selection changed before config mutation.');
		return { ok: true, strategyRevision: input.strategyRevision, selectionRevision: state.state.revision };
	}, input && input.applyNonce);
};

export const strategy_identity_outcome = function(input) {
	if (!is_object(input) || input.runtimeVerified != true)
		return { ok: false, state: 'uncertain' };
	if (input.identityOk == true) return { ok: true, state: 'verified' };
	return { ok: false, state: 'rollback' };
};

function runtime_checks_shape(value) {
	return is_object(value) && exact_fields(value, ['processPresent', 'singleInstance', 'rulesPresent', 'queueRegistered', 'ownerMatch'])
		&& type(value.processPresent) == 'bool' && type(value.singleInstance) == 'bool'
		&& type(value.rulesPresent) == 'bool' && type(value.queueRegistered) == 'bool'
		&& type(value.ownerMatch) == 'bool';
}

function runtime_checks_verified(value) {
	return runtime_checks_shape(value) && value.processPresent == true && value.singleInstance == true
		&& value.rulesPresent == true && value.queueRegistered == true && value.ownerMatch == true;
}

function runtime_outcome_valid(value) {
	return is_object(value) && exact_fields(value, ['initial', 'rollback', 'restartRc', 'rollbackRestartRc', 'configRestored', 'identityRestored'])
		&& runtime_checks_shape(value.initial) && runtime_checks_shape(value.rollback)
		&& type(value.restartRc) == 'int' && type(value.rollbackRestartRc) == 'int'
		&& type(value.configRestored) == 'bool' && type(value.identityRestored) == 'bool';
}

function apply_uncertain_valid(value) {
	return is_object(value) && exact_fields(value, ['schema', 'oldConfigSha256', 'newConfigSha256',
		'oldCandidateSha256', 'newCandidateSha256', 'catalogDigest', 'oldIdentity', 'newIdentity', 'runtimeOutcome', 'reason']) && value.schema === 1
		&& sha256(value.oldConfigSha256) && sha256(value.newConfigSha256)
		&& sha256(value.oldCandidateSha256) && sha256(value.newCandidateSha256)
		&& sha256(value.catalogDigest)
		&& apply_uncertain_identity(value.oldIdentity) && apply_uncertain_identity(value.newIdentity)
		&& runtime_outcome_valid(value.runtimeOutcome) && bounded_string(value.reason, 128);
}

function apply_uncertain_valid_readonly(value) {
	return is_object(value) && exact_fields(value, ['schema', 'oldConfigSha256', 'newConfigSha256',
		'oldCandidateSha256', 'newCandidateSha256', 'catalogDigest', 'oldIdentity', 'newIdentity', 'runtimeOutcome', 'reason']) && value.schema === 1
		&& sha256(value.oldConfigSha256) && sha256(value.newConfigSha256)
		&& sha256(value.oldCandidateSha256) && sha256(value.newCandidateSha256)
		&& sha256(value.catalogDigest)
		&& selected_readonly_valid(value.oldIdentity) && selected_readonly_valid(value.newIdentity)
		&& runtime_outcome_valid(value.runtimeOutcome) && bounded_string(value.reason, 128);
}

function apply_uncertain_read() {
	let result = read_document(APPLY_UNCERTAIN_PATH);
	if (result.missing) return { ok: true, record: null };
	if (!result.ok || !apply_uncertain_valid(result.value)
		|| length(result.raw) > MAX_APPLY_UNCERTAIN_BYTES)
		return error('EINPUT', 'Strategy Apply uncertainty record is invalid.');
	return { ok: true, record: result.value };
}

function apply_uncertain_parent() {
	let slash = rindex(APPLY_UNCERTAIN_PATH, '/');
	return slash > 0 && ensure_directory(substr(APPLY_UNCERTAIN_PATH, 0, slash), PRIVATE_DIR_MODE);
}

export const strategy_apply_uncertain_record = function(input) {
	return locked(function() {
		if (!is_object(input) || !sha256(input.oldConfigSha256) || !sha256(input.newConfigSha256)
			|| !sha256(input.oldCandidateSha256) || !sha256(input.newCandidateSha256)
			|| !sha256(input.catalogDigest)
			|| !apply_uncertain_identity(input.oldIdentity) || !apply_uncertain_identity(input.newIdentity)
			|| !runtime_outcome_valid(input.runtimeOutcome) || !bounded_string(input.reason, 128))
			return error('EINPUT', 'Strategy Apply uncertainty record is invalid.');
		if (!apply_uncertain_parent()) return error('EIO', 'Strategy Apply uncertainty directory is unavailable.');
		let record = {
			schema: 1, oldConfigSha256: input.oldConfigSha256, newConfigSha256: input.newConfigSha256,
			oldCandidateSha256: input.oldCandidateSha256, newCandidateSha256: input.newCandidateSha256,
			catalogDigest: input.catalogDigest,
			oldIdentity: selection_copy(input.oldIdentity), newIdentity: selection_copy(input.newIdentity),
			runtimeOutcome: input.runtimeOutcome, reason: input.reason
		};
		let encoded = sprintf('%J', record);
		if (length(encoded) > MAX_APPLY_UNCERTAIN_BYTES) return error('EINPUT', 'Strategy Apply uncertainty record is too large.');
		let write = atomic_write(APPLY_UNCERTAIN_PATH, record, true);
		return write.ok ? { ok: true, record: record } : write;
	}, input && input.applyNonce);
};

export const strategy_apply_uncertain_get = function() {
	return apply_uncertain_read();
};

export const strategy_apply_uncertain_get_readonly = function() {
	let result = read_document_readonly(APPLY_UNCERTAIN_PATH);
	if (result.missing) return { ok: true, record: null };
	if (!result.ok || !apply_uncertain_valid_readonly(result.value)
		|| length(result.raw) > MAX_APPLY_UNCERTAIN_BYTES)
		return error('EINPUT', 'Strategy Apply uncertainty record is invalid.');
	return { ok: true, record: result.value };
};

export const strategy_apply_uncertain_clear = function() {
	return locked(function() {
		if (stat(APPLY_UNCERTAIN_PATH) == null) return { ok: true, cleared: false };
		try { unlink(APPLY_UNCERTAIN_PATH); } catch (e) { return error('EIO', 'Strategy Apply uncertainty record could not be cleared.'); }
		return { ok: true, cleared: true };
	});
};

function selection_authoritative(value) {
	if (!selected_valid(value)) return false;
	if (value.origin == 'user') {
		let current = read_user(value.id);
		return current.ok && current.strategy.revision == value.revision;
	}
	return value.revision == 0 && (value.origin == 'avatar_builtin' ? catalog_id(value.id) : extension_id(value.id));
}

function selection_exact_authoritative(active, expected) {
	return expected != null && same_selection(active, expected) && selection_authoritative(active);
}

function selection_old_authoritative(active, expected) {
	return expected == null ? active == null : selection_exact_authoritative(active, expected);
}

function apply_target_current(id, revision) {
	let current = read_user(id);
	if (current.ok) return current.strategy.revision == revision;
	return revision == 0 && (catalog_id(id) || extension_id(id));
}

function reconcile_evidence_valid(input) {
	return is_object(input) && input.evidenceMarker == 'z2m-authoritative-reconcile.v1'
		&& sha256(input.currentConfigSha256) && sha256(input.activeCandidateSha256)
		&& runtime_checks_verified(input.runtimeChecks);
}

function clear_apply_uncertainty() {
	try { unlink(APPLY_UNCERTAIN_PATH); } catch (e) { return error('EIO', 'Strategy Apply uncertainty record could not be cleared.'); }
	if (!apply_block_clear()) return error('EIO', 'Strategy Apply blocking marker could not be cleared.');
	return { ok: true };
}

// Reconciliation is explicit and requires independently verified runtime and
// exact old/new config evidence. Normal Apply must remain blocked while the
// uncertainty record exists.
export const strategy_apply_reconcile = function(input) {
	return locked(function() {
		let pending = apply_uncertain_read();
		if (!pending.ok) return pending;
		let block = apply_block_read();
		if (!block.ok) return block;
		if (pending.record == null && block.record == null) return { ok: true, reconciled: false };
		if (!reconcile_evidence_valid(input))
			return error('EVERIFY', 'verified runtime and exact config evidence are required for reconciliation.');
		let current = read_state();
		if (!current.ok) return current;
		if (pending.record == null) {
			let baseline = block.record;
			if (baseline.oldConfigSha256 == null || baseline.oldCandidateSha256 == null
				|| !apply_target_current(baseline.strategyId, baseline.strategyRevision)
				|| apply_catalog_digest() != baseline.catalogDigest
				|| input.currentConfigSha256 != baseline.oldConfigSha256
				|| input.activeCandidateSha256 != baseline.oldCandidateSha256
				|| !selection_old_authoritative(current.state.selected, baseline.oldSelected))
				return error('ECONFLICT', 'dead pending Strategy Apply outcome is not the exact verified old state.');
			let clearedPending = apply_block_clear();
			if (!clearedPending) return error('EIO', 'Strategy Apply blocking marker could not be cleared.');
			return { ok: true, reconciled: 'pending-old', selected: baseline.oldSelected };
		}
		let record = pending.record;
		if (apply_catalog_digest() != record.catalogDigest)
			return error('ECONFLICT', 'Strategy catalog identity changed during reconciliation.');
		let oldMatch = input.currentConfigSha256 == record.oldConfigSha256
			&& input.activeCandidateSha256 == record.oldCandidateSha256;
		let newMatch = input.currentConfigSha256 == record.newConfigSha256
			&& input.activeCandidateSha256 == record.newCandidateSha256;
		if (oldMatch) {
			if (!selection_old_authoritative(current.state.selected, record.oldIdentity))
				return error('ECONFLICT', 'authoritative persisted Strategy selection does not match the old identity.');
			let clearedOld = clear_apply_uncertainty();
			if (!clearedOld.ok) return clearedOld;
			return { ok: true, reconciled: 'old', selected: record.oldIdentity };
		}
		if (!newMatch)
			return error('ECONFLICT', 'runtime and config do not match either Strategy Apply identity.');
		let selected = record.newIdentity;
		if (selection_exact_authoritative(current.state.selected, selected)) {
			let clearedNew = clear_apply_uncertainty();
			if (!clearedNew.ok) return clearedNew;
			return { ok: true, reconciled: 'new', selected: selected, revision: current.state.revision };
		}
		if (!selection_old_authoritative(current.state.selected, record.oldIdentity))
			return error('ECONFLICT', 'authoritative persisted Strategy selection does not match the old identity.');
		let next = copy(current.state);
		next.selected = selection_copy(selected);
		next.revision = current.state.revision + 1;
		let saved = write_state(current, next, current.state.revision);
		if (!saved.ok) return saved;
		let clearedNew = clear_apply_uncertainty();
		if (!clearedNew.ok) return clearedNew;
		return { ok: true, reconciled: 'new', selected: selected, state: saved.state, revision: saved.revision };
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

export const strategy_reconcile_get_readonly = function() {
	let result = read_document_readonly(RECONCILE_PATH);
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
