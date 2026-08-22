'use strict';
// Immutable Avatar Strategy catalog reader. The manifest is the only source of
// file names and digests; raw files provide the parsed Strategy records. The
// read-only RPC path can use the manifest's already-materialized index, while
// full catalog loads still verify every raw file and declaration.

import { readfile, readlink, stat, popen, writefile } from 'fs';
import { avatar_tokenize, catalog_entry_to_strategy as normalize_catalog_entry } from './strategy-model.uc';

const DEFAULT_ROOT = getenv('Z2M_STRATEGY_CATALOG_PACKAGE_ROOT') || '/usr/share/zapret2-manager/catalog/avatar';
const MANAGED_ROOT = getenv('Z2M_STRATEGY_CATALOG_MANAGED_ROOT') || '/etc/zapret2-manager/catalog/avatar-active';
const MANAGED_PREVIOUS_ROOT = MANAGED_ROOT + '.previous';
const MANAGED_PREVIOUS_NEW_ROOT = MANAGED_ROOT + '.previous.new';
const READ_INDEX_PATH = getenv('Z2M_STRATEGY_CATALOG_INDEX_PATH') || '/etc/zapret2-manager/strategy-catalog-index.json';
const ACTIVE_POINTER_PATH = getenv('Z2M_STRATEGY_CATALOG_ACTIVE_POINTER') || '/etc/zapret2-manager/catalog/active.json';
const DERIVED_CACHE_PREFIX = '/tmp/zapret2-manager/strategy-catalog.';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const PINNED_REPOSITORY = 'avatarDD/zapret-gui';
const PINNED_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const AGGREGATE_ALGORITHM = 'sha256(source-order lines "<file-sha256>  catalogs/<relative-path>\\n")';
const LEVELS = ['advanced', 'basic', 'builtin', 'direct'];
const PROTOCOLS = ['tcp', 'udp'];
const SETS = ['quick', 'standard', 'full'];
const LABELS = { recommended: 1, experimental: 1, game: 1, stable: 1, caution: 1, deprecated: 1 };
const WINDIVERT_PREFIXES = ['--wf-tcp', '--wf-udp', '--wf-raw', '--wf-l3', '--wf-ip'];

let loaded = null;
let loadedRoot = null;
let activeResolution = null;

function is_object(value) { return type(value) == 'object' && value != null; }
function starts(text, prefix) { return type(text) == 'string' && index(text, prefix) == 0; }
function ends(text, suffix) {
	return type(text) == 'string' && length(text) >= length(suffix)
		&& substr(text, length(text) - length(suffix), length(suffix)) == suffix;
}
function symlink_target(path) { try { return readlink(path); } catch (e) { return null; } }
function is_safe_root(root) {
	if (type(root) != 'string' || length(root) < 2 || substr(root, 0, 1) != '/') return false;
	if (index(root, chr(0)) >= 0 || index(root, '//') >= 0 || index(root, '/../') >= 0
		|| ends(root, '/..')) return false;
	return true;
}

function error_result(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}

function read_active_pointer() {
	let metadata = null;
	try { metadata = stat(ACTIVE_POINTER_PATH); } catch (e) { return null; }
	if (!metadata || metadata.type != 'file' || metadata.size > MAX_FILE_BYTES
		|| symlink_target(ACTIVE_POINTER_PATH) != null) return null;
	let pointer = null;
	try { pointer = json(readfile(ACTIVE_POINTER_PATH)); } catch (e) { return null; }
	if (!is_object(pointer) || pointer.schema != 'z2m.strategy-active.v1'
		|| !is_safe_root(pointer.root) || (pointer.kind != 'package' && pointer.kind != 'managed')
		|| pointer.verified != true || type(pointer.sourceCommit) != 'string'
		|| !match(pointer.aggregateDigest || '', /^[0-9a-f]{64}$/)) return null;
	return pointer;
}

function configured_root() { return getenv('Z2M_STRATEGY_CATALOG_ROOT') || null; }
function catalog_root() {
	let pointer = read_active_pointer();
	if (pointer != null && pointer.root != null) return pointer.root;
	return configured_root() || DEFAULT_ROOT;
}

function source_commit(catalog) {
	return is_object(catalog) && is_object(catalog.source) ? catalog.source.commit : null;
}

function identity_matches(record, pointer, root) {
	if (!is_object(record) || record.schema != 'z2m.strategy-read-index.v2'
		|| record.root != root || !is_object(record.catalog)) return false;
	let catalog = record.catalog;
	if (pointer != null && (record.kind != pointer.kind || record.sourceCommit != pointer.sourceCommit
		|| record.aggregateDigest != pointer.aggregateDigest)) return false;
	return record.sourceRepository == (catalog.source && catalog.source.repository)
		&& record.sourceCommit == source_commit(catalog)
		&& record.aggregateDigest == catalog.aggregateDigest
		&& record.entryCount == catalog.physicalEntryCount
		&& type(record.generatedAt) == 'int';
}

function sort_strings(values) {
	for (let i = 1; i < length(values); i++) {
		let value = values[i];
		let j = i - 1;
		while (j >= 0 && values[j] > value) { values[j + 1] = values[j]; j--; }
		values[j + 1] = value;
	}
	return values;
}

function copy_array(values) {
	let result = [];
	for (let i = 0; i < length(values); i++) push(result, values[i]);
	return result;
}

function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let ch = substr(value, i, 1);
		if (ch == chr(39)) result += chr(39) + chr(92) + chr(39) + chr(92) + chr(39);
		else result += ch;
	}
	return result + chr(39);
}

function atomic_write(path, content) {
	let parent = path == ACTIVE_POINTER_PATH ? '/etc/zapret2-manager/catalog'
		: path == READ_INDEX_PATH ? '/etc/zapret2-manager' : null;
	if (parent != null) {
		let prep = null;
		try { prep = popen('mkdir ' + shell_quote(parent) + ' 2>/dev/null', 'r'); } catch (e) { prep = null; }
		if (!prep || prep.close() != 0) return false;
	}
	let temporary = path + '.tmp.' + time();
	try { writefile(temporary, content); } catch (e) { return false; }
	let move = null, rc = -1;
	try { move = popen('mv ' + shell_quote(temporary) + ' ' + shell_quote(path) + ' 2>/dev/null', 'r'); if (move) rc = move.close(); } catch (e) { rc = -1; }
	if (rc != 0) { try { popen('rm -f ' + shell_quote(temporary) + ' 2>/dev/null', 'r').close(); } catch (e) {} }
	return rc == 0;
}

function command_rc(command) {
	let process = null, rc = -1;
	try { process = popen(command + ' 2>/dev/null', 'r'); if (process) rc = process.close(); } catch (e) { rc = -1; }
	return rc;
}

function active_pointer_write(root, kind, catalog, fallbackUsed, verificationError) {
	if (!is_object(catalog) || !is_object(catalog.source)) return false;
	let payload = sprintf('%J', { schema: 'z2m.strategy-active.v1', root: root, kind: kind,
		sourceRepository: catalog.source.repository, sourceCommit: source_commit(catalog),
		aggregateDigest: catalog.aggregateDigest, verified: true, fallbackUsed: fallbackUsed == true,
		verificationError: verificationError || null, verifiedAt: time() });
	return atomic_write(ACTIVE_POINTER_PATH, payload);
}

function sha256_file(path) {
	let process = null;
	try { process = popen('sha256sum ' + shell_quote(path) + ' 2>/dev/null', 'r'); }
	catch (e) { return null; }
	if (!process) return null;
	let output = process.read('all') || '';
	let rc = process.close();
	let fields = split(trim(output), /[ \t]+/);
	return rc == 0 && length(fields) > 0 && match(fields[0], /^[0-9a-f]{64}$/) ? fields[0] : null;
}

