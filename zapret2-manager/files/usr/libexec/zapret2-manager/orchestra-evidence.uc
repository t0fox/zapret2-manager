'use strict';
// Evidence primitives for the orchestration runner.
//
// This module owns three production concerns that must never be re-implemented
// inline in orchestra-run.uc / orchestra-worker-control.uc:
//
//   1. the strict Blockcheck PASS gate (marker_gate)
//   2. unique, machine-derived evidence identity (evidence_id, confirmation_state)
//   3. typed post-Apply target verification (verify_target)
//
// Nothing here hardcodes a candidate id, a strategy string, a candidate order,
// a winner, a runId or a literal passed:true.

function low(v) {
	let s = '' + (v || ''), out = '';
	for (let i = 0; i < length(s); i++) { let n = ord(substr(s, i, 1)); out += n >= 65 && n <= 90 ? chr(n + 32) : substr(s, i, 1); }
	return out;
}
function tokens(v) { let out = []; let parts = split(trim('' + (v || '')), ' '); for (let pi = 0; pi < length(parts); pi++) if (length(parts[pi])) push(out, parts[pi]); return out; }

export const EXPECTED_DAEMON = 'nfqws2';

// Parse one upstream Blockcheck result line of the shape:
//   !!!!! <test>: working strategy found for ipv4 <domain> : nfqws2 <parameters> !!!!!
// Returns null when the line is not a terminal upstream marker at all.
export const marker_line_parse = function (line, testName) {
	let s = trim('' + (line || ''));
	if (length(s) < 12 || substr(s, 0, 6) != '!!!!! ' || substr(s, length(s) - 5) != '!!!!!') return null;
	let body = trim(substr(s, 6, length(s) - 11)), lowBody = low(body);
	if (index(lowBody, low(testName + ':')) != 0) return null;
	if (index(lowBody, 'working strategy found') < 0) return null;
	let at = index(body, ' : ');
	if (at < 0) return null;
	let head = tokens(substr(body, 0, at)), reported = tokens(substr(body, at + 3));
	if (!length(head) || !length(reported)) return null;
	return {
		line: s,
		domain: low(head[length(head) - 1]),
		ipFamily: length(head) > 1 ? low(head[length(head) - 2]) : null,
		daemon: low(reported[0]),
		parameters: join(' ', slice(reported, 1))
	};
};

// Strict PASS gate. A PASS requires ALL of:
//   - the expected test (curl_test_https_tls12 / curl_test_http3)
//   - the expected target domain on the marker line
//   - daemon nfqws2
//   - the upstream "working strategy found" terminal marker
//   - no infrastructure / parameter error markers
//   - no timeout or interruption marker
//   - every sanitized candidate parameter present in the reported strategy
// Parameters are compared as a normalized token subset, never byte-for-byte:
// upstream normalizes arguments and may append its own.
export const marker_gate = function (text, testName, domain, resolved) {
	let gate = {
		ok: false,
		testName: testName,
		expectedDomain: low(domain),
		expectedDaemon: EXPECTED_DAEMON,
		expectedParameters: join(' ', tokens(resolved)),
		markerLine: null,
		reportedDomain: null,
		reportedDaemon: null,
		reportedParameters: null,
		ipFamily: null,
		missingParameters: [],
		reasons: []
	};
	let body = '' + (text || '');
	if (index(body, 'PROBE_FAIL') >= 0) push(gate.reasons, 'probe reported PROBE_FAIL');
	if (index(body, 'INFRA_ERROR') >= 0) push(gate.reasons, 'probe reported INFRA_ERROR');
	if (match(body, /timed out|timeout while|terminated by signal|interrupted/i)) push(gate.reasons, 'timeout or interruption marker present');
	if (match(body, /unknown option|unrecognized option|invalid argument|failed to parse|invalid value/i)) push(gate.reasons, 'parameter error marker present');
	if (match(body, /command not found|permission denied|no such file|cannot create|failed to execute/i)) push(gate.reasons, 'infrastructure error marker present');

	let found = null;
	let bodyLines = split(body, '\n');
	for (let bi = 0; bi < length(bodyLines); bi++) {
		let line = bodyLines[bi];
		let parsed = marker_line_parse(line, testName);
		if (!parsed) continue;
		found = parsed;
		if (parsed.domain == gate.expectedDomain && parsed.daemon == EXPECTED_DAEMON) break;
	}
	if (!found) { push(gate.reasons, 'no upstream working-strategy marker for ' + testName); return gate; }

	gate.markerLine = found.line;
	gate.reportedDomain = found.domain;
	gate.reportedDaemon = found.daemon;
	gate.reportedParameters = found.parameters;
	gate.ipFamily = found.ipFamily;
	if (found.domain != gate.expectedDomain) push(gate.reasons, 'marker domain is not the tested target');
	if (found.daemon != EXPECTED_DAEMON) push(gate.reasons, 'marker daemon is not ' + EXPECTED_DAEMON);

	let seen = {};
	let foundTokens = tokens(found.parameters);
	for (let fi = 0; fi < length(foundTokens); fi++) { let k = low(foundTokens[fi]); seen[k] = (seen[k] || 0) + 1; }
	let wantTokens = tokens(resolved);
	for (let wi = 0; wi < length(wantTokens); wi++) { let t = wantTokens[wi]; let k = low(t); if (!seen[k]) { push(gate.missingParameters, t); continue; } seen[k] = seen[k] - 1; }
	if (length(gate.missingParameters)) push(gate.reasons, 'reported strategy does not contain the tested candidate parameters');

	gate.ok = !length(gate.reasons);
	return gate;
};

