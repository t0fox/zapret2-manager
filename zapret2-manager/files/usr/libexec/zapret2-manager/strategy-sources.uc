'use strict';

// Durable ownership for Strategy source configuration and source snapshots.
// This module deliberately stores only source state. It does not fetch remote
// content, parse an upstream corpus, publish the unified catalog, or select a
// snapshot by directory enumeration.

import { mkdir, popen, readfile, readlink, stat, unlink, writefile } from 'fs';

const ROOT = getenv('Z2M_STRATEGY_SOURCES_ROOT') || '/etc/zapret2-manager';
const CONFIG_PATH = ROOT + '/strategy-sources.json';
const SOURCE_ROOT = ROOT + '/strategy-sources';
const SCHEMA = 'z2m.strategy-sources.v1';
const SNAPSHOT_SCHEMA = 'z2m.strategy-source-snapshot.v1';
const MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_IDS = ['avatar', 'z2k'];
const SOURCE_REPOSITORIES = { avatar: 'avatarDD/zapret-gui', z2k: 'necronicle/z2k' };
const OFFICIAL_Z2K_SOURCE_PATH = 'official:generate_nfqws2_opt_from_strategies';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function valid_digest(value) { return string(value) && match(value, /^[0-9a-f]{64}$/); }
function integer(value) { return type(value) == 'int' && value >= 0; }
function error(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function known_source(id) {
	return id == 'avatar' || id == 'z2k';
}
function source_dir(id) { return SOURCE_ROOT + '/' + id; }
function snapshot_dir(id) { return source_dir(id) + '/snapshots'; }
function state_path(id) { return source_dir(id) + '/state.json'; }
function snapshot_path(id, snapshotId) { return snapshot_dir(id) + '/' + snapshotId + '.json'; }
function safe_snapshot_id(value) {
	return string(value) && length(value) >= 3 && length(value) <= 160
		&& match(value, /^[A-Za-z0-9][A-Za-z0-9._-]*$/) && value != '.' && value != '..';
}

function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}

function directory(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return false; }
	return metadata != null && metadata.type == 'directory' && readlink(path) == null;
}

function ensure_directory(path) {
	if (directory(path)) return true;
	try { mkdir(path); } catch (e) { }
	return directory(path);
}

function ensure_layout(id) {
	return known_source(id) && ensure_directory(ROOT) && ensure_directory(SOURCE_ROOT)
		&& ensure_directory(source_dir(id)) && ensure_directory(snapshot_dir(id));
}

function atomic_write(path, value) {
	let parent = substr(path, 0, rindex(path, '/'));
	if (!directory(parent)) return false;
	let temporary = path + '.tmp.' + time();
	try { writefile(temporary, value); } catch (e) { return false; }
	let process = null, rc = -1;
	try {
		process = popen('mv -f ' + shell_quote(temporary) + ' ' + shell_quote(path) + ' 2>/dev/null', 'r');
		if (process) rc = process.close();
	} catch (e) { rc = -1; }
	if (rc != 0) try { unlink(temporary); } catch (ignored) { }
	return rc == 0;
}

function read_json(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata == null) return { ok: true, missing: true, value: null };
	if (metadata.type != 'file' || readlink(path) != null || type(metadata.size) != 'int'
		|| metadata.size > MAX_BYTES) return error('EIO', 'Strategy source state is not a bounded regular file');
	let raw = null;
	try { raw = readfile(path); } catch (e) { return error('EIO', 'Strategy source state could not be read'); }
	if (!string(raw) || length(raw) != metadata.size) return error('EIO', 'Strategy source state is truncated');
	try { return { ok: true, missing: false, value: json(raw) }; }
	catch (e) { return error('EIO', 'Strategy source state is not valid JSON'); }
}

function default_config() {
	return { schema: SCHEMA, revision: 1,
		sources: { avatar: { enabled: true }, z2k: { enabled: true } } };
}

function valid_config(value) {
	return object(value) && value.schema == SCHEMA && integer(value.revision) && value.revision >= 1
		&& object(value.sources) && object(value.sources.avatar) && object(value.sources.z2k)
		&& type(value.sources.avatar.enabled) == 'bool' && type(value.sources.z2k.enabled) == 'bool';
}

