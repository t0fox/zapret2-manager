'use strict';
// User initiated strategy orchestration.  This is deliberately separate from
// orchestra.uc, which only observes zapret-auto.lua's packet-time engine.

import { readfile, writefile, stat, mkdir, unlink, lsdir } from 'fs';

const ROOT = '/tmp/zapret2-manager/orchestra-runs';
const ACTIVE = ROOT + '/active.json';
const MAX_HISTORY = 20;
const MAX_EVENTS = 500;
const PROTOCOLS = ['tcp_https', 'quic_udp'];
const TERMINAL = ['completed', 'applied', 'stopped', 'failed', 'interrupted'];
const TRANSITIONS = {
	queued: ['preparing', 'stopping', 'failed', 'interrupted'], preparing: ['baseline', 'stopping', 'failed'],
	baseline: ['testing', 'stopping', 'failed'], testing: ['paused', 'ranking', 'stopping', 'failed'],
	paused: ['testing', 'stopping', 'failed'], ranking: ['completed', 'failed'], completed: ['applying'],
	applying: ['applied', 'completed', 'failed'], stopping: ['stopped', 'failed'], applied: [], stopped: [], failed: [], interrupted: []
};

function err(code, message, details, runId, phase) { return { ok: false, error: { code: code, message: message, details: details || {}, runId: runId || null, phase: phase || null } }; }
function ensure() { try { mkdir('/tmp/zapret2-manager'); mkdir(ROOT); } catch (e) {} }
function safe_id(id) { return type(id) == 'string' && match(id, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function path(id) { return ROOT + '/' + id + '.json'; }
function load(pathname) { try { let raw = readfile(pathname); let x = raw ? json(raw) : null; return type(x) == 'object' ? x : null; } catch (e) { return null; } }
function save(run) { ensure(); writefile(path(run.runId), sprintf('%J', run)); if (!TERMINAL.includes(run.phase)) writefile(ACTIVE, sprintf('%J', { runId: run.runId })); else try { unlink(ACTIVE); } catch (e) {} }
function active() { let ref = load(ACTIVE); return ref && safe_id(ref.runId) ? load(path(ref.runId)) : null; }
function add_event(run, type, message, details) { if (!run.events) run.events = []; let sequence = length(run.events) ? run.events[length(run.events)-1].sequence + 1 : 1; push(run.events, { sequence: sequence, timestamp: time(), type: type, message: message, details: details || {} }); if (length(run.events) > MAX_EVENTS) run.events = slice(run.events, length(run.events) - MAX_EVENTS); }
function hostname(v) { let d = tolower(trim(v || '')); if (length(d) && substr(d, length(d)-1, 1) == '.') d = substr(d, 0, length(d)-1); return match(d, /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/) ? d : null; }
function valid_protocols(a) { if (type(a) != 'array' || !length(a)) return false; for (let p in a) if (!PROTOCOLS.includes(p)) return false; return true; }

export const orchestra_run_validate = function(input) {
	if (type(input) != 'object' || input == null) return err('EINPUT', 'start requires an object');
	let targetType = input.targetType;
	if (targetType != 'domain' && targetType != 'service') return err('EINPUT', 'targetType must be domain or service');
	if (!valid_protocols(input.protocols)) return err('EINPUT', 'protocols contain an unsupported value');
	let target = targetType == 'domain' ? hostname(input.domain) : trim(input.targetId || '');
	if (!target || length(target) > 253 || (targetType == 'service' && !match(target, /^[a-zA-Z0-9_.-]{1,128}$/))) return err('EINPUT', targetType == 'domain' ? 'domain must be a hostname, not a URL or command' : 'unknown or invalid service');
	let repeats = input.repeats == null ? 2 : +input.repeats;
	let perAttemptTimeoutSec = input.perAttemptTimeoutSec == null ? 20 : +input.perAttemptTimeoutSec;
	let totalTimeoutSec = input.totalTimeoutSec == null ? 600 : +input.totalTimeoutSec;
	if (repeats < 1 || repeats > 3 || perAttemptTimeoutSec < 1 || perAttemptTimeoutSec > 120 || totalTimeoutSec < perAttemptTimeoutSec || totalTimeoutSec > 1800) return err('EINPUT', 'repeat or timeout is outside the safe bounds');
	let mode = input.candidateMode || 'recommended'; if (!['recommended', 'all', 'selected'].includes(mode)) return err('EINPUT', 'candidateMode is invalid');
	if (mode == 'selected' && (type(input.candidateIds) != 'array' || !length(input.candidateIds))) return err('EINPUT', 'selected mode needs candidateIds');
	return { ok: true, value: { targetType: targetType, target: target, protocols: input.protocols, candidateMode: mode, candidateIds: input.candidateIds || [], repeats: repeats, perAttemptTimeoutSec: perAttemptTimeoutSec, totalTimeoutSec: totalTimeoutSec } };
};

export const orchestra_run_start = function(input) {
	let check = orchestra_run_validate(input); if (!check.ok) return check;
	let old = active(); if (old && !TERMINAL.includes(old.phase)) return err('EBUSY', 'an orchestration run is already active', { activeRunId: old.runId }, old.runId, old.phase);
	let nonce = sprintf('%04x', (time() * 1103515245) & 0xffff), id = 'or-' + sprintf('%08x', time()) + '-' + nonce;
	let run = { runId: id, createdAt: time(), startedAt: null, finishedAt: null, phase: 'queued', target: check.value.target, targetType: check.value.targetType, protocols: check.value.protocols, candidateIds: check.value.candidateIds, candidateMode: check.value.candidateMode, repeats: check.value.repeats, perAttemptTimeoutSec: check.value.perAttemptTimeoutSec, totalTimeoutSec: check.value.totalTimeoutSec, currentCandidate: null, currentAttempt: null, completedCount: 0, totalCount: null, progress: null, results: [], rankedResults: [], selectedWinner: null, events: [], error: null, cleanup: { status: 'pending' }, appliedOperationId: null };
	add_event(run, 'queued', 'Orchestration queued'); save(run);
	return { ok: true, run: run };
};

export const orchestra_run_status = function(input) { let r = input && input.runId ? orchestra_run_load(input) : active(); return r ? { ok: true, run: r } : err('ENOENT', 'run not found'); };
export const orchestra_run_load = function(input) { let id = input && input.runId; return safe_id(id) && stat(path(id)) ? load(path(id)) : null; };
export const orchestra_run_events = function(input) { let r = orchestra_run_load(input) || active(); if (!r) return err('ENOENT', 'run not found'); let cursor = +(input && input.cursor || 0), events = []; for (let e in r.events) if (e.sequence > cursor) push(events, e); return { ok: true, runId: r.runId, events: events, nextCursor: length(r.events) ? r.events[length(r.events)-1].sequence : cursor }; };
export const orchestra_run_transition = function(id, next) { let r = orchestra_run_load({runId:id}); if (!r) return err('ENOENT', 'run not found', {}, id); if (!TRANSITIONS[r.phase] || !TRANSITIONS[r.phase].includes(next)) return err('ESTATE', 'invalid state transition', { from: r.phase, to: next }, id, r.phase); r.phase = next; if (next == 'preparing') r.startedAt = time(); if (TERMINAL.includes(next)) r.finishedAt = time(); add_event(r, next, 'Run entered ' + next); save(r); return {ok:true,run:r}; };
export const orchestra_run_pause = function(input) { let r = active(); return !r ? err('ENOENT','no active run') : orchestra_run_transition(r.runId, 'paused'); };
export const orchestra_run_resume = function(input) { let r = active(); return !r ? err('ENOENT','no active run') : orchestra_run_transition(r.runId, 'testing'); };
export const orchestra_run_stop = function(input) { let r = active(); if (!r) return err('ENOENT','no active run'); let x = orchestra_run_transition(r.runId, 'stopping'); if (!x.ok) return x; x.run.cleanup = { status: 'completed', completedAt: time() }; x.run.phase = 'stopped'; x.run.finishedAt = time(); add_event(x.run, 'cleanup', 'Cleanup completed'); save(x.run); return {ok:true,run:x.run}; };
export const orchestra_run_history = function() { ensure(); let names = []; try { names = lsdir(ROOT) || []; } catch (e) {} let out = []; for (let n in names) if (match(n, /^or-[a-f0-9]{8}-[a-f0-9]{4}\.json$/)) { let r = load(ROOT+'/'+n); if (r) push(out, r); } out.sort((a,b) => b.createdAt-a.createdAt); return {ok:true,runs:slice(out,0,MAX_HISTORY)}; };
export const orchestra_run_delete = function(input) { let r = orchestra_run_load(input); if (!r) return err('ENOENT','run not found'); if (!TERMINAL.includes(r.phase)) return err('EBUSY','cannot delete active run',{},r.runId,r.phase); try { unlink(path(r.runId)); } catch(e) { return err('EIO','could not delete run',{},r.runId,r.phase); } return {ok:true,runId:r.runId}; };
export const orchestra_preview_best = function(input) { let r = orchestra_run_load(input); if (!r) return err('ENOENT','run not found'); if (r.phase != 'completed' || !r.selectedWinner) return err('ESTATE','a completed run with a winner is required',{},r.runId,r.phase); return {ok:true,runId:r.runId,readOnly:true,winner:r.selectedWinner,evidence:r.rankedResults}; };
export const orchestra_apply_best = function(input) { let r = orchestra_run_load(input); if (!r) return err('ENOENT','run not found'); return err('EUNSUPPORTED','Apply best is unavailable until the installed Blockcheck exposes per-candidate production changes', { runner: 'blockcheck2', productionUnchanged: true }, r.runId, r.phase); };
