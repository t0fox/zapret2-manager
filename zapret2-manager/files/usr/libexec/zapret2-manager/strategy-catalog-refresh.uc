'use strict';
import { readfile, writefile, stat, unlink, mkdir, popen, readlink } from 'fs';
import { strategy_catalog_read_index } from './strategy-catalog.uc';
import { strategy_catalog_generation_publish, strategy_catalog_generation_read } from './strategy-catalog-generation.uc';
import * as source_refresh from './strategy-source-refresh.uc';
import * as source_store from './strategy-sources.uc';

const STATE_PATH = getenv('Z2M_STRATEGY_CATALOG_REFRESH_STATE_PATH') || '/tmp/zapret2-manager/catalog-refresh.json';
const STATE_TMP = STATE_PATH + '.tmp';
const STALE_SECONDS = 300;
const MAX_STATE_BYTES = 64 * 1024;

function object(v) { return type(v) == 'object' && v != null; }
function string(v) { return type(v) == 'string'; }
function now() { return time(); }
function shell(v) {
  let out = "'";
  for (let i = 0; i < length(v); i++) out += substr(v, i, 1) == "'" ? "'\\''" : substr(v, i, 1);
  return out + "'";
}
function ensure_parent() {
  try { mkdir('/tmp/zapret2-manager'); } catch(e) {}
  try { mkdir('/tmp/zapret2-manager/catalog-refresh'); } catch(e) {}
}
function state_load() {
  let raw = null;
  try { raw = readfile(STATE_PATH); } catch(e) { return null; }
  if (!string(raw) || length(raw) > MAX_STATE_BYTES) return null;
  try {
    let v = json(raw);
    if (!object(v) || !string(v.operationId) || !string(v.state)) return null;
    return v;
  } catch(e) { return null; }
}
function state_save(obj) {
  ensure_parent();
  let tmp = STATE_TMP + '.' + now() + '.' + sprintf('%08x', time() % 100000000);
  try { writefile(tmp, sprintf('%J', obj) + '\n'); } catch(e) { return false; }
  let p = popen('mv -f ' + shell(tmp) + ' ' + shell(STATE_PATH) + ' 2>/dev/null', 'r');
  let rc = p ? p.close() : -1;
  if (rc != 0) { try { unlink(tmp); } catch(e) {} return false; }
  return true;
}
function is_stale(state) {
  if (!object(state) || !state.startedAt || !state.heartbeatAt) return true;
  return (now() - state.heartbeatAt) > STALE_SECONDS;
}
function make_id() {
  return 'cat-refresh-' + now() + '-' + sprintf('%08x', time() % 100000000);
}
function phase(state, name, percent) {
	let wasQueued = state.phase == 'queued';
	state.phase = name;
	state.percent = percent;
	state.heartbeatAt = now();
	if (type(state.phaseHistory) != 'array') state.phaseHistory = wasQueued ? ['queued'] : [];
  if (!length(state.phaseHistory) || state.phaseHistory[length(state.phaseHistory) - 1] != name)
    push(state.phaseHistory, name);
  state_save(state);
}
function failure(state, result) {
  state.state = 'error';
  state.error = result && result.error ? result.error : { code: 'EUNAVAILABLE', message: 'Strategy source refresh failed' };
  state.finishedAt = now();
  state.heartbeatAt = state.finishedAt;
  state_save(state);
  return state;
}
function completed(state, result) {
  state.state = 'completed';
  state.transaction = null;
  phase(state, 'done', 100);
  state.finishedAt = now();
  state.result = result;
  state.error = null;
  state_save(state);
  return state;
}
function current_source_row(id, enabled) {
  let current = null;
  try { current = source_store.strategy_source_current_snapshot(id); } catch (e) { current = null; }
  if (!current || current.ok != true || current.snapshot == null)
    return { ok: false, error: current && current.error || { code: 'EUNAVAILABLE', message: 'Enabled strategy source has no current LKG snapshot' } };
  return { ok: true, row: { enabled: enabled == true, currentSnapshotId: current.snapshot.snapshotId, snapshot: current.snapshot } };
}
function source_activations(config) {
	let result = {};
	for (let id in ['avatar', 'z2k']) {
		let row = config.sources[id];
		if (!object(row)) continue;
		result[id] = { currentSnapshotId: row.currentSnapshotId,
			lastKnownGoodSnapshotId: row.lastKnownGoodSnapshotId };
	}
	return result;
}
function desired_sources(config, generationSources) {
	let result = {};
	for (let id in ['avatar', 'z2k']) {
		let enabled = config.sources[id] && config.sources[id].enabled == true;
		result[id] = { enabled: enabled, snapshotId: enabled && generationSources[id]
			? generationSources[id].currentSnapshotId : null };
	}
	return result;
}
function generation_matches_transaction(transaction) {
	if (!object(transaction) || (transaction.phase != 'publishing' && transaction.phase != 'published')
		|| !object(transaction.desiredSources)) return false;
	let active = null;
	try { active = strategy_catalog_generation_read(); } catch (e) { active = null; }
	if (!active || active.ok != true || !object(active.index.sources)) return false;
	for (let id in ['avatar', 'z2k']) {
		let expected = transaction.desiredSources[id], actual = active.index.sources[id];
		if (!object(expected)) return false;
		if (expected.enabled == true) {
			if (!object(actual) || actual.snapshotId != expected.snapshotId) return false;
		} else if (actual != null) return false;
	}
	return true;
}
function clear_transaction(state) {
	state.transaction = null;
	state.heartbeatAt = now();
	return state_save(state);
}
function rollback_sources(activations) {
	let failures = [];
	for (let id in ['avatar', 'z2k']) {
		if (!object(activations[id])) continue;
		let restored = null;
		try { restored = source_store.strategy_source_restore_activation(id, activations[id]); }
		catch (e) { restored = { ok: false, error: { code: 'EIO', message: 'Source activation rollback raised an exception' } }; }
		if (!restored || restored.ok != true) push(failures, { sourceId: id, error: restored && restored.error || { code: 'EIO', message: 'Source activation rollback failed' } });
	}
	return failures;
}
function finish_transaction_error(state, result) {
	state.transaction = null;
	state.state = 'error';
	state.error = result && result.error ? result.error : { code: 'EUNAVAILABLE', message: 'Catalog transaction failed' };
	state.finishedAt = now();
	state.heartbeatAt = state.finishedAt;
	return state_save(state);
}
function recovery_failure(state, transaction, error) {
	state.state = 'error';
	state.phase = 'recovery';
	state.percent = 0;
	state.error = error;
	state.finishedAt = now();
	state.heartbeatAt = state.finishedAt;
	state.transaction = transaction;
	state_save(state);
	return state;
}
function recover_transaction(state) {
	let transaction = state && state.transaction;
	if (!object(transaction)) return state;
	// A journal is committed only after the generation pointer is known to
	// contain the staged source set. Before that point, source activation and
	// optional enablement config are rolled back on the next RPC after a crash.
	if (generation_matches_transaction(transaction)) {
		state.transaction = null;
		state.state = 'completed';
		state.phase = 'done';
		state.percent = 100;
		state.error = null;
		state.result = { ok: true, recovered: 'committed', generationId: null };
		state.finishedAt = now();
		state.heartbeatAt = state.finishedAt;
		state_save(state);
		return state;
	}
	let failures = rollback_sources(transaction.previousActivations || {});
	if (transaction.previousConfig != null) {
		let loaded = null;
		try { loaded = source_store.strategy_sources_get(); } catch (e) { loaded = null; }
		if (!loaded || loaded.ok != true) push(failures, { sourceId: 'config', error: loaded && loaded.error || { code: 'EIO', message: 'Source config recovery could not be read' } });
		else {
			let restored = source_store.strategy_sources_restore_config(transaction.previousConfig, loaded.config.revision);
			if (!restored || restored.ok != true) push(failures, { sourceId: 'config', error: restored && restored.error || { code: 'EIO', message: 'Source config recovery failed' } });
		}
	}
	if (length(failures) > 0)
		return recovery_failure(state, transaction, { code: 'ERECOVERY', message: 'Catalog transaction recovery could not restore all authorities', rollback: failures });
	state.transaction = null;
	state.state = 'error';
	state.phase = 'recovery';
	state.percent = 0;
	state.error = { code: 'ERECOVERED', message: 'Interrupted catalog transaction was rolled back before the next operation' };
	state.recovery = { action: 'rollback', operationId: state.operationId };
	state.finishedAt = now();
	state.heartbeatAt = state.finishedAt;
	state_save(state);
	return state;
}
function transaction_checkpoint(state, transaction, phaseName, percent) {
	state.transaction = transaction;
	phase(state, phaseName, percent);
	return state_save(state);
}
function new_transaction_state(transaction, phaseName) {
	let stamp = now();
	return { operationId: make_id(), state: 'running', phase: phaseName, percent: 10,
		startedAt: stamp, heartbeatAt: stamp, finishedAt: null, result: null, error: null,
		pid: null, phaseHistory: [phaseName], transaction: transaction };
}
function failure_with_rollback(state, result, activations) {
	let failures = rollback_sources(activations);
	if (length(failures) > 0) {
		let wrapped = result && result.error ? result.error : { code: 'EUNAVAILABLE', message: 'Strategy source refresh failed' };
		wrapped.rollback = failures;
		result = { ok: false, error: wrapped };
	} else state.transaction = null;
	return failure(state, result);
}
function refresh_source(state, id, enabled, fetchPercent, verifyPercent) {
  phase(state, id + '-fetch', fetchPercent);
  let refreshed = null;
  try { refreshed = source_refresh.strategy_source_refresh_prepare(id); }
  catch (e) { refreshed = { ok: false, error: { code: 'EUNAVAILABLE', message: 'Strategy source refresh raised an exception' } }; }
  phase(state, id + '-verify', verifyPercent);
  let fallback = refreshed && refreshed.ok == true ? null : refreshed && refreshed.error || { code: 'EUNAVAILABLE', message: 'Strategy source refresh failed' };
  let row = refreshed && refreshed.ok == true && refreshed.snapshot
    ? { ok: true, row: { enabled: enabled == true, currentSnapshotId: refreshed.snapshot.snapshotId, snapshot: refreshed.snapshot } }
    : current_source_row(id, enabled);
  if (!row.ok) return { ok: false, error: fallback || row.error };
	return { ok: true, row: row.row, mode: fallback == null ? 'fresh' : 'lkg', error: fallback,
		transport: refreshed && refreshed.metadataTransport || null };
}
function user_entries() {
  let read = null;
  try { read = strategy_catalog_read_index(null); } catch (e) { read = null; }
  if (!read || read.ok != true || !read.catalog) return { revision: 0, entries: [] };
  let entries = [], physical = read.catalog.physicalEntries || [];
  for (let entry in physical)
    if (entry && entry.sourceId == 'user') push(entries, entry);
  return { revision: read.catalog.userRevision || 0, entries: entries };
}