function regular_file(path, expectedSize) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return false; }
	if (!metadata || metadata.type != 'file' || type(metadata.size) != 'int') return false;
	return metadata.size == expectedSize && metadata.size <= MAX_FILE_BYTES;
}

function directory(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return false; }
	return metadata != null && metadata.type == 'directory';
}

function has_symlink_component(path) {
	let prefix = '';
	for (let component in split(path, '/')) {
		if (component == '') continue;
		prefix += '/' + component;
		if (symlink_target(prefix) != null) return true;
	}
	return false;
}

function safe_relative_path(path) {
	return type(path) == 'string'
		&& match(path, /^(advanced|basic|builtin|direct)\/[A-Za-z0-9._-]+\.txt$/)
		&& index(path, '..') < 0;
}

function safe_file_path(root, relative) {
	if (!is_safe_root(root) || !safe_relative_path(relative)) return null;
	let path = root + '/' + relative;
	if (index(path, '//') >= 0 || index(path, '/../') >= 0 || ends(path, '/..')) return null;
	return path;
}

function read_manifest(root) {
	if (!is_safe_root(root)) return error_result('EPATH', 'catalog root must be an absolute bounded path', 'root');
	if (!directory(root) || has_symlink_component(root))
		return error_result('EPATH', 'catalog root must be a real directory', 'root');
	for (let level in LEVELS) {
		let levelPath = root + '/' + level;
		if (!directory(levelPath) || symlink_target(levelPath) != null)
			return error_result('EPATH', 'catalog level must be a real directory', levelPath);
	}
	let manifestPath = root + '/manifest.json';
	let manifestStat = null;
	try { manifestStat = stat(manifestPath); } catch (e) { manifestStat = null; }
	if (!manifestStat || manifestStat.type != 'file' || manifestStat.size > MAX_FILE_BYTES)
		return error_result('EMANIFEST', 'manifest is missing or is not a bounded regular file', manifestPath);
	if (symlink_target(manifestPath) != null) return error_result('EPATH', 'manifest must not be a symlink', manifestPath);
	let raw = readfile(manifestPath);
	if (raw == null) return error_result('EMANIFEST', 'manifest could not be read', manifestPath);
	let manifest = null;
	try { manifest = json(raw); } catch (e) { return error_result('EMANIFEST', 'manifest is not valid JSON', manifestPath); }
	if (!is_object(manifest) || manifest.schema != 1)
		return error_result('EMANIFEST', 'unsupported manifest schema', manifestPath);
	if (!is_object(manifest.source) || manifest.source.repository != PINNED_REPOSITORY
		|| manifest.source.commit != PINNED_COMMIT)
		return error_result('EPROVENANCE', 'manifest provenance does not match the pinned Avatar source', manifestPath);
	if (manifest.aggregateDigestAlgorithm != AGGREGATE_ALGORITHM
		|| type(manifest.aggregateDigest) != 'string'
		|| !match(manifest.aggregateDigest, /^[0-9a-f]{64}$/))
		return error_result('EDIGEST', 'manifest aggregate digest declaration is invalid', manifestPath);
	if (type(manifest.files) != 'array' || length(manifest.files) == 0)
		return error_result('EMANIFEST', 'manifest files must be a non-empty array', manifestPath);
	return { ok: true, manifest: manifest, manifestPath: manifestPath };
}

// The shipped manifest is generated from a successful full catalog validation
// and contains the exact winner entries and set membership needed by the
// read-only UI. Re-reading the 12 MB derived cache for every RPC needlessly
// blocks rpcd; keep full verification on strategy_catalog_load/reload and use
// this bounded index for list/recommendation/detail/status reads.
function manifest_read_index(manifestResult) {
	if (!is_object(manifestResult) || manifestResult.ok != true
		|| !is_object(manifestResult.manifest)) return null;
	let manifest = manifestResult.manifest;
	if (type(manifest.physicalEntries) != 'array'
		|| length(manifest.physicalEntries) != manifest.physicalEntryCount
		|| type(manifest.winnerOrder) != 'array'
		|| !is_object(manifest.sets) || !is_object(manifest.sets.tcp)
		|| !is_object(manifest.sets.udp)) return null;
	let winners = {}, winnerCount = 0;
	for (let entry in manifest.physicalEntries) {
		if (!is_object(entry) || type(entry.id) != 'string' || entry.id == '') return null;
		if (entry.winner == true) {
			if (winners[entry.id] != null) return null;
			winners[entry.id] = entry;
			winnerCount++;
		}
	}
	if (winnerCount != manifest.uniqueStrategyIdCount
		|| length(manifest.winnerOrder) != winnerCount) return null;
	for (let id in manifest.winnerOrder)
		if (type(id) != 'string' || winners[id] == null) return null;
	return { schema: manifest.schema, source: manifest.source,
		aggregateDigest: manifest.aggregateDigest,
		aggregateDigestAlgorithm: manifest.aggregateDigestAlgorithm,
		physicalFileCount: manifest.physicalFileCount,
		physicalEntryCount: manifest.physicalEntryCount,
		uniqueStrategyIdCount: manifest.uniqueStrategyIdCount,
		duplicateIdGroupCount: manifest.duplicateIdGroupCount,
		levelEntryCounts: manifest.levelEntryCounts,
		protocolEntryCounts: manifest.protocolEntryCounts,
		featuredIds: manifest.featuredIds, winnerOrder: manifest.winnerOrder,
		winners: winners, sets: manifest.sets, tcp: manifest.sets.tcp,
		udp: manifest.sets.udp, manifestPath: manifestResult.manifestPath };
}

function index_profile_identity(values, index) {
	for (let value in values) {
		if (starts(value, '--filter-tcp=')) {
			let ports = substr(value, length('--filter-tcp='));
			return { id: ports == '80' ? 'http' + (index + 1) : 'tcp' + (index + 1),
				name: ports == '80' ? 'HTTP (порт 80)' : 'TCP (порты ' + ports + ')' };
		}
		if (starts(value, '--filter-udp='))
			return { id: 'udp' + (index + 1), name: 'UDP (порты ' + substr(value, length('--filter-udp=')) + ')' };
		if (starts(value, '--filter-l3='))
			return { id: substr(value, length('--filter-l3=')) + '_' + (index + 1), name: substr(value, length('--filter-l3=')) };
	}
	return { id: 'profile' + (index + 1), name: 'Profile ' + (index + 1) };
}

function index_profiles(entry) {
	let sections = [], current = [];
	for (let line in split(entry.args == null ? '' : entry.args, '\n')) {
		let value = trim(line);
		if (value == '') continue;
		if (value == '--new') { if (length(current)) push(sections, current); current = []; }
		else push(current, value);
	}
	if (length(current)) push(sections, current);
	let result = [];
	for (let i = 0; i < length(sections); i++) {
		let identity = index_profile_identity(sections[i], i);
		push(result, { id: identity.id, name: identity.name, enabled: true });
	}
	return result;
}

function index_tokens(value) {
	let tokenized = avatar_tokenize(value), result = [];
	if (!tokenized.ok) return result;
	for (let token in tokenized.tokens) push(result, token.value);
	return result;
}

function index_full_preset(value) {
	for (let token in index_tokens(value))
		if (token == '--new' || starts(token, '--filter-tcp=') || starts(token, '--filter-udp=')
			|| starts(token, '--hostlist=') || starts(token, '--hostlist-domains=')
			|| starts(token, '--ipset=') || starts(token, '--ipset-exclude=')
			|| starts(token, '--blob=')) return true;
	return false;
}

