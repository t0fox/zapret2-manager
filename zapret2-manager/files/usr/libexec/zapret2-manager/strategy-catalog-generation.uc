'use strict';

// Unified Strategy catalog generation. Source adapters own parsing and source
// snapshots; this module owns only deterministic merge, generation records,
// the v3 read index, and the active pointer. Runtime readers must use the
// pointer/index identity and never infer authority from directory order.

import { mkdir, popen, readfile, readlink, stat, unlink, writefile } from 'fs';

const CATALOG_ROOT = getenv('Z2M_STRATEGY_CATALOG_GENERATION_ROOT') || '/etc/zapret2-manager/catalog';
const GENERATIONS_ROOT = getenv('Z2M_STRATEGY_CATALOG_GENERATIONS_ROOT') || CATALOG_ROOT + '/generations';
const ACTIVE_POINTER = getenv('Z2M_STRATEGY_CATALOG_ACTIVE_POINTER') || CATALOG_ROOT + '/active.json';
const INDEX_PATH = getenv('Z2M_STRATEGY_CATALOG_INDEX_PATH') || CATALOG_ROOT + '/strategy-catalog-index.json';
const INDEX_SCHEMA = 'z2m.strategy-read-index.v3';
const POINTER_SCHEMA = 'z2m.strategy-active-generation.v1';
const SOURCE_IDS = ['avatar', 'z2k'];
const SOURCE_REPOSITORIES = { avatar: 'avatarDD/zapret-gui', z2k: 'necronicle/z2k' };
const OFFICIAL_Z2K_SOURCE_PATH = 'official:generate_nfqws2_opt_from_strategies';
const MAX_BYTES = 16 * 1024 * 1024;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function error(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}
function sha256(value) {
	if (!string(value)) return null;
	let file = '/tmp/z2m-strategy-generation-digest-' + time() + '-' + length(value);
	try { writefile(file, value); } catch (e) { return null; }
	let process = null, output = '', rc = -1;
	try { process = popen("sha256sum " + shell_quote(file) + " 2>/dev/null | awk '{print $1}'", 'r'); }
	catch (e) { process = null; }
	if (process) { output = trim(process.read('all') || ''); rc = process.close(); }
	try { unlink(file); } catch (e) { }
	return rc == 0 && match(output, /^[0-9a-f]{64}$/) ? output : null;
}
function command(command) {
	let process = null;
	try { process = popen(command, 'r'); } catch (e) { return { ok: false, output: '', rc: -1 }; }
	if (!process) return { ok: false, output: '', rc: -1 };
	let output = process.read('all') || '', rc = process.close();
	return { ok: rc == 0, output: output, rc: rc };
}
function directory(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return false; }
	return metadata != null && metadata.type == 'directory' && readlink(path) == null;
}
function ensure_layout() {
	if (!directory(CATALOG_ROOT)) try { mkdir(CATALOG_ROOT); } catch (e) { }
	if (!directory(GENERATIONS_ROOT)) try { mkdir(GENERATIONS_ROOT); } catch (e) { }
	return directory(CATALOG_ROOT) && directory(GENERATIONS_ROOT);
}
function atomic_write(path, content) {
	if (!directory(substr(path, 0, rindex(path, '/')))) return false;
	let temporary = path + '.tmp.' + time();
	try { writefile(temporary, content); } catch (e) { return false; }
	let moved = command('mv -f ' + shell_quote(temporary) + ' ' + shell_quote(path) + ' 2>/dev/null');
	if (!moved.ok) try { unlink(temporary); } catch (ignored) { }
	return moved.ok;
}
function read_raw(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (metadata == null) return { ok: true, missing: true, raw: null };
	if (metadata.type != 'file' || readlink(path) != null || type(metadata.size) != 'int' || metadata.size > MAX_BYTES)
		return error('ESTALE', 'Generation file is not a bounded regular file');
	let raw = null;
	try { raw = readfile(path); } catch (e) { return error('ESTALE', 'Generation file could not be read'); }
	return { ok: true, missing: false, raw: raw };
}
function read_json(path) {
	let raw = read_raw(path);
	if (!raw.ok || raw.missing) return raw;
	try { return { ok: true, missing: false, value: json(raw.raw), raw: raw.raw }; }
	catch (e) { return error('ESTALE', 'Generation file is not valid JSON'); }
}
function safe_id(value) {
	return string(value) && length(value) >= 3 && length(value) <= 160
		&& match(value, /^[A-Za-z0-9][A-Za-z0-9._-]*$/) && value != '.' && value != '..';
}
function valid_digest(value) { return string(value) && match(value, /^[0-9a-f]{64}$/); }
function valid_commit(value) { return string(value) && match(value, /^[0-9a-f]{7,40}$/); }
function contains(value, needle) {
	if (type(value) != 'array') return false;
	for (let item in value) if (item == needle) return true;
	return false;
}
function valid_z2k_snapshot(snapshot) {
	if (!object(snapshot) || type(snapshot.sourceFiles) != 'array'
		|| !contains(snapshot.sourceFiles, 'strats_new2.txt') || !contains(snapshot.sourceFiles, 'quic_strats.ini')
		|| !object(snapshot.allInOne) || snapshot.allInOne.canonicalId != 'z2k:z2k_all_in_one'
		|| !valid_digest(snapshot.allInOne.digest) || type(snapshot.allInOne.profileCount) != 'int'
		|| snapshot.allInOne.profileCount < 1 || type(snapshot.entries) != 'array') return false;
	if (snapshot.sourcePath == OFFICIAL_Z2K_SOURCE_PATH) {
		if (!valid_digest(snapshot.compilerSnapshotDigest) || !valid_digest(snapshot.nfqws2OptSha256)
			|| snapshot.compilerSchema != 'z2m.z2k-official-compiler-snapshot.v1'
			|| type(snapshot.fileSha256) != 'object' || type(snapshot.sourceFiles) != 'array'
			|| length(snapshot.sourceFiles) != 5) return false;
		for (let relative in ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh'])
			if (!contains(snapshot.sourceFiles, relative) || !valid_digest(snapshot.fileSha256[relative])) return false;
	}
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
function valid_source_snapshot(id, snapshot) {
	return object(snapshot) && snapshot.schema == 'z2m.strategy-source-snapshot.v1'
		&& snapshot.sourceId == id && snapshot.repository == SOURCE_REPOSITORIES[id]
		&& safe_id(snapshot.snapshotId) && valid_commit(snapshot.sourceCommit)
		&& valid_digest(snapshot.contentDigest) && integer(snapshot.entryCount)
		&& integer(snapshot.normalizedEntryCount) && snapshot.immutable == true
		&& snapshot.published != false && type(snapshot.entries) == 'array'
		&& (id != 'z2k' || valid_z2k_snapshot(snapshot));
}
function valid_entry(entry, sourceId, snapshotId) {
	return object(entry) && string(entry.canonicalId) && length(entry.canonicalId) > 0
		&& entry.sourceId == sourceId && string(entry.upstreamId) && entry.sourceSnapshotId == snapshotId
		&& valid_commit(entry.sourceCommit) && type(entry.profiles) == 'array'
		&& object(entry.provenance) && entry.provenance.sourceId == sourceId;
}
function entry_problem(entry, sourceId, snapshotId) {
	if (!object(entry)) return 'entry is not an object';
	if (!string(entry.canonicalId) || length(entry.canonicalId) == 0) return 'canonicalId';
	if (entry.sourceId != sourceId) return 'sourceId';
	if (!string(entry.upstreamId)) return 'upstreamId';
	if (entry.sourceSnapshotId != snapshotId) return 'sourceSnapshotId';
	if (!valid_commit(entry.sourceCommit)) return 'sourceCommit';
	if (type(entry.profiles) != 'array') return 'profiles';
	if (!object(entry.provenance) || entry.provenance.sourceId != sourceId) return 'provenance';
	return null;
}
function source_input(input, id) {
	if (!object(input.sources)) return null;
	return input.sources[id] || null;
}
function append_source(index, seen, input, id) {
	let row = source_input(input, id);
	if (!object(row) || row.enabled != true) return { ok: true };
	let snapshot = row.snapshot;
	if (object(snapshot) && snapshot.published == false) return { ok: true };
	if (!valid_source_snapshot(id, snapshot)) return error('ESTALE', 'Enabled source has no published immutable snapshot', id);
	if (row.currentSnapshotId != snapshot.snapshotId)
		return error('ESTALE', 'Source snapshot does not match its activation authority', id);
	index.sources[id] = {
		sourceId: id, repository: snapshot.repository, snapshotId: snapshot.snapshotId,
		sourceCommit: snapshot.sourceCommit, contentDigest: snapshot.contentDigest,
		entryCount: snapshot.entryCount, normalizedEntryCount: snapshot.normalizedEntryCount
	};
	for (let entry in snapshot.entries) {
		let problem = entry_problem(entry, id, snapshot.snapshotId);
		if (problem != null) return error('EVERIFY', 'Source entry provenance is invalid: ' + problem, id);
		if (seen[entry.canonicalId]) return error('EDUPLICATE', 'Canonical Strategy ID is duplicated', entry.canonicalId);
		seen[entry.canonicalId] = true;
		push(index.entries, copy(entry));
	}
	return { ok: true };
}
function append_users(index, seen, input) {
	let users = input.userEntries == null ? [] : input.userEntries;
	if (type(users) != 'array') return error('EINPUT', 'userEntries must be an array');
	for (let entry in users) {
		if (!object(entry) || !string(entry.canonicalId) || entry.sourceId != 'user'
			|| !string(entry.upstreamId) || type(entry.profiles) != 'array')
			return error('EVERIFY', 'User Strategy entry is not canonical');
		if (seen[entry.canonicalId]) return error('EDUPLICATE', 'Canonical Strategy ID is duplicated', entry.canonicalId);
		seen[entry.canonicalId] = true;
		push(index.entries, copy(entry));
	}
	return { ok: true };
}
function compare_entries(left, right) {
	return left.canonicalId == right.canonicalId ? 0 : (left.canonicalId < right.canonicalId ? -1 : 1);
}
function index_basis(index) {
	return { schema: index.schema, generatedAt: index.generatedAt, sources: index.sources,
		userRevision: index.userRevision, entries: index.entries };
}
function build(input) {
	if (!object(input)) return error('EINPUT', 'Generation input is required');
	let userRevision = input.userRevision == null ? 0 : input.userRevision;
	if (!integer(userRevision)) return error('EINPUT', 'userRevision must be a non-negative integer');
	let index = { schema: INDEX_SCHEMA, generatedAt: input.generatedAt == null ? time() : input.generatedAt,
		sources: {}, userRevision: userRevision, entries: [] };
	if (!integer(index.generatedAt)) return error('EINPUT', 'generatedAt must be a non-negative integer');
	let seen = {};
	for (let id in SOURCE_IDS) {
		let result = append_source(index, seen, input, id);
		if (!result.ok) return result;
	}
	let users = append_users(index, seen, input);
	if (!users.ok) return users;
	sort(index.entries, compare_entries);
	let indexDigest = sha256(sprintf('%J', index_basis(index)));
	if (!valid_digest(indexDigest)) return error('EGENERATE', 'Candidate index digest could not be computed');
	let generationId = 'generation-' + indexDigest;
	index.generationId = generationId;
	index.indexDigest = indexDigest;
	return { ok: true, candidate: { generationId: generationId, indexDigest: indexDigest, index: index } };
}
function restore(path, raw) {
	if (raw == null) {
		try { unlink(path); } catch (e) { }
		return true;
	}
	return atomic_write(path, raw);
}
function failure(code, message) { return error(code, message); }
function fail_phase(phase) {
	return getenv('Z2M_STRATEGY_GENERATION_FAIL_PHASE') == phase;
}

export const strategy_catalog_generation_build = function(input) { return build(input); };

export const strategy_catalog_generation_publish = function(input) {
	let built = build(input);
	if (!built.ok) return built;
	let candidate = built.candidate;
	if (!ensure_layout()) return failure('EWRITE', 'Generation storage is unavailable');
	let oldIndex = read_raw(INDEX_PATH), oldPointer = read_raw(ACTIVE_POINTER);
	if (!oldIndex.ok || !oldPointer.ok) return failure('ESTALE', 'Existing generation authority is unreadable');
	let generationPath = GENERATIONS_ROOT + '/' + candidate.generationId + '.json';
	let serialized = sprintf('%J', candidate.index);
	if (!atomic_write(generationPath, serialized)) return failure('EWRITE', 'Generation record could not be written');
	if (fail_phase('generation')) return failure('EWRITE', 'Injected generation publication failure');
	if (!atomic_write(INDEX_PATH, serialized)) {
		restore(INDEX_PATH, oldIndex.raw);
		return failure('EWRITE', 'Candidate index could not be published');
	}
	if (fail_phase('index')) {
		restore(INDEX_PATH, oldIndex.raw);
		return failure('EWRITE', 'Injected index publication failure');
	}
	let pointer = { schema: POINTER_SCHEMA, generationId: candidate.generationId, indexDigest: candidate.indexDigest };
	if (fail_phase('pointer')) {
		restore(INDEX_PATH, oldIndex.raw);
		restore(ACTIVE_POINTER, oldPointer.raw);
		return failure('EWRITE', 'Injected pointer publication failure');
	}
	if (!atomic_write(ACTIVE_POINTER, sprintf('%J', pointer))) {
		restore(INDEX_PATH, oldIndex.raw);
		restore(ACTIVE_POINTER, oldPointer.raw);
		return failure('EWRITE', 'Active generation pointer could not be published');
	}
	return { ok: true, generationId: candidate.generationId, indexDigest: candidate.indexDigest, index: candidate.index };
};

export const strategy_catalog_generation_read = function() {
	let pointer = read_json(ACTIVE_POINTER), index = read_json(INDEX_PATH);
	if (!pointer.ok || pointer.missing || !index.ok || index.missing)
		return failure('ESTALE', 'Active Strategy generation authority is unavailable');
	let p = pointer.value, i = index.value;
	if (!object(p) || p.schema != POINTER_SCHEMA || !safe_id(p.generationId) || !valid_digest(p.indexDigest)
		|| !object(i) || i.schema != INDEX_SCHEMA || i.generationId != p.generationId
		|| i.indexDigest != p.indexDigest || !integer(i.generatedAt) || !object(i.sources)
		|| !integer(i.userRevision) || type(i.entries) != 'array')
		return { ok: false, error: { code: 'ESTALE', message: 'Active Strategy generation pointer and index do not match',
			details: { pointerGenerationId: p && p.generationId || null, indexGenerationId: i && i.generationId || null,
				pointerIndexDigest: p && p.indexDigest || null, indexDigest: i && i.indexDigest || null } } };
	let digest = sha256(sprintf('%J', index_basis(i)));
	if (digest != i.indexDigest) return failure('ESTALE', 'Active Strategy generation index digest is invalid');
	let generation = read_json(GENERATIONS_ROOT + '/' + p.generationId + '.json');
	if (!generation.ok || generation.missing || !object(generation.value)
		|| generation.value.indexDigest != i.indexDigest)
		return failure('ESTALE', 'Active Strategy generation record is unavailable');
	return { ok: true, index: i, pointer: p };
};