function current_generation_sources(config) {
	let generationSources = {}, sourceIds = [];
	for (let id in ['avatar', 'z2k']) {
		if (!config.sources[id] || config.sources[id].enabled != true) continue;
		let current = current_source_row(id, true);
		if (!current.ok) return current;
		generationSources[id] = current.row;
		push(sourceIds, id);
	}
	return { ok: true, sources: generationSources, sourceIds: sourceIds };
}

// Rebuild from the exact source activation authorities. This is deliberately
// network-free and is used after a single-source refresh or enable/disable
// mutation so UI state and the unified catalog cannot drift apart.
export const catalog_refresh_rebuild = function() {
	let config = null;
	try { config = source_store.strategy_sources_get(); } catch (e) { config = null; }
	if (!config || config.ok != true) return config || { ok: false, error: { code: 'EIO', message: 'Strategy source config is unavailable' } };
	let input = current_generation_sources(config);
	if (!input.ok) return input;
	let users = user_entries();
	let published = null;
	try { published = strategy_catalog_generation_publish({ generatedAt: now(), sources: input.sources,
		userRevision: users.revision, userEntries: users.entries }); }
	catch (e) { published = { ok: false, error: { code: 'EINDEX', message: 'Strategy generation publication raised an exception' } }; }
	return published && published.ok == true ? { ok: true, generationId: published.generationId,
		indexDigest: published.indexDigest, sourceIds: input.sourceIds } : published;
};

