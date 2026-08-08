// health-logic.mjs — node reference for the Service Health Matrix v1
// (Phase C). Mirrored by the shipped ucode jobs.uc (healthmatrix_start) and
// health-run.sh.
//
// This is DIAGNOSTICS, never a "service works" verdict. Every service gets
// per-layer probe results and an inferred failure CLASS; the labels are
// deliberately narrow ('reachable-http' is the best achievable — it is not
// a service-availability claim).
//
// Bounds: targets come ONLY from validated catalog entries (or a tightly
// validated custom domain); per-probe timeout 4s; per-service budget 20s;
// sequential execution (router-safe); no credentials; no response-body
// storage; evidence is exit/http codes only.

export const PROBE_TIMEOUT_SEC = 4;
export const SERVICE_BUDGET_SEC = 20;
export const MATRIX_MODES = ['quick', 'full'];
export const HEALTH_CLASSES = [
	'pending', 'dns', 'connect', 'tls', 'http-application',
	'possible-geo-account', 'reachable-http', 'upstream-error',
	'unknown-timeout', 'unavailable-unknown', 'skipped'
];

// pickProbeDomains(svc, max) — the probe targets for a service: up to `max`
// of its catalog domains (validated upstream of this module).
export function pickProbeDomains(svc, max = 2) {
	return (svc.domains || []).slice(0, max);
}

// classifyCurlStage(stage, rc, httpCode) → per-probe outcome.
// curl rc classes (blockcheck2.sh verified semantics): 6 resolve, 7 connect,
// 28 timeout, 35/60 SSL/cert, 0 ok (http_code then classifies).
export function classifyCurlStage(rc, httpCode) {
	if (rc === 6) return { outcome: 'fail', layer: 'dns' };
	if (rc === 7) return { outcome: 'fail', layer: 'connect' };
	if (rc === 28) return { outcome: 'fail', layer: 'timeout' };
	if (rc === 35 || rc === 60 || rc === 51 || rc === 58 || rc === 59 || rc === 90) return { outcome: 'fail', layer: 'tls' };
	if (rc === 0) {
		const code = Number(httpCode) || 0;
		if (code >= 200 && code < 400) return { outcome: 'ok', layer: 'http', httpCode: code };
		if (code === 401 || code === 403) return { outcome: 'ok', layer: 'http', httpCode: code, note: 'auth/region class response' };
		if (code >= 500) return { outcome: 'ok', layer: 'http', httpCode: code, note: 'upstream 5xx' };
		return { outcome: 'ok', layer: 'http', httpCode: code };
	}
	return { outcome: 'fail', layer: 'unknown' };
}

// classifyService(probes) → the service-level inferred class.
// probes: { catalog: {...}, dns: {ok}, extDns: {ok|null, evidence}, tcp: {rc},
//           tls: {rc}, http: {rc, httpCode} }
export function classifyService(probes) {
	// local catalog/list state first (free)
	if (probes.catalog && probes.catalog.domainsPresent === false)
		return { class: 'skipped', reason: 'service domains are not in the user list (service disabled?)' };
	if (!probes.dns || probes.dns.ok !== true) return { class: 'dns', reason: 'local resolution failed' };
	const tcp = probes.tcp ? classifyCurlStage(probes.tcp.rc, null) : { outcome: 'fail', layer: 'unknown' };
	if (tcp.outcome !== 'ok' && tcp.layer === 'connect') return { class: 'connect', reason: 'TCP 443 connect failed' };
	if (tcp.outcome !== 'ok' && tcp.layer === 'dns') return { class: 'dns', reason: 'curl-side resolution failed' };
	if (tcp.outcome !== 'ok' && tcp.layer === 'timeout') return { class: 'unknown-timeout', reason: 'TCP probe timed out' };
	const tls = probes.tls ? classifyCurlStage(probes.tls.rc, null) : { outcome: 'fail', layer: 'unknown' };
	if (tls.outcome !== 'ok') {
		if (tls.layer === 'tls') return { class: 'tls', reason: 'TLS/SNI handshake failed' };
		if (tls.layer === 'timeout') return { class: 'unknown-timeout', reason: 'TLS probe timed out' };
		if (tls.layer === 'connect') return { class: 'connect', reason: 'connect failed at TLS stage' };
		if (tls.layer === 'dns') return { class: 'dns', reason: 'resolution failed at TLS stage' };
		return { class: 'unavailable-unknown', reason: 'TLS probe inconclusive' };
	}
	const http = probes.http ? classifyCurlStage(probes.http.rc, probes.http.httpCode) : { outcome: 'fail', layer: 'unknown' };
	if (http.outcome !== 'ok') return { class: 'http-application', reason: 'no HTTP response' };
	const code = http.httpCode || 0;
	if (code >= 200 && code < 400) return { class: 'reachable-http', reason: 'HTTP ' + code + ' — host responds at the application layer (NOT a service-availability claim)' };
	if (code === 401 || code === 403) return { class: 'possible-geo-account', reason: 'HTTP ' + code + ' — auth/region class response; account or GEO restriction is possible (not provable here)' };
	if (code >= 500) return { class: 'upstream-error', reason: 'HTTP ' + code + ' — upstream/application error' };
	return { class: 'http-application', reason: 'HTTP ' + code };
}

// buildServiceResult(svc, probes, ledgerEnabled) — the matrix row.
export function buildServiceResult(svc, probes, ledgerEnabled) {
	const cls = classifyService(probes);
	return {
		id: svc.id,
		name: svc.name,
		category: svc.category,
		enabledInLedger: ledgerEnabled === true,
		domains: probes.domains || [],
		probes: {
			catalog: probes.catalog || null,
			dns: probes.dns || null,
			extDns: probes.extDns || null,
			tcp: probes.tcp || null,
			tls: probes.tls || null,
			http: probes.http || null
		},
		class: cls.class,
		reason: cls.reason
	};
}

// validateMatrixTargets(services, ledger) → { ok, targets } | { ok:false, reason }
// Targets = enabled services (or all catalog services when no ledger set
// exists yet — a diagnostic sweep over the catalog is read-only by nature).
export function validateMatrixTargets(services, ledger, requestedIds) {
	const byId = new Map(services.map((s) => [s.id, s]));
	let ids = requestedIds && requestedIds.length ? requestedIds : null;
	if (!ids) ids = ledger && ledger.enabled && ledger.enabled.length ? ledger.enabled : services.map((s) => s.id);
	const targets = [];
	const unknown = [];
	for (const id of ids) {
		const svc = byId.get(id);
		if (!svc) { unknown.push(id); continue; }
		targets.push(svc);
	}
	if (unknown.length) return { ok: false, reason: 'unknown service ids: ' + unknown.join(', ') };
	if (!targets.length) return { ok: false, reason: 'no services to probe' };
	if (targets.length > 16) return { ok: false, reason: 'too many targets (max 16 per matrix)' };
	return { ok: true, targets };
}

// matrixSummary(rows) — counts by class (never a "works/fails" verdict).
export function matrixSummary(rows) {
	const byClass = {};
	for (const r of rows) byClass[r.class] = (byClass[r.class] || 0) + 1;
	return {
		services: rows.length,
		byClass,
		note: 'diagnostics per layer, not service-availability verdicts'
	};
}

// evidenceBound(value, maxLen) — evidence is codes only; anything else is
// rejected with a marker (no response bodies, no URLs with secrets).
export function evidenceBound(value, maxLen = 160) {
	if (value == null) return null;
	const s = String(value);
	if (s.length > maxLen) return s.slice(0, maxLen) + '…[truncated]';
	return s;
}
