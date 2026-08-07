const STATUS_LABELS = {
	pending: 'Ожидает проверки', testing: 'Проверяется', pass: 'Подтверждена', working: 'Работает',
	'target-fail': 'Не прошла', 'runner-error': 'Ошибка инфраструктуры',
	'infrastructure-error': 'Ошибка инфраструктуры', stopped: 'Остановлена', timeout: 'Не завершена из-за таймаута'
};

export function classifyProbeOutcome({ probe, rc, marker, dependencyReady }) {
	if (!dependencyReady || marker === 'EPROBEDEPENDENCY' || rc === 66) return { class: 'infrastructure-error', status: 'infrastructure-error', reasonCode: 'EPROBEDEPENDENCY' };
	if (probe === 'websocket' && marker === 'EWEBSOCKET') return { class: 'strategy-failure', status: 'failed', reasonCode: 'TARGET_PROBE_FAILED' };
	return rc === 0 ? { class: 'strategy-success', status: 'working', reasonCode: null } : { class: 'strategy-failure', status: 'failed', reasonCode: 'TARGET_PROBE_FAILED' };
}

export function readinessResult(input = {}) {
	const checks = [input.transport, input.scanner, input.curl, input.catalog], targets = input.targets || [];
	let status = 'ready', reasonCode = null;
	if (!input.transport) { status = 'missing-dependency'; reasonCode = 'TRANSPORT_MISSING'; }
	else if (!input.scanner) { status = 'missing-dependency'; reasonCode = 'SCANNER_MISSING'; }
	else if (!input.curl) { status = 'missing-dependency'; reasonCode = 'CURL_MISSING'; }
	else if (!input.catalog) { status = 'missing-dependency'; reasonCode = 'CATALOG_MISSING'; }
	else if (targets.some(v => !v)) { status = 'temporary-infrastructure-failure'; reasonCode = 'TARGET_UNAVAILABLE'; }
	return { ok: status === 'ready', status, reasonCode, dependencies: checks.filter(Boolean).length, targetsReady: targets.filter(Boolean).length, createsRun: false };
}

export function statusLabel(status) { return STATUS_LABELS[status] || 'Не завершена'; }

export function buildCandidateJournal({ runId, generation, candidateIds = [], results = [] }) {
	return candidateIds.map(candidateId => {
		const rows = results.filter(result => result.candidateId === candidateId), last = rows[rows.length - 1] || null;
		const verdict = last && last.verdict || null;
		const status = !last ? 'pending' : verdict === 'pass' ? 'working' : verdict === 'runner-error' || verdict === 'infrastructure-error' ? 'infrastructure-error' : verdict === 'timeout' ? 'timeout' : 'failed';
		return { runId, generation, candidateId, displayName: last && (last.displayName || last.name) || candidateId, status, statusLabel: statusLabel(status), attemptsCompleted: rows.length, attemptsTotal: rows.length, targetsPassed: rows.filter(result => result.passed).length, targetsTotal: rows.length ? new Set(rows.map(result => result.targetId || result.domain)).size : 0, durationMs: rows.reduce((sum, result) => sum + (result.durationMs || 0), 0), rank: null, applied: false, lastGood: false, technical: { candidateId } };
	});
}

export function journalCounts(rows = []) {
	return { tested: rows.filter(row => row.status !== 'pending').length, total: rows.length, working: rows.filter(row => row.status === 'working' || row.status === 'pass').length, failed: rows.filter(row => row.status === 'failed').length, infrastructure: rows.filter(row => row.status === 'infrastructure-error').length, remaining: rows.filter(row => row.status === 'pending').length };
}
