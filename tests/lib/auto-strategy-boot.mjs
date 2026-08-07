const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:@-]{1,160}$/;
const RUN = /^or-[a-f0-9]{8}-[a-f0-9]{4}$/;

export function validateLastGood(value, meta = {}) {
	if (!meta.regular || meta.symlink || !Number.isFinite(meta.size) || meta.size > 16384) return { ok: false, reason: 'unsafe-file' };
	if (!value || value.schema !== 1 || !ID.test(value.candidateId || '') || !ID.test(value.profileRevision || '') || !HEX.test(value.profileHash || '') || !HEX.test(value.corpusDigest || '') || !RUN.test(value.runId || '')) return { ok: false, reason: 'invalid-record' };
	if (!Array.isArray(value.serviceIds) || !value.serviceIds.length || value.serviceIds.length > 16 || !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 2 || value.evidenceIds.length > 32 || !value.evidenceIds.every((x) => ID.test(x))) return { ok: false, reason: 'invalid-evidence' };
	if (value.runtimeVerification?.status !== 'verified' || value.runtimeVerification?.queueOwnerMatches !== true || value.healthVerification?.confirmationPassed !== true) return { ok: false, reason: 'unverified' };
	return { ok: true, value };
}

export function validateRunLock(lock, live) {
	if (!lock || !Number.isInteger(lock.pid) || !ID.test(lock.starttime || '') || !RUN.test(lock.runId || '') || !ID.test(lock.generation || '') || !Number.isFinite(lock.createdAt) || !Number.isFinite(lock.heartbeatAt)) return { status: 'invalid' };
	if (live.pid !== lock.pid || live.starttime !== lock.starttime || (live.now - lock.heartbeatAt) > 900) return { status: 'stale' };
	return { status: 'live' };
}

export function decideBootRecovery(state, env) {
	const next = { ...state, lastBootCheckAt: env.now };
	if (next.enabled !== true) return { action: 'none', state: { ...next, phase: 'disabled' } };
	if (env.uptime < 90) return { action: 'none', state: { ...next, phase: 'waiting-network', infrastructureStatus: 'boot-delay' } };
	const valid = validateLastGood(env.lastGood, env.lastGoodMeta || { regular: true, symlink: false, size: 1024 });
	if (!valid.ok) return { action: 'none', state: { ...next, phase: 'failed', recoveryStatus: 'manual-required', lastError: 'last-good ' + valid.reason } };
	if (env.interrupted && (env.interrupted.phase === 'applying' || env.interrupted.phase === 'verifying' || next.phase === 'recovering')) return env.recoveryFails ? { action: 'none', state: { ...next, phase: 'failed', recoveryStatus: 'failed', interruptedOperation: env.interrupted } } : { action: 'sanctioned-recovery', state: { ...next, phase: 'recovering', recoveryStatus: 'required', interruptedOperation: env.interrupted } };
	if (next.phase === 'scanning') { const lock = validateRunLock(env.runLock, { now: env.now, pid: env.runLock?.alive ? env.runLock.pid : null, starttime: env.runLock?.alive ? env.runLock.starttime : null }); if (lock.status !== 'live') return { action: 'none', state: { ...next, phase: 'cooldown', cooldownUntil: env.now + 900, interruptedOperation: { phase: 'scanning', reason: lock.status } } }; return { action: 'none', state: next }; }
	if (next.cooldownUntil > env.now) return { action: 'none', state: next };
	if (env.infrastructure !== 'ready') return { action: 'none', state: { ...next, phase: 'waiting-network', infrastructureStatus: env.infrastructure, cooldownUntil: env.now + 15 } };
	const current = env.current || {}; if (!current.present) return { action: 'none', state: { ...next, phase: 'failed', divergenceStatus: 'current-missing', recoveryStatus: 'manual-sanctioned-apply-required' } }; const matches = current.revision === env.lastGood.profileRevision && current.hash === env.lastGood.profileHash;
	return { action: 'health-check', state: { ...next, phase: current.healthy ? 'healthy' : 'degraded', infrastructureStatus: 'ready', divergenceStatus: matches ? 'matching' : (current.healthy ? 'healthy-divergent' : 'unhealthy-divergent'), recoveryStatus: 'not-needed' } };
}
