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