function index_complexity(value) {
	let actions = 0, repeats = 0, multi = 0;
	for (let token in index_tokens(value)) {
		if (starts(token, '--lua-desync=')) actions++;
		if (token == '--new' || starts(token, '--lua-desync=send')) multi = 1;
		let repeatAt = index(token, 'repeats=');
		if (repeatAt >= 0) {
			let text = substr(token, repeatAt + 8), end = index(text, ':');
			if (end >= 0) text = substr(text, 0, end);
			let parsed = int(text);
			if (parsed > repeats) repeats = parsed;
		}
	}
	return [actions, repeats, multi];
}

function index_entry(entry) {
	if (!is_object(entry) || type(entry.id) != 'string' || type(entry.args) != 'string') return null;
	let metadata = is_object(entry.metadata) ? entry.metadata : {};
	let result = { indexEntry: true, args: entry.args, fullPreset: index_full_preset(entry.args),
		complexity: index_complexity(entry.args), profiles: index_profiles(entry) };
	for (let key in ['id', 'name', 'description', 'is_builtin', 'source', 'level',
		'label', 'author', 'protocol', 'featured', 'metadata', 'sourceFile',
		'sourceOrdinal', 'cacheKey', 'cacheOrdinal', 'duplicateGroup',
		'winner', 'effectiveOrdinal'])
		if (entry[key] != null) result[key] = entry[key];
	if (result.name == null) result.name = metadata.name == null ? entry.id : metadata.name;
	if (result.description == null) result.description = metadata.description == null ? '' : metadata.description;
	if (result.label == null) result.label = metadata.label == null ? '' : metadata.label;
	if (result.author == null) result.author = metadata.author == null ? '' : metadata.author;
	if (result.featured == null) result.featured = metadata.featured == true;
	if (result.is_builtin == null) result.is_builtin = true;
	if (result.source == null) result.source = 'catalog';
	if (result.protocol == null) result.protocol = entry.protocol == 'udp' ? 'udp' : 'tcp';
	if (result.level == null) result.level = '';
	if (result.metadata == null) result.metadata = metadata;
	if (result.winner == null) result.winner = entry.winner == true;
	if (result.effectiveOrdinal == null && entry.effectiveOrdinal != null)
		result.effectiveOrdinal = entry.effectiveOrdinal;
	if (result.sourceFile == null && entry.sourceFile != null) result.sourceFile = entry.sourceFile;
	if (result.sourceOrdinal == null && entry.sourceOrdinal != null) result.sourceOrdinal = entry.sourceOrdinal;
	if (result.cacheKey == null && entry.cacheKey != null) result.cacheKey = entry.cacheKey;
	if (result.cacheOrdinal == null && entry.cacheOrdinal != null) result.cacheOrdinal = entry.cacheOrdinal;
	if (result.duplicateGroup == null && entry.duplicateGroup != null) result.duplicateGroup = entry.duplicateGroup;
	for (let profile in result.profiles) {
		if (profile.protocol == null) profile.protocol = result.protocol;
	}
	return result;
}

function compact_catalog(catalog) {
	if (!is_object(catalog) || !is_object(catalog.winners)) return null;
	let winners = {};
	for (let key in catalog.winnerOrder || []) {
		if (catalog.winners[key] == null) return null;
		winners[key] = index_entry(catalog.winners[key]);
	}
	let result = {};
	for (let key in ['schema', 'source', 'aggregateDigest', 'aggregateDigestAlgorithm',
		'physicalFileCount', 'physicalEntryCount', 'uniqueStrategyIdCount',
		'duplicateIdGroupCount', 'levelEntryCounts', 'protocolEntryCounts',
		'featuredIds', 'winnerOrder', 'sets', 'tcp', 'udp', 'manifestPath'])
		if (catalog[key] != null) result[key] = catalog[key];
	result.winners = winners;
	return result;
}

function read_persisted_index(root) {
	let metadata = null;
	try { metadata = stat(READ_INDEX_PATH); } catch (e) { return null; }
	if (!metadata || metadata.type != 'file' || metadata.size > MAX_FILE_BYTES
		|| symlink_target(READ_INDEX_PATH) != null) return null;
	let raw = null, record = null;
	try { raw = readfile(READ_INDEX_PATH); record = raw == null ? null : json(raw); } catch (e) { return null; }
	let pointer = read_active_pointer();
	if (!identity_matches(record, pointer, root)) return null;
	let catalog = record.catalog;
	if (type(catalog.aggregateDigest) != 'string'
		|| !match(catalog.aggregateDigest, /^[0-9a-f]{64}$/)
		|| type(catalog.winnerOrder) != 'array' || !is_object(catalog.winners)
		|| !is_object(catalog.sets) || !is_object(catalog.sets.tcp)
		|| !is_object(catalog.sets.udp)) return null;
	for (let id in catalog.winnerOrder)
		if (type(id) != 'string' || !is_object(catalog.winners[id])) return null;
	return catalog;
}

function persist_read_index(catalog, root, kind) {
	if (!is_object(catalog) || catalog.manifestPath == null) return false;
	let compact = compact_catalog(catalog);
	if (compact == null) return false;
	let actualRoot = root || catalog_root();
	let record = { schema: 'z2m.strategy-read-index.v2', root: actualRoot,
		kind: kind || (actualRoot == MANAGED_ROOT ? 'managed' : 'package'),
		sourceRepository: catalog.source && catalog.source.repository,
		sourceCommit: source_commit(catalog), aggregateDigest: catalog.aggregateDigest,
		entryCount: catalog.physicalEntryCount, generatedAt: time(), catalog: compact };
	if (!identity_matches(record, null, actualRoot)) return false;
	return atomic_write(READ_INDEX_PATH, sprintf('%J', record));
}

function protocol_for(filename) {
	let lower = '';
	for (let i = 0; i < length(filename); i++) {
		let code = ord(substr(filename, i, 1));
		lower += (code >= 65 && code <= 90) ? chr(code + 32) : substr(filename, i, 1);
	}
	let keywords = [
		['udp', 'udp'], ['voice', 'udp'], ['discord', 'udp'], ['stun', 'udp'], ['quic', 'udp'],
		['tcp', 'tcp'], ['http80', 'tcp'], ['http', 'tcp'], ['tls', 'tcp']
	];
	for (let i = 0; i < length(keywords); i++) if (index(lower, keywords[i][0]) >= 0) return keywords[i][1];
	return 'tcp';
}

function lower_ascii(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += (code >= 65 && code <= 90) ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}

function is_windivert_line(value) {
	let lower = lower_ascii(value);
	for (let prefix in WINDIVERT_PREFIXES) if (starts(lower, prefix)) return true;
	return false;
}

function filter_windivert_line(value) {
	return { keep: !is_windivert_line(value), value: value };
}