// Machine-derived, unique per attempt. Never derived from a hardcoded runId.
export const evidence_id = function (runId, sequence, candidateId, protocol) {
	return (runId || 'or-unknown') + '-e-' + sprintf('%05d', +sequence || 0) + '-' + (candidateId || 'c-unknown') + '-' + (protocol || 'unknown');
};

// Distinct positive evidence ids for one candidate/target/protocol triple.
export const distinct_positive_evidence_ids = function (results, domain, candidateId, protocol) {
	let ids = [], seen = {};
	let rows = results || [];
	for (let ri = 0; ri < length(rows); ri++) {
		let a = rows[ri];
		if (a.domain != domain || a.candidateId != candidateId) continue;
		if (protocol && a.protocol != protocol) continue;
		if (!a.passed || !a.positiveEvidence) continue;
		let key = a.evidenceId || (candidateId + '-' + a.protocol + '-' + a.attempt + '-' + a.startedAt);
		if (seen[key]) continue;
		seen[key] = true;
		push(ids, key);
	}
	return ids;
};

// One PASS is provisional. Two distinct positive evidence ids from two separate
// live attempts confirm a winner. Nothing else may set confirmed.
export const confirmation_state = function (results, domain, candidateId, protocol) {
	let ids = distinct_positive_evidence_ids(results, domain, candidateId, protocol);
	return {
		positiveEvidenceIds: ids,
		provisional: length(ids) == 1,
		confirmed: length(ids) >= 2
	};
};

export const winner_record = function (results, domain, candidateId, protocol) {
	let state = confirmation_state(results, domain, candidateId, protocol);
	if (!state.confirmed) return null;
	let evidence = [];
	let winnerRows = results || [];
	for (let wr = 0; wr < length(winnerRows); wr++) { let a = winnerRows[wr]; if (a.domain == domain && a.candidateId == candidateId && (!protocol || a.protocol == protocol) && a.passed && a.positiveEvidence) push(evidence, a); }
	return {
		candidateId: candidateId,
		strategyId: candidateId,
		domain: domain,
		protocol: protocol,
		confirmed: true,
		positiveEvidenceIds: state.positiveEvidenceIds,
		evidence: evidence
	};
};

// ---------------------------------------------------------------------------
// Typed post-Apply target verification.
// exec(cmd) must return { out, rc }. No probe may report passed without its own
// typed evidence; there is no shared "one curl for every target" shortcut.
// ---------------------------------------------------------------------------

function verify_web(target, exec) {
	let cmd = "curl -4 -sS -o /dev/null --connect-timeout 8 --max-time 20 -w '%{http_code} %{ssl_verify_result} %{remote_ip} %{time_total}' 'https://" + target.domain + (target.verify && target.verify.path || '/') + "'";
	let x = exec(cmd), f = tokens(x.out), reasons = [];
	let code = length(f) > 0 ? +f[0] : 0, tls = length(f) > 1 ? f[1] : '', peer = length(f) > 2 ? f[2] : '';
	if (!length(peer)) push(reasons, 'DNS resolution produced no peer address');
	if (tls != '0') push(reasons, 'TLS verification result is ' + (length(tls) ? tls : 'unavailable'));
	if (!(code >= 200 && code < 500)) push(reasons, 'unexpected HTTP status ' + code);
	return { passed: !length(reasons), reasons: reasons, evidence: { probe: 'https', httpStatus: code, tlsVerifyResult: tls, peerAddress: peer, timeTotalSec: length(f) > 3 ? f[3] : null, curlRc: x.rc } };
}

