import { createHash } from 'node:crypto';

const ROOT = '/tmp/zapret2-manager/orchestra-runs';
const USER_LIST = '/opt/zapret2/ipset/zapret-hosts-user.txt';
const USER_EXCLUDE = '/opt/zapret2/ipset/zapret-hosts-user-exclude.txt';

const INFRA_MARKERS = [/command not found/i, /permission denied/i, /syntax error/i, /no such file/i, /cannot create/i, /failed to execute/i];
const PARAMETER_MARKERS = [/unknown option/i, /unrecognized option/i, /invalid argument/i, /failed to parse/i, /invalid value/i];

export function resolveCandidate(catalog, managerId, revision) {
	const entry = (catalog || []).find((candidate) => candidate.managerId === managerId);
	if (!entry || entry.catalogRevision !== revision || typeof entry.opt !== 'string' || !entry.opt.trim()) return null;
	const upstreamInput = translateStrategy(entry.opt);
	if (!upstreamInput || /<[A-Z][A-Z0-9_]*>/.test(upstreamInput)) return null;
	return {
		managerCandidateId: managerId,
		canonicalStrategyId: entry.canonicalStrategyId,
		catalogRevision: revision,
		upstreamStrategyReference: entry.upstreamStrategyReference,
		upstreamInput,
		removedManagerOnlyOptions: String(entry.opt).split(/\s+/).filter((token) => /^--(?:filter-|hostlist|hostlist-auto|comment(?:=|$)|new(?:=|$))/.test(token)),
		sanitizedParameterHash: createHash('sha256').update(upstreamInput).digest('hex')
	};
}

export function translateStrategy(opt) {
	return String(opt).split(/\s+/).filter((token) => token && !/^--(filter-|hostlist|hostlist-auto|comment(?:=|$)|new(?:=|$))/.test(token) && token !== '<HOSTLIST>' && token !== '<HOSTLIST_NOAUTO>').join(' ');
}

export function classifyAttempt({ candidateResolved, resolvedStrategyReference, resolvedStrategyParameters = null, protocol, expectedDomain = 'youtube.com', attempt, startedAt, finishedAt, executionRc, output, timedOut = false, testStarted: startedOverride }) {
	const boundedLog = String(output || '').slice(-8192);
	const testName = protocol === 'tcp_https' ? 'curl_test_https_tls12' : 'curl_test_http3';
	const escapedDomain = String(expectedDomain).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const testStarted = startedOverride ?? new RegExp(`(?:\\*\\s*)?${testName}(?: ipv[46] ${escapedDomain}|:)`, 'i').test(boundedLog);
	const positiveMatch = boundedLog.match(new RegExp(`!!!!!\\s+${testName}:\\s+working strategy found for ipv[46]\\s+${escapedDomain}\\s*:\\s+nfqws2\\s+(.+?)\\s+!!!!!`, 'i'));
	const positiveEvidence = Boolean(positiveMatch) && (!resolvedStrategyParameters || positiveMatch[1].trim().replace(/\\s+/g, ' ') === String(resolvedStrategyParameters).trim().replace(/\\s+/g, ' '));
	const normalNegative = new RegExp(`(?:${testName} ipv[46] ${escapedDomain}[^\\n]*not working|${escapedDomain}[^\\n]*not working|strategy .*${escapedDomain} not working|nfqws2 strategy .*${escapedDomain} not found|UNAVAILABLE(?: code=\\d+)?)`, 'i').test(boundedLog);
	const errorMarkers = INFRA_MARKERS.filter((marker) => marker.test(boundedLog)).map(String);
	const parameterErrors = PARAMETER_MARKERS.filter((marker) => marker.test(boundedLog)).map(String);
	let verdict = 'indeterminate', reason = 'no recognized positive or target result marker';
	if (timedOut || executionRc === 124) {
		verdict = 'timeout'; reason = 'upstream custom test timed out';
	} else if (!candidateResolved) {
		verdict = 'candidate-invalid'; reason = 'trusted candidate resolution failed';
	} else if (parameterErrors.length) {
		verdict = 'candidate-invalid'; reason = 'nfqws2 rejected the sanitized parameters';
	} else if (executionRc === 66 || executionRc < 0) {
		verdict = 'runner-error'; reason = 'Blockcheck executable or result channel unavailable';
	} else if (errorMarkers.length || !testStarted) {
		verdict = 'runner-error'; reason = errorMarkers.length ? 'Blockcheck infrastructure failed' : 'target test start could not be proven';
	} else if (positiveEvidence) {
		verdict = 'pass'; reason = 'upstream Blockcheck reported a working strategy';
	} else if (normalNegative) {
		verdict = 'target-fail'; reason = 'upstream Blockcheck completed without a working strategy';
	} else if (executionRc !== 0) {
		verdict = 'runner-error'; reason = `upstream Blockcheck exited ${executionRc}`;
	}
	return {
		candidateResolved, resolvedStrategyReference, protocol, attempt, startedAt, finishedAt,
		durationMs: Math.max(0, finishedAt - startedAt) * 1000,
		executionRc, exitCode: executionRc, upstreamResult: positiveEvidence ? 'pass' : normalNegative ? 'target-fail' : null,
		positiveEvidence, errorMarkers, parameterErrors, testStarted, supported: protocol !== 'quic_udp' || !/does not support http3|tests disabled/i.test(boundedLog),
		passed: verdict === 'pass', timedOut, verdict, reason, evidence: { source: 'upstream blockcheck2.sh' }, boundedLog,
		cleanup: { status: 'completed' }
	};
}

export function buildCandidateEnvironment({ runId, candidate, protocol }) {
	const base = `${ROOT}/${runId}/${candidate.id}`;
	return {
		TEST: 'custom',
		LIST_HTTP: '/dev/null',
		LIST_HTTPS_TLS12: protocol === 'tcp_https' ? `${base}.tls12` : '/dev/null',
		LIST_HTTPS_TLS13: '/dev/null',
		LIST_QUIC: protocol === 'quic_udp' ? `${base}.quic` : '/dev/null',
		strategy: candidate.opt
	};
}

export function parseCandidateOutput({ candidateId, protocol, attempt, startedAt, finishedAt, exitCode, output, timedOut = false }) {
	return classifyAttempt({ candidateResolved: true, resolvedStrategyReference: candidateId, protocol, attempt, startedAt, finishedAt, executionRc: exitCode, output, timedOut });
}