// Synchronous single-source refresh used by the RPC boundary. The source
// adapter only prepares a private candidate; this coordinator is the sole
// path that can activate it and publish the generation that refers to it.
export const catalog_refresh_source = function(id) {
	if (id != 'avatar' && id != 'z2k') return { ok: false, error: { code: 'EINPUT', message: 'Unknown strategy source' } };
	let before = null;
	try { before = source_store.strategy_sources_get(); } catch (e) { before = null; }
	if (!before || before.ok != true) return before || { ok: false, error: { code: 'EIO', message: 'Strategy source config is unavailable' } };
	let existing = state_load();
	if (existing && existing.transaction) {
		if (existing.state == 'running' && !is_stale(existing))
			return { ok: false, error: { code: 'EBUSY', message: 'Another catalog transaction is running' }, operationId: existing.operationId };
		existing = recover_transaction(existing);
		if (existing.transaction) return { ok: false, error: existing.error || { code: 'ERECOVERY', message: 'Catalog transaction recovery is required' } };
	}
	if (existing && existing.state == 'running' && !is_stale(existing))
		return { ok: false, error: { code: 'EBUSY', message: 'Catalog refresh already running' }, operationId: existing.operationId };
	let transaction = { kind: 'source-refresh', phase: 'staged', previousActivations: source_activations(before), desiredSources: {} };
	let state = new_transaction_state(transaction, id + '-staged');
	if (!state_save(state)) return { ok: false, error: { code: 'EIO', message: 'Could not persist source transaction journal' } };
	phase(state, id + '-fetch', 20);
	let prepared = null;
	try { prepared = source_refresh.strategy_source_refresh_prepare(id); }
	catch (e) { prepared = { ok: false, error: { code: 'EUNAVAILABLE', message: 'Strategy source refresh raised an exception' } }; }
	phase(state, id + '-verify', 40);
	if (!prepared || prepared.ok != true) {
		let failed = finish_transaction_error(state, prepared);
		return { ok: false, error: failed.error, operationId: failed.operationId, state: failed };
	}
	let generationSources = {}, sourceSnapshots = {};
	for (let sourceId in ['avatar', 'z2k']) {
		if (!before.config.sources[sourceId] || before.config.sources[sourceId].enabled != true) continue;
		let row = sourceId == id
			? { ok: true, row: { enabled: true, currentSnapshotId: prepared.snapshot.snapshotId, snapshot: prepared.snapshot } }
			: current_source_row(sourceId, true);
		if (!row.ok) {
			let failed = finish_transaction_error(state, row);
			return { ok: false, error: failed.error, operationId: failed.operationId, state: failed };
		}
		generationSources[sourceId] = row.row;
	}
	// A disabled source can still be refreshed and stored as the new LKG, but
	// it must not silently enter the active generation.
	sourceSnapshots[id] = { mode: 'fresh', snapshotId: prepared.snapshot.snapshotId,
		sourceCommit: prepared.snapshot.sourceCommit, error: null, transport: prepared.metadataTransport || null };
	state.transaction.desiredSources = desired_sources(before.config, generationSources);
	state.transaction.phase = 'publishing';
	transaction_checkpoint(state, state.transaction, 'merge', 60);
	let activated = null;
	try { activated = source_store.strategy_source_install_verified_snapshot(id, { verified: true, snapshot: prepared.snapshot }); }
	catch (e) { activated = { ok: false, error: { code: 'EWRITE', message: 'Source snapshot activation raised an exception' } }; }
	if (!activated || activated.ok != true) {
		let failed = failure_with_rollback(state, activated, state.transaction.previousActivations);
		return { ok: false, error: failed.error, operationId: failed.operationId, state: failed };
	}
	let users = user_entries();
	phase(state, 'indexing', 75);
	let published = null;
	try { published = strategy_catalog_generation_publish({ generatedAt: now(), sources: generationSources,
		userRevision: users.revision, userEntries: users.entries }); }
	catch (e) { published = { ok: false, error: { code: 'EINDEX', message: 'Strategy generation publication raised an exception' } }; }
	if (!published || published.ok != true) {
		let failed = failure_with_rollback(state, published, state.transaction.previousActivations);
		return { ok: false, error: failed.error, operationId: failed.operationId, state: failed };
	}
	let result = { ok: true, sourceId: id, snapshot: prepared.snapshot,
		generationId: published.generationId, indexDigest: published.indexDigest, sourceSnapshots: sourceSnapshots };
	completed(state, result);
	return result;
};