function verify_gateway(target, exec) {
	let path = target.verify && target.verify.path || '/?v=10&encoding=json';
	let cmd = "key=$(head -c 16 /dev/urandom | base64 2>/dev/null); curl -4 -sS -i -N --http1.1 --connect-timeout 8 --max-time 15 " +
		"-H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H \"Sec-WebSocket-Key: $key\" " +
		"'https://" + target.domain + path + "' 2>&1 | head -c 4096";
	let x = exec(cmd), text = '' + (x.out || ''), first = trim(split(text, '\n')[0] || ''), reasons = [];
	let switching = index(first, ' 101') >= 0 || index(low(first), '101 switching protocols') >= 0;
	let upgraded = !!match(text, /[Uu]pgrade:[ \t]*websocket/);
	let accepted = !!match(text, /[Ss]ec-[Ww]eb[Ss]ocket-[Aa]ccept:/);
	if (!switching) push(reasons, 'no HTTP 101 Switching Protocols status line');
	if (!upgraded) push(reasons, 'server did not confirm the websocket upgrade header');
	if (!accepted) push(reasons, 'server did not return Sec-WebSocket-Accept');
	return { passed: !length(reasons), reasons: reasons, evidence: { probe: 'websocket', statusLine: first, switchingProtocols: switching, upgradeHeader: upgraded, acceptHeader: accepted, curlRc: x.rc } };
}

function verify_bounded_download(target, exec) {
	let path = target.verify && target.verify.path;
	if (!path) return { passed: false, reasons: ['manifest does not declare a bounded download asset'], evidence: { probe: 'bounded_download' } };
	let prefix = target.verify && target.verify.expectContentTypePrefix || 'image/';
	let maxBytes = +(target.verify && target.verify.maxBytes || 262144);
	let out = '/tmp/z2m-target-verify.' + target.id;
	let cmd = "curl -4 -sS -o '" + out + "' --connect-timeout 8 --max-time 20 --max-filesize " + maxBytes +
		" -w '%{http_code} %{content_type} %{size_download}' 'https://" + target.domain + path + "'; rc=$?; rm -f '" + out + "'; exit $rc";
	let x = exec(cmd), f = tokens(x.out), reasons = [];
	let code = length(f) > 0 ? +f[0] : 0, ctype = length(f) > 1 ? f[1] : '', bytes = length(f) > 2 ? +f[2] : 0;
	if (code != 200) push(reasons, 'unexpected HTTP status ' + code);
	if (index(low(ctype), low(prefix)) != 0) push(reasons, 'unexpected content type ' + (length(ctype) ? ctype : 'unavailable'));
	if (!(bytes > 0)) push(reasons, 'empty response body');
	if (bytes > maxBytes) push(reasons, 'download exceeded the bounded limit');
	return { passed: !length(reasons), reasons: reasons, evidence: { probe: 'bounded_download', assetPath: path, httpStatus: code, contentType: ctype, bodyBytes: bytes, maxBytes: maxBytes, curlRc: x.rc } };
}

export const verify_target = function (target, exec) {
	let base = { targetId: target.id, domain: target.domain, probe: target.probe, required: !!target.required, checkedAt: time() };
	let result = target.probe == 'https' ? verify_web(target, exec)
		: target.probe == 'websocket' ? verify_gateway(target, exec)
			: target.probe == 'bounded_download' ? verify_bounded_download(target, exec)
				: { passed: false, reasons: ['unsupported probe type'], evidence: { probe: target.probe } };
	base.passed = result.passed;
	base.reasons = result.reasons;
	base.evidence = result.evidence;
	return base;
};

export const verify_service_targets = function (targets, exec) {
	let verifications = [], failures = [];
	let targetList = targets || [];
	for (let ti = 0; ti < length(targetList); ti++) {
		let t = targetList[ti];
		let v = verify_target(t, exec);
		push(verifications, v);
		if (!v.passed) push(failures, { targetId: v.targetId, domain: v.domain, probe: v.probe, reasons: v.reasons });
	}
	return { verifications: verifications, failures: failures, ok: !length(failures) };
};

// Generic run invalidation. The caller supplies the code and reason; no runId,
// no failure text and no lineage is hardcoded in business logic.
export const invalidation_patch = function (code, reason) {
	let c = type(code) == 'string' && match(code, /^[A-Z][A-Z0-9_]{2,31}$/) ? code : null;
	let why = type(reason) == 'string' ? trim(reason) : '';
	if (!c) return { ok: false, error: { code: 'EINPUT', message: 'invalidation requires an uppercase error code' } };
	if (length(why) < 3 || length(why) > 512) return { ok: false, error: { code: 'EINPUT', message: 'invalidation requires a bounded human reason' } };
	return { ok: true, value: { code: c, reason: why, validity: 'invalid', candidateEvidenceUsable: false, applyAllowed: false, continuable: false } };
};
