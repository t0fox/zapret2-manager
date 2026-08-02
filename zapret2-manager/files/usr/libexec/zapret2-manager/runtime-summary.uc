'use strict';
// Single, additive runtime projection.  It consumes the status collector
// payload; consumers must treat missing evidence as unknown, never stopped.

import { readfile } from 'fs';
import { PATHS } from './constants.uc';

function bool_or_null(v) { return v === true ? true : v === false ? false : null; }
function text_or_null(v) { return type(v) == 'string' && length(v) ? v : null; }
function argv_hash(v) { let h=5381,s=''+(v||'');for(let i=0;i<length(s);i++)h=(((h<<5)+h)+ord(substr(s,i,1)))&0xFFFFFFFF;return sprintf('%08x',h); }

export const runtime_summary = function(status) {
	let runtime = status && type(status.runtime) == 'object' ? status.runtime : null;
	let health = status && type(status.health) == 'object' ? status.health : null;
	let queue = health && type(health.queue) == 'object' ? health.queue : null;
	let drift = status && type(status.drift) == 'object' ? status.drift : null;
	let instances = runtime && type(runtime.instances) == 'array' ? runtime.instances : [];
	let first = length(instances) ? instances[0] : null;
	let found = runtime ? runtime.present === true : null;
	let registered = queue ? bool_or_null(queue.registered) : null;
	let ownerMatches = queue && queue.registered === true && queue.ownerConflict != null ? !queue.ownerConflict : null;
	let appliedMatch = null;
	if (drift && drift.reason != 'process absent (nothing to compare)' && drift.reason != 'no stored apply hash (run an apply first)' && drift.divergent != null)
		appliedMatch = drift.divergent === true ? false : drift.divergent === false ? true : null;
	let state = 'unknown', reason = 'runtime-not-confirmed';
	if (found === false && registered === false) { state = 'stopped'; reason = 'process-confirmed-absent'; }
	else if (found === true && registered === true && ownerMatches === true && appliedMatch !== false) { state = 'running'; reason = 'process-and-nfqueue-confirmed'; }
	else if (found === true && appliedMatch === false) { state = 'mismatch'; reason = 'applied-mismatch'; }
	else if (found === true || registered === true) { state = 'degraded'; reason = 'runtime-evidence-incomplete'; }
	return {
		schemaVersion: 1, source: 'status-v3', status: state, reasonCode: reason,
		service: { configured: status && status.system && status.system.autostart ? bool_or_null(status.system.autostart.enabled) : null, running: null },
		process: { found: found, pid: first && type(first.pid) == 'int' ? first.pid : null, startTime: first ? text_or_null(first.startTime) : null, executable: first && text_or_null(first.binary) ? 'nfqws2' : null, identityVerified: found === true },
		runtime: { argvAvailable: first && text_or_null(first.cmdline) ? true : false, argvHash: first && text_or_null(first.cmdline) ? argv_hash(first.cmdline) : null, argvHashAlgorithm: 'djb2-32', appliedMatch: appliedMatch, verification: appliedMatch == null ? 'unknown' : appliedMatch ? 'verified' : 'failed' },
		nfqueue: { number: 300, registered: registered, ownerMatches: ownerMatches, rulesPresent: runtime ? bool_or_null(runtime.rulesPresent) : null },
		watchdog: { running: null, lastSeenProcess: null }
	};
};

export const runtime_summary_cached = function() {
	let raw = readfile(PATHS.status_json), status = null;
	try { status = raw ? json(raw) : null; } catch (e) { status = null; }
	if (status && type(status.runtimeSummary) == 'object') return status.runtimeSummary;
	return runtime_summary(status);
};