// Canonical enable/disable transaction for RPC/UI callers. The source config
// becomes visible only together with a generation that reflects the same
// enabled-source set; a failed generation publication restores the config.
export const catalog_source_set_enabled = function(id, enabled, expectedRevision) {
	if (id != 'avatar' && id != 'z2k') return { ok: false, error: { code: 'EINPUT', message: 'Unknown strategy source' } };
	if (type(enabled) != 'bool' || type(expectedRevision) != 'int')
		return { ok: false, error: { code: 'EINPUT', message: 'Source enable mutation requires sourceId, boolean enabled, and expectedRevision' } };
	let before = source_store.strategy_sources_get();
	if (!before || before.ok != true) return before;
	let existing = state_load();
	if (existing && existing.transaction) {
		if (existing.state == 'running' && !is_stale(existing))
			return { ok: false, error: { code: 'EBUSY', message: 'Another catalog transaction is running' }, operationId: existing.operationId };
		existing = recover_transaction(existing);
		if (existing.transaction) return { ok: false, error: existing.error || { code: 'ERECOVERY', message: 'Catalog transaction recovery is required' } };
	}
	if (existing && existing.state == 'running' && !is_stale(existing))
		return { ok: false, error: { code: 'EBUSY', message: 'Catalog refresh already running' }, operationId: existing.operationId };
	if (enabled == true) {
		let current = source_store.strategy_source_current_snapshot(id);
		if (!current || current.ok != true || current.snapshot == null)
			return { ok: false, error: { code: 'EUNAVAILABLE', message: 'Cannot enable a source without a verified LKG snapshot' } };
	}
	let tx = new_transaction_state({ kind: 'source-toggle', phase: 'staged', previousActivations: source_activations(before.config), previousConfig: before.config }, 'toggle-staged');
	if (!state_save(tx)) return { ok: false, error: { code: 'EIO', message: 'Could not persist source transaction journal' } };
	let changed = source_store.strategy_source_set_enabled(id, enabled, expectedRevision);
	if (!changed || changed.ok != true) return changed;
	let desired = desired_sources(changed.config, {});
	if (enabled == true) {
		let current = source_store.strategy_source_current_snapshot(id);
		if (!current || current.ok != true || current.snapshot == null) {
			source_store.strategy_sources_restore_config(before.config, changed.config.revision);
			let unavailable = { ok: false, error: { code: 'EUNAVAILABLE', message: 'Enabled source lost its verified LKG before catalog rebuild' } };
			finish_transaction_error(tx, unavailable);
			return unavailable;
		}
		desired[id].snapshotId = current.snapshot.snapshotId;
	}
	tx.transaction.desiredSources = desired;
	tx.transaction.phase = 'publishing';
	transaction_checkpoint(tx, tx.transaction, 'toggle-publishing', 90);
	let rebuilt = catalog_refresh_rebuild();
	if (rebuilt && rebuilt.ok == true) {
		completed(tx, { ok: true, recovered: false, generationId: rebuilt.generationId, indexDigest: rebuilt.indexDigest });
		return { ok: true, config: changed.config, source: changed.source,
			generationId: rebuilt.generationId, indexDigest: rebuilt.indexDigest };
	}
	let restored = source_store.strategy_sources_restore_config(before.config, changed.config.revision);
	let failureResult = { ok: false, error: rebuilt && rebuilt.error || { code: 'EINDEX', message: 'Unified Strategy catalog could not be rebuilt' },
		config: before.config, source: before.sources[id] };
	if (!restored || restored.ok != true) failureResult.error.rollback = restored && restored.error || { code: 'EIO', message: 'Source config rollback failed' };
	if (restored && restored.ok == true) finish_transaction_error(tx, failureResult);
	return failureResult;
};

