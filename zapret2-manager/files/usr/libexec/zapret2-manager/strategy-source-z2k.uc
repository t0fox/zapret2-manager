'use strict';

// Z2K source adapter.
//
// Z2K owns strategy semantics. This module only imports the already compiled
// flat NFQWS2_OPT through the existing Z2M parser, binds infrastructure paths,
// and creates the immutable source snapshot consumed by the catalog lifecycle.
// It deliberately contains no pool list, strategy expansion, or Discord
// argument patching.

import { popen, unlink, writefile } from 'fs';
import { z2m_parse, z2m_validate } from './profiles.uc';

const SOURCE_ID = 'z2k';
const REPOSITORY = 'necronicle/z2k';
const BRANCH = 'z2k-enhanced';
const SCHEMA = 'z2m.strategy-source-snapshot.v1';
const COMPILER_SCHEMA = 'z2m.z2k-official-compiler-snapshot.v1';
const COMPILER_SOURCE_PATH = 'official:generate_nfqws2_opt_from_strategies';
const ALL_IN_ONE_ID = 'z2k_all_in_one';
const ALL_IN_ONE_NAME = 'z2k всё-в-одном';
const MAX_CONTENT = 4 * 1024 * 1024;
const REQUIRED_FILES = [
	'strats_new2.txt',
	'quic_strats.ini',
	'lib/utils.sh',
	'lib/strategies.sh',
	'lib/config_official.sh'
];

