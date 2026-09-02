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
const ALL_IN_ONE_ID = 'z2k_all_in_one';
const ALL_IN_ONE_NAME = 'z2k всё-в-одном';
const SUPPORTED_POOL_ORDER = ['rkn_tcp', 'yt_tcp', 'gv_tcp', 'yt_quic', 'discord_udp'];

// The upstream QUIC catalog contains an older experimental Discord arm. The
// production z2k flow is defined by config_official.sh in the same revision:
// STUN/IP-discovery only, tight d4 cutoff, hostless canonical key, and the
// nine proven candidates below. Keep this normalization source-bound and
// provenance-visible so a refresh cannot silently reintroduce the broken arm.
const DISCORD_OFFICIAL_ARGS = '--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344 '
  + '--filter-l7=discord,stun --out-range=-d4 --payload=discord_ip_discovery,stun '
  + '--lua-desync=circular:fails=3:time=60:udp_in=1:udp_out=4:key=discord_udp:nld=2:hostkey=z2k_nohost_key '
  + '--lua-desync=fake:payload=all:blob=active_discord_udp:repeats=6:strategy=1 '
  + '--lua-desync=fake:payload=all:blob=active_discord_udp:repeats=5:strategy=2 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=3:strategy=3 '
  + '--lua-desync=fake:payload=all:blob=active_discord_udp:repeats=3:strategy=3 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=10:strategy=4 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=10:strategy=4 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=3:strategy=5 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=3:strategy=5 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=6:strategy=6 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=6:strategy=6 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=6:strategy=7 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=6:ip_autottl=-2,3-20:strategy=7 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=4:strategy=8 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=4:strategy=8 '
  + '--lua-desync=fake:payload=discord_ip_discovery:blob=stun:repeats=5:strategy=9 '
  + '--lua-desync=fake:payload=all:blob=quic_dbankcloud:repeats=5:strategy=9';

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
function push_unique(result, value) {
	if (!string(value) || value == '') return;
	for (let item in result) if (item == value) return;
	push(result, value);
}
function supported_pool(value) {
	for (let pool in SUPPORTED_POOL_ORDER) if (pool == value) return true;
	return false;
}
function option_value(args, prefix) {
	let values = tokens(args);
	if (values == null) return null;
	for (let value in values) if (starts(value, prefix)) return substr(value, length(prefix));
	return null;
}
function requirements_from_args(args) {
	let luaFunctions = [], blobs = [], values = tokens(args);
	if (values == null) return { engine: 'nfqws2', luaFunctions: [], blobs: [] };
	for (let value in values) {
		if (starts(value, '--blob=')) {
			let name = split(substr(value, 7), ':')[0];
			if (!starts(name, '0x')) push_unique(blobs, name);
		}
		if (!starts(value, '--lua-desync=')) continue;
		let fields = split(substr(value, 13), ':');
		if (length(fields) > 0) push_unique(luaFunctions, fields[0]);
		for (let field in fields) if (starts(field, 'blob=')) {
			let name = substr(field, 5);
			if (!starts(name, '0x')) push_unique(blobs, name);
		}
	}
	return { engine: 'nfqws2', luaFunctions: luaFunctions, blobs: blobs };
}
function routing_descriptor(args, headerParts, poolKey) {
	let udp = option_value(args, '--filter-udp='), tcp = option_value(args, '--filter-tcp=');
	return {
		family: poolKey,
		addressFamily: headerParts && headerParts[1] || null,
		upstreamTarget: headerParts && headerParts[2] || null,
		protocol: udp != null ? 'udp' : 'tcp',
		ports: udp != null ? udp : tcp,
		l7: option_value(args, '--filter-l7='),
		filterSemantics: udp != null ? 'ports-and-l7' : 'ports-and-l7',
		precedence: ['profile-order', 'l7', 'ports']
	};
}
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
	if (poolKey != 'discord_udp') return args;
	if (has(args, '--in-range=-d100') || has(args, '--out-range=-d100')
		|| has(args, '--payload=quic_initial,discord_ip_discovery')
		|| has(args, '--filter-udp=50000-50099')) return DISCORD_OFFICIAL_ARGS;
	if (has(args, 'key=discord_voice')) return join('key=discord_udp', split(args, 'key=discord_voice'));
	return args;
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
		let hasStrategy = false;
		for (let field in split(token, ':')) if (starts(field, 'strategy=')) hasStrategy = true;
		if (hasStrategy && number == null) return null;
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
		requirements: requirements_from_args(args),
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
		if (aggregate.provenance.adaptation != null) entry.provenance.adaptation = aggregate.provenance.adaptation;
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
		aggregate.routing = routing_descriptor(aggregate.args, parts, poolKey);
		if (adapted != args) {
			aggregate.provenance.adaptation = 'key=discord_voice normalized to key=discord_udp and upstream Discord arm normalized to official Discord STUN runtime flow';
			aggregate.semanticAdaptation = { from: 'discord_voice', to: 'discord_udp', scope: 'state-namespace', safe: true };
		}
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
		aggregate.routing = routing_descriptor(aggregate.args, [], poolKey);
		if (adapted != section.args) {
			aggregate.provenance.adaptation = 'key=discord_voice normalized to key=discord_udp and upstream Discord arm normalized to official Discord STUN runtime flow';
			aggregate.semanticAdaptation = { from: 'discord_voice', to: 'discord_udp', scope: 'state-namespace', safe: true };
		}
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

