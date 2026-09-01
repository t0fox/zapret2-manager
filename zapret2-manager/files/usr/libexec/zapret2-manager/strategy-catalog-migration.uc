'use strict';

// One-way bootstrap from the verified Avatar-only catalog to the unified
// source-generation authority. This is an explicit install/maintenance path;
// ordinary catalog reads never call it and it never touches runtime state.

import * as avatar_source from './strategy-source-avatar.uc';
import * as source_refresh from './strategy-source-refresh.uc';
import * as source_store from './strategy-sources.uc';
import { strategy_catalog_resolve } from './strategy-catalog.uc';
import { strategy_catalog_generation_publish, strategy_catalog_generation_read } from './strategy-catalog-generation.uc';
import { strategy_user_list } from './strategy-state.uc';

const SOURCE_IDS = ['avatar', 'z2k'];

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function copy(value) {
	try { return json(sprintf('%J', value)); } catch (e) { return null; }
}
function error(code, message, sourceId) {
	let result = { ok: false, migrated: false, error: { code: code, message: message } };
	if (sourceId != null) result.error.sourceId = sourceId;
	return result;
}
function failure(result, sourceId, fallback) {
	if (object(result) && result.ok == false && object(result.error)) {
		let failed = error(result.error.code || 'EUNAVAILABLE', result.error.message || 'Strategy catalog migration failed', sourceId);
		failed.error.details = result.error;
		if (fallback != null) failed.fallback = fallback;
		return failed;
	}
	return error('EUNAVAILABLE', 'Strategy catalog migration failed', sourceId);
}
function current(id) {
	let result = null;
	try { result = source_store.strategy_source_current_snapshot(id); } catch (e) { result = null; }
	if (!object(result)) return error('EIO', 'Strategy source state could not be read', id);
	if (!result.ok) return failure(result, id);
	if (result.snapshot == null) return { ok: true, snapshot: null, mode: 'missing' };
	if (!object(result.snapshot) || result.snapshot.published == false
		|| type(result.snapshot.entries) != 'array')
		return error('EVERIFY', 'Recorded source snapshot is not a published immutable candidate', id);
	return { ok: true, snapshot: result.snapshot, mode: 'existing' };
}
function source_row(id, snapshot, enabled) {
	return { enabled: enabled == true, currentSnapshotId: snapshot.snapshotId, snapshot: snapshot };
}
function prepare_avatar(legacy) {
	let prepared = null;
	try { prepared = avatar_source.strategy_source_avatar_snapshot({ root: legacy.root }); }
	catch (e) { prepared = null; }
	if (!object(prepared) || prepared.ok != true || !object(prepared.snapshot))
		return failure(prepared, 'avatar', { legacyKind: legacy.kind, legacyRoot: legacy.root });
	prepared.snapshot.published = true;
	let installed = null;
	try { installed = source_store.strategy_source_install_verified_snapshot('avatar', { verified: true, snapshot: prepared.snapshot }); }
	catch (e) { installed = null; }
	if (!object(installed) || installed.ok != true) return failure(installed, 'avatar');
	return { ok: true, snapshot: prepared.snapshot, mode: 'migrated' };
}
function prepare_z2k() {
	let refreshed = null;
	try { refreshed = source_refresh.strategy_source_refresh('z2k'); }
	catch (e) { refreshed = null; }
	if (!object(refreshed) || refreshed.ok != true || !object(refreshed.snapshot))
		return failure(refreshed, 'z2k');
	return { ok: true, snapshot: refreshed.snapshot, mode: 'fresh' };
}
function user_entries() {
	let listed = null;
	try { listed = strategy_user_list(); } catch (e) { listed = null; }
	if (!object(listed) || listed.ok != true || type(listed.strategies) != 'array')
		return failure(listed, 'user');
	let entries = [];
	for (let strategy in listed.strategies) {
		if (!object(strategy) || !string(strategy.id) || strategy.id == '' || type(strategy.profiles) != 'array')
			return error('EVERIFY', 'Existing user Strategy is not canonical', 'user');
		let entry = copy(strategy);
		if (!object(entry)) return error('EINTERNAL', 'Existing user Strategy could not be copied', 'user');
		entry.canonicalId = strategy.id;
		entry.sourceId = 'user';
		entry.upstreamId = strategy.id;
		entry.provenance = { sourceId: 'user', kind: 'user-strategy',
			sourcePath: 'strategies/' + strategy.id + '.json' };
		push(entries, entry);
	}
	return { ok: true, revision: 0, entries: entries };
}
function config() {
	let result = null;
	try { result = source_store.strategy_sources_get(); } catch (e) { result = null; }
	if (!object(result) || result.ok != true || !object(result.config) || !object(result.sources))
		return failure(result, 'sources');
	return result;
}
function active_generation() {
	let result = null;
	try { result = strategy_catalog_generation_read(); } catch (e) { result = null; }
	return result;
}
function legacy_resolution() {
	let result = null;
	try { result = strategy_catalog_resolve({ forceVerify: true }); } catch (e) { result = null; }
	if (!object(result) || result.ok != true || !string(result.root)
		|| (result.kind != 'managed' && result.kind != 'package') || result.verified != true)
		return failure(result, 'avatar');
	return result;
}