// These are infrastructure bindings, not strategy semantics. The generated
// profile is rejected if it names any other temporary/logical resource path.
// Targets are existing Z2M-owned runtime locations.
const DEFAULT_RESOURCE_BINDINGS = {
	'/runtime-assets/lists/whitelist.txt': {
		target: '/etc/zapret2-manager/lists/whitelist.txt', role: 'manager-whitelist'
	},
	'/runtime-assets/lists/discovered-domains.txt': {
		target: '/opt/zapret2/lists/discovered-domains.txt', role: 'z2k-discovered-domains'
	},
	'/runtime-assets/lists/extra_strats/TCP/RKN/List.txt': {
		target: '/runtime-assets/lists/extra_strats/TCP/RKN/List.txt', role: 'z2k-rkn-hostlist'
	},
	'/runtime-assets/lists/extra_strats/TCP/YT/List.txt': {
		target: '/runtime-assets/lists/extra_strats/TCP/YT/List.txt', role: 'z2k-youtube-hostlist'
	},
	'/runtime-assets/lists/extra_strats/TCP/YT_GV/List.txt': {
		target: '/runtime-assets/lists/extra_strats/TCP/YT_GV/List.txt', role: 'z2k-youtube-gv-hostlist'
	},
	'/runtime-assets/lists/extra_strats/UDP/YT/List.txt': {
		target: '/runtime-assets/lists/extra_strats/UDP/YT/List.txt', role: 'z2k-youtube-quic-hostlist'
	}
};

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function error(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function trim_ws(value) { return trim(value == null ? '' : '' + value); }
function valid_commit(value) { return string(value) && match(value, /^[0-9a-f]{40}$/); }
function valid_digest(value) { return string(value) && match(value, /^[0-9a-f]{64}$/); }
function starts(value, prefix) {
	return string(value) && length(value) >= length(prefix)
		&& substr(value, 0, length(prefix)) == prefix;
}
function has(value, needle) { return string(value) && index(value, needle) >= 0; }
function shell_quote(value) {
	let result = chr(39), text = '' + value;
	for (let i = 0; i < length(text); i++) {
		let ch = substr(text, i, 1);
		result += ch == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : ch;
	}
	return result + chr(39);
}
function digest(value) {
	if (!string(value)) return null;
	let temp = '/tmp/z2m-strategy-source-digest-' + time() + '-' + length(value), process = null;
	try { writefile(temp, value); }
	catch (e) { return null; }
	try { process = popen("sha256sum " + shell_quote(temp) + " 2>/dev/null | awk '{print $1}'", 'r'); }
	catch (e) { process = null; }
	if (!process) { try { unlink(temp); } catch (ignored) { } return null; }
	let output = trim(process.read('all') || ''), rc = process.close();
	try { unlink(temp); } catch (ignored) { }
	return rc == 0 && valid_digest(output) ? output : null;
}
function profile_args(model, profile) {
	if (!object(model) || !object(profile) || type(profile.originalTokens) != 'array') return null;
	let values = [];
	for (let tokenIndex in profile.originalTokens) {
		let token = model.tokens[tokenIndex];
		if (!object(token) || !string(token.value)) return null;
		push(values, token.value);
	}
	return length(values) > 0 ? join(' ', values) : null;
}
function option_prefix(value) {
	for (let prefix in [
		'--hostlist=', '--hostlist-exclude=', '--hostlist-auto=', '--hostlist-domains=',
		'--hostlist-exclude-domains=', '--ipset=', '--ipset-exclude=', '--lua-init='
	]) if (starts(value, prefix)) return prefix;
	return null;
}
function push_unique(result, value) {
	if (!string(value) || value == '') return;
	for (let item in result) if (item == value) return;
	push(result, value);
}
function valid_runtime_target(value) {
	return string(value) && substr(value, 0, 1) == '/' && index(value, '..') < 0
		&& index(value, '\\') < 0 && match(value, /^\/[A-Za-z0-9._+@%=-]+(\/[A-Za-z0-9._+@%=-]+)*$/);
}
function binding_record(reference, resources) {
	let record = null;
	if (object(resources) && resources[reference] != null) record = resources[reference];
	if (record == null) record = DEFAULT_RESOURCE_BINDINGS[reference];
	if (record == null) return error('ERESOURCE', 'Z2K generated resource is not allowlisted', reference);
	if (record === false || (object(record) && (record.available === false || record.present === false)))
		return error('ERESOURCE', 'Z2K generated resource is unavailable', reference);
	let target = object(record) ? record.target : record;
	if (!valid_runtime_target(target)) return error('ERESOURCE', 'Z2K resource target is invalid', reference);
	return { ok: true, target: target, role: object(record) && record.role || null };
}
function bind_resource_reference(reference, resources) {
	if (starts(reference, '/tmp/'))
		return error('ERESOURCE', 'Z2K generated temporary resource path cannot be published', reference);
	if (!starts(reference, '/runtime-assets/')) return { ok: true, target: reference, role: null };
	return binding_record(reference, resources);
}
function bind_token(value, resources, records) {
	let prefix = option_prefix(value);
	if (prefix != null) {
		let reference = substr(value, length(prefix));
		if (starts(reference, '/tmp/') || starts(reference, '/runtime-assets/')) {
			let bound = bind_resource_reference(reference, resources);
			if (!bound.ok) return bound;
			if (bound.target != reference || bound.role != null)
				push(records, { from: reference, to: bound.target, role: bound.role });
			return { ok: true, value: prefix + bound.target };
		}
	}
	// --blob=name:@path / --blob=name:+path are infrastructure references
	// when present. Blob names and all opaque Lua expressions remain untouched.
	if (starts(value, '--blob=')) {
		let raw = substr(value, 7), marker = index(raw, ':');
		if (marker >= 0) {
			let source = substr(raw, marker + 1), sigil = substr(source, 0, 1);
			if ((sigil == '@' || sigil == '+') && (starts(source, '@/tmp/') || starts(source, '@/runtime-assets/')
				|| starts(source, '+/tmp/') || starts(source, '+/runtime-assets/'))) {
				let bound = bind_resource_reference(substr(source, 1), resources);
				if (!bound.ok) return bound;
				push(records, { from: substr(source, 1), to: bound.target, role: bound.role });
				return { ok: true, value: substr(value, 0, 7 + marker + 1) + sigil + bound.target };
			}
		}
	}
	return { ok: true, value: value };
}
function bind_args(args, resources) {
	let model = null;
	try { model = z2m_parse(args); } catch (e) { return error('ERESOURCE', 'Z2K profile cannot be tokenized for resource binding', 'args'); }
	let values = [], records = [];
	for (let token in model.tokens) {
		let bound = bind_token(token.value, resources, records);
		if (!bound.ok) return bound;
		push(values, bound.value);
	}
	return { ok: true, args: join(' ', values), bindings: records };
}
function requirements_from_profiles(profiles) {
	let functions = [], blobs = [];
	for (let profile in profiles) {
		let model = null;
		try { model = z2m_parse(profile.args); } catch (e) { continue; }
		for (let item in model.tokens) {
			let value = item.value;
			if (starts(value, '--blob=')) {
				let raw = substr(value, 7), colon = index(raw, ':');
				let name = colon >= 0 ? substr(raw, 0, colon) : raw;
				if (name != '' && !starts(name, '0x')) push_unique(blobs, name);
			}
			if (!starts(value, '--lua-desync=')) continue;
			let fields = split(substr(value, 13), ':');
			if (length(fields) > 0) push_unique(functions, fields[0]);
			for (let field in fields) if (starts(field, 'blob=')) {
				let name = substr(field, 5);
				if (name != '' && !starts(name, '0x')) push_unique(blobs, name);
			}
		}
	}
	return { engine: 'nfqws2', luaFunctions: functions, blobs: blobs };
}
function capabilities(profiles) {
	let protocols = [], circular = false, discord = false;
	for (let profile in profiles) {
		if (profile.protocol == 'tcp' || profile.protocol == 'mixed') push_unique(protocols, 'tcp');
		if (profile.protocol == 'udp' || profile.protocol == 'mixed') push_unique(protocols, 'udp');
		if (has(profile.args, '--lua-desync=circular')) circular = true;
		if (has(profile.args, '--filter-l7=discord') || has(profile.args, '--filter-l7=discord,stun')) discord = true;
	}
	return { autocircular: circular, discordUdp: discord, protocols: protocols };
}
function structural_validation(args) {
	let model = null;
	try { model = z2m_parse(args); } catch (e) { return error('EVERIFY', 'Official NFQWS2_OPT could not be parsed', 'nfqws2Opt'); }
	if (!object(model) || type(model.profiles) != 'array' || length(model.profiles) == 0
		|| type(model.trailingTokens) != 'array' || length(model.trailingTokens) > 0)
		return error('EVERIFY', 'Official NFQWS2_OPT has no complete ordered profiles', 'nfqws2Opt');
	for (let diagnostic in model.diagnostics || [])
		if (diagnostic.severity == 'error') return error('EVERIFY', 'Official NFQWS2_OPT has parser errors', 'nfqws2Opt');
	let validation = z2m_validate(model);
	for (let diagnostic in validation || [])
		if (diagnostic.severity == 'error') return error('EVERIFY', 'Official NFQWS2_OPT failed Z2M validation', 'nfqws2Opt');
	return { ok: true, model: model, validation: validation };
}
function valid_compiled(compiled) {
	if (!object(compiled)) return error('EINPUT', 'Official Z2K compiler result is required', 'compiler');
	if (compiled.schema != COMPILER_SCHEMA)
		return error('EPROVENANCE', 'Official compiler schema is not approved', 'compiler.schema');
	if (compiled.repository != REPOSITORY)
		return error('EPROVENANCE', 'Official compiler repository is not approved', 'compiler.repository');
	if (!valid_commit(compiled.sourceCommit)) return error('EPROVENANCE', 'Official compiler commit is not exact', 'sourceCommit');
	if (!valid_digest(compiled.compilerSnapshotDigest)) return error('EPROVENANCE', 'Compiler snapshot digest is required', 'compilerSnapshotDigest');
	if (!string(compiled.nfqws2Opt) || length(compiled.nfqws2Opt) == 0 || length(compiled.nfqws2Opt) > MAX_CONTENT)
		return error('EVERIFY', 'Official compiler output is empty or exceeds the parser bound', 'nfqws2Opt');
	if (!valid_digest(compiled.nfqws2OptSha256) || digest(compiled.nfqws2Opt) != compiled.nfqws2OptSha256)
		return error('EDIGEST', 'Official compiler output digest is invalid', 'nfqws2OptSha256');
	let parsed = structural_validation(compiled.nfqws2Opt);
	return parsed.ok ? { ok: true, compiled: compiled, model: parsed.model, validation: parsed.validation } : parsed;
}
function contains(values, needle) {
	if (type(values) != 'array') return false;
	for (let value in values) if (value == needle) return true;
	return false;
}
function profile_projection(model, profile, index, resources) {
	let officialArgs = profile_args(model, profile);
	if (officialArgs == null) return error('EVERIFY', 'Official compiler emitted an empty profile', 'profiles[' + index + ']');
	let bound = bind_args(officialArgs, resources);
	if (!bound.ok) return bound;
	return { ok: true, profile: {
		id: 'all-in-one-profile-' + (index + 1), name: 'Z2K profile ' + (index + 1), enabled: profile.enabled !== false,
		protocol: profile.protocol == null ? 'unknown' : profile.protocol, args: bound.args,
		officialArgs: officialArgs, officialProfileIndex: profile.index
	}, bindings: bound.bindings };
}
function composition_digest(value) { return digest(sprintf('%J', value)); }
function profile_field_values(profiles, field) {
	let result = [];
	for (let profile in profiles) push(result, profile[field]);
	return result;
}

export const strategy_source_z2k_info = function() {
	return { sourceId: SOURCE_ID, canonicalPrefix: 'z2k:', repository: REPOSITORY,
		compiler: 'official:generate_nfqws2_opt_from_strategies', templates: 'disabled' };
};

// Infrastructure-only rebinding. It accepts a canonical all-in-one entry and
// rewrites only allowlisted path-bearing options. No opaque Lua token is parsed
// or changed here.
export const strategy_source_z2k_bind_resources = function(entry, resources) {
	if (!object(entry) || type(entry.profiles) != 'array' || length(entry.profiles) == 0)
		return error('EINPUT', 'Z2K resource binding requires ordered profiles', 'entry');
	let result = copy(entry), records = [];
	for (let i = 0; i < length(result.profiles); i++) {
		let profile = result.profiles[i], official = profile.officialArgs || profile.args;
		let bound = bind_args(official, resources);
		if (!bound.ok) return bound;
		profile.args = bound.args;
		for (let item in bound.bindings) push(records, { profileIndex: i, from: item.from, to: item.to, role: item.role });
	}
	result.resourceBindings = records;
	result.provenance = object(result.provenance) ? result.provenance : {};
	result.provenance.resourceBindings = copy(records);
	result.args = join(' --new ', profile_field_values(result.profiles, 'args'));
	return { ok: true, entry: result };
};

export const strategy_source_z2k_import_compiled = function(compiled, metadata) {
	metadata = object(metadata) ? metadata : {};
	let checked = valid_compiled(compiled);
	if (!checked.ok) return checked;
	if (metadata.sourceCommit != null && metadata.sourceCommit != checked.compiled.sourceCommit)
		return error('ESTALE', 'Compiler result commit does not match accepted source revision', 'sourceCommit');
	let profiles = [], bindings = [];
	for (let i = 0; i < length(checked.model.profiles); i++) {
		let projected = profile_projection(checked.model, checked.model.profiles[i], i, metadata.resourceBindings);
		if (!projected.ok) return projected;
		push(profiles, projected.profile);
		for (let item in projected.bindings) push(bindings, { profileIndex: i, from: item.from, to: item.to, role: item.role });
	}
	let args = join(' --new ', profile_field_values(profiles, 'args'));
	let caps = capabilities(profiles), requirements = requirements_from_profiles(profiles);
	let entry = {
		id: 'z2k:' + ALL_IN_ONE_ID, canonicalId: 'z2k:' + ALL_IN_ONE_ID, sourceId: SOURCE_ID,
		upstreamId: ALL_IN_ONE_ID, sourceCommit: checked.compiled.sourceCommit,
		sourcePath: COMPILER_SOURCE_PATH, name: ALL_IN_ONE_NAME,
		description: 'Импортировано из полного flat NFQWS2_OPT официального компилятора Z2K.',
		args: args, officialNfqws2Opt: checked.compiled.nfqws2Opt, profiles: profiles,
		capabilities: caps, autocircular: caps.autocircular, discordUdp: caps.discordUdp,
		is_builtin: false, requirements: requirements, usable: true, featured: true, recommended: true,
		pinned: true, entryKind: 'all-in-one', poolKey: 'all-in-one',
		composition: { source: COMPILER_SOURCE_PATH, profileCount: length(profiles),
			profileOrder: profile_field_values(profiles, 'id'), preservesFilters: true },
		resourceBindings: bindings,
		provenance: { repository: REPOSITORY, sourceId: SOURCE_ID,
			sourceCommit: checked.compiled.sourceCommit, sourcePath: COMPILER_SOURCE_PATH,
			kind: 'strategy-catalog-import', compilerSchema: COMPILER_SCHEMA,
			compilerSnapshotDigest: checked.compiled.compilerSnapshotDigest,
			nfqws2OptSha256: checked.compiled.nfqws2OptSha256,
			templates: 'disabled', sourceFiles: metadata.sourceFiles || REQUIRED_FILES,
			fileSha256: metadata.fileSha256 || {}, resourceBindings: copy(bindings) },
		validation: { parser: 'passed', manager: 'passed', diagnostics: checked.validation }
	};
	return { ok: true, entry: entry, model: checked.model, validation: checked.validation };
};

export const strategy_source_z2k_prepare_snapshot = function(input) {
	if (!object(input)) return error('EINPUT', 'Z2K snapshot input is required', 'input');
	let compiled = input.compiler;
	if (!object(compiled)) return error('EINPUT', 'Z2K snapshot requires an official compiler result', 'compiler');
	let sourceCommit = input.sourceCommit || compiled.sourceCommit;
	if (!valid_commit(sourceCommit)) return error('EPROVENANCE', 'Z2K snapshot requires the exact source commit', 'sourceCommit');
	if (compiled.sourceCommit != sourceCommit) return error('ESTALE', 'Z2K compiler result is from a different source commit', 'sourceCommit');
	let sourceFiles = input.sourceFiles || REQUIRED_FILES, fileSha256 = input.fileSha256 || {};
	if (type(sourceFiles) != 'array' || length(sourceFiles) != length(REQUIRED_FILES))
		return error('EVERIFY', 'Z2K snapshot must carry the complete compiler file manifest', 'sourceFiles');
	for (let relative in REQUIRED_FILES) {
		let name = relative;
		if (!contains(sourceFiles, name) || !valid_digest(fileSha256[name]))
			return error('EVERIFY', 'Z2K snapshot compiler file provenance is incomplete', name);
	}
	let imported = strategy_source_z2k_import_compiled(compiled, {
		sourceCommit: sourceCommit, sourceFiles: sourceFiles, fileSha256: fileSha256,
		resourceBindings: input.resourceBindings
	});
	if (!imported.ok) return imported;
	let identity = COMPILER_SCHEMA + '\n' + REPOSITORY + '\n' + sourceCommit + '\n'
		+ compiled.compilerSnapshotDigest + '\n' + compiled.nfqws2OptSha256 + '\n';
	for (let relative in REQUIRED_FILES) identity += relative + '\n' + fileSha256[relative] + '\n';
	let contentDigest = digest(identity);
	if (!contentDigest) return error('EDIGEST', 'Z2K snapshot content digest could not be computed');
	let snapshotId = 'z2k-' + contentDigest, entry = copy(imported.entry);
	entry.sourceSnapshotId = snapshotId;
	entry.provenance.sourceSnapshotId = snapshotId;
	let entryDigest = digest(sprintf('%J', entry)), allInOneDigest = composition_digest(entry);
	if (!entryDigest || !allInOneDigest) return error('EDIGEST', 'Z2K imported entry identity could not be computed');
	return { ok: true, snapshot: {
		schema: SCHEMA, sourceId: SOURCE_ID, repository: REPOSITORY, sourceCommit: sourceCommit,
		sourcePath: COMPILER_SOURCE_PATH, sourceFiles: sourceFiles, sourceBranch: BRANCH,
		fileSha256: fileSha256, compilerSchema: COMPILER_SCHEMA,
		compilerSnapshotDigest: compiled.compilerSnapshotDigest, nfqws2OptSha256: compiled.nfqws2OptSha256,
		contentDigest: contentDigest, snapshotId: snapshotId, entryDigests: [entryDigest],
		normalizedEntriesDigest: entryDigest, entryCount: 1, normalizedEntryCount: 1,
		entries: [entry], allInOne: { canonicalId: entry.canonicalId, digest: allInOneDigest,
			profileCount: length(entry.profiles), order: entry.composition.profileOrder },
		immutable: true, published: true
	} };
};

// Kept as a narrow compatibility seam for callers that need to reject legacy
// hand-composed entries. It never reconstructs or edits Z2K semantics.
export const strategy_source_z2k_normalize = function(entry) {
	if (!object(entry) || entry.sourceId != SOURCE_ID
		|| !object(entry.provenance) || entry.provenance.repository != REPOSITORY)
		return error('EPROVENANCE', 'Z2K adapter cannot normalize a foreign source entry', 'sourceId');
	if (entry.entryKind != 'all-in-one' || !string(entry.officialNfqws2Opt)
		|| !valid_digest(entry.provenance.compilerSnapshotDigest))
		return error('EVERIFY', 'Z2K entry is not an official compiled import', 'provenance');
	return { ok: true, entry: copy(entry) };
};
