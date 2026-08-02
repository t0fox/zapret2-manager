import { normalizeAutoState } from './auto-strategy-state.mjs';

export const AUTO_POLICY = Object.freeze({ bootDelaySec: 90, healthIntervalSec: 30, scanCooldownSec: 900, infraBackoffBaseSec: 15, infraBackoffMaxSec: 300, strategyFailuresToScan: 3 });

export function classifyHealthMatrix(matrix) {
	if (!matrix || matrix.status !== 'completed' || !Array.isArray(matrix.rows) || matrix.rows.length === 0) return { class: 'infrastructure', reason: 'health matrix unavailable or empty' };
	const classes = matrix.rows.map((row) => row.class);
	if (classes.some((x) => ['dns', 'skipped', 'unavailable-unknown'].includes(x))) return { class: 'infrastructure', reason: 'health matrix reports an infrastructure condition' };
	if (classes.every((x) => x === 'reachable-http')) return { class: 'healthy', reason: 'all selected service probes reached HTTP' };
	if (classes.some((x) => ['connect', 'tls', 'http-application', 'unknown-timeout'].includes(x))) return { class: 'strategy-failure', reason: 'selected service probes failed beyond DNS' };
	return { class: 'infrastructure', reason: 'health matrix result is not a strategy verdict' };
}

function infra(state, now, reason) {
	const infrastructureFailures = Math.min(99, state.infrastructureFailures + 1);
	const wait = Math.min(AUTO_POLICY.infraBackoffMaxSec, AUTO_POLICY.infraBackoffBaseSec * (2 ** Math.min(8, infrastructureFailures - 1)));
	return { ...state, phase: 'waiting-network', consecutiveFailures: 0, infrastructureFailures, cooldownUntil: now + wait, lastFailureAt: now, lastError: reason };
}

export function decideAutoTick(value, input = {}) {
	let state = normalizeAutoState(value), now = Number.isFinite(input.now) ? input.now : 0;
	if (!state.enabled) return { action: 'none', state: { ...state, phase: 'disabled' } };
	if (input.health) {
		if (input.health.class === 'healthy') return { action: 'none', state: { ...state, phase: 'healthy', consecutiveFailures: 0, infrastructureFailures: 0, lastCheckAt: now, lastSuccessAt: now, lastError: null } };
		if (input.health.class === 'infrastructure') return { action: 'none', state: infra(state, now, input.health.reason || 'infrastructure failure') };
		if (input.health.class === 'strategy-failure') {
			state = { ...state, phase: 'degraded', consecutiveFailures: Math.min(99, state.consecutiveFailures + 1), infrastructureFailures: 0, lastCheckAt: now, lastFailureAt: now, lastError: input.health.reason || null };
			if (state.consecutiveFailures >= AUTO_POLICY.strategyFailuresToScan && !state.activeRunId && !state.scanRequestedAt && (!state.lastRunAt || now - state.lastRunAt >= AUTO_POLICY.scanCooldownSec)) return { action: 'scan', state: { ...state, scanRequestedAt: now } };
			return { action: 'none', state };
		}
	}
	if (input.uptime != null && input.uptime < AUTO_POLICY.bootDelaySec) return { action: 'none', state: { ...state, phase: 'waiting-network' } };
	if (input.wan === false || input.dns === false || input.engine === false || input.queue === false) return { action: 'none', state: infra(state, now, 'runtime infrastructure unavailable') };
	if (state.cooldownUntil && now < state.cooldownUntil) return { action: 'none', state };
	if (state.lastCheckAt && now - state.lastCheckAt < AUTO_POLICY.healthIntervalSec) return { action: 'none', state };
	return { action: 'health-check', state: { ...state, lastCheckAt: now } };
}
