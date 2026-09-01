'use strict';

// Z2K Strategy source adapter. It understands the upstream strats_new2.txt
// line format and emits canonical Strategy records. It does not own Z2K Lua,
// blobs, lists, installation, or runtime activation.

import { popen, unlink, writefile } from 'fs';
import { z2m_tokenize } from './profiles.uc';

const SOURCE_ID = 'z2k';
const REPOSITORY = 'necronicle/z2k';
const SCHEMA = 'z2m.strategy-source-snapshot.v1';
const MAX_CONTENT = 4 * 1024 * 1024;
const STRATS_FILE = 'strats_new2.txt';
const QUIC_FILE = 'quic_strats.ini';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function starts(value, prefix) { return string(value) && length(value) >= length(prefix) && substr(value, 0, length(prefix)) == prefix; }
function error(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}
function trim_ws(value) { return trim(value == null ? '' : '' + value); }
function valid_commit(value) { return string(value) && match(value, /^[0-9a-f]{7,40}$/); }
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let ch = substr(value, i, 1);
		result += ch == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : ch;
	}
	return result + chr(39);
}
function digest(value) {
	let temp = '/tmp/z2m-strategy-source-digest-' + time() + '-' + length(value);
	let process = null;
	try {
		writefile(temp, value);
		process = popen("sha256sum " + shell_quote(temp) + " 2>/dev/null | awk '{print $1}'", 'r');
	} catch (e) {
		try { unlink(temp); } catch (ignored) { }
		return null;
	}
	if (!process) return null;
	let output = trim(process.read('all') || ''), rc = process.close();
	try { unlink(temp); } catch (ignored) { }
	let fields = split(output, /[ \t]+/);
	return rc == 0 && length(fields) > 0 && match(fields[0], /^[0-9a-f]{64}$/) ? fields[0] : null;
}
function tokens(value) {
	let result = z2m_tokenize(value);
	if (!object(result) || type(result.tokens) != 'array') return null;
	for (let diagnostic in result.diagnostics || [])
		if (diagnostic.severity == 'error') return null;
	let out = [];
	for (let token in result.tokens) push(out, token.value);
	return out;
}
function has(value, needle) { return string(value) && index(value, needle) >= 0; }
function source_path(metadata, fallback) { return metadata.sourcePath || fallback; }
function pool_key(id, args, explicit) {
	if (explicit != null && explicit != '') {
		if (explicit == 'discord_voice_autocircular') return 'discord_udp';
		if (explicit == 'yt_quic_autocircular') return 'yt_quic';
	}
	if (id == 'manual_autocircular_rkn') return 'rkn_tcp';
	if (id == 'manual_autocircular_yt') return 'yt_tcp';
	if (id == 'manual_autocircular_gv') return 'gv_tcp';
	let values = split(args || '', /[ \t]+/);
	for (let value in values) {
		if (!starts(value, '--lua-desync=circular')) continue;
		for (let field in split(value, ':')) {
			if (!starts(field, 'key=')) continue;
			let key = substr(field, 4);
			return key == 'discord_voice' ? 'discord_udp' : key;
		}
	}
	return null;
}
function adapt_args(args, poolKey) {
	if (poolKey != 'discord_udp' || !has(args, 'key=discord_voice')) return args;
	return join('key=discord_udp', split(args, 'key=discord_voice'));
}
function strategy_number(token) {
	if (!starts(token, '--lua-desync=')) return null;
	for (let field in split(token, ':')) {
		if (starts(field, 'strategy=') && match(substr(field, 9), /^[0-9]+$/)) return +substr(field, 9);
	}
	return null;
}
function strategy_tokens(args) {
	let values = tokens(args);
	if (values == null || length(values) == 0) return null;
	let common = [], numbered = {}, numbers = [];
	for (let token in values) {
		if (!starts(token, '--lua-desync=')) { push(common, token); continue; }
		let number = strategy_number(token);
		if (number == null || starts(token, '--lua-desync=circular')) {
			push(common, token);
			continue;
		}
		if (numbered[number] == null) numbered[number] = [];
		let known = false;
		for (let knownNumber in numbers) if (knownNumber == number) known = true;
		if (!known) push(numbers, number);
		push(numbered[number], token);
	}
	return { common: common, numbered: numbered, numbers: numbers };
}
function decorate_entry(entry, aggregateId, poolKey, kind, number, legacyKey) {
	entry.entryKind = kind;
	entry.poolKey = poolKey;
	entry.aggregateId = aggregateId;
	entry.origin = 'z2k_builtin';
	entry.is_builtin = false;
	if (number != null) {
		entry.strategyNumber = number;
		entry.strategySlot = true;
		entry.name = aggregateId + ' / strategy ' + number;
		entry.description = 'Z2K ' + poolKey + ' strategy ' + number;
	}
	if (legacyKey != null) entry.provenance.legacyRuntimeKey = legacyKey;
	return entry;
}
function profile_segments(args) {
	let values = tokens(args);
	if (values == null || length(values) == 0) return null;
	let segments = [], current = null;
	for (let value in values) {
		if (starts(value, '--new=')) {
			if (current != null && length(current.args) > 0) push(segments, current);
			current = { name: substr(value, 6), args: [] };
			if (current.name == '') return null;
			continue;
		}
		if (value == '--new') {
			if (current != null && length(current.args) > 0) push(segments, current);
			current = { name: null, args: [] };
			continue;
		}
		if (current == null) current = { name: null, args: [] };
		push(current.args, value);
	}
	if (current != null && length(current.args) > 0) push(segments, current);
	if (length(segments) == 0) return null;
	let result = [];
	for (let i = 0; i < length(segments); i++) {
		let segment = segments[i], argsText = join(' ', segment.args), name = segment.name || 'Profile ' + (i + 1);
		let protocol = has(argsText, '--filter-udp=') ? 'udp' : 'tcp';
		push(result, { id: 'profile-' + (i + 1), name: name, enabled: true,
			protocol: protocol, args: argsText });
	}
	return result;
}
function capabilities(args) {
	let protocols = [];
	if (has(args, '--filter-tcp=')) push(protocols, 'tcp');
	if (has(args, '--filter-udp=')) push(protocols, 'udp');
	if (length(protocols) == 0) push(protocols, 'tcp');
	return {
		autocircular: has(args, '--lua-desync=circular') || has(args, '--lua-desync=circular:'),
		discordUdp: has(args, 'key=discord_udp') && has(args, 'hostkey=z2k_nohost_key')
			&& (has(args, '--filter-l7=discord') || has(args, '--filter-l7=discord,stun')),
		protocols: protocols
	};
}
function normalize_record(id, args, metadata) {
	if (!string(id) || !match(id, /^[A-Za-z0-9._-]+$/) || id == '')
		return error('EVERIFY', 'Z2K Strategy id is malformed', 'id');
	if (!string(args) || args == '') return error('EVERIFY', 'Z2K Strategy args are empty', 'args');
	let profiles = profile_segments(args);
	if (profiles == null) return error('EVERIFY', 'Z2K Strategy args are not tokenizable', 'args');
	let sourceCommit = metadata.sourceCommit, sourcePath = source_path(metadata, STRATS_FILE);
	if (!valid_commit(sourceCommit)) return error('EPROVENANCE', 'Z2K source commit is required and must be a git SHA', 'sourceCommit');
	let derivedCapabilities = capabilities(args);
	let entry = {
		id: 'z2k:' + id, canonicalId: 'z2k:' + id, sourceId: SOURCE_ID, upstreamId: id,
		sourceCommit: sourceCommit, sourcePath: sourcePath,
		name: id, description: 'Z2K Strategy ' + id, args: args, profiles: profiles,
		capabilities: derivedCapabilities,
		autocircular: derivedCapabilities.autocircular,
		discordUdp: derivedCapabilities.discordUdp,
		requirements: { engine: 'nfqws2', luaFunctions: [], blobs: [] },
		usable: true,
		provenance: { repository: REPOSITORY, sourceId: SOURCE_ID, sourceCommit: sourceCommit,
			sourcePath: sourcePath, kind: 'strategy-catalog' }
	};
	return { ok: true, entry: entry };
}
function slot_entries(aggregate, metadata, poolKey, legacyKey) {
	let selected = strategy_tokens(aggregate.args);
	if (selected == null) return error('EVERIFY', 'Z2K Strategy args are not tokenizable', 'args');
	let numbers = selected.numbers;
	sort(numbers, function(left, right) { return left - right; });
	let result = [];
	for (let number in numbers) {
		let strategyNumber = number;
		let args = join(' ', selected.common);
		if (length(selected.numbered[strategyNumber]) > 0)
			args += (args == '' ? '' : ' ') + join(' ', selected.numbered[strategyNumber]);
		let normalized = normalize_record(poolKey + '_strat_' + strategyNumber, args, {
			sourceCommit: metadata.sourceCommit, sourcePath: metadata.sourcePath
		});
		if (!normalized.ok) return normalized;
		let entry = decorate_entry(normalized.entry, aggregate.upstreamId, poolKey, 'slot', strategyNumber, legacyKey);
		entry.provenance.aggregateId = aggregate.canonicalId;
		push(result, entry);
	}
	return { ok: true, entries: result };
}
export const strategy_source_z2k_info = function() {
	return { sourceId: SOURCE_ID, canonicalPrefix: 'z2k:', repository: REPOSITORY };
};