function parse_file(content, file, level, protocol) {
	let entries = [];
	let current = null;
	let flush = function() {
		if (current == null) return;
		let filtered = [];
		for (let i = 0; i < length(current.rawArgs); i++) {
			let filteredLine = filter_windivert_line(current.rawArgs[i]);
			if (filteredLine.keep) push(filtered, filteredLine.value);
		}
		if (length(filtered) == 0) { current = null; return; }
		let args = trim(join('\n', filtered));
		if (args == '') { current = null; return; }
		push(entries, {
			id: current.id,
			metadata: {
				name: current.name == '' ? current.id : current.name,
				author: current.author,
				label: LABELS[current.label] ? current.label : '',
				description: current.description,
				blobs: current.blobs,
				featured: current.featured
			},
			rawArgs: join('\n', current.rawArgs), args: args,
			level: level, protocol: protocol, sourceFile: file
		});
		current = null;
	};

	let lines = split(content, '\n');
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (ends(line, '\r')) line = substr(line, 0, length(line) - 1);
		let stripped = trim(line);
		if (stripped == '' || starts(stripped, '#')) continue;
		if (starts(stripped, '[') && ends(stripped, ']')) {
			flush();
			current = { id: trim(substr(stripped, 1, length(stripped) - 2)), name: '', author: '',
				label: '', description: '', blobs: [], featured: false, rawArgs: [] };
			continue;
		}
		if (current == null) continue;
		if (starts(stripped, '--')) { push(current.rawArgs, stripped); continue; }
		let equals = index(stripped, '=');
		if (equals < 0) continue;
		let key = trim(substr(stripped, 0, equals));
		let value = trim(substr(stripped, equals + 1));
		let lowerKey = '';
		for (let j = 0; j < length(key); j++) {
			let code = ord(substr(key, j, 1));
			lowerKey += (code >= 65 && code <= 90) ? chr(code + 32) : substr(key, j, 1);
		}
		if (lowerKey == 'name') current.name = value;
		else if (lowerKey == 'author') current.author = value;
		else if (lowerKey == 'label') current.label = value;
		else if (lowerKey == 'description') current.description = value;
		else if (lowerKey == 'blobs') {
			current.blobs = [];
			for (let blob in split(value, ',')) if (trim(blob) != '') push(current.blobs, trim(blob));
		}
		else if (lowerKey == 'featured') {
			let flag = value;
			for (let j = 0; j < length(flag); j++) {
				let code = ord(substr(flag, j, 1));
				if (code >= 65 && code <= 90) flag = substr(flag, 0, j) + chr(code + 32) + substr(flag, j + 1);
			}
			current.featured = flag == '1' || flag == 'true' || flag == 'yes' || flag == 'on';
		}
	}
	flush();
	return entries;
}

function validate_manifest_file(file, seenPaths) {
	if (!is_object(file) || !safe_relative_path(file.path)) return 'manifest file path is invalid';
	if (seenPaths[file.path]) return 'duplicate manifest file path: ' + file.path;
	seenPaths[file.path] = true;
	if (type(file.level) != 'string') return 'manifest file level is invalid: ' + file.path;
	if (index(LEVELS, file.level) < 0 || file.level != split(file.path, '/')[0]) return 'manifest file level mismatch: ' + file.path;
	if (type(file.protocol) != 'string') return 'manifest file protocol is invalid: ' + file.path;
	if (index(PROTOCOLS, file.protocol) < 0 || file.protocol != protocol_for(split(file.path, '/')[1]))
		return 'manifest file protocol mismatch: ' + file.path;
	if (type(file.byteSize) != 'int' || file.byteSize <= 0 || file.byteSize > MAX_FILE_BYTES)
		return 'manifest file size is outside bounds: ' + file.path;
	if (type(file.sha256) != 'string' || !match(file.sha256, /^[0-9a-f]{64}$/))
		return 'manifest file digest is invalid: ' + file.path;
	if (type(file.physicalEntryCount) != 'int' || file.physicalEntryCount < 0
		|| type(file.sourceOrder) != 'array' || length(file.sourceOrder) != file.physicalEntryCount)
		return 'manifest file source order is invalid: ' + file.path;
	return null;
}

function verify_manifest_entries(manifest, entries) {
	if (type(manifest.physicalEntries) != 'array' || length(manifest.physicalEntries) != length(entries))
		return 'manifest physical entry inventory is missing or has the wrong length';
	let ordinals = {};
	for (let i = 0; i < length(manifest.physicalEntries); i++) {
		let expected = manifest.physicalEntries[i];
		if (!is_object(expected) || expected.sourceOrdinal != i + 1 || ordinals[expected.sourceOrdinal])
			return 'manifest physical source ordinals are not unique and contiguous';
		ordinals[expected.sourceOrdinal] = true;
		if (expected.id != entries[i].id) return 'manifest source order does not match raw catalog files';
	}
	return null;
}

function sha256_text(text) {
	let process = null;
	try { process = popen('printf %s ' + shell_quote(text) + ' | sha256sum 2>/dev/null', 'r'); }
	catch (e) { return null; }
	if (!process) return null;
	let output = process.read('all') || '', rc = process.close();
	let fields = split(trim(output), /[ \t]+/);
	return rc == 0 && length(fields) > 0 ? fields[0] : null;
}

function unique_entries(entries) {
	let result = [], seen = {};
	for (let i = 0; i < length(entries); i++) {
		if (seen[entries[i].id]) continue;
		seen[entries[i].id] = true;
		push(result, entries[i]);
	}
	return result;
}

function filter_label(entries, label) {
	let result = [];
	for (let i = 0; i < length(entries); i++) if (entries[i].metadata.label == label) push(result, entries[i]);
	return result;
}

function concat(first, second, third) {
	let result = [];
	for (let values in [first, second, third]) if (values != null)
		for (let i = 0; i < length(values); i++) push(result, values[i]);
	return result;
}

function ids(entries) {
	let result = [];
	for (let i = 0; i < length(entries); i++) push(result, entries[i].id);
	return result;
}

function same_value(left, right) {
	if (type(left) != type(right)) return false;
	if (left == null || right == null) return left == right;
	if (type(left) == 'array') {
		if (length(left) != length(right)) return false;
		for (let i = 0; i < length(left); i++) if (!same_value(left[i], right[i])) return false;
		return true;
	}
	if (type(left) == 'object') {
		let leftKeys = keys(left), rightKeys = keys(right);
		if (length(leftKeys) != length(rightKeys)) return false;
		for (let key in leftKeys)
			if (!exists(right, key) || !same_value(left[key], right[key])) return false;
		return true;
	}
	return left == right;
}

function same_file_evidence(expected, actual) {
	let fields = ['path', 'byteSize', 'sha256', 'level', 'protocol', 'physicalEntryCount', 'sourceOrder'];
	for (let field in fields) if (!same_value(expected[fields[field]], actual[fields[field]])) return false;
	return true;
}

function declaration_error(message, path) {
	return error_result('EDECLARATION', message, path);
}

function validate_declarations(manifest, files, physicalEntries, duplicateGroups,
	 winnerOrder, sets, winners, levelEntryCounts, protocolEntryCounts, featuredIds) {
	if (manifest.physicalFileCount != length(files) || manifest.physicalEntryCount != length(physicalEntries)
		|| manifest.uniqueStrategyIdCount != length(keys(winners))
		|| manifest.duplicateIdGroupCount != length(duplicateGroups))
		return declaration_error('manifest aggregate counts differ from recomputed catalog', 'manifest.json');
	if (!same_value(manifest.levelEntryCounts, levelEntryCounts)
		|| !same_value(manifest.protocolEntryCounts, protocolEntryCounts))
		return declaration_error('manifest level or protocol counts differ from recomputed catalog', 'manifest.json');
	if (!same_value(manifest.featuredIds, featuredIds))
		return declaration_error('manifest featured IDs differ from recomputed catalog', 'manifest.json');
	if (type(manifest.winnerOrder) != 'array' || !same_value(manifest.winnerOrder, winnerOrder))
		return declaration_error('manifest winner order differs from recomputed traversal', 'manifest.json');
	if (!is_object(manifest.sets) || !same_value(manifest.sets, sets))
		return declaration_error('manifest protocol sets differ from recomputed membership', 'manifest.json');
	if (type(manifest.duplicateGroups) != 'array' || !same_value(manifest.duplicateGroups, duplicateGroups))
		return declaration_error('manifest duplicate groups differ from recomputed groups', 'manifest.json');
	if (type(manifest.physicalEntries) != 'array' || !same_value(manifest.physicalEntries, physicalEntries))
		return declaration_error('manifest physical entries differ from recomputed entries', 'manifest.json');
	if (type(manifest.files) != 'array' || length(manifest.files) != length(files))
		return declaration_error('manifest file evidence length differs from recomputed files', 'manifest.json');
	for (let i = 0; i < length(files); i++)
		if (!same_file_evidence(manifest.files[i], files[i]))
			return declaration_error('manifest file evidence differs from recomputed files', manifest.files[i].path);
	return null;
}