export const strategy_catalog_migrate = function() {
	let existing = active_generation();
	if (object(existing) && existing.ok == true)
		return { ok: true, migrated: false, reused: true, generationId: existing.index.generationId,
			indexDigest: existing.index.indexDigest };
	// A present but invalid v3 pointer is an integrity failure, not permission
	// to fall back to a legacy directory or to silently replace the authority.
	if (object(existing) && existing.ok == false && existing.error
		&& existing.error.code != 'ESTALE') {
		return failure(existing, 'generation');
	}
	let loaded = config();
	if (!loaded.ok) return loaded;
	let sources = {}, legacy = null, sourceModes = {};
	for (let id in SOURCE_IDS) {
		let enabled = loaded.sources[id] && loaded.sources[id].enabled == true;
		if (!enabled) continue;
		let known = current(id);
		if (!known.ok) return known;
		let prepared = known.snapshot != null ? known : null;
		if (prepared == null && id == 'avatar') {
			if (legacy == null) {
				legacy = legacy_resolution();
				if (!legacy.ok) return legacy;
			}
			prepared = prepare_avatar(legacy);
		}
		if (prepared == null && id == 'z2k') prepared = prepare_z2k();
		if (!prepared || !prepared.ok) return prepared || error('EUNAVAILABLE', 'Enabled source has no verified snapshot', id);
		if (!object(prepared.snapshot) || prepared.snapshot.sourceId != id)
			return error('EVERIFY', 'Prepared source snapshot identity is inconsistent', id);
		sourceModes[id] = prepared.mode;
		sources[id] = source_row(id, prepared.snapshot, true);
	}
	let users = user_entries();
	if (!users.ok) return users;
	// Re-check before publication so a concurrent installer/maintenance task
	// wins rather than being replaced by a stale migration candidate.
	existing = active_generation();
	if (object(existing) && existing.ok == true)
		return { ok: true, migrated: false, reused: true, generationId: existing.index.generationId,
			indexDigest: existing.index.indexDigest };
	let published = null;
	try { published = strategy_catalog_generation_publish({ generatedAt: time(), sources: sources,
		userRevision: users.revision, userEntries: users.entries }); }
	catch (e) { published = null; }
	if (!object(published) || published.ok != true) return failure(published, 'generation');
	return { ok: true, migrated: true, reused: false, generationId: published.generationId,
		indexDigest: published.indexDigest, legacyKind: legacy && legacy.kind || null,
		legacyRoot: legacy && legacy.root || null, sourceModes: sourceModes,
		sourceIds: keys(sources), userCount: length(users.entries) };
};