export const strategy_source_z2k_parse = function(content, metadata) {
	metadata = object(metadata) ? metadata : {};
	if (!string(content) || length(content) == 0 || length(content) > MAX_CONTENT)
		return error('EVERIFY', 'Z2K Strategy corpus is empty or exceeds the parser bound', 'content');
	if (!valid_commit(metadata.sourceCommit))
		return error('EPROVENANCE', 'Z2K source commit is required and must be a git SHA', 'sourceCommit');
	let entries = [], seen = {}, lines = split(content, '\n');
	for (let raw in lines) {
		let line = trim_ws(raw);
		if (line == '' || substr(line, 0, 1) == '#') continue;
		let colon = index(line, ':');
		if (colon <= 0) return error('EVERIFY', 'Z2K corpus line is missing the source delimiter', 'line');
		let header = trim_ws(substr(line, 0, colon)), payload = trim_ws(substr(line, colon + 1));
		let parts = split(header, /[ \t]+/);
		if (length(parts) < 2 || parts[0] == '' || payload == '')
			return error('EVERIFY', 'Z2K corpus line header or payload is malformed', 'line');
		let payloadParts = split(payload, /[ \t]+/);
		if (length(payloadParts) < 2 || payloadParts[0] != 'nfqws2')
			return error('EVERIFY', 'Z2K corpus record must declare nfqws2', 'line');
		let args = trim_ws(substr(payload, length(payloadParts[0])));
		let normalized = normalize_record(parts[0], args, metadata);
		if (!normalized.ok) return normalized;
		if (seen[normalized.entry.canonicalId])
			return error('EVERIFY', 'Z2K corpus contains a duplicate Strategy id', parts[0]);
		seen[normalized.entry.canonicalId] = true;
		let poolKey = pool_key(parts[0], args, null), adapted = adapt_args(args, poolKey);
		if (adapted != args) {
			normalized = normalize_record(parts[0], adapted, { sourceCommit: metadata.sourceCommit, sourcePath: source_path(metadata, STRATS_FILE) });
			if (!normalized.ok) return normalized;
		}
		let aggregate = decorate_entry(normalized.entry, parts[0], poolKey, 'aggregate', null, null);
		push(entries, aggregate);
		let slots = slot_entries(aggregate, { sourceCommit: metadata.sourceCommit, sourcePath: source_path(metadata, STRATS_FILE) }, poolKey, null);
		if (!slots.ok) return slots;
		for (let slot in slots.entries) {
			if (seen[slot.canonicalId]) return error('EVERIFY', 'Z2K corpus contains a duplicate Strategy id', slot.canonicalId);
			seen[slot.canonicalId] = true;
			push(entries, slot);
		}
	}
	if (length(entries) == 0) return error('EVERIFY', 'Z2K corpus contains no usable Strategy records');
	return { ok: true, source: strategy_source_z2k_info(), entries: entries };
};

