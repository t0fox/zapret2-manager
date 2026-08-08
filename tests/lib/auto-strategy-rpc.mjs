const requestOk = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(id);
const serviceIds = (ids) => Array.isArray(ids) && ids.length <= 16 && ids.every((id) => id === 'youtube' || id === 'discord') ? [...new Set(ids)] : null;
const error = (code) => ({ ok: false, error: { code, message: 'redacted' } });

export function autoStatus(state, opts = {}) {
	if (!state) return { ok: true, schemaVersion: 1, revision: 0, enabled: false, phase: 'disabled', serviceIds: [], activeRun: { runId: null, generation: null, startedAt: null, progress: null, cancellable: false }, lastGood: { available: false }, health: { status: 'unknown' }, infrastructure: { status: 'unknown' }, capabilities: { runNow: false, stop: false, restoreLastGood: false }, verifyRouter: [] };
	if (state.schema !== 1) return { ...autoStatus(null), lastError: 'state-corrupt' };
	const verified = opts.lastGood && state.lastGoodVerification !== 'partial';
	return { ok: true, schemaVersion: 1, revision: state.revision, enabled: state.enabled, phase: state.phase, serviceIds: state.serviceIds, activeRun: { runId: state.activeRunId, generation: state.generation, startedAt: null, progress: null, cancellable: state.phase === 'scanning' }, currentApplied: { revision: state.currentAppliedRevision, hash: state.currentAppliedHash }, lastGood: { available: verified, candidateId: verified ? state.lastGoodCandidateId : null, profileRevision: verified ? state.lastGoodRevision : null, profileHash: verified ? state.lastGoodHash : null }, health: { status: state.phase === 'healthy' ? 'healthy' : 'unknown' }, infrastructure: { status: state.infrastructureStatus || 'ready', reason: null }, cooldownUntil: state.cooldownUntil, lastError: state.lastError, capabilities: { runNow: state.enabled && !state.activeRunId && state.phase !== 'recovering', stop: state.phase === 'scanning', restoreLastGood: verified && !state.activeRunId }, verifyRouter: state.lastGoodVerification === 'partial' ? ['runtime verification remains router evidence'] : [] };
}

export function autoRequest(state, req) {
	if (!requestOk(req.requestId) || !Number.isInteger(req.expectedRevision)) return error('EINPUT');
	const payload = JSON.stringify({ op: req.op, serviceIds: req.serviceIds || [] });
	const seen = state.rpcRequests?.find((x) => x.id === req.requestId);
	if (seen) return seen.payload === payload ? { ...seen.response, idempotent: true } : error('EIDEMPOTENCY');
	if (req.expectedRevision !== state.revision) return error('ECONFLICT');
	const ids = serviceIds(req.serviceIds || []); if (!ids) return error('EINPUT');
	const save = (next, response) => ({ ...response, ok: response.ok !== false, revision: next.revision, state: next });
	const store = (next, response) => { const complete = save(next, response); next.rpcRequests = [...(state.rpcRequests || []), { id: req.requestId, payload, response: complete }].slice(-16); return complete; };
	if (req.op === 'enable') return store({ ...state, enabled: true, serviceIds: ids, phase: 'waiting-network', revision: state.revision + 1 }, { action: 'health-first' });
	if (req.op === 'disable') { if (!state.enabled && !state.activeRunId && !state.pendingApplyRunId && !['applying', 'verifying', 'recovering'].includes(state.phase)) return { ok: true, status: 'already-disabled', revision: state.revision }; const scanning = state.phase === 'scanning'; const applying = ['applying', 'verifying', 'recovering'].includes(state.phase); return store({ ...state, enabled: false, disableRequested: applying, revision: state.revision + 1 }, { cancellationRequested: scanning, disablePendingSafeCompletion: applying }); }
	if (req.op === 'run') { if (!state.enabled) return error('EDISABLED'); if (state.phase === 'recovering') return error('ERECOVERY'); if (state.activeRunId) return error('EALREADY'); if (state.phase === 'applying' || state.phase === 'verifying') return error('EBUSY'); if (state.infrastructureStatus && state.infrastructureStatus !== 'ready') return error('EINFRA'); if (state.cooldownUntil && state.now < state.cooldownUntil) return error('ECOOLDOWN'); if (!state.lastGoodHash) return error('ENOLASTGOOD'); const runId = 'or-aaaaaaaa-bbbb'; return store({ ...state, activeRunId: runId, phase: 'scanning', generation: state.generation + 1, revision: state.revision + 1 }, { accepted: true, runId, generation: state.generation + 1, async: true }); }
	if (req.op === 'stop') { if (state.phase === 'recovering') return error('ERECOVERY'); if (!state.activeRunId) return { ok: true, status: 'not-running', revision: state.revision }; return store({ ...state, revision: state.revision + 1 }, { cancellationRequested: true }); }
	if (req.op === 'restore') { if (!state.lastGoodHash) return error('ENOLASTGOOD'); if (state.lastGoodVerification === 'partial') return error('ESTATE'); if (state.activeRunId || ['applying', 'verifying', 'recovering'].includes(state.phase)) return error('EBUSY'); if (state.currentAppliedHash === state.lastGoodHash) return { ok: true, status: 'already-current', revision: state.revision }; if (req.forceFailure) return { ok: false, rollbackRequested: true, state, error: { code: 'EVERIFY', message: 'redacted' } }; return store({ ...state, currentAppliedHash: state.lastGoodHash, revision: state.revision + 1 }, { accepted: true, path: 'orchestra-preview-apply-verify' }); }
	return error('EINPUT');
}