function compose_queue_args(args, poolKey) {
	if (poolKey != 'yt_quic')
		return { args: args, adaptation: null };
	let udp = option_value(args, '--filter-udp='), l7 = option_value(args, '--filter-l7=');
	if (udp != null && udp != '443')
		return { error: { code: 'EUNSUPPORTED', message: 'YT QUIC profile has an explicit non-443 UDP filter', path: 'filter-udp' } };
	if (l7 != null && l7 != 'quic')
		return { error: { code: 'EUNSUPPORTED', message: 'YT QUIC profile has an explicit non-QUIC L7 filter', path: 'filter-l7' } };
	if (udp == '443' && l7 == 'quic') return { args: args, adaptation: null };
	// The upstream QUIC queue is intentionally implicit.  Z2M's unified
	// process needs an explicit queue boundary so it cannot catch unrelated
	// UDP traffic when this profile is joined with Discord.
	let prefix = udp == null ? '--filter-udp=443 ' : '';
	if (l7 == null) prefix += '--filter-l7=quic ';
	return { args: prefix + args,
		adaptation: 'yt_quic queue scoped to explicit UDP/443 + QUIC filters for the unified Z2M process' };
}
function compose_profiles(entry, label, poolKey, adaptations) {
	let profiles = [];
	if (type(entry.profiles) == 'array' && length(entry.profiles) > 0) {
		for (let i = 0; i < length(entry.profiles); i++) {
			let profile = entry.profiles[i];
			if (!object(profile) || !string(profile.args) || profile.args == '') return null;
			let scoped = compose_queue_args(profile.args, poolKey);
			if (scoped.error != null) return { ok: false, error: scoped.error };
			if (scoped.adaptation != null) push_unique(adaptations, scoped.adaptation);
			push(profiles, { id: 'all-in-one-' + label + '-' + (i + 1), name: label, enabled: true,
				protocol: scoped.args && (has(scoped.args, '--filter-udp=') ? 'udp' : 'tcp'), args: scoped.args });
		}
	} else if (string(entry.args) && entry.args != '') {
		let scoped = compose_queue_args(entry.args, poolKey);
		if (scoped.error != null) return { ok: false, error: scoped.error };
		if (scoped.adaptation != null) push_unique(adaptations, scoped.adaptation);
		push(profiles, { id: 'all-in-one-' + label, name: label, enabled: true,
			protocol: has(scoped.args, '--filter-udp=') ? 'udp' : 'tcp', args: scoped.args });
	} else return null;
	return profiles;
}

function composition_digest(value) {
	let encoded = null;
	try { encoded = sprintf('%J', value); } catch (e) { encoded = null; }
	return encoded == null ? null : digest(encoded);
}

