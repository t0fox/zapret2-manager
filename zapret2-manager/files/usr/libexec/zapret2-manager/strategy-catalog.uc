'use strict';
// Immutable Avatar Strategy catalog reader. The manifest is the only source of
// file names and digests; raw files provide the parsed Strategy records.

import { readfile, readlink, stat, popen, writefile } from 'fs';
import { catalog_entry_to_strategy as normalize_catalog_entry } from './strategy-model.uc';

const PACKAGE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const ACTIVE_ROOT = '/etc/zapret2-manager/catalog/avatar';
const SECONDARY_FORGEJO_ROOT = '/usr/share/zapret2-manager/catalog/forgejo';
const DERIVED_CACHE_PREFIX = '/tmp/zapret2-manager/strategy-catalog.';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Current update source is Forgejo (see strategy-catalog-update.uc). The
// installed immutable snapshot is still checked as a legacy package baseline
// until a validated Forgejo transaction replaces it. catalog_update is the
// source_update transaction marker: stage -> validate -> atomic activate.
const LEGACY_SNAPSHOT_REPOSITORY = 'avatarDD/zapret-gui';
const LEGACY_SNAPSHOT_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const OFFICIAL_FORGEJO_REPOSITORY = 'https://git.zapret.moe/zapretdiscordyoutube/zapretgui';
const OFFICIAL_FORGEJO_COMMIT = '6824294ee53421cc9c3e2a361f4976783ff62307';
const CATALOG_UPDATE_TRANSACTION = 'stage-validate-atomic-activate';
const CATALOG_MODEL = 'avatar-curated-lossless-semantic-v1';
const AGGREGATE_ALGORITHM = 'sha256(source-order lines "<file-sha256>  catalogs/<relative-path>\\n")';
const LEVELS = ['advanced', 'basic', 'builtin', 'direct'];
const PROTOCOLS = ['tcp', 'udp'];
const SETS = ['quick', 'standard', 'full'];
const LABELS = { recommended: 1, experimental: 1, game: 1, stable: 1, caution: 1, deprecated: 1 };
const WINDIVERT_PREFIXES = ['--wf-tcp', '--wf-udp', '--wf-raw', '--wf-l3', '--wf-ip'];

let loaded = null;
let loadedRoot = null;

function default_root() {
	let configured = getenv('Z2M_STRATEGY_CATALOG_ROOT');
	if (configured) return configured;
	let info = null;
	try { info = stat(ACTIVE_ROOT); } catch (e) { info = null; }
	return info != null && info.type == 'directory' ? ACTIVE_ROOT : PACKAGE_ROOT;
}

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

function directory(path) {
	let metadata = null;
	try { metadata = stat(path); } catch (e) { return false; }
	return metadata != null && metadata.type == 'directory';
}

function symlink_target(path) {
	try { return readlink(path); } catch (e) { return null; }
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
	let official = is_object(manifest.source) && manifest.source.repository == OFFICIAL_FORGEJO_REPOSITORY
		&& manifest.source.commit == OFFICIAL_FORGEJO_COMMIT;
	let legacy = is_object(manifest.source) && manifest.source.repository == LEGACY_SNAPSHOT_REPOSITORY
		&& manifest.source.commit == LEGACY_SNAPSHOT_COMMIT;
	if (!official && !legacy)
		return error_result('EPROVENANCE', 'manifest provenance does not match the current Forgejo source or an explicit legacy fixture', manifestPath);
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

function canonical_args(value) {
	if (value == null || type(value) != 'string') return null;
	// Source lines are already parsed as nfqws2 arguments. Normalize only
	// record separators and edge whitespace here; do not split quoted values or
	// inline arguments in the fingerprint layer.
	let lines = split(value, '\n'), kept = [];
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (line != '') push(kept, line);
	}
	return join('\n', kept);
}

function semantic_fingerprint(canonical) {
	// The complete ordered token stream is the execution contract: it keeps
	// globals, --new boundaries, filters, targeting, ranges, payload, Lua,
	// blobs, and unknown future nfqws2 options. Metadata and display names are
	// intentionally outside the fingerprint.
	if (canonical == null || canonical == '') return null;
	// Do not fork a sha256sum process once per record on the router. The full
	// canonical token stream remains the collision-free grouping key; this
	// compact two-lane digest is only a stable wire identifier and suffix.
	let left = 5381, right = 2166136261 % 2147483647;
	for (let i = 0; i < length(canonical); i++) {
		let code = ord(substr(canonical, i, 1));
		left = (left * 33 + code) % 2147483647;
		right = (right * 16777619 + code) % 2147483647;
	}
	return 'v1-' + left + '-' + right;
}

function source_kind(entry) {
	if (is_object(entry.__source) && index(entry.__source.repository || '', 'git.zapret.moe') >= 0)
		return 'forgejo';
	let file = entry.sourceFile || '';
	if (starts(file, 'builtin/z2k_')) return 'z2k';
	return 'avatar-curated';
}

