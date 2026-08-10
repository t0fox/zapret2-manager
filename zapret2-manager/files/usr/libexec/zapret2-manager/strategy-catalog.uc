'use strict';
// Immutable Avatar Strategy catalog reader. The manifest is the only source of
// file names and digests; raw files provide the parsed Strategy records.

import { readfile, readlink, stat, popen } from 'fs';
import { avatar_tokenize } from './strategy-model.uc';

const DEFAULT_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const PINNED_REPOSITORY = 'avatarDD/zapret-gui';
const PINNED_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const AGGREGATE_ALGORITHM = 'sha256(source-order lines "<file-sha256>  catalogs/<relative-path>\\n")';
const LEVELS = ['advanced', 'basic', 'builtin', 'direct'];
const PROTOCOLS = ['tcp', 'udp'];
const SETS = ['quick', 'standard', 'full'];
const LABELS = { recommended: 1, experimental: 1, game: 1, stable: 1, caution: 1, deprecated: 1 };

let loaded = null;
let loadedRoot = null;

function error_result(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}

function is_object(value) { return type(value) == 'object' && value != null; }
function starts(text, prefix) { return type(text) == 'string' && index(text, prefix) == 0; }
function ends(text, suffix) {
	return type(text) == 'string' && length(text) >= length(suffix)
		&& substr(text, length(text) - length(suffix), length(suffix)) == suffix;
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

function is_safe_root(root) {
	if (type(root) != 'string' || length(root) < 2 || substr(root, 0, 1) != '/') return false;
	if (index(root, chr(0)) >= 0 || index(root, '//') >= 0 || index(root, '/../') >= 0
		|| ends(root, '/..')) return false;
	return true;
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
	let manifestPath = root + '/manifest.json';
	let manifestStat = null;
	try { manifestStat = stat(manifestPath); } catch (e) { manifestStat = null; }
	if (!manifestStat || manifestStat.type != 'file' || manifestStat.size > MAX_FILE_BYTES)
		return error_result('EMANIFEST', 'manifest is missing or is not a bounded regular file', manifestPath);
	let manifestLink = null;
	try { manifestLink = readlink(manifestPath); } catch (e) { manifestLink = null; }
	if (manifestLink != null) return error_result('EPATH', 'manifest must not be a symlink', manifestPath);
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

function is_windivert(value) {
	let tokenized = avatar_tokenize(value);
	if (!tokenized.ok || length(tokenized.tokens) != 1) return false;
	return starts(tokenized.tokens[0].value, '--wf-');
}

function parse_file(content, file, level, protocol) {
	let entries = [];
	let current = null;
	let flush = function() {
		if (current == null) return;
		let filtered = [];
		for (let i = 0; i < length(current.rawArgs); i++)
			if (!is_windivert(current.rawArgs[i])) push(filtered, current.rawArgs[i]);
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
		if (path == null || !regular_file(path, file.byteSize))
			return error_result('EFILE', 'manifest-listed file is missing, non-regular, or oversized', file.path);
		let link = null;
		try { link = readlink(path); } catch (e) { link = null; }
		if (link != null) return error_result('EPATH', 'manifest-listed file must not be a symlink', file.path);
		let actual = sha256_file(path);
		if (actual == null || actual != file.sha256)
			return error_result('EDIGEST', 'catalog file digest mismatch', file.path);
		let raw = readfile(path);
		if (raw == null || length(raw) > MAX_FILE_BYTES)
			return error_result('ESIZE', 'catalog file content exceeds the parser bound', file.path);
		let level = split(file.path, '/')[0], filename = split(file.path, '/')[1];
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
	let occurrences = {}, duplicateGroupById = {}, duplicateGroups = [], duplicateGroup = 0;
	for (let i = 0; i < length(physicalEntries); i++) {
		let id = physicalEntries[i].id;
		if (occurrences[id] == null) occurrences[id] = [];
		push(occurrences[id], physicalEntries[i]);
	}
	for (let i = 0; i < length(physicalEntries); i++) {
		let entry = physicalEntries[i], id = entry.id;
		if (length(occurrences[id]) > 1 && duplicateGroupById[id] == null)
			duplicateGroupById[id] = ++duplicateGroup;
		entry.duplicateGroup = duplicateGroupById[id] == null ? 0 : duplicateGroupById[id];
	}
	for (let id in duplicateGroupById) {
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

function load_catalog(root) {
	let actualRoot = root == null ? DEFAULT_ROOT : root;
	let manifestResult = read_manifest(actualRoot);
	if (!manifestResult.ok) { loaded = null; loadedRoot = null; return manifestResult; }
	let result = build_catalog(actualRoot, manifestResult.manifest, manifestResult.manifestPath);
	if (!result.ok) { loaded = null; loadedRoot = null; return result; }
	loaded = result.catalog; loadedRoot = actualRoot;
	return result;
}

function ensure_loaded(root) {
	if (loaded != null && (root == null || root == loadedRoot)) return loaded;
	let result = load_catalog(root == null ? DEFAULT_ROOT : root);
	return result.ok ? loaded : null;
}

export const strategy_catalog_load = function(root) {
	return load_catalog(root);
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

export const strategy_catalog_status = function() {
	let catalog = ensure_loaded(null);
	if (catalog == null) return { ok: false, error: { code: 'ESTATE', message: 'Avatar catalog is unavailable' } };
	return { ok: true, digest: catalog.aggregateDigest, counts: {
		files: catalog.physicalFileCount, physicalEntries: catalog.physicalEntryCount,
		uniqueStrategies: catalog.uniqueStrategyIdCount, duplicateGroups: catalog.duplicateIdGroupCount
	}, source: catalog.manifestPath };
};

export const strategy_catalog_reload = function() {
	let root = loadedRoot == null ? DEFAULT_ROOT : loadedRoot;
	let result = strategy_catalog_load(root);
	if (!result.ok) return result;
	return strategy_catalog_status();
};
