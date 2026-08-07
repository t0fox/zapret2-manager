// Node reference: blockcheck job state machine (ЦЕЛЬ ТРИ).
//
// ALGORITHM SPEC for the shipped ucode jobs.uc. State machine:
//   pending → running → succeeded | failed
//                    \→ cancelled
// Transitions are forward-only; no going back to pending/running. At most one
// blockcheck job runs at a time (can_start checks the existing job). Cancel
// sets cancelled=true + finishedAt; the ucode side also KILLS the process
// (cancel is real, not just a flag). Result saved as a file.

let _seq = 0;

export function create_job(level, domains) {
	_seq++;
	return {
		id: 'job-' + Date.now() + '-' + _seq,
		status: 'pending',
		level: level,
		domains: domains || [],
		createdAt: Date.now(),
		startedAt: null,
		finishedAt: null,
		resultFile: null,
		error: null,
		cancelled: false
	};
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const VALID = {
	pending: new Set(['running', 'cancelled']),
	running: new Set(['succeeded', 'failed', 'cancelled']),
};
VALID.succeeded = new Set();
VALID.failed = new Set();
VALID.cancelled = new Set();
VALID.expired = new Set();

export function transition(job, to, extra) {
	if (!job) return job;
	const allowed = VALID[job.status] || new Set();
	if (!allowed.has(to)) return job;   // invalid transition — reject silently
	return Object.assign({}, job, { status: to, ...extra },
		(to === 'running' && !job.startedAt) ? { startedAt: Date.now() } : {},
		TERMINAL.has(to) && !job.finishedAt ? { finishedAt: Date.now() } : {}
	);
}

export function can_start(existing) {
	if (!existing) return true;
	return TERMINAL.has(existing.status);
}

export function cancel_job(job) {
	if (!job) return job;
	if (TERMINAL.has(job.status)) return job;  // already terminal — can't cancel
	return transition(job, 'cancelled', { cancelled: true });
}

export function job_status(job) {
	if (!job) return null;
	return {
		id: job.id,
		status: job.status,
		level: job.level,
		domains: job.domains,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		resultFile: job.resultFile,
		error: job.error,
		cancelled: job.cancelled
	};
}

// ===========================================================================
// SLICE 4 — full job lifecycle (generic infrastructure; blockcheck is the
// first consumer). Extend-only: the ЦЕЛЬ-ТРИ surface above is unchanged.
// Contract: docs/contracts/ubus.md "Long operations (job model)" —
//   pending → running → succeeded | failed
//           (any non-terminal) → cancelled
//           (any) → rolled_back
//           (succeeded|failed) → expired
// Records: one JSON file per job in /tmp/zapret2-manager/jobs/.
// ===========================================================================

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back', 'expired'];
export const JOB_TTL_SEC = 600;        // terminal records expire after 10 min
export const JOB_MAX_HISTORY = 10;

const TERMINAL2 = new Set(['succeeded', 'failed', 'cancelled', 'rolled_back', 'expired']);
const VALID2 = {
	pending: new Set(['running', 'cancelled', 'rolled_back']),
	running: new Set(['succeeded', 'failed', 'cancelled', 'rolled_back']),
	succeeded: new Set(['expired']),
	failed: new Set(['expired']),
	cancelled: new Set(['expired']),
	rolled_back: new Set(),
	expired: new Set(),
};

export function is_terminal(status) {
	return TERMINAL2.has(status);
}

// transition2 — forward-only full state machine. Unlike transition() (which
// silently ignores invalid moves), an invalid move returns null so the caller
// can surface a defect instead of a silent no-op.
export function transition2(job, to, extra = {}, now = Date.now()) {
	if (!job) return null;
	const allowed = VALID2[job.status];
	if (!allowed || !allowed.has(to)) return null;
	const out = Object.assign({}, job, { status: to }, extra);
	if (to === 'running' && !job.startedAt) out.startedAt = now;
	if (TERMINAL2.has(to) && !job.finishedAt) out.finishedAt = now;
	return out;
}

// make_job_record({kind, mode, domains, timeoutSec}, now, seq) — the v2 record.
export function make_job_record(spec, now, seq) {
	return {
		version: 2,
		id: 'job-' + now + '-' + seq,
		kind: spec.kind || 'blockcheck',
		mode: spec.mode || 'quick',
		domains: spec.domains || [],
		status: 'pending',
		createdAt: now,
		startedAt: null,
		finishedAt: null,
		runnerPid: null,
		childPid: null,
		runnerFingerprint: null,
		timeoutSec: spec.timeoutSec || 300,
		logPath: null,          // set by the backend (jobs/<id>.log)
		rc: null,
		error: null,
		cancelled: false,
		engineRunning: null,    // honesty flag captured at start
		recommendations: [],
		provenance: null
	};
}

// crash_recover(job, alive, now) — crash recovery decision.
//   alive = { runner: bool, child: bool }
// A non-terminal job whose runner is dead is failed with a crash-recovery
// error; a surviving child is signalled by the CALLER (ucode sends INT so
// blockcheck2.sh unpreparse its own firewall artifacts) — this function only
// decides the record side.
export function crash_recover(job, alive, now = Date.now()) {
	if (!job || is_terminal(job.status)) return null;
	if (alive.runner) return null;   // healthy
	return transition2(job, 'failed', {
		error: alive.child
			? 'runner died (crash recovery; the scanner process was interrupted)'
			: 'runner died (crash recovery)'
	}, now);
}

// sweep_jobs(records, now, {ttlSec, maxHistory}) — lazy cleanup run on every
// jobs call. Terminal records older than ttlSec become expired; when the
// total exceeds maxHistory the OLDEST terminal records are removed. Returns
// { kept, expired:[ids], removed:[ids] } — the backend deletes files for
// removed ids and rewrites records for expired ids.
export function sweep_jobs(records, now = Date.now(), opts = {}) {
	const ttlSec = opts.ttlSec || JOB_TTL_SEC;
	const maxHistory = opts.maxHistory || JOB_MAX_HISTORY;
	const expired = [];
	const removed = [];
	const kept = [];
	for (const r of records) {
		if (!r || typeof r !== 'object') { removed.push(null); continue; }   // malformed record is swept, never kept
		let cur = r;
		if (TERMINAL2.has(cur.status) && cur.status !== 'expired' && cur.finishedAt && (now - cur.finishedAt) > ttlSec * 1000) {
			const t = transition2(cur, 'expired', {}, now);
			if (t) { expired.push(cur.id); cur = t; }
		}
		kept.push(cur);
	}
	// maxHistory: remove oldest TERMINAL records beyond the cap
	if (kept.length > maxHistory) {
		const sorted = kept.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
		let excess = kept.length - maxHistory;
		const removeIds = new Set();
		for (const r of sorted) {
			if (excess <= 0) break;
			if (TERMINAL2.has(r.status)) { removeIds.add(r.id); excess--; }
		}
		if (excess > 0) {
			// still over the cap with non-terminal records only — remove oldest of any kind except the active one
			for (const r of sorted) {
				if (excess <= 0) break;
				if (!removeIds.has(r.id)) { removeIds.add(r.id); excess--; }
			}
		}
		for (const id of removeIds) removed.push(id);
		return { kept: kept.filter((r) => !removeIds.has(r.id)), expired, removed };
	}
	return { kept, expired, removed };
}

// parse_job_record(text) — a record file must be valid JSON with the v2
// shape; anything else is malformed (the sweeper removes it; job_get reports
// it honestly). Never throws.
export function parse_job_record(text) {
	if (!text) return { ok: false, malformed: true, reason: 'empty record' };
	let obj;
	try { obj = JSON.parse(text); } catch (e) { return { ok: false, malformed: true, reason: 'not valid JSON' }; }
	if (!obj || typeof obj !== 'object' || typeof obj.id !== 'string' || !JOB_STATUSES.includes(obj.status))
		return { ok: false, malformed: true, reason: 'record missing id/status (or unknown status)' };
	return { ok: true, record: obj };
}

// elapsed_sec(job, now) — the ONLY progress signal the contract allows
// (no fabricated percentage).
export function elapsed_sec(job, now = Date.now()) {
	if (!job) return null;
	if (!job.startedAt) return null;
	const end = job.finishedAt || now;
	return Math.max(0, Math.floor((end - job.startedAt) / 1000));
}