function load_config() {
	if (!ensure_directory(ROOT)) return error('EIO', 'Strategy source root is unavailable');
	let result = read_json(CONFIG_PATH);
	if (!result.ok) return result;
	if (result.missing) {
		let value = default_config();
		if (!atomic_write(CONFIG_PATH, sprintf('%J', value))) return error('EIO', 'Default strategy source config could not be persisted');
		return { ok: true, config: value };
	}
	if (!valid_config(result.value)) return error('EIO', 'Strategy source config is invalid');
	return { ok: true, config: result.value };
}

function default_state(id) {
	return { schema: 'z2m.strategy-source-state.v1', sourceId: id,
		currentSnapshotId: null, lastKnownGoodSnapshotId: null, revision: 1 };
}

function valid_state(id, value) {
	return object(value) && value.schema == 'z2m.strategy-source-state.v1'
		&& value.sourceId == id && integer(value.revision) && value.revision >= 1
		&& (value.currentSnapshotId == null || safe_snapshot_id(value.currentSnapshotId))
		&& (value.lastKnownGoodSnapshotId == null || safe_snapshot_id(value.lastKnownGoodSnapshotId));
}

function load_state(id) {
	if (!ensure_layout(id)) return error('EIO', 'Strategy source state root is unavailable');
	let result = read_json(state_path(id));
	if (!result.ok) return result;
	if (result.missing) {
		let value = default_state(id);
		if (!atomic_write(state_path(id), sprintf('%J', value))) return error('EIO', 'Default source state could not be persisted');
		return { ok: true, state: value };
	}
	if (!valid_state(id, result.value)) return error('EIO', 'Strategy source state is invalid');
	return { ok: true, state: result.value };
}

function source_config(config, id) {
	return config.sources[id];
}

