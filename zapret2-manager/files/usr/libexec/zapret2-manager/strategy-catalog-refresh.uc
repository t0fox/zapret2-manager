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
function refresh_source(state, id, enabled, fetchPercent, verifyPercent) {
  phase(state, id + '-fetch', fetchPercent);
  let refreshed = null;
  try { refreshed = source_refresh.strategy_source_refresh(id); }
  catch (e) { refreshed = { ok: false, error: { code: 'EUNAVAILABLE', message: 'Strategy source refresh raised an exception' } }; }
  phase(state, id + '-verify', verifyPercent);
  let fallback = refreshed && refreshed.ok == true ? null : refreshed && refreshed.error || { code: 'EUNAVAILABLE', message: 'Strategy source refresh failed' };
  let row = current_source_row(id, enabled);
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

export const catalog_refresh_status = function() {
  let s = state_load();
  if (s == null) return { ok: true, state: 'idle', operationId: null, phase: null, phaseHistory: [], startedAt: null, finishedAt: null, result: null, error: null };
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
    cur.state = 'error';
    cur.error = { code: 'ESTALE', message: 'Previous refresh stale, starting new' };
    cur.finishedAt = now();
    state_save(cur);
  }
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
  let generationSources = {}, sourceSnapshots = {}, enabledCount = 0, freshCount = 0;
  for (let id in ['avatar', 'z2k']) {
    let enabled = config.sources[id] && config.sources[id].enabled == true;
    if (!enabled) continue;
    enabledCount++;
    let refreshed = refresh_source(s, id, enabled, id == 'avatar' ? 15 : 35, id == 'avatar' ? 25 : 45);
    if (!refreshed.ok) return failure(s, refreshed);
		generationSources[id] = refreshed.row;
		sourceSnapshots[id] = { mode: refreshed.mode, snapshotId: refreshed.row.currentSnapshotId,
		  sourceCommit: refreshed.row.snapshot.sourceCommit, error: refreshed.error, transport: refreshed.transport };
    if (refreshed.mode == 'fresh') freshCount++;
  }
  let active = null;
  try { active = strategy_catalog_generation_read(); } catch (e) { active = null; }
  if (enabledCount > 0 && freshCount == 0) {
    if (!active || active.ok != true)
      return failure(s, { ok: false, error: { code: 'EUNAVAILABLE', message: 'No enabled strategy source has a usable LKG and no active generation exists' } });
    return completed(s, { ok: true, preserved: true, generationId: active.index.generationId,
      sourceSnapshots: sourceSnapshots });
  }
  phase(s, 'merge', 60);
  let users = user_entries();
  phase(s, 'indexing', 75);
  let published = null;
  try {
    published = strategy_catalog_generation_publish({ generatedAt: now(), sources: generationSources,
      userRevision: users.revision, userEntries: users.entries });
  } catch (e) { published = { ok: false, error: { code: 'EINDEX', message: 'Strategy generation publication raised an exception' } }; }
  phase(s, 'activating', 90);
  if (!published || published.ok != true) return failure(s, published);
  return completed(s, { ok: true, generationId: published.generationId, indexDigest: published.indexDigest,
    sourceSnapshots: sourceSnapshots });
};