function parse_ini(content, metadata) {
	if (!string(content) || length(content) == 0 || length(content) > MAX_CONTENT)
		return error('EVERIFY', 'Z2K QUIC corpus is empty or exceeds the parser bound', QUIC_FILE);
	let sections = [], current = null;
	for (let raw in split(content, '\n')) {
		let line = trim_ws(raw);
		if (line == '' || substr(line, 0, 1) == '#') continue;
		if (substr(line, 0, 1) == '[' && substr(line, length(line) - 1, 1) == ']') {
			if (current != null) push(sections, current);
			current = { id: substr(line, 1, length(line) - 2), desc: '', args: '' };
			continue;
		}
		if (current == null) return error('EVERIFY', 'Z2K QUIC corpus has a key outside a section', QUIC_FILE);
		let equal = index(line, '=');
		if (equal <= 0) return error('EVERIFY', 'Z2K QUIC corpus key is malformed', QUIC_FILE);
		let key = trim_ws(substr(line, 0, equal)), value = trim_ws(substr(line, equal + 1));
		if (key == 'desc') current.desc = value;
		else if (key == 'args') current.args = value;
	}
	if (current != null) push(sections, current);
	if (length(sections) == 0) return error('EVERIFY', 'Z2K QUIC corpus contains no sections', QUIC_FILE);
	let entries = [];
	for (let section in sections) {
		if (!match(section.id, /^[A-Za-z0-9._-]+$/) || section.args == '')
			return error('EVERIFY', 'Z2K QUIC corpus section is incomplete', section.id);
		let poolKey = pool_key(section.id, section.args, section.id);
		if (poolKey == null) return error('EVERIFY', 'Z2K QUIC section has no canonical pool key', section.id);
		let adapted = adapt_args(section.args, poolKey);
		let normalized = normalize_record(section.id, adapted, { sourceCommit: metadata.sourceCommit, sourcePath: QUIC_FILE });
		if (!normalized.ok) return normalized;
		normalized.entry.description = section.desc || normalized.entry.description;
		let legacyKey = section.id == 'discord_voice_autocircular' ? 'discord_voice' : null;
		let aggregate = decorate_entry(normalized.entry, section.id, poolKey, 'aggregate', null, legacyKey);
		push(entries, aggregate);
		let slots = slot_entries(aggregate, { sourceCommit: metadata.sourceCommit, sourcePath: QUIC_FILE }, poolKey, legacyKey);
		if (!slots.ok) return slots;
		for (let slot in slots.entries) {
			slot.description = section.desc ? section.desc + ' / strategy ' + slot.strategyNumber : slot.description;
			push(entries, slot);
		}
	}
	return { ok: true, entries: entries };
}