function contains(value, needle) {
	if (type(value) != 'array') return false;
	for (let item in value) if (item == needle) return true;
	return false;
}
function valid_official_z2k_provenance(snapshot) {
	if (snapshot.sourcePath != OFFICIAL_Z2K_SOURCE_PATH || !valid_digest(snapshot.compilerSnapshotDigest)
		|| !valid_digest(snapshot.nfqws2OptSha256) || type(snapshot.fileSha256) != 'object'
		|| type(snapshot.sourceFiles) != 'array' || length(snapshot.sourceFiles) != 5
		|| snapshot.compilerSchema != 'z2m.z2k-official-compiler-snapshot.v1') return false;
	for (let relative in ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh'])
		if (!contains(snapshot.sourceFiles, relative) || !valid_digest(snapshot.fileSha256[relative])) return false;
	return true;
}
function valid_z2k_snapshot(snapshot) {
	if (!object(snapshot) || type(snapshot.sourceFiles) != 'array'
		|| !contains(snapshot.sourceFiles, 'strats_new2.txt') || !contains(snapshot.sourceFiles, 'quic_strats.ini')
		|| !object(snapshot.allInOne) || snapshot.allInOne.canonicalId != 'z2k:z2k_all_in_one'
		|| !string(snapshot.allInOne.digest) || !match(snapshot.allInOne.digest, /^[0-9a-f]{64}$/)
		|| type(snapshot.allInOne.profileCount) != 'int' || snapshot.allInOne.profileCount < 1
		|| type(snapshot.entries) != 'array') return false;
	if (snapshot.sourcePath == OFFICIAL_Z2K_SOURCE_PATH && !valid_official_z2k_provenance(snapshot)) return false;
	for (let entry in snapshot.entries) {
		if (object(entry) && entry.canonicalId == snapshot.allInOne.canonicalId
			&& entry.sourceId == 'z2k' && entry.sourceSnapshotId == snapshot.snapshotId
			&& entry.entryKind == 'all-in-one' && entry.usable == true
			&& (snapshot.sourcePath != OFFICIAL_Z2K_SOURCE_PATH || (object(entry.provenance)
				&& entry.provenance.compilerSnapshotDigest == snapshot.compilerSnapshotDigest
				&& string(entry.officialNfqws2Opt)))
			&& type(entry.profiles) == 'array' && length(entry.profiles) == snapshot.allInOne.profileCount)
			return true;
	}
	return false;
}

function valid_snapshot(id, snapshot) {
	return object(snapshot) && snapshot.schema == SNAPSHOT_SCHEMA && snapshot.sourceId == id
		&& snapshot.repository == SOURCE_REPOSITORIES[id] && safe_snapshot_id(snapshot.snapshotId)
		&& string(snapshot.sourceCommit) && match(snapshot.sourceCommit, /^[0-9a-f]{7,40}$/)
		&& string(snapshot.contentDigest) && match(snapshot.contentDigest, /^[0-9a-f]{64}$/)
		&& integer(snapshot.entryCount) && integer(snapshot.normalizedEntryCount)
		&& snapshot.immutable == true && (id != 'z2k' || valid_z2k_snapshot(snapshot));
}

function read_current(id, state) {
	if (state.currentSnapshotId == null) return { ok: true, snapshot: null };
	let result = read_json(snapshot_path(id, state.currentSnapshotId));
	if (!result.ok) return result;
	if (result.missing || !valid_snapshot(id, result.value))
		return error('ESTALE', 'Recorded current source snapshot is unavailable or invalid');
	return { ok: true, snapshot: result.value };
}

function source_projection(config, state, id) {
	let current = read_current(id, state), snapshot = current.ok ? current.snapshot : null;
	return { id: id, enabled: source_config(config, id).enabled,
		currentSnapshotId: state.currentSnapshotId,
		lastKnownGoodSnapshotId: state.lastKnownGoodSnapshotId, revision: state.revision,
		repository: SOURCE_REPOSITORIES[id], sourceCommit: snapshot && snapshot.sourceCommit || null,
		contentDigest: snapshot && snapshot.contentDigest || null,
		entryCount: snapshot && snapshot.entryCount || 0,
		normalizedEntryCount: snapshot && snapshot.normalizedEntryCount || 0,
		hasLkg: state.lastKnownGoodSnapshotId != null,
		state: current.ok ? (snapshot == null ? 'missing' : 'current') : 'error' };
}

export const strategy_sources_get = function() {
	let loaded = load_config();
	if (!loaded.ok) return loaded;
	let result = { ok: true, config: copy(loaded.config), sources: {} };
	for (let id in SOURCE_IDS) {
		let state = load_state(id);
		if (!state.ok) return state;
		result.sources[id] = source_projection(loaded.config, state.state, id);
	}
	return result;
};

export const strategy_source_get = function(id) {
	if (!known_source(id)) return error('EINPUT', 'Unknown strategy source', 'sourceId');
	let loaded = load_config();
	if (!loaded.ok) return loaded;
	let state = load_state(id);
	if (!state.ok) return state;
	return { ok: true, source: source_projection(loaded.config, state.state, id) };
};

export const strategy_source_set_enabled = function(id, enabled, expectedRevision) {
	if (!known_source(id) || type(enabled) != 'bool' || type(expectedRevision) != 'int')
		return error('EINPUT', 'Source enable mutation requires sourceId, boolean enabled, and expectedRevision');
	let loaded = load_config();
	if (!loaded.ok) return loaded;
	if (loaded.config.revision != expectedRevision)
		return error('ESTALE', 'Strategy source config revision is stale');
	let next = copy(loaded.config);
	next.sources[id].enabled = enabled;
	next.revision++;
	if (!atomic_write(CONFIG_PATH, sprintf('%J', next))) return error('EIO', 'Strategy source config could not be published');
	let state = load_state(id);
	if (!state.ok) return state;
	return { ok: true, config: next, source: source_projection(next, state.state, id) };
};

export const strategy_sources_restore_config = function(config, expectedRevision) {
	if (!valid_config(config) || type(expectedRevision) != 'int')
		return error('EINPUT', 'A valid source config and expected revision are required');
	let loaded = load_config();
	if (!loaded.ok) return loaded;
	if (loaded.config.revision != expectedRevision)
		return error('ESTALE', 'Strategy source config changed during rollback');
	if (!atomic_write(CONFIG_PATH, sprintf('%J', config)))
		return error('EIO', 'Strategy source config rollback could not be published');
	return { ok: true, config: copy(config) };
};

export const strategy_source_current_snapshot = function(id) {
	if (!known_source(id)) return error('EINPUT', 'Unknown strategy source', 'sourceId');
	let state = load_state(id);
	if (!state.ok) return state;
	return read_current(id, state.state);
};

// Restore the source activation authority after a catalog transaction that
// could not publish its generation. Snapshot files are immutable; only the
// pointer state is rolled back, so the failed candidate remains harmless and
// can be garbage-collected by a later maintenance pass.
export const strategy_source_restore_activation = function(id, activation) {
	if (!known_source(id) || !object(activation))
		return error('EINPUT', 'Source activation rollback requires sourceId and activation');
	let state = load_state(id);
	if (!state.ok) return state;
	let currentId = activation.currentSnapshotId == null ? null : activation.currentSnapshotId;
	let lkgId = activation.lastKnownGoodSnapshotId == null ? null : activation.lastKnownGoodSnapshotId;
	if ((currentId != null && !safe_snapshot_id(currentId)) || (lkgId != null && !safe_snapshot_id(lkgId)))
		return error('EINPUT', 'Source activation rollback contains an unsafe snapshot id');
	if (currentId != null) {
		let current = read_json(snapshot_path(id, currentId));
		if (!current.ok || current.missing || !valid_snapshot(id, current.value))
			return error('ESTALE', 'Source activation rollback snapshot is unavailable');
	}
	if (lkgId != null) {
		let lkg = read_json(snapshot_path(id, lkgId));
		if (!lkg.ok || lkg.missing || !valid_snapshot(id, lkg.value))
			return error('ESTALE', 'Source activation rollback LKG snapshot is unavailable');
	}
	let next = copy(state.state);
	next.currentSnapshotId = currentId;
	next.lastKnownGoodSnapshotId = lkgId;
	next.revision++;
	if (!atomic_write(state_path(id), sprintf('%J', next)))
		return error('EIO', 'Source activation rollback could not be published');
	return { ok: true, source: { id: id, currentSnapshotId: currentId,
		lastKnownGoodSnapshotId: lkgId, revision: next.revision } };
};

export const strategy_source_install_verified_snapshot = function(id, prepared) {
	if (!known_source(id) || !object(prepared) || !object(prepared.snapshot))
		return error('EINPUT', 'A verified prepared source snapshot is required');
	if (prepared.verified != true) return error('EVERIFY', 'Prepared source snapshot is not verified');
	let snapshot = copy(prepared.snapshot);
	if (!valid_snapshot(id, snapshot)) return error('EVERIFY', 'Prepared source snapshot failed immutable identity validation');
	let state = load_state(id);
	if (!state.ok) return state;
	// Deterministic failure seam for native/product tests only. It is gated by
	// the existing test contract and is not exposed through RPC or UI.
	if (getenv('Z2M_STRATEGY_SOURCE_TEST') == '1' && getenv('Z2M_STRATEGY_SOURCE_INSTALL_FAIL') == id)
		return error('EWRITE', 'Injected source snapshot installation failure', id);
	let path = snapshot_path(id, snapshot.snapshotId);
	if (!atomic_write(path, sprintf('%J', snapshot))) return error('EIO', 'Verified source snapshot could not be stored');
	let next = copy(state.state);
	next.currentSnapshotId = snapshot.snapshotId;
	next.lastKnownGoodSnapshotId = snapshot.snapshotId;
	next.revision++;
	if (!atomic_write(state_path(id), sprintf('%J', next)))
		return error('EIO', 'Source snapshot authority could not be published');
	return { ok: true, source: { id: id, currentSnapshotId: next.currentSnapshotId,
		lastKnownGoodSnapshotId: next.lastKnownGoodSnapshotId, revision: next.revision }, snapshot: snapshot };
};
