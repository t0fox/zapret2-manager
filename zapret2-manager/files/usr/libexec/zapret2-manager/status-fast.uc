#!/usr/bin/ucode
'use strict';

// Bounded runtime observation for frequent UI polling.  The full collector
// remains the diagnostic authority; this path only observes process/queue
// state and the durable active Strategy identity.
import { readfile, stat, lsdir } from 'fs';
import { NFQUEUE, DAEMON, PATHS } from './constants.uc';
import { parse_queue } from './qlen.uc';
import { strategy_selection_get_readonly, strategy_user_get_readonly } from './strategy-state.uc';
import { nft_rules_present } from './core/nft-rule-observation.uc';

function process_rows() {
	let rows = [], entries = lsdir('/proc') || [];
	for (let i = 0; i < length(entries) && length(rows) < 64; i++) {
		let name = entries[i];
		if (!match(name, /^[0-9]+$/)) continue;
		let raw = readfile('/proc/' + name + '/cmdline');
		if (!raw) continue;
		let argv = split(raw, chr(0)), bin = length(argv) ? argv[0] : '';
		if (bin != DAEMON && index(bin, '/' + DAEMON) < 0) continue;
		push(rows, { pid: +name, binary: bin || null, cmdline: trim(join(' ', argv)) });
	}
	return rows;
}

function active_strategy() {
	let result = null;
	try { result = strategy_selection_get_readonly(); } catch (e) { result = null; }
	if (!result || result.ok !== true || !result.selected) return null;
	let selected = result.selected, name = selected.id;
	if (selected.origin == 'user') {
		try {
			let user = strategy_user_get_readonly({ id: selected.id });
			if (user && user.ok === true && user.strategy && user.strategy.name) name = user.strategy.name;
		} catch (e) { }
	}
	return { id: selected.id || null, name: name || null, origin: selected.origin || null,
		revision: selected.revision == null ? null : selected.revision };
}

function engine_contract() {
	let config = stat(PATHS.applied_conf) != null;
	let binary = stat(PATHS.nfqws_bin) != null;
	let init = stat(PATHS.upstream_init) != null;
	return { installed: config && binary && init, runtimeContract: config && binary && init };
}

// Keep this observation cheap enough for the fast status path.  The full
// collector exposes the same shape, and the Dashboard uses it for the
// autostart card when status_fast is the selected transport.
function autostart_observation() {
	let enabled = false, links = [];
	try {
		let entries = lsdir('/etc/rc.d') || [];
		for (let i = 0; i < length(entries); i++) {
			if (index(entries[i], 'zapret2') < 0) continue;
			push(links, entries[i]);
			if (substr(entries[i], 0, 1) == 'S') enabled = true;
		}
	} catch (e) { }
	return { enabled: enabled, symlinks: links };
}

function queue_observation(rows) {
	let q = parse_queue(), ownerConflict = false, ownerPid = null;
	if (q.registered) {
		ownerPid = q.peer_portid;
		ownerConflict = true;
		for (let i = 0; i < length(rows); i++) if (rows[i].pid == q.peer_portid) { ownerConflict = false; break; }
	}
	return { number: NFQUEUE, registered: q.registered, reason: q.reason || null,
		peerPortid: q.peer_portid, ownerPid: ownerPid, ownerConflict: ownerConflict,
		queueTotal: q.queue_total, copyRange: q.copy_range,
		queueDropped: q.queue_dropped, queueUserDropped: q.queue_user_dropped };
}

function service_state(contract, rows, queue) {
	if (!contract.installed) return 'engine_missing';
	let present = length(rows) > 0, registered = queue.registered === true;
	if (stat(PATHS.paused_flag) != null) return present ? 'error' : 'paused';
	if (!present && !registered) return 'stopped';
	if (queue.ownerConflict === true) return 'error';
	if (present !== registered) return 'error';
	return 'running';
}

function runtime_summary(state, rows, queue, rules) {
	let present = length(rows) > 0, registered = queue.registered === true;
	let summaryState = state == 'running' ? 'running' : state == 'stopped' || state == 'paused' ? 'stopped' : state;
	return { schemaVersion: 1, source: 'status-fast.v1', status: summaryState,
		reasonCode: state == 'running' ? 'process-and-nfqueue-confirmed' : state == 'stopped' ? 'process-confirmed-absent' : 'runtime-evidence-incomplete',
		service: { configured: null, running: present },
		process: { found: present, pid: present ? rows[0].pid : null, startTime: null, executable: present ? 'nfqws2' : null, identityVerified: present },
		runtime: { argvAvailable: present, argvHash: null, argvHashAlgorithm: null, appliedMatch: null, verification: 'unknown' },
		nfqueue: { number: NFQUEUE, registered: registered, ownerMatches: registered ? !queue.ownerConflict : null, rulesPresent: rules },
		watchdog: { running: null, lastSeenProcess: null } };
}

function collect() {
	let contract, rows, queue, selected, rules = null;
	try { contract = engine_contract(); rows = process_rows(); queue = queue_observation(rows); selected = active_strategy(); }
	catch (e) { return { ok: false, schema: 'status-fast.v1', state: 'unavailable', error: { code: 'EFAST_STATUS', message: 'Не удалось собрать быстрый runtime status.' } }; }
	try { rules = nft_rules_present(); } catch (e) { rules = null; }
	let state = service_state(contract, rows, queue);
	return { ok: true, schema: 'status-fast.v1', generatedAt: time(), generation: selected ? selected.revision : null,
		serviceState: state, engine: contract, runtime: { present: length(rows) > 0, instances: rows, count: length(rows), rulesPresent: rules },
		health: { queue: queue }, strategyStatus: selected, system: { autostart: autostart_observation() }, runtimeSummary: runtime_summary(state, rows, queue, rules),
		warnings: queue.ownerConflict ? [{ code: 'queue_owner_conflict', message: 'NFQUEUE зарегистрирован не процессом nfqws2.', severity: 'error' }] : [] };
}

print(sprintf('%J', collect()) + '\n');