export const catalog_refresh_status = function() {
  let s = state_load();
  if (s == null) return { ok: true, state: 'idle', operationId: null, phase: null, phaseHistory: [], startedAt: null, finishedAt: null, result: null, error: null };
  if (s.transaction && (s.state != 'running' || is_stale(s))) s = recover_transaction(s);
  // stale recovery
  if (s.state == 'running' && is_stale(s)) {
    s.state = 'error';
    s.error = { code: 'ESTALE', message: 'Catalog refresh worker is stale (no heartbeat)' };
    s.finishedAt = now();
    state_save(s);
  }
  return { ok: true, operationId: s.operationId, state: s.state, phase: s.phase || null, phaseHistory: s.phaseHistory || [], percent: s.percent || 0, startedAt: s.startedAt || null, finishedAt: s.finishedAt || null, result: s.result || null, error: s.error || null };
};

export const catalog_refresh_start = function() {
  let cur = state_load();
  if (cur != null && cur.state == 'running' && !is_stale(cur)) {
    return { ok: false, error: { code: 'EBUSY', message: 'Catalog refresh already running' }, operationId: cur.operationId, state: cur.state };
  }
  // if stale, allow new
	if (cur != null && cur.state == 'running' && is_stale(cur)) {
		if (cur.transaction) cur = recover_transaction(cur);
		else {
			cur.state = 'error';
			cur.error = { code: 'ESTALE', message: 'Previous refresh stale, starting new' };
			cur.finishedAt = now();
			state_save(cur);
		}
	}
	if (cur != null && cur.transaction && cur.state != 'running') cur = recover_transaction(cur);
	if (cur != null && cur.transaction) return { ok: false, error: cur.error || { code: 'ERECOVERY', message: 'Previous catalog transaction could not be recovered' }, operationId: cur.operationId };
  let opId = make_id();
  let rec = {
    operationId: opId,
    state: 'running',
    phase: 'queued',
    percent: 5,
    startedAt: now(),
    heartbeatAt: now(),
    finishedAt: null,
    result: null,
    error: null,
    pid: null,
    phaseHistory: ['queued']
  };
  if (!state_save(rec)) return { ok: false, error: { code: 'EIO', message: 'Could not persist refresh operation' } };
  // launch worker via dedicated CLI in background — avoids inline `require("fs")` bug
  // and reuses the tested catalog_refresh_worker_run path (fs imports + correct error
  // propagation). The CLI is invoked detached; its stdout/stderr goes to a log.
  let workerCmd = '/usr/bin/ucode ' + shell('/usr/libexec/zapret2-manager/strategy-catalog-refresh-cli.uc') + ' run >/tmp/catalog-refresh.log 2>&1';
  let bg = 'sh -c ' + shell(workerCmd + ' &');
  let p = popen(bg, 'r');
  if (p) p.close();
  return { ok: true, accepted: true, operationId: opId, state: 'running', phase: 'queued', percent: 5, startedAt: rec.startedAt };
};