function copy_entry(entry) {
	let result = {};
	for (let key in entry) if (key != '__source') result[key] = entry[key];
	if (is_object(entry.metadata)) {
		result.metadata = {};
		for (let key in entry.metadata) result.metadata[key] = entry.metadata[key];
	}
	return result;
}

function canonical_ids(entries) {
	let result = [];
	for (let i = 0; i < length(entries); i++) push(result, entries[i].id);
	return result;
}

function canonical_sets(entries) {
	let sets = { tcp: {}, udp: {} };
	for (let protocol in PROTOCOLS) {
		let all = [], recommended = [], others = [];
		for (let i = 0; i < length(entries); i++) {
			let entry = entries[i];
			if (entry.protocol != protocol) continue;
			push(all, entry);
			if (entry.metadata.label == 'recommended') push(recommended, entry);
			else push(others, entry);
		}
		let quickEntries = slice(recommended, 0, 30);
		for (let i = 0; i < length(others) && length(quickEntries) < 30; i++) push(quickEntries, others[i]);
		let standardEntries = [];
		for (let i = 0; i < length(entries); i++) {
			let entry = entries[i];
			if (entry.protocol == protocol && (entry.level == 'basic' || entry.level == 'advanced'))
				push(standardEntries, entry);
		}
		sets[protocol] = {
			quick: canonical_ids(quickEntries),
			standard: canonical_ids(slice(standardEntries, 0, 80)),
			full: canonical_ids(all)
		};
	}
	return sets;
}

function build_canonical_projection(physicalEntries, source) {
	let groups = {}, groupOrder = [], sameIdFingerprints = {}, provenanceLinks = 0;
	for (let i = 0; i < length(physicalEntries); i++) {
		let physical = physicalEntries[i], canonical = canonical_args(physical.args);
		let fingerprint = semantic_fingerprint(canonical);
		if (canonical == null || fingerprint == null)
			return error_result('ESEMANTIC', 'catalog entry has no semantic fingerprint', physical.sourceFile);
		let group = groups[canonical];
		if (group == null) {
			group = { key: canonical, fingerprint: fingerprint, physical: physical, records: [] };
			groups[canonical] = group;
			push(groupOrder, canonical);
		}
		push(group.records, {
			source: is_object(physical.__source) ? physical.__source : source,
			sourceKind: source_kind(physical),
			id: physical.id,
			name: physical.metadata.name,
			level: physical.level,
			protocol: physical.protocol,
			sourceFile: physical.sourceFile,
			sourceOrdinal: physical.sourceOrdinal,
			semanticFingerprint: fingerprint
		});
		provenanceLinks++;
		if (sameIdFingerprints[physical.id] == null) sameIdFingerprints[physical.id] = {};
		sameIdFingerprints[physical.id][canonical] = true;
	}
	let usedIds = {}, winners = {}, winnerOrder = [], entries = [], exactDuplicates = 0;
	for (let i = 0; i < length(groupOrder); i++) {
		let key = groupOrder[i], group = groups[key], fingerprint = group.fingerprint, physical = group.physical;
		let id = physical.id;
		if (usedIds[id] != null && usedIds[id] != key)
			id += '--' + substr(fingerprint, 0, 12);
		while (usedIds[id] != null && usedIds[id] != key) id += '-x';
		usedIds[id] = key;
		let entry = copy_entry(physical);
		entry.id = id;
		entry.sourceId = physical.id;
		entry.semanticFingerprint = fingerprint;
		entry.semanticFingerprintEqual = length(group.records) > 1;
		entry.provenance = group.records;
		entry.provenanceCount = length(group.records);
		entry.canonical = true;
		if (length(group.records) > 1) exactDuplicates++;
		push(entries, entry);
		winners[id] = entry;
		push(winnerOrder, id);
	}
	let sameNameDifferent = 0;
	for (let id in sameIdFingerprints) if (length(keys(sameIdFingerprints[id])) > 1) sameNameDifferent++;
	return { ok: true, entries: entries, winners: winners, winnerOrder: winnerOrder,
		sets: canonical_sets(entries), semanticFingerprintCount: length(entries),
		semanticDuplicateGroupCount: exactDuplicates, provenanceLinkCount: provenanceLinks,
		sameIdDifferentSemanticCount: sameNameDifferent };
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
	let official = is_object(manifest.source) && manifest.source.repository == OFFICIAL_FORGEJO_REPOSITORY
		&& manifest.source.commit == OFFICIAL_FORGEJO_COMMIT;
	// Forgejo's four source files are the authoritative inventory. Its source
	// order is preserved and every file/hash/count is still verified, while the
	// legacy Avatar declaration fields (winner order and duplicate-group shape)
	// are not required to describe a different catalog representation.
	if (official) {
		if (manifest.physicalFileCount != length(files) || manifest.physicalEntryCount != length(physicalEntries)
			|| type(manifest.files) != 'array' || length(manifest.files) != length(files))
			return declaration_error('Forgejo manifest aggregate counts differ from recomputed catalog', 'manifest.json');
		for (let i = 0; i < length(files); i++)
			if (!same_file_evidence(manifest.files[i], files[i]))
				return declaration_error('Forgejo manifest file evidence differs from recomputed files', manifest.files[i].path);
		return null;
	}
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
	let canonical = null;
	// The two package roots are merged once below. Avoid computing three
	// semantic projections for the same physical records during first load.
	if (root == PACKAGE_ROOT || root == SECONDARY_FORGEJO_ROOT) {
		canonical = { entries: [], winners: {}, winnerOrder: [], sets: { tcp: {}, udp: {} },
			semanticFingerprintCount: 0, semanticDuplicateGroupCount: 0,
			provenanceLinkCount: 0, sameIdDifferentSemanticCount: 0 };
	} else {
		canonical = build_canonical_projection(physicalEntries,
			is_object(manifest.source) ? manifest.source : { repository: 'unknown', commit: null });
		if (!canonical.ok) return canonical;
	}
	return { ok: true, catalog: {
		schema: manifest.schema, source: manifest.source, aggregateDigest: manifest.aggregateDigest,
		aggregateDigestAlgorithm: manifest.aggregateDigestAlgorithm, physicalFileCount: length(files),
		physicalEntryCount: length(physicalEntries), uniqueStrategyIdCount: length(keys(winners)),
		duplicateIdGroupCount: length(duplicateGroups), levelEntryCounts: levelEntryCounts,
		protocolEntryCounts: protocolEntryCounts, featuredIds: featuredIds, files: files,
		physicalEntries: physicalEntries, duplicateGroups: duplicateGroups, winnerOrder: winnerOrder,
		winners: winners, sets: sets, tcp: sets.tcp, udp: sets.udp, manifestPath: manifestPath,
		canonicalEntries: canonical.entries, canonicalWinners: canonical.winners,
		canonicalWinnerOrder: canonical.winnerOrder, canonicalSets: canonical.sets,
		canonicalTcp: canonical.sets.tcp, canonicalUdp: canonical.sets.udp,
		semanticFingerprintCount: canonical.semanticFingerprintCount,
		semanticDuplicateGroupCount: canonical.semanticDuplicateGroupCount,
		provenanceLinkCount: canonical.provenanceLinkCount,
		sameIdDifferentSemanticCount: canonical.sameIdDifferentSemanticCount
	} };
}

