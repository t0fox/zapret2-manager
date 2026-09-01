'use strict';

// Avatar source adapter. The existing catalog reader remains the byte-level
// verifier for Avatar's manifest/layout; this adapter adds the source-owned
// namespace and immutable snapshot identity without creating a second reader.

import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';

const SOURCE_ID = 'avatar';
const REPOSITORY = 'avatarDD/zapret-gui';
const SCHEMA = 'z2m.strategy-source-snapshot.v1';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function starts(value, prefix) { return string(value) && length(value) >= length(prefix) && substr(value, 0, length(prefix)) == prefix; }
function error(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function canonical_id(upstreamId) { return 'avatar:' + upstreamId; }

export const strategy_source_avatar_info = function() {
	return { sourceId: SOURCE_ID, canonicalPrefix: 'avatar:', repository: REPOSITORY };
};

function normalize_entry(entry, snapshot) {
	if (!object(entry) || !string(entry.id) || entry.id == '')
		return error('EINPUT', 'Avatar source entry id is required', 'id');
	if (entry.sourceId != null && entry.sourceId != SOURCE_ID)
		return error('EPROVENANCE', 'Avatar adapter cannot normalize a foreign source entry', 'sourceId');
	if (object(entry.provenance) && entry.provenance.repository != null
		&& entry.provenance.repository != REPOSITORY)
		return error('EPROVENANCE', 'Avatar adapter provenance repository is not canonical', 'provenance.repository');
	let out = copy(entry);
	if (!object(out)) return error('EINTERNAL', 'Avatar source entry could not be copied');
	out.sourceId = SOURCE_ID;
	out.upstreamId = out.upstreamId || (starts(out.id, 'avatar:') ? substr(out.id, 6) : out.id);
	out.canonicalId = canonical_id(out.upstreamId);
	out.id = out.canonicalId;
	out.sourceSnapshotId = snapshot && snapshot.snapshotId || out.sourceSnapshotId || null;
	out.sourceCommit = snapshot && snapshot.sourceCommit || out.sourceCommit || null;
	let strategy = catalog_entry_to_strategy(out);
	if (strategy == null) return error('EVERIFY', 'Avatar source entry could not be converted to Strategy', 'id');
	out.name = strategy.name;
	out.description = strategy.description;
	out.profiles = strategy.profiles;
	out.capabilities = { autocircular: strategy.circular == true || strategy.isCircular == true,
		discordUdp: false, protocols: [out.protocol == 'udp' ? 'udp' : 'tcp'] };
	out.requirements = { engine: 'nfqws2' };
	out.provenance = {
		repository: REPOSITORY,
		sourceId: SOURCE_ID,
		sourceCommit: out.sourceCommit,
		sourcePath: out.sourceFile || (object(out.provenance) && out.provenance.sourcePath) || null,
		kind: 'strategy-catalog'
	};
	return { ok: true, entry: out };
}

function verified_catalog(input) {
	let options = object(input) ? input : {};
	let root = options.root || null;
	let result;
	try { result = strategy_catalog_load(root); } catch (e) {
		return error('EVERIFY', 'Avatar catalog verification raised an exception');
	}
	if (!object(result) || result.ok != true || !object(result.catalog))
		return result && result.error ? { ok: false, error: result.error } : error('EVERIFY', 'Avatar catalog is unavailable');
	return result.catalog;
}

function catalog_entries(catalog) {
	let snapshot = { snapshotId: 'avatar-' + catalog.aggregateDigest,
		sourceCommit: catalog.source && catalog.source.commit };
	let entries = [];
	for (let id in catalog.winnerOrder || []) {
		let normalized = normalize_entry(catalog.winners[id], snapshot);
		if (!normalized.ok) return normalized;
		push(entries, normalized.entry);
	}
	return { ok: true, entries: entries, snapshotId: snapshot.snapshotId,
		sourceCommit: snapshot.sourceCommit };
}

export const strategy_source_avatar_snapshot = function(input) {
	let catalog = verified_catalog(input);
	if (!object(catalog) || !object(catalog.source)) return catalog;
	let listed = catalog_entries(catalog);
	if (!object(listed) || listed.ok != true) return listed;
	let snapshotId = 'avatar-' + catalog.aggregateDigest;
	let snapshot = {
		schema: SCHEMA,
		sourceId: SOURCE_ID,
		repository: REPOSITORY,
		sourceCommit: catalog.source.commit,
		contentDigest: catalog.aggregateDigest,
		snapshotId: snapshotId,
		entryCount: catalog.physicalEntryCount,
		normalizedEntryCount: catalog.uniqueStrategyIdCount,
		entries: listed.entries,
		immutable: true
	};
	return { ok: true, snapshot: snapshot };
};

export const strategy_source_avatar_list = function(input) {
	let catalog = verified_catalog(input);
	if (!object(catalog) || !object(catalog.winners)) return catalog;
	let listed = catalog_entries(catalog);
	if (!listed.ok) return listed;
	return { ok: true, source: strategy_source_avatar_info(), entries: listed.entries,
		snapshotId: listed.snapshotId, sourceCommit: listed.sourceCommit };
};

export const strategy_source_avatar_normalize = function(entry) {
	return normalize_entry(entry, null);
};

export const strategy_source_avatar_to_strategy = function(entry) {
	let normalized = normalize_entry(entry, null);
	if (!normalized.ok) return normalized;
	let strategy = catalog_entry_to_strategy(normalized.entry);
	return strategy == null ? error('EVERIFY', 'Avatar source entry could not be converted to Strategy')
		: { ok: true, strategy: strategy };
};
