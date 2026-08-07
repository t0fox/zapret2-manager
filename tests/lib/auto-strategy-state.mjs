export const DEFAULT_AUTO_STATE = Object.freeze({
	schema: 1, revision: 0, enabled: false, serviceIds: [], phase: 'disabled',
	consecutiveFailures: 0, activeRunId: null, lastGoodCandidateId: null,
	lastGoodProfileRevision: null, lastGoodEvidenceId: null, lastCheckAt: null,
	lastSuccessAt: null, lastFailureAt: null, lastRunAt: null, cooldownUntil: null,
	lastHealthJobId: null, infrastructureFailures: 0, scanRequestedAt: null, pendingApplyRunId: null,
	lastBootCheckAt: null, infrastructureStatus: null, currentAppliedRevision: null, currentAppliedHash: null,
	lastGoodRevision: null, lastGoodHash: null, divergenceStatus: null, interruptedOperation: null,
	recoveryStatus: null, lastError: null
});

const PHASES = new Set(['disabled', 'waiting-network', 'healthy', 'degraded', 'scanning', 'applying', 'verifying', 'cooldown', 'failed']);
const nullableString = (value, pattern = null) => typeof value === 'string' && (!pattern || pattern.test(value)) ? value : null;
const serviceIds = (value) => Array.isArray(value) ? [...new Set(value.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(x)))].slice(0, 16) : [];

export function normalizeAutoState(value) {
	if (!value || value.schema !== 1) return { ...DEFAULT_AUTO_STATE };
	const phase = PHASES.has(value.phase) ? value.phase : 'disabled';
	return {
		...DEFAULT_AUTO_STATE,
		revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
		enabled: value.enabled === true,
		serviceIds: serviceIds(value.serviceIds),
		phase: value.enabled === true ? phase : 'disabled',
		consecutiveFailures: Number.isInteger(value.consecutiveFailures) ? Math.max(0, Math.min(value.consecutiveFailures, 99)) : 0,
		activeRunId: nullableString(value.activeRunId, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/),
		lastGoodCandidateId: nullableString(value.lastGoodCandidateId, /^[a-zA-Z0-9._:@-]{1,128}$/),
		lastGoodProfileRevision: nullableString(value.lastGoodProfileRevision, /^[a-zA-Z0-9._:@-]{1,128}$/),
		lastGoodEvidenceId: nullableString(value.lastGoodEvidenceId, /^[a-zA-Z0-9._:@-]{1,160}$/),
		lastCheckAt: Number.isFinite(value.lastCheckAt) ? value.lastCheckAt : null,
		lastSuccessAt: Number.isFinite(value.lastSuccessAt) ? value.lastSuccessAt : null,
		lastFailureAt: Number.isFinite(value.lastFailureAt) ? value.lastFailureAt : null,
		lastRunAt: Number.isFinite(value.lastRunAt) ? value.lastRunAt : null,
		cooldownUntil: Number.isFinite(value.cooldownUntil) ? value.cooldownUntil : null,
		lastHealthJobId: nullableString(value.lastHealthJobId, /^job-[a-zA-Z0-9._-]{1,128}$/),
		infrastructureFailures: Number.isInteger(value.infrastructureFailures) ? Math.max(0, Math.min(value.infrastructureFailures, 99)) : 0,
		scanRequestedAt: Number.isFinite(value.scanRequestedAt) ? value.scanRequestedAt : null,
		pendingApplyRunId: nullableString(value.pendingApplyRunId, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/),
		lastBootCheckAt: Number.isFinite(value.lastBootCheckAt) ? value.lastBootCheckAt : null,
		infrastructureStatus: nullableString(value.infrastructureStatus),
		currentAppliedRevision: nullableString(value.currentAppliedRevision, /^[a-zA-Z0-9._:@-]{1,128}$/),
		currentAppliedHash: nullableString(value.currentAppliedHash, /^[a-f0-9]{64}$/),
		lastGoodRevision: nullableString(value.lastGoodRevision, /^[a-zA-Z0-9._:@-]{1,128}$/),
		lastGoodHash: nullableString(value.lastGoodHash, /^[a-f0-9]{64}$/),
		divergenceStatus: nullableString(value.divergenceStatus),
		interruptedOperation: value.interruptedOperation && typeof value.interruptedOperation === 'object' ? { phase: nullableString(value.interruptedOperation.phase), reason: nullableString(value.interruptedOperation.reason), at: Number.isFinite(value.interruptedOperation.at) ? value.interruptedOperation.at : null } : null,
		recoveryStatus: nullableString(value.recoveryStatus),
		lastError: nullableString(value.lastError)
	};
}

export function transitionAutoState(value, event) {
	const state = normalizeAutoState(value);
	const at = Number.isFinite(event?.at) ? event.at : null;
	if (event?.kind === 'healthy') return { ...state, phase: state.enabled ? 'healthy' : 'disabled', consecutiveFailures: 0, lastCheckAt: at, lastSuccessAt: at, lastError: null };
	if (event?.kind === 'strategy-failure') return { ...state, phase: 'degraded', consecutiveFailures: Math.min(99, state.consecutiveFailures + 1), lastCheckAt: at, lastFailureAt: at };
	return state;
}
