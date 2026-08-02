export function admitAutoApply(state, run, expectedRevision) {
	if (!state || state.revision !== expectedRevision || !run || state.pendingApplyRunId !== run.runId) return { ok: false };
	if (run.phase !== 'completed' || run.targetType !== 'service' || run.serviceVerdict !== 'ready' || run.validity !== 'valid' || run.candidateEvidenceUsable !== true) return { ok: false };
	const winners = (run.targetResults || []).flatMap((group) => (group.protocols || []).map((p) => p.winner).filter(Boolean));
	if (winners.length !== (run.targets || []).length || winners.some((winner) => !Array.isArray(winner.positiveEvidenceIds) || winner.positiveEvidenceIds.length < 2)) return { ok: false };
	return { ok: true };
}

export function buildLastGood(run, preview, applied, confirmation, now, previous) {
	if (!applied || !(applied.targetVerifications || []).every((x) => x.passed === true) || confirmation?.confirmationPassed !== true) return null;
	const winners = (run.targetResults || []).flatMap((group) => (group.protocols || []).map((p) => p.winner).filter(Boolean));
	const ids = [...new Set(winners.flatMap((winner) => winner.positiveEvidenceIds || []))].slice(0, 32);
	return { schema: 1, generation: String(now), candidateId: preview.profiles?.[0]?.candidateId || null, corpusDigest: run.candidateRegistryDigest || null, profileRevision: applied.operationId || null, profileHash: preview.changeHash || null, serviceIds: [run.serviceId].filter(Boolean), runId: run.runId, evidenceIds: ids, runtimeVerification: { status: 'partial', pid: null, processStarttime: null, queue: 300, queueOwnerMatches: null }, healthVerification: { requiredTargetsPassed: true, confirmationPassed: true }, appliedAt: now, previousLastGoodGeneration: previous?.generation || null };
}
