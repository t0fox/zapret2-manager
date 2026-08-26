'use strict';
import { readfile, writefile, stat, unlink, mkdir, popen, readlink } from 'fs';
import { strategy_catalog_resolve, strategy_catalog_write_read_index } from './strategy-catalog.uc';

const STATE_PATH = '/tmp/zapret2-manager/catalog-refresh.json';
const STATE_TMP = STATE_PATH + '.tmp';
const STALE_SECONDS = 120;
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
  let tmp = STATE_TMP + '.' + now() + '.' + Math.random();
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

export const catalog_refresh_status = function() {
  let s = state_load();
  if (s == null) return { ok: true, state: 'idle', operationId: null, startedAt: null, finishedAt: null, result: null, error: null };
  // stale recovery
  if (s.state == 'running' && is_stale(s)) {
    s.state = 'error';
    s.error = { code: 'ESTALE', message: 'Catalog refresh worker is stale (no heartbeat)' };
    s.finishedAt = now();
    state_save(s);
  }
  return { ok: true, operationId: s.operationId, state: s.state, phase: s.phase || null, percent: s.percent || 0, startedAt: s.startedAt || null, finishedAt: s.finishedAt || null, result: s.result || null, error: s.error || null };
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
    pid: null
  };
  if (!state_save(rec)) return { ok: false, error: { code: 'EIO', message: 'Could not persist refresh operation' } };
  // launch worker
  let worker_code = 'import { strategy_catalog_resolve, strategy_catalog_write_read_index } from "/usr/libexec/zapret2-manager/strategy-catalog.uc"; let s=require("fs"); let st=s.readfile("/tmp/zapret2-manager/catalog-refresh.json"); let cur=json(st); cur.phase="verifying"; cur.percent=15; cur.heartbeatAt=time(); s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n"); let r=strategy_catalog_resolve({forceVerify:true}); if (!r || r.ok!=true) { cur.state="error"; cur.error=r && r.error ? r.error : {code:"EVERIFY",message:"forceVerify failed"}; cur.finishedAt=time(); s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n"); exit(1); } cur.phase="indexing"; cur.percent=60; cur.heartbeatAt=time(); s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n"); let w=strategy_catalog_write_read_index(null); cur.phase="activating"; cur.percent=80; cur.heartbeatAt=time(); s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n"); if (!w || w.ok!=true || w.written!=true) { cur.state="error"; cur.error=w && w.error ? w.error : {code:"EINDEX",message:"index rebuild failed"}; cur.finishedAt=time(); s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n"); exit(1); } cur.state="completed"; cur.phase="done"; cur.percent=100; cur.finishedAt=time(); cur.result={ok:true, digest:r.aggregateDigest, root:r.root}; s.writefile("/tmp/zapret2-manager/catalog-refresh.json", sprintf("%J", cur)+"\\n");';
  let cmd = 'sh -c ' + shell('/usr/bin/ucode -e ' + shell(worker_code) + ' >/tmp/catalog-refresh.log 2>&1 &');
  let p = popen(cmd, 'r');
  if (p) p.close();
  // update with pid if possible (not critical)
  return { ok: true, accepted: true, operationId: opId, state: 'running', phase: 'queued', percent: 5, startedAt: rec.startedAt };
};

// For CLI testing
export const catalog_refresh_worker_run = function() {
  let s = state_load();
  if (s == null) return { ok: false, error: { code: 'ENOENT', message: 'No refresh operation' } };
  s.phase = 'verifying';
  s.percent = 15;
  s.heartbeatAt = now();
  state_save(s);
  let r = strategy_catalog_resolve({forceVerify: true});
  if (!r || r.ok != true) {
    s.state = 'error';
    s.error = r && r.error ? r.error : { code: 'EVERIFY', message: 'forceVerify failed' };
    s.finishedAt = now();
    state_save(s);
    return s;
  }
  s.phase = 'indexing';
  s.percent = 60;
  s.heartbeatAt = now();
  state_save(s);
  let w = strategy_catalog_write_read_index(null);
  s.phase = 'activating';
  s.percent = 80;
  s.heartbeatAt = now();
  state_save(s);
  if (!w || w.ok != true || w.written != true) {
    s.state = 'error';
    s.error = w && w.error ? w.error : { code: 'EINDEX', message: 'index rebuild failed' };
    s.finishedAt = now();
    state_save(s);
    return s;
  }
  s.state = 'completed';
  s.phase = 'done';
  s.percent = 100;
  s.finishedAt = now();
  s.result = { ok: true, digest: r.aggregateDigest, root: r.root };
  state_save(s);
  return s;
};
