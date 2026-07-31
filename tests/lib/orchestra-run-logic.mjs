const PROTOCOLS = new Set(['tcp_https', 'quic_udp']);
const TRANSITIONS = {
	queued: ['preparing', 'stopping', 'interrupted', 'failed'],
	preparing: ['baseline', 'stopping', 'failed'],
	baseline: ['testing', 'stopping', 'failed'],
	testing: ['paused', 'ranking', 'stopping', 'failed'],
	paused: ['testing', 'stopping', 'failed'],
	ranking: ['completed', 'failed'],
	completed: ['applying'], applying: ['applied', 'completed', 'failed'],
	applied: [], stopping: ['stopped', 'failed'], stopped: [], failed: [], interrupted: []
};

export function validateStart(input = {}) {
	const targetType = input.targetType;
	if (!['domain', 'service'].includes(targetType)) return { ok: false, error: 'targetType must be domain or service' };
	const protocols = Array.isArray(input.protocols) ? input.protocols : [];
	if (!protocols.length || protocols.some(p => !PROTOCOLS.has(p))) return { ok: false, error: 'protocols must contain supported protocol IDs' };
	const domain = String(input.domain || '').trim().toLowerCase().replace(/\.$/, '');
	if (targetType === 'domain' && (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) return { ok: false, error: 'domain must be a hostname' };
	const repeats = input.repeats ?? 2, perAttemptTimeoutSec = input.perAttemptTimeoutSec ?? 20, totalTimeoutSec = input.totalTimeoutSec ?? 600;
	if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !Number.isInteger(perAttemptTimeoutSec) || perAttemptTimeoutSec < 1 || perAttemptTimeoutSec > 120 || !Number.isInteger(totalTimeoutSec) || totalTimeoutSec < perAttemptTimeoutSec || totalTimeoutSec > 1800) return { ok: false, error: 'timeout or repeat bounds invalid' };
	return { ok: true, value: { targetType, ...(targetType === 'domain' ? { domain } : { targetId: input.targetId }), protocols, candidateMode: input.candidateMode ?? 'recommended', candidateIds: input.candidateIds ?? [], repeats, perAttemptTimeoutSec, totalTimeoutSec } };
}

export function transition(from, to) { return { ok: !!TRANSITIONS[from]?.includes(to), from, to }; }

export function appendBoundedEvent(events, event) { return [...events, event].slice(-500); }

export function scoreCandidate(candidate, repeats) {
	const attempts = candidate.attempts || [], byProtocol = new Map();
	for (const a of attempts) { if (!byProtocol.has(a.protocol)) byProtocol.set(a.protocol, []); byProtocol.get(a.protocol).push(a); }
	const supported = [...byProtocol.entries()].filter(([, v]) => v.some(a => a.status !== 'unsupported'));
	const passedProtocols = supported.filter(([, v]) => v.filter(a => a.success).length >= repeats).map(([p]) => p);
	const successCount = attempts.filter(a => a.success).length;
	const timedOut = attempts.some(a => a.timeout || a.status === 'timeout');
	const durations = attempts.filter(a => Number.isFinite(a.durationMs)).map(a => a.durationMs).sort((a, b) => a - b);
	const medianDurationMs = durations.length ? durations[Math.floor(durations.length / 2)] : null;
	const httpsStable = passedProtocols.includes('tcp_https');
	const quicStable = passedProtocols.includes('quic_udp');
	const stability = httpsStable && attempts.filter(a => a.protocol === 'tcp_https' && a.success).length >= repeats ? 'stable' : successCount ? 'unstable' : 'failed';
	const score = (httpsStable ? 10000 : 0) + (quicStable ? 1000 : 0) + successCount * 10 - (timedOut ? 100 : 0) - (medianDurationMs || 0) / 100000;
	const verdict = httpsStable ? (quicStable ? 'best' : 'working') : (supported.length ? (successCount ? 'unstable' : 'failed') : 'unsupported');
	return { strategyId: candidate.strategyId, successCount, attemptCount: attempts.length, supportedProtocolCount: supported.length, passedProtocols, failedProtocols: supported.filter(([p]) => !passedProtocols.includes(p)).map(([p]) => p), stability, medianDurationMs, score, verdict, reason: httpsStable ? 'repeatable HTTPS evidence' : 'no repeatable HTTPS evidence' };
}
