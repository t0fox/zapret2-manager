// Node reference implementation of the status.uc runtime/queue/owner logic.
//
// ucode does not run in the build env, so this mirrors the shipped ucode so the
// serviceState, the NUL-cmdline parse, and the queue-owner reconciliation are
// unit-testable locally. The runtime shape is re-confirmed on the target via
// smoke.sh (status.uc --no-print + ubus call).
//
// Mirrors: status.uc find_pids(), reconcile_queue_owner(), service_state(),
// qlen.uc parse_queue() peer_portid. Keep in sync with those.

export const DAEMON = 'nfqws2';
export const NFQUEUE = 300;

// parse_cmdline(buf) → { argv, human, binary }
//   buf: Buffer/Uint8Array of /proc/<pid>/cmdline (NUL-separated argv, trailing NUL).
// Mirrors status.uc find_pids: split on NUL (chr(0)), re-join with spaces. ucode's
// replace(cl, '\x00', ' ') is BROKEN (inserts a space between every byte), so the
// reference and the ucode both use split-then-join. ucode join is (sep, array);
// JS array.join(sep) is used here.
export function parse_cmdline(buf) {
	const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
	// Drop the trailing NUL's empty element (a real cmdline ends with NUL).
	const argv = bytes.toString('latin1').split('\x00');
	if (argv.length && argv[argv.length - 1] === '') argv.pop();
	const human = argv.join(' ');
	return { argv, human, binary: argv.length ? argv[0] : null };
}

// match_daemon(human, daemon) → bool. Mirrors `index(human, DAEMON) >= 0`.
export function match_daemon(human, daemon = DAEMON) {
	return typeof human === 'string' && human.indexOf(daemon) >= 0;
}

// find_pids(procs, daemon) → instances[]
//   procs: [{ pid, cmdline: Buffer }]  (a /proc snapshot)
// Mirrors status.uc find_pids: parse each cmdline, match the BINARY (argv[0]),
// not the whole cmdline — a substring match on the full cmdline also matches
// shells running scripts that merely MENTION the daemon (false count).
export function find_pids(procs, daemon = DAEMON) {
	const out = [];
	for (const p of procs) {
		if (!p.cmdline || !p.cmdline.length) continue;
		const { argv, human, binary } = parse_cmdline(p.cmdline);
		const bin = binary || '';
		// match absolute-path tail '/nfqws2' OR the bare name 'nfqws2'
		if (!(bin.indexOf('/' + daemon) >= 0 || bin === daemon)) continue;
		out.push({ pid: p.pid, binary, cmdline: human.trim() });
	}
	return out;
}

// reconcile_queue_owner(runtime, queue) → warning|null
//   runtime: { instances: [{pid}, ...] }  queue: { registered, peerPortid } (mutated)
// Mirrors status.uc reconcile_queue_owner: peer_portid must match a detected
// nfqws2 PID, else ownerConflict=true + a warning. Mutates queue.ownerPid/ownerConflict.
export function reconcile_queue_owner(runtime, queue) {
	if (!queue || !queue.registered) return null;
	const pp = queue.peerPortid;
	const pids = (runtime && Array.isArray(runtime.instances)) ? runtime.instances : [];
	const owned = pids.some(p => p.pid === pp);
	queue.ownerPid = pp;
	queue.ownerConflict = !owned;
	if (queue.ownerConflict) {
		const pidList = pids.map(p => String(p.pid)).join(',');
		if (pids.length)
			return `QNUM ${NFQUEUE} registered to PID ${pp}, not to the detected nfqws2 process(es) [${pidList}]`;
		return `QNUM ${NFQUEUE} registered to PID ${pp} but no nfqws2 process is running (stale/unknown owner)`;
	}
	return null;
}

// service_state(runtime, rules, health, draft, opts) → one of
//   engine_missing | running | stopped | partial | error | paused | passthrough
// Mirrors status.uc service_state (engine availability + runtime states).
//   opts: { pausedFlag?: bool, engineInstalled?: bool }
export function service_state(runtime, rules, health, draft, opts = {}) {
	const qh = (health && health.qlenHealth) ? health.qlenHealth : null;
	const q = (health && health.queue) ? health.queue : null;
	const present = !!(runtime && runtime.present);
	if (opts.engineInstalled === false) return 'engine_missing';
	if (opts.pausedFlag) {
		// pause HELD (process down as intended); NOT held (up despite intent) → error.
		return present ? 'error' : 'paused';
	}
	if (draft && draft.passthrough && draft.passthrough.enabled) {
		return present ? 'passthrough' : 'error';
	}
	// Process ABSENT.
	if (!present) {
		// queue still registered → unknown owner → ERROR, not stopped.
		if (q && q.registered) return 'error';
		return 'stopped';
	}
	// Process PRESENT.
	if (!rules) return 'partial';
	if (q && q.registered === false) return 'error';            // up but queue not bound
	if (q && q.registered && q.ownerConflict) return 'error';   // bound by non-nfqws2
	if (qh && qh.state === 'critical') return 'error';
	return 'running';
}