export const strategy_source_z2k_compose_all_in_one = function(entries, metadata) {
	metadata = object(metadata) ? metadata : {};
	if (type(entries) != 'array' || length(entries) == 0)
		return error('EINPUT', 'Z2K composition requires normalized entries', 'entries');
	if (!valid_commit(metadata.sourceCommit))
		return error('EPROVENANCE', 'Z2K composition requires the exact source commit', 'sourceCommit');
	let pools = {}, unknown = [];
	for (let entry in entries) {
		if (!object(entry) || entry.sourceId != SOURCE_ID || entry.entryKind != 'aggregate') continue;
		let pool = entry.poolKey;
		if (pool == null || !supported_pool(pool)) {
			if (pool != null) push_unique(unknown, pool);
			continue;
		}
		if (pools[pool] != null) return error('EDUPLICATE', 'Z2K source contains duplicate aggregate pool', pool);
		if (entry.usable !== true) return error('EVERIFY', 'Z2K aggregate pool is not usable', pool);
		pools[pool] = entry;
	}
	if (length(unknown) > 0)
		return error('EUNSUPPORTED', 'Z2K source contains an unknown required pool family: ' + join(', ', unknown), 'poolKey');
	let missing = [];
	for (let pool in SUPPORTED_POOL_ORDER) if (pools[pool] == null) push(missing, pool);
	if (length(missing) > 0)
		return error('ECOMPOSITION', 'Z2K All-in-One is incomplete; required pool family is missing: ' + join(', ', missing), 'poolKey');
	let profiles = [], order = [], routing = [], argsParts = [], adaptations = [], requirements = { engine: 'nfqws2', luaFunctions: [], blobs: [] };
	for (let pool in SUPPORTED_POOL_ORDER) {
		let entry = pools[pool], familyProfiles = compose_profiles(entry, pool, pool, adaptations);
		if (familyProfiles && familyProfiles.ok === false) return familyProfiles;
		if (familyProfiles == null || length(familyProfiles) == 0)
			return error('ECOMPOSITION', 'Z2K All-in-One cannot materialize pool profiles', pool);
		for (let profile in familyProfiles) {
			push(profiles, profile);
			push(argsParts, profile.args);
		}
		push(order, pool);
		push(routing, routing_descriptor(familyProfiles[0].args, [], pool));
		for (let fn in entry.requirements && entry.requirements.luaFunctions || []) push_unique(requirements.luaFunctions, fn);
		for (let blob in entry.requirements && entry.requirements.blobs || []) push_unique(requirements.blobs, blob);
	}
	let args = join(' --new ', argsParts), generatedFrom = [];
	for (let pool in order) push(generatedFrom, pools[pool].canonicalId);
	let provenance = {
		repository: REPOSITORY, sourceId: SOURCE_ID, sourceCommit: metadata.sourceCommit,
		sourcePath: STRATS_FILE + '+' + QUIC_FILE, kind: 'strategy-catalog-generated',
		generatedFrom: generatedFrom,
		adaptation: 'key=discord_voice normalized to key=discord_udp and upstream Discord arm normalized to official Discord STUN runtime flow',
		compositions: adaptations
	};
	let entry = {
		id: 'z2k:' + ALL_IN_ONE_ID, canonicalId: 'z2k:' + ALL_IN_ONE_ID, sourceId: SOURCE_ID,
		upstreamId: ALL_IN_ONE_ID, sourceCommit: metadata.sourceCommit,
		sourcePath: STRATS_FILE + '+' + QUIC_FILE, name: ALL_IN_ONE_NAME,
		description: 'Собрано из текущих проверенных Z2K pool: TCP RKN/YouTube/GoogleVideo и UDP YouTube/Discord.',
		args: args, profiles: profiles, capabilities: { autocircular: true, discordUdp: true, protocols: ['tcp', 'udp'] },
		autocircular: true, discordUdp: true, is_builtin: false, requirements: requirements, usable: true,
		featured: true, recommended: true, pinned: true, entryKind: 'all-in-one', poolKey: 'all-in-one',
		composition: { order: order, families: routing, overlapPolicy: 'explicit-profile-order',
			preservesFilters: true, noImplicitCatchAll: true, adaptations: adaptations }, provenance: provenance
	};
	return { ok: true, entry: entry, digest: composition_digest(entry) };
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
	if (!files) return error('EINPUT', 'Z2K snapshot requires both exact source files', 'files');
	let parsed = strategy_source_z2k_parse_files(files, { sourceCommit: input.sourceCommit });
	if (!parsed.ok) return parsed;
	let stratsNew2Digest = digest(files[STRATS_FILE]);
	let quicStratsDigest = digest(files[QUIC_FILE]);
	if (!stratsNew2Digest || !quicStratsDigest) return error('EDIGEST', 'Z2K corpus content digest could not be computed');
	let identityText = STRATS_FILE + '\n' + stratsNew2Digest + '\n' + QUIC_FILE + '\n' + quicStratsDigest;
	let contentDigest = digest(identityText);
	if (!contentDigest) return error('EDIGEST', 'Z2K corpus content digest could not be computed');
	let composed = strategy_source_z2k_compose_all_in_one(parsed.entries, { sourceCommit: input.sourceCommit });
	if (!composed.ok) return composed;
	let parsedEntries = [];
	for (let item in parsed.entries) push(parsedEntries, item);
	push(parsedEntries, composed.entry);
	let entries = [], entryDigests = [];
	for (let entry in parsedEntries) {
		let normalized = copy(entry);
		normalized.sourceSnapshotId = 'z2k-' + contentDigest;
		push(entries, normalized);
		let entryDigest = digest(sprintf('%J', normalized));
		if (!entryDigest) return error('EDIGEST', 'Z2K normalized entry digest could not be computed');
		push(entryDigests, entryDigest);
	}
	let orderedDigest = digest(join('\n', entryDigests));
	if (!orderedDigest) return error('EDIGEST', 'Z2K normalized entry order digest could not be computed');
	let allInOne = null;
	for (let normalized in entries) if (normalized.canonicalId == 'z2k:' + ALL_IN_ONE_ID) allInOne = normalized;
	let allInOneDigest = composition_digest(allInOne);
	if (!allInOne || !allInOneDigest) return error('EDIGEST', 'Z2K All-in-One identity could not be computed');
	return { ok: true, snapshot: {
		schema: SCHEMA, sourceId: SOURCE_ID, repository: REPOSITORY,
		sourceCommit: input.sourceCommit, sourcePath: STRATS_FILE + '+' + QUIC_FILE,
		sourceFiles: [STRATS_FILE, QUIC_FILE], sourceBranch: 'z2k-enhanced',
		contentDigest: contentDigest, stratsNew2Digest: stratsNew2Digest, quicStratsDigest: quicStratsDigest,
		snapshotId: 'z2k-' + contentDigest,
		entryDigests: entryDigests, normalizedEntriesDigest: orderedDigest,
		entryCount: length(entries), normalizedEntryCount: length(entries), entries: entries,
		allInOne: { canonicalId: allInOne.canonicalId, digest: allInOneDigest,
			profileCount: length(allInOne.profiles), order: allInOne.composition.order },
		immutable: true
	} };
};