function derived_cache_path(root, digest) {
	return (root == PACKAGE_ROOT || root == ACTIVE_ROOT) && match(digest || '', /^[0-9a-f]{64}$/)
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
		|| record.aggregateDigest != digest || record.model != CATALOG_MODEL
		|| !is_object(record.catalog)
		|| !is_object(record.catalog.canonicalWinners)) return null;
	return record.catalog;
}

function persist_derived_catalog(root, catalog) {
	if (!is_object(catalog)) return;
	let path = derived_cache_path(root, catalog.aggregateDigest);
	if (path == null) return;
	try {
		// The cache is disposable and digest-keyed. A partial write is treated
		// as a cache miss; the canonical manifest/raw files remain authoritative.
		writefile(path, sprintf('%J', { schema: 1, model: CATALOG_MODEL, root: root,
			aggregateDigest: catalog.aggregateDigest, catalog: catalog }));
	} catch (e) { }
}

function merge_verified_secondary_source(result, root) {
	if (!result.ok || root != PACKAGE_ROOT) return result;
	let secondaryManifest = read_manifest(SECONDARY_FORGEJO_ROOT);
	if (!secondaryManifest.ok) return error_result('EPROVENANCE',
		'complete catalog requires the verified Forgejo secondary source', SECONDARY_FORGEJO_ROOT);
	let secondary = build_catalog(SECONDARY_FORGEJO_ROOT, secondaryManifest.manifest,
		secondaryManifest.manifestPath);
	if (!secondary.ok) return secondary;
	let combined = copy_array(result.catalog.physicalEntries);
	for (let i = 0; i < length(secondary.catalog.physicalEntries); i++) {
		let external = copy_entry(secondary.catalog.physicalEntries[i]);
		external.__source = secondary.catalog.source;
		push(combined, external);
	}
	let canonical = build_canonical_projection(combined, result.catalog.source);
	if (!canonical.ok) return canonical;
	result.catalog.canonicalEntries = canonical.entries;
	result.catalog.canonicalWinners = canonical.winners;
	result.catalog.canonicalWinnerOrder = canonical.winnerOrder;
	result.catalog.canonicalSets = canonical.sets;
	result.catalog.canonicalTcp = canonical.sets.tcp;
	result.catalog.canonicalUdp = canonical.sets.udp;
	result.catalog.semanticFingerprintCount = canonical.semanticFingerprintCount;
	result.catalog.semanticDuplicateGroupCount = canonical.semanticDuplicateGroupCount;
	result.catalog.provenanceLinkCount = canonical.provenanceLinkCount;
	result.catalog.sameIdDifferentSemanticCount = canonical.sameIdDifferentSemanticCount;
	result.catalog.sourceCatalogCount = 2;
	result.catalog.sourcePhysicalEntryCount = length(combined);
	result.catalog.sourcePhysicalEntryCounts = {
		avatar: result.catalog.physicalEntryCount,
		forgejo: secondary.catalog.physicalEntryCount
	};
	return result;
}