export const strategy_source_z2k_parse_files = function(files, metadata) {
	metadata = object(metadata) ? metadata : {};
	if (!object(files) || !string(files[STRATS_FILE]) || !string(files[QUIC_FILE]))
		return error('EINPUT', 'Z2K snapshot requires strats_new2.txt and quic_strats.ini', 'files');
	let tcp = strategy_source_z2k_parse(files[STRATS_FILE], { sourceCommit: metadata.sourceCommit, sourcePath: STRATS_FILE });
	if (!tcp.ok) return tcp;
	let quic = parse_ini(files[QUIC_FILE], { sourceCommit: metadata.sourceCommit });
	if (!quic.ok) return quic;
	let entries = [], seen = {};
	for (let group in [tcp.entries, quic.entries]) {
		for (let entry in group) {
			if (seen[entry.canonicalId]) return error('EVERIFY', 'Z2K source files contain a duplicate Strategy id', entry.canonicalId);
			seen[entry.canonicalId] = true;
			push(entries, entry);
		}
	}
	return { ok: true, source: strategy_source_z2k_info(), entries: entries };
};

export const strategy_source_z2k_normalize = function(entry) {
	if (!object(entry) || entry.sourceId != SOURCE_ID
		|| (object(entry.provenance) && entry.provenance.repository != REPOSITORY))
		return error('EPROVENANCE', 'Z2K adapter cannot normalize a foreign source entry', 'sourceId');
	let id = entry.upstreamId || (string(entry.id) && starts(entry.id, 'z2k:') ? substr(entry.id, 4) : null);
	return normalize_record(id, entry.args, {
		sourceCommit: entry.sourceCommit || (entry.provenance && entry.provenance.sourceCommit),
		sourcePath: entry.sourcePath || (entry.provenance && entry.provenance.sourcePath)
	});
};

