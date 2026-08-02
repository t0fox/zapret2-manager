export function boundedRunRequest(serviceId) {
	return { targetType: 'service', targetId: serviceId, candidateMode: 'zapret2gui-only', repeats: 1, perAttemptTimeoutSec: 10, totalTimeoutSec: 120, maxCandidates: 8, maxAttempts: 48 };
}

export function reconcileScanResult(state, run, now) {
	const next = { ...state, activeRunId: null, scanRequestedAt: null, lastRunAt: now };
	if (!run || run.runId !== state.activeRunId || run.phase !== 'completed' || run.serviceVerdict !== 'ready' || run.candidateEvidenceUsable !== true) {
		return { action: 'no-winner', state: { ...next, phase: 'cooldown', cooldownUntil: now + 900, lastError: 'no confirmed winner' } };
	}
	return { action: 'apply', state: { ...next, phase: 'applying', pendingApplyRunId: run.runId } };
}