function load_catalog(root, bypassCache) {
	let actualRoot = root == null ? default_root() : root;
	let manifestResult = read_manifest(actualRoot);
	if (!manifestResult.ok) { loaded = null; loadedRoot = null; return manifestResult; }
	if (bypassCache != true) {
		let cached = cached_catalog(actualRoot, manifestResult);
		if (cached != null) { loaded = cached; loadedRoot = actualRoot; return { ok: true, catalog: cached }; }
	}
	let result = build_catalog(actualRoot, manifestResult.manifest, manifestResult.manifestPath);
	if (!result.ok) { loaded = null; loadedRoot = null; return result; }
	result = merge_verified_secondary_source(result, actualRoot);
	if (!result.ok) { loaded = null; loadedRoot = null; return result; }
	loaded = result.catalog; loadedRoot = actualRoot;
	persist_derived_catalog(actualRoot, loaded);
	return result;
}

function ensure_loaded(root) {
	if (loaded != null && (root == null || root == loadedRoot)) return loaded;
	let result = load_catalog(root == null ? default_root() : root);
	return result.ok ? loaded : null;
}

export const strategy_catalog_load = function(root) {
	// Keep one verified catalog snapshot for the lifetime of the caller.
	// strategies_list invokes this reader and then validates the persisted
	// selection through strategy-state.uc.  Rebuilding the 2.7 MB manifest for
	// both calls made one RPC take ~30 seconds on the target and exceed ubus's
	// timeout.  Explicit reload remains the only path that forces a rebuild.
	if (loaded != null && (root == null || root == loadedRoot))
		return { ok: true, catalog: loaded };
	return load_catalog(root);
};

export const strategy_catalog_list = function(protocol, set) {
	let catalog = ensure_loaded(null);
	if (catalog == null || index(PROTOCOLS, protocol) < 0 || index(SETS, set) < 0) return [];
	let result = [];
	for (let i = 0; i < length(catalog.canonicalSets[protocol][set]); i++)
		push(result, catalog.canonicalWinners[catalog.canonicalSets[protocol][set][i]]);
	return result;
};

export const strategy_catalog_get = function(id) {
	let catalog = ensure_loaded(null);
	if (catalog == null || type(id) != 'string' || catalog.canonicalWinners[id] == null)
		return { error: { code: 'ENOENT', message: 'strategy is not present in the catalog' } };
	return catalog.canonicalWinners[id];
};

export const strategy_catalog_status = function() {
	let catalog = ensure_loaded(null);
	if (catalog == null) return { ok: false, error: { code: 'ESTATE', message: 'Strategy catalog is unavailable' } };
	return { ok: true, digest: catalog.aggregateDigest, counts: {
		files: catalog.physicalFileCount, physicalEntries: catalog.physicalEntryCount,
		uniqueStrategies: catalog.uniqueStrategyIdCount, duplicateGroups: catalog.duplicateIdGroupCount
	}, semantic: {
		canonicalStrategies: catalog.semanticFingerprintCount,
		semanticDuplicateGroups: catalog.semanticDuplicateGroupCount,
		provenanceLinks: catalog.provenanceLinkCount,
		sameIdDifferentSemantics: catalog.sameIdDifferentSemanticCount
	}, sources: {
		catalogs: catalog.sourceCatalogCount || 1,
		physicalEntries: catalog.sourcePhysicalEntryCount || catalog.physicalEntryCount,
		physicalEntryCounts: catalog.sourcePhysicalEntryCounts || { avatar: catalog.physicalEntryCount }
	}, source: catalog.manifestPath, sourceModel: 'avatar-curated-lossless-semantic-v1' };
};

export const strategy_catalog_reload = function() {
	let root = loadedRoot == null ? default_root() : loadedRoot;
	let result = load_catalog(root, true);
	if (!result.ok) return result;
	return strategy_catalog_status();
};

export const catalog_entry_to_strategy = function(entry, fastProjection) {
	return normalize_catalog_entry(entry, fastProjection);
};