function build_sets(byCacheKey) {
	let cacheKeys = sort_strings(keys(byCacheKey));
	let sets = { tcp: {}, udp: {} };
	for (let protocol in PROTOCOLS) {
		let all = [];
		for (let i = 0; i < length(cacheKeys); i++) {
			if (!ends(cacheKeys[i], '/' + protocol)) continue;
			for (let entry in byCacheKey[cacheKeys[i]]) push(all, entry);
		}
		let unique = unique_entries(all), recommended = [], others = [];
		for (let i = 0; i < length(unique); i++) {
			if (unique[i].metadata.label == 'recommended') push(recommended, unique[i]);
			else push(others, unique[i]);
		}
		let quickEntries = slice(recommended, 0, 30);
		for (let i = 0; i < length(others) && length(quickEntries) < 30; i++) push(quickEntries, others[i]);
		let basic = [], advanced = [];
		for (let i = 0; i < length(cacheKeys); i++) {
			if (cacheKeys[i] == 'basic/' + protocol) basic = byCacheKey[cacheKeys[i]];
			if (cacheKeys[i] == 'advanced/' + protocol) advanced = byCacheKey[cacheKeys[i]];
		}
		let standardEntries = unique_entries(concat(basic,
			filter_label(advanced, 'recommended'), advanced));
		standardEntries = slice(standardEntries, 0, 80);
		sets[protocol] = {
			quick: ids(quickEntries), standard: ids(standardEntries), full: ids(unique)
		};
	}
	return sets;
}

function build_catalog(root, manifest, manifestPath) {
	let seenPaths = {}, files = [], physicalEntries = [], aggregate = '';
	for (let i = 0; i < length(manifest.files); i++) {
		let validation = validate_manifest_file(manifest.files[i], seenPaths);
		if (validation != null) return error_result('EMANIFEST', validation, manifestPath);
	}
	if (length(manifest.files) != manifest.physicalFileCount)
		return error_result('EORDINAL', 'manifest file count does not match its inventory', manifestPath);
	let ordered = copy_array(manifest.files);
	for (let i = 1; i < length(ordered); i++) {
		let item = ordered[i], j = i - 1;
		while (j >= 0 && ordered[j].path > item.path) { ordered[j + 1] = ordered[j]; j--; }
		ordered[j + 1] = item;
	}
	for (let i = 0; i < length(ordered); i++) {
		let file = ordered[i];
		let path = safe_file_path(root, file.path);
		let link = null;
		try { link = readlink(path); } catch (e) { link = null; }
		if (path == null || link != null)
			return error_result('EPATH', 'manifest-listed file must be contained and must not be a symlink', file.path);
		if (!regular_file(path, file.byteSize))
			return error_result('EFILE', 'manifest-listed file is missing, non-regular, or oversized', file.path);
		let actual = sha256_file(path);
		if (actual == null || actual != file.sha256)
			return error_result('EDIGEST', 'catalog file digest mismatch', file.path);
		let raw = readfile(path);
		if (raw == null || length(raw) > MAX_FILE_BYTES)
			return error_result('ESIZE', 'catalog file content exceeds the parser bound', file.path);
		let level = split(file.path, '/')[0];
		let parsed = parse_file(raw, file.path, level, file.protocol);
		if (length(parsed) != file.physicalEntryCount)
			return error_result('EORDINAL', 'parsed entry count differs from manifest', file.path);
		for (let j = 0; j < length(parsed); j++) {
			if (parsed[j].id != file.sourceOrder[j])
				return error_result('EORDINAL', 'parsed source order differs from manifest', file.path);
			parsed[j].sourceOrdinal = length(physicalEntries) + 1;
			push(physicalEntries, parsed[j]);
		}
		push(files, { path: file.path, byteSize: file.byteSize, sha256: actual, level: level,
			protocol: file.protocol, physicalEntryCount: length(parsed), sourceOrder: ids(parsed) });
		aggregate += actual + '  catalogs/' + file.path + '\n';
	}
	if (sha256_text(aggregate) != manifest.aggregateDigest)
		return error_result('EDIGEST', 'catalog aggregate digest mismatch', manifestPath);
	if (length(physicalEntries) != manifest.physicalEntryCount)
		return error_result('EORDINAL', 'manifest physical entry count mismatch', manifestPath);
	let inventoryError = verify_manifest_entries(manifest, physicalEntries);
	if (inventoryError != null) return error_result('EORDINAL', inventoryError, manifestPath);
	let occurrences = {}, duplicateGroupById = {}, duplicateIds = [], duplicateGroups = [], duplicateGroup = 0;
	for (let i = 0; i < length(physicalEntries); i++) {
		let id = physicalEntries[i].id;
		if (occurrences[id] == null) occurrences[id] = [];
		push(occurrences[id], physicalEntries[i]);
	}
	for (let i = 0; i < length(physicalEntries); i++) {
		let entry = physicalEntries[i], id = entry.id;
		if (length(occurrences[id]) > 1 && duplicateGroupById[id] == null) {
			duplicateGroupById[id] = ++duplicateGroup;
			push(duplicateIds, id);
		}
		entry.duplicateGroup = duplicateGroupById[id] == null ? 0 : duplicateGroupById[id];
	}
	for (let id in duplicateIds) {
		let groupEntries = occurrences[id], occurrenceOrdinals = [];
		for (let i = 0; i < length(groupEntries); i++) push(occurrenceOrdinals, groupEntries[i].sourceOrdinal);
		push(duplicateGroups, { group: duplicateGroupById[id], id: id, occurrences: occurrenceOrdinals, winner: null });
	}
	let byCacheKey = {};
	for (let i = 0; i < length(physicalEntries); i++) {
		let entry = physicalEntries[i], cacheKey = entry.level + '/' + entry.protocol;
		entry.cacheKey = cacheKey;
		if (byCacheKey[cacheKey] == null) byCacheKey[cacheKey] = [];
		push(byCacheKey[cacheKey], entry);
	}
	let cacheKeys = sort_strings(keys(byCacheKey)), seen = {}, winners = {}, winnerOrder = [];
	let cacheOrdinal = 0, effectiveOrdinal = 0;
	for (let i = 0; i < length(cacheKeys); i++) for (let j = 0; j < length(byCacheKey[cacheKeys[i]]); j++) {
		let entry = byCacheKey[cacheKeys[i]][j];
		entry.cacheOrdinal = ++cacheOrdinal;
		if (seen[entry.id] == null) {
			seen[entry.id] = true; entry.winner = true; entry.effectiveOrdinal = ++effectiveOrdinal;
			winners[entry.id] = entry; push(winnerOrder, entry.id);
		} else { entry.winner = false; entry.effectiveOrdinal = null; }
	}
	for (let i = 0; i < length(duplicateGroups); i++) duplicateGroups[i].winner = winners[duplicateGroups[i].id].sourceOrdinal;
	let sets = build_sets(byCacheKey), featuredIds = [], featuredSeen = {};
	for (let i = 0; i < length(physicalEntries); i++) {
		if (physicalEntries[i].metadata.featured && featuredSeen[physicalEntries[i].id] == null) {
			featuredSeen[physicalEntries[i].id] = true; push(featuredIds, physicalEntries[i].id);
		}
	}
	let levelEntryCounts = {}, protocolEntryCounts = {};
	for (let i = 0; i < length(LEVELS); i++) levelEntryCounts[LEVELS[i]] = 0;
	for (let i = 0; i < length(PROTOCOLS); i++) protocolEntryCounts[PROTOCOLS[i]] = 0;
	for (let i = 0; i < length(physicalEntries); i++) {
		levelEntryCounts[physicalEntries[i].level]++;
		protocolEntryCounts[physicalEntries[i].protocol]++;
	}
	let declaration = validate_declarations(manifest, files, physicalEntries, duplicateGroups,
		winnerOrder, sets, winners, levelEntryCounts, protocolEntryCounts, featuredIds);
	if (declaration != null) return declaration;
	return { ok: true, catalog: {
		schema: manifest.schema, source: manifest.source, aggregateDigest: manifest.aggregateDigest,
		aggregateDigestAlgorithm: manifest.aggregateDigestAlgorithm, physicalFileCount: length(files),
		physicalEntryCount: length(physicalEntries), uniqueStrategyIdCount: length(keys(winners)),
		duplicateIdGroupCount: length(duplicateGroups), levelEntryCounts: levelEntryCounts,
		protocolEntryCounts: protocolEntryCounts, featuredIds: featuredIds, files: files,
		physicalEntries: physicalEntries, duplicateGroups: duplicateGroups, winnerOrder: winnerOrder,
		winners: winners, sets: sets, tcp: sets.tcp, udp: sets.udp, manifestPath: manifestPath
	} };
}