export const strategy_source_z2k_prepare_snapshot = function(input) {
	if (!object(input)) return error('EINPUT', 'Z2K snapshot input is required', 'input');
	let files = object(input.files) ? input.files : null;
	let parsed = files
		? strategy_source_z2k_parse_files(files, { sourceCommit: input.sourceCommit })
		: string(input.content) ? strategy_source_z2k_parse(input.content, {
			sourceCommit: input.sourceCommit, sourcePath: input.sourcePath || STRATS_FILE
		}) : error('EINPUT', 'Z2K snapshot content is required', 'content');
	if (!parsed.ok) return parsed;
	let stratsNew2Digest = files ? digest(files[STRATS_FILE]) : digest(input.content);
	let quicStratsDigest = files ? digest(files[QUIC_FILE]) : null;
	if (!stratsNew2Digest || (files && !quicStratsDigest)) return error('EDIGEST', 'Z2K corpus content digest could not be computed');
	let identityText = files ? STRATS_FILE + '\n' + stratsNew2Digest + '\n' + QUIC_FILE + '\n' + quicStratsDigest : input.content;
	let contentDigest = digest(identityText);
	if (!contentDigest) return error('EDIGEST', 'Z2K corpus content digest could not be computed');
	let entries = [], entryDigests = [];
	for (let entry in parsed.entries) {
		let normalized = copy(entry);
		normalized.sourceSnapshotId = 'z2k-' + contentDigest;
		push(entries, normalized);
		let entryDigest = digest(sprintf('%J', normalized));
		if (!entryDigest) return error('EDIGEST', 'Z2K normalized entry digest could not be computed');
		push(entryDigests, entryDigest);
	}
	let orderedDigest = digest(join('\n', entryDigests));
	if (!orderedDigest) return error('EDIGEST', 'Z2K normalized entry order digest could not be computed');
	return { ok: true, snapshot: {
		schema: SCHEMA, sourceId: SOURCE_ID, repository: REPOSITORY,
		sourceCommit: input.sourceCommit, sourcePath: files ? STRATS_FILE + '+' + QUIC_FILE : input.sourcePath || STRATS_FILE,
		contentDigest: contentDigest, stratsNew2Digest: stratsNew2Digest, quicStratsDigest: quicStratsDigest,
		sourceFiles: files ? [STRATS_FILE, QUIC_FILE] : [STRATS_FILE], snapshotId: 'z2k-' + contentDigest,
		entryDigests: entryDigests, normalizedEntriesDigest: orderedDigest,
		entryCount: length(entries), normalizedEntryCount: length(entries), entries: entries,
		immutable: true
	} };
};