// For CLI testing
export const catalog_refresh_worker_run = function() {
  let s = state_load();
  if (s == null) return { ok: false, error: { code: 'ENOENT', message: 'No refresh operation' } };
  let config = null;
	try { config = source_store.strategy_sources_get(); } catch (e) { config = null; }
	if (!config || config.ok != true) return failure(s, config);
	let previousActivations = source_activations(config);
	s.transaction = { kind: 'catalog-refresh', phase: 'staged', previousActivations: previousActivations, desiredSources: {} };
	if (!state_save(s)) return failure(s, { ok: false, error: { code: 'EIO', message: 'Could not persist catalog transaction journal' } });
	let generationSources = {}, sourceSnapshots = {}, enabledCount = 0, freshCount = 0;
  for (let id in ['avatar', 'z2k']) {
    let enabled = config.sources[id] && config.sources[id].enabled == true;
    if (!enabled) continue;
    enabledCount++;
    let refreshed = refresh_source(s, id, enabled, id == 'avatar' ? 15 : 35, id == 'avatar' ? 25 : 45);
		if (!refreshed.ok) return failure_with_rollback(s, refreshed, previousActivations);
		generationSources[id] = refreshed.row;
		sourceSnapshots[id] = { mode: refreshed.mode, snapshotId: refreshed.row.currentSnapshotId,
		  sourceCommit: refreshed.row.snapshot.sourceCommit, error: refreshed.error, transport: refreshed.transport };
    if (refreshed.mode == 'fresh') freshCount++;
  }
  let active = null;
  try { active = strategy_catalog_generation_read(); } catch (e) { active = null; }
	if (enabledCount > 0 && freshCount == 0) {
    if (!active || active.ok != true)
			return failure_with_rollback(s, { ok: false, error: { code: 'EUNAVAILABLE', message: 'No enabled strategy source has a usable LKG and no active generation exists' } }, previousActivations);
    return completed(s, { ok: true, preserved: true, generationId: active.index.generationId,
      sourceSnapshots: sourceSnapshots });
	}
	s.transaction.desiredSources = desired_sources(config, generationSources);
	s.transaction.phase = 'publishing';
	// Keep the public refresh phase history stable; the nested journal phase is
	// the crash-recovery authority and is persisted before publication begins.
	state_save(s);
	phase(s, 'merge', 60);
  let users = user_entries();
  phase(s, 'indexing', 75);
	// Candidate snapshots are still private at this point. Activate them only
	// after every enabled source has parsed and the candidate generation input is
	// complete; the transaction journal lets recovery roll these pointers back
	// if publication is interrupted before the generation pointer is committed.
	phase(s, 'activating', 85);
	for (let id in ['avatar', 'z2k']) {
		let candidate = sourceSnapshots[id];
		if (!candidate || candidate.mode != 'fresh') continue;
		let activation = null;
		try { activation = source_store.strategy_source_install_verified_snapshot(id, { verified: true, snapshot: generationSources[id].snapshot }); }
		catch (e) { activation = { ok: false, error: { code: 'EWRITE', message: 'Source snapshot activation raised an exception' } }; }
		if (!activation || activation.ok != true)
			return failure_with_rollback(s, activation, previousActivations);
	}
  let published = null;
  try {
    published = strategy_catalog_generation_publish({ generatedAt: now(), sources: generationSources,
      userRevision: users.revision, userEntries: users.entries });
  } catch (e) { published = { ok: false, error: { code: 'EINDEX', message: 'Strategy generation publication raised an exception' } }; }
	phase(s, 'activating', 90);
	if (!published || published.ok != true) return failure_with_rollback(s, published, previousActivations);
  return completed(s, { ok: true, generationId: published.generationId, indexDigest: published.indexDigest,
    sourceSnapshots: sourceSnapshots });
};