function verify_candidate(root) {
	let manifestResult = read_manifest(root);
	if (!manifestResult.ok) return manifestResult;
	return build_catalog(root, manifestResult.manifest, manifestResult.manifestPath);
}

function verification_error(result) {
	return is_object(result) && is_object(result.error) ? result.error
		: { code: 'EVERIFY', message: 'catalog verification failed' };
}

function resolution_from(kind, root, result, fallbackUsed, verificationError) {
	let catalog = result.catalog;
	return { ok: true, root: root, kind: kind, sourceCommit: source_commit(catalog),
		aggregateDigest: catalog.aggregateDigest, verified: true, fallbackUsed: fallbackUsed == true,
		verificationError: verificationError || null, catalog: catalog };
}

function persist_active_resolution(resolution) {
	if (!is_object(resolution) || !is_object(resolution.catalog)) return false;
	if (!persist_read_index(resolution.catalog, resolution.root, resolution.kind)) return false;
	return active_pointer_write(resolution.root, resolution.kind, resolution.catalog,
		resolution.fallbackUsed, resolution.verificationError);
}

function recover_interrupted_managed() {
	let managedMetadata = null, stagedMetadata = null;
	try { managedMetadata = stat(MANAGED_ROOT); } catch (e) { managedMetadata = null; }
	try { stagedMetadata = stat(MANAGED_PREVIOUS_NEW_ROOT); } catch (e) { stagedMetadata = null; }
	if (managedMetadata != null || !stagedMetadata || stagedMetadata.type != 'directory') return;
	let verified = verify_candidate(MANAGED_PREVIOUS_NEW_ROOT);
	if (verified.ok) command_rc('mv ' + shell_quote(MANAGED_PREVIOUS_NEW_ROOT) + ' ' + shell_quote(MANAGED_ROOT));
}

function full_resolve(packageRoot, managedRoot, persist) {
	recover_interrupted_managed();
	let managedResult = verify_candidate(managedRoot), packageResult = null;
	if (managedResult.ok) {
		let selected = resolution_from('managed', managedRoot, managedResult, false, null);
		if (persist == true && !persist_active_resolution(selected))
			return error_result('EWRITE', 'verified catalog identity could not be materialized');
		return selected;
	}
	packageResult = verify_candidate(packageRoot);
	if (packageResult.ok) {
		let selected = resolution_from('package', packageRoot, packageResult, true, verification_error(managedResult));
		if (persist == true && !persist_active_resolution(selected))
			return error_result('EWRITE', 'verified package catalog identity could not be materialized');
		return selected;
	}
	let failed = error_result('EVERIFY', 'no verified Strategy catalog is available');
	failed.error.managed = verification_error(managedResult);
	failed.error.package = verification_error(packageResult);
	return failed;
}

function fast_resolve(packageRoot, managedRoot) {
	let pointer = read_active_pointer();
	if (pointer == null || (pointer.root != packageRoot && pointer.root != managedRoot)) return null;
	let catalog = read_persisted_index(pointer.root);
	if (catalog == null || (pointer.aggregateDigest != catalog.aggregateDigest
		|| pointer.sourceCommit != source_commit(catalog))) return null;
	let kind = pointer.root == managedRoot ? 'managed' : 'package';
	return { ok: true, root: pointer.root, kind: kind, sourceCommit: source_commit(catalog),
		aggregateDigest: catalog.aggregateDigest, verified: pointer.verified == true,
		fallbackUsed: pointer.fallbackUsed == true,
		verificationError: pointer.verificationError || null, catalog: catalog };
}

export const strategy_catalog_resolve = function(options) {
	options = is_object(options) ? options : {};
	let packageRoot = options.packageRoot || DEFAULT_ROOT, managedRoot = options.managedRoot || MANAGED_ROOT;
	let explicit = options.root || configured_root();
	if (explicit != null) {
		// A single rpcd/ucode process serves many read requests.  Once an
		// explicit root has passed the full manifest/raw-file verification, reuse
		// that immutable resolution for ordinary reads; forced status/reload
		// paths still re-verify the complete catalog below.
		if (options.forceVerify != true && activeResolution != null
			&& activeResolution.root == explicit) return activeResolution;
		let result = verify_candidate(explicit);
		if (!result.ok) return result;
		let kind = explicit == managedRoot ? 'managed' : explicit == packageRoot ? 'package' : 'explicit';
		let selected = resolution_from(kind, explicit, result, false, null);
		activeResolution = selected;
		return selected;
	}
	if (options.forceVerify != true) {
		if (activeResolution != null && (activeResolution.root == managedRoot
			|| (activeResolution.root == packageRoot && !directory(managedRoot)))) return activeResolution;
		let fast = fast_resolve(packageRoot, managedRoot);
		// A cached package fallback is only reusable when no managed candidate
		// exists. If the managed root is present, it must be verified first so a
		// newly installed catalog cannot be hidden by a stale package pointer.
		if (fast != null && (fast.kind == 'managed' || !directory(managedRoot))) {
			activeResolution = fast; return fast;
		}
	}
	let resolved = full_resolve(packageRoot, managedRoot, options.persist != false);
	if (resolved.ok) activeResolution = resolved;
	return resolved;
};

function derived_cache_path(root, digest) {
	return root == catalog_root() && match(digest || '', /^[0-9a-f]{64}$/)
		? DERIVED_CACHE_PREFIX + digest + '.json' : null;
}

function cached_catalog(root, manifestResult) {
	if (!is_object(manifestResult) || !is_object(manifestResult.manifest)) return null;
	let digest = manifestResult.manifest.aggregateDigest;
	let path = derived_cache_path(root, digest);
	if (path == null) return null;
	let raw = null, record = null;
	try { raw = readfile(path); record = raw == null ? null : json(raw); } catch (e) { record = null; }
	if (!is_object(record) || record.schema != 1 || record.root != root
		|| record.aggregateDigest != digest || !is_object(record.catalog)) return null;
	return record.catalog;
}

function persist_derived_catalog(root, catalog) {
	if (!is_object(catalog)) return;
	let path = derived_cache_path(root, catalog.aggregateDigest);
	if (path == null) return;
	try {
		// The cache is disposable and digest-keyed. A partial write is treated
		// as a cache miss; the canonical manifest/raw files remain authoritative.
		writefile(path, sprintf('%J', { schema: 1, root: root,
			aggregateDigest: catalog.aggregateDigest, catalog: catalog }));
	} catch (e) { }
}

function load_catalog(root, bypassCache) {
	let actualRoot = root == null ? catalog_root() : root;
	let manifestResult = read_manifest(actualRoot);
	if (!manifestResult.ok) { loaded = null; loadedRoot = null; return manifestResult; }
	if (bypassCache != true) {
		let cached = cached_catalog(actualRoot, manifestResult);
		if (cached != null) { loaded = cached; loadedRoot = actualRoot; return { ok: true, catalog: cached }; }
	}
	let result = build_catalog(actualRoot, manifestResult.manifest, manifestResult.manifestPath);
	if (!result.ok) { loaded = null; loadedRoot = null; return result; }
	loaded = result.catalog; loadedRoot = actualRoot;
	persist_derived_catalog(actualRoot, loaded);
	return result;
}

function ensure_loaded(root) {
	if (loaded != null && (root == null || root == loadedRoot)) return loaded;
	let result = root == null ? strategy_catalog_load(null) : load_catalog(root);
	return result.ok ? loaded : null;
}

export const strategy_catalog_load = function(root) {
	if (root == null) {
		let resolved = strategy_catalog_resolve();
		if (!resolved.ok) { loaded = null; loadedRoot = null; return resolved; }
		loaded = resolved.catalog; loadedRoot = resolved.root;
		return { ok: true, catalog: loaded, resolution: {
			root: resolved.root, kind: resolved.kind, sourceCommit: resolved.sourceCommit,
			aggregateDigest: resolved.aggregateDigest, verified: resolved.verified,
			fallbackUsed: resolved.fallbackUsed, verificationError: resolved.verificationError
		} };
	}
	let actualRoot = root;
	if (loaded != null && loadedRoot == actualRoot)
		return { ok: true, catalog: loaded };
	return load_catalog(actualRoot, true);
};

export const strategy_catalog_read_index = function(root) {
	if (root == null) {
		let resolved = strategy_catalog_resolve();
		if (!resolved.ok) { loaded = null; loadedRoot = null; return resolved; }
		loaded = resolved.catalog; loadedRoot = resolved.root;
		return { ok: true, catalog: loaded, resolution: {
			root: resolved.root, kind: resolved.kind, sourceCommit: resolved.sourceCommit,
			aggregateDigest: resolved.aggregateDigest, verified: resolved.verified,
			fallbackUsed: resolved.fallbackUsed, verificationError: resolved.verificationError
		} };
	}
	let actualRoot = root;
	if (loaded != null && loadedRoot == actualRoot)
		return { ok: true, catalog: loaded };
	let persisted = read_persisted_index(actualRoot);
	if (persisted != null) {
		loaded = persisted; loadedRoot = actualRoot;
		return { ok: true, catalog: persisted };
	}
	let result = read_manifest(actualRoot);
	if (!result.ok) { loaded = null; loadedRoot = null; return result; }
	let catalog = manifest_read_index(result);
	if (catalog == null) {
		loaded = null; loadedRoot = null;
		return error_result('EDECLARATION', 'catalog manifest read index is incomplete', result.manifestPath);
	}
	loaded = catalog; loadedRoot = actualRoot;
	return { ok: true, catalog: catalog };
};

export const strategy_catalog_write_read_index = function(root) {
	let result = load_catalog(root == null ? catalog_root() : root, true);
	if (!result.ok) return result;
	let actualRoot = root == null ? catalog_root() : root;
	let kind = actualRoot == MANAGED_ROOT ? 'managed' : 'package';
	return { ok: true, digest: result.catalog.aggregateDigest,
		written: persist_read_index(result.catalog, actualRoot, kind) && active_pointer_write(actualRoot, kind, result.catalog) };
};

export const strategy_catalog_list = function(protocol, set) {
	let catalog = ensure_loaded(null);
	if (catalog == null || index(PROTOCOLS, protocol) < 0 || index(SETS, set) < 0) return [];
	let result = [];
	for (let i = 0; i < length(catalog.sets[protocol][set]); i++)
		push(result, catalog.winners[catalog.sets[protocol][set][i]]);
	return result;
};

export const strategy_catalog_get = function(id) {
	let catalog = ensure_loaded(null);
	if (catalog == null || type(id) != 'string' || catalog.winners[id] == null)
		return { error: { code: 'ENOENT', message: 'strategy is not present in the catalog' } };
	return catalog.winners[id];
};

export const strategy_catalog_get_detail = function(id) {
	let fast = strategy_catalog_read_index(null);
	if (!fast.ok || !is_object(fast.catalog) || fast.catalog.winners[id] == null)
		return { error: { code: 'ENOENT', message: 'strategy is not present in the catalog' } };
	// A full verified resolution already contains parsed physical entries.
	// Reuse that immutable data instead of reparsing the source file for every
	// detail request in a large catalog response. Compact index resolutions
	// continue through the bounded single-file fallback below.
	if (type(fast.catalog.physicalEntries) == 'array') {
		for (let entry in fast.catalog.physicalEntries)
			if (entry.id == id && entry.winner == true) return copy(entry);
	}
	let indexed = fast.catalog.winners[id], path = safe_file_path(loadedRoot || catalog_root(), indexed.sourceFile);
	if (path == null) return { error: { code: 'EPATH', message: 'strategy source path is unavailable' } };
	let raw = null, entries = [];
	try { raw = readfile(path); entries = raw == null ? [] : parse_file(raw, indexed.sourceFile, indexed.level, indexed.protocol); }
	catch (e) { entries = []; }
	for (let entry in entries) if (entry.id == id) {
		for (let key in ['sourceFile', 'sourceOrdinal', 'cacheKey', 'cacheOrdinal',
			'duplicateGroup', 'winner', 'effectiveOrdinal'])
			if (indexed[key] != null) entry[key] = indexed[key];
		return entry;
	}
	return { error: { code: 'ENOENT', message: 'strategy source entry is unavailable' } };
};

// Materialize only the bounded winner set selected by the Scanner planner.
// The compact index remains the selection authority; raw catalog files are
// parsed only for those selected ids and are never expanded into the planner's
// full working set on the Quick path.
export const strategy_catalog_materialize = function(ids, root) {
	let resolved = root == null ? strategy_catalog_resolve() : null;
	if (root == null && (!resolved || !resolved.ok)) return resolved || error_result('EVERIFY', 'verified catalog is unavailable');
	let actualRoot = root == null ? resolved.root : root;
	if (actualRoot != catalog_root() && getenv('Z2M_SCANNER_SERVER_TEST') != '1')
		return error_result('EPATH', 'catalog root override is available only in server tests', 'root');
	if (type(ids) != 'array' || length(ids) > 64)
		return error_result('EINPUT', 'catalog materialization ids are bounded', 'ids');
	let persisted = read_persisted_index(actualRoot), indexed = persisted || (resolved && resolved.catalog);
	if (indexed == null) {
		let manifestResult = read_manifest(actualRoot);
		if (!manifestResult.ok) return manifestResult;
		indexed = manifest_read_index(manifestResult);
		if (indexed == null) return error_result('EDECLARATION', 'catalog manifest read index is incomplete', manifestResult.manifestPath);
	}
	let materialized;
	try { materialized = json(sprintf('%J', indexed)); } catch (e) {
		return error_result('EINTERNAL', 'catalog read index could not be copied');
	}
	let parsed = {}, seen = {};
	for (let id in ids) {
		if (type(id) != 'string' || id == '' || seen[id])
			return error_result('EINPUT', 'catalog materialization ids must be unique strings', 'ids');
		seen[id] = true;
		let indexedEntry = indexed.winners[id];
		if (!is_object(indexedEntry) || type(indexedEntry.sourceFile) != 'string')
			return error_result('ENOENT', 'strategy is not present in the catalog', id);
		let relative = indexedEntry.sourceFile, path = safe_file_path(actualRoot, relative);
		if (path == null) return error_result('EPATH', 'strategy source path is unavailable', id);
		if (parsed[relative] == null) {
			let raw = null, entries = [];
			try { raw = readfile(path); entries = raw == null ? [] : parse_file(raw, relative, indexedEntry.level, indexedEntry.protocol); }
			catch (e) { entries = []; }
			parsed[relative] = entries;
		}
		let detail = null;
		for (let entry in parsed[relative]) if (entry.id == id) { detail = entry; break; }
		if (detail == null) return error_result('ENOENT', 'strategy source entry is unavailable', id);
		for (let key in ['sourceFile', 'sourceOrdinal', 'cacheKey', 'cacheOrdinal',
			'duplicateGroup', 'winner', 'effectiveOrdinal'])
			if (indexedEntry[key] != null) detail[key] = indexedEntry[key];
		materialized.winners[id] = detail;
	}
	loaded = materialized;
	loadedRoot = actualRoot;
	return { ok: true, catalog: materialized, materialized: length(ids), files: length(keys(parsed)) };
};

export const strategy_catalog_status = function() {
	let resolved = strategy_catalog_resolve();
	if (!resolved.ok) return resolved;
	let catalog = resolved.catalog;
	return { ok: true, digest: catalog.aggregateDigest, counts: {
		files: catalog.physicalFileCount, physicalEntries: catalog.physicalEntryCount,
		uniqueStrategies: catalog.uniqueStrategyIdCount, duplicateGroups: catalog.duplicateIdGroupCount
	}, source: catalog.manifestPath, resolution: {
		root: resolved.root, kind: resolved.kind, sourceCommit: resolved.sourceCommit,
		aggregateDigest: resolved.aggregateDigest, verified: resolved.verified,
		fallbackUsed: resolved.fallbackUsed, verificationError: resolved.verificationError
	} };
};

export const strategy_catalog_reload = function() {
	let result = strategy_catalog_resolve({ forceVerify: true });
	if (!result.ok) return result;
	loaded = result.catalog; loadedRoot = result.root;
	return strategy_catalog_status();
};

export const strategy_catalog_prepare_snapshot = function(root) {
	if (!is_safe_root(root)) return error_result('EPATH', 'staged catalog root is not a safe absolute path', 'root');
	let result = load_catalog(root, true);
	if (!result.ok) return result;
	let compact = compact_catalog(result.catalog);
	if (compact == null) return error_result('EINDEX', 'verified catalog index could not be built');
	let record = { schema: 'z2m.strategy-read-index.v2', root: root, kind: 'managed',
		sourceRepository: result.catalog.source && result.catalog.source.repository,
		sourceCommit: source_commit(result.catalog), aggregateDigest: result.catalog.aggregateDigest,
		entryCount: result.catalog.physicalEntryCount, generatedAt: time(), catalog: compact };
	if (!identity_matches(record, null, root)) return error_result('EINDEX', 'verified catalog index identity is inconsistent');
	return { ok: true, root: root, catalog: result.catalog, index: record };
};

function remove_exact(path) { return command_rc('rm -rf ' + shell_quote(path)) == 0; }
function restore_file(path, raw) {
	if (raw == null) return command_rc('rm -f ' + shell_quote(path)) == 0;
	return atomic_write(path, raw);
}

export const strategy_catalog_activate_snapshot = function(root, prepared) {
	if (!is_object(prepared) || prepared.ok != true || prepared.root != root || !is_object(prepared.catalog))
		return error_result('EINPUT', 'verified staged catalog preparation is required');
	let catalog = prepared.catalog, old = strategy_catalog_resolve();
	if (!old.ok) return old;
	let metadata = null;
	try { metadata = stat(root); } catch (e) { metadata = null; }
	if (!metadata || metadata.type != 'directory' || has_symlink_component(root))
		return error_result('EPATH', 'verified staged catalog root is unavailable', root);
	let oldIndex = null, oldPointer = null;
	try { oldIndex = readfile(READ_INDEX_PATH); } catch (e) { oldIndex = null; }
	try { oldPointer = readfile(ACTIVE_POINTER_PATH); } catch (e) { oldPointer = null; }
	let previousNew = MANAGED_PREVIOUS_NEW_ROOT, previous = MANAGED_PREVIOUS_ROOT;
	remove_exact(previousNew);
	let managedMetadata = null;
	try { managedMetadata = stat(MANAGED_ROOT); } catch (e) { managedMetadata = null; }
	let hadManaged = managedMetadata != null && managedMetadata.type == 'directory';
	if (command_rc('mkdir ' + shell_quote('/etc/zapret2-manager/catalog')) != 0)
		return error_result('EWRITE', 'managed catalog directory could not be prepared');
	if (hadManaged && command_rc('mv ' + shell_quote(MANAGED_ROOT) + ' ' + shell_quote(previousNew)) != 0)
		return error_result('EWRITE', 'current managed catalog could not be staged for replacement');
	if (command_rc('mv ' + shell_quote(root) + ' ' + shell_quote(MANAGED_ROOT)) != 0) {
		if (hadManaged) command_rc('mv ' + shell_quote(previousNew) + ' ' + shell_quote(MANAGED_ROOT));
		return error_result('EWRITE', 'verified staged catalog activation failed');
	}
	let activated = null;
	try { activated = json(sprintf('%J', catalog)); } catch (e) { activated = null; }
	if (!is_object(activated)) activated = catalog;
	activated.manifestPath = MANAGED_ROOT + '/manifest.json';
	let indexOk = persist_read_index(activated, MANAGED_ROOT, 'managed');
	let pointerOk = indexOk && active_pointer_write(MANAGED_ROOT, 'managed', activated, false, null);
	if (!pointerOk) {
		remove_exact(MANAGED_ROOT);
		if (hadManaged) command_rc('mv ' + shell_quote(previousNew) + ' ' + shell_quote(MANAGED_ROOT));
		restore_file(READ_INDEX_PATH, oldIndex); restore_file(ACTIVE_POINTER_PATH, oldPointer);
		return error_result('EWRITE', 'catalog identity activation failed; previous verified catalog restored');
	}
	if (hadManaged) {
		remove_exact(previous);
		command_rc('mv ' + shell_quote(previousNew) + ' ' + shell_quote(previous));
	}
	activeResolution = { ok: true, root: MANAGED_ROOT, kind: 'managed', sourceCommit: source_commit(activated),
		aggregateDigest: activated.aggregateDigest, verified: true, fallbackUsed: false,
		verificationError: null, catalog: compact_catalog(activated) };
	loaded = activeResolution.catalog; loadedRoot = MANAGED_ROOT;
	return { ok: true, resolution: activeResolution, previousRoot: hadManaged ? previous : old.root };
};

export const catalog_entry_to_strategy = function(entry) {
	return normalize_catalog_entry(entry);
};
