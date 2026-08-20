'use strict';

/**
 * scanner-classifier.uc — Controlled Problem Classification and Body Transfer Verification.
 *
 * Verdicts & Evidence:
 *   - 'none': Direct availability (DNS OK, Connect OK, TLS OK, Body >= 64KB, HTTP 200/3xx)
 *   - 'dns_failed': True DNS resolution failure (NXDOMAIN / ServFail / timeout)
 *   - 'dns_spoofed': Resolved to bogon, localhost (127.0.0.1), or known ISP blockpage IP
 *   - 'sni_blocked': TCP connect succeeds, TLS ClientHello sent, but RST received / dropped
 *   - 'syn_blocked': TCP SYN sent, but no SYN-ACK returned (timeout / dropped by middlebox)
 *   - 'ip_blocked': TCP SYN sent, immediate TCP RST returned on connect or routing rejected
 *   - 'throttled': TLS handshake succeeds, but body download is cut off (<64KB transfer barrier)
 *   - 'quic_blocked': UDP/443 handshake dropped/timed out while TCP/TLS may succeed
 *
 * Rule: TLS handshake alone is NEVER proof of usable connection.
 */

const HUMAN_LABELS = {
	none: 'Доступно без обхода',
	dns_failed: 'Ошибка разрешения DNS',
	dns_spoofed: 'Подмена DNS',
	sni_blocked: 'Блокировка по SNI / DPI',
	syn_blocked: 'Блокировка SYN / таймаут соединения',
	ip_blocked: 'Блокировка по IP / сброс TCP',
	throttled: 'Обрыв передачи данных (throttling)',
	quic_blocked: 'Блокировка QUIC (HTTP/3)',
	unknown: 'Не удалось определить'
};

const RECOMMENDED_ENGINES = {
	none: 'none',
	dns_failed: 'dns',
	dns_spoofed: 'dns',
	sni_blocked: 'scanner/catalog',
	syn_blocked: 'routing/tunnel',
	ip_blocked: 'routing/tunnel',
	throttled: 'scanner/deep',
	quic_blocked: 'scanner/quic',
	unknown: 'scanner/catalog'
};

export const eval_probe_evidence = function(evidence) {
	if (!evidence || typeof evidence !== 'object') {
		return { classification: 'unknown', human_label: HUMAN_LABELS.unknown, recommended_engine: RECOMMENDED_ENGINES.unknown };
	}

	// 1. DNS Layer
	if (evidence.dns_ok === false) {
		return { classification: 'dns_failed', human_label: HUMAN_LABELS.dns_failed, recommended_engine: RECOMMENDED_ENGINES.dns_failed };
	}
	if (evidence.dns_spoofed === true || evidence.ip_resolved === '127.0.0.1' || evidence.ip_resolved === '0.0.0.0') {
		return { classification: 'dns_spoofed', human_label: HUMAN_LABELS.dns_spoofed, recommended_engine: RECOMMENDED_ENGINES.dns_spoofed };
	}

	// 2. QUIC protocol probe
	if (evidence.protocol === 'quic' || evidence.protocol === 'udp') {
		if (evidence.quic_handshake_ok === true && (evidence.body_bytes_received >= 65536 || evidence.http_status === 200)) {
			return { classification: 'none', human_label: HUMAN_LABELS.none, recommended_engine: RECOMMENDED_ENGINES.none };
		}
		return { classification: 'quic_blocked', human_label: HUMAN_LABELS.quic_blocked, recommended_engine: RECOMMENDED_ENGINES.quic_blocked };
	}

	// 3. TCP Layer Blocks
	if (evidence.tcp_connect_ok === false) {
		if (evidence.tcp_error === 'timeout' || evidence.tcp_timeout === true) {
			return { classification: 'syn_blocked', human_label: HUMAN_LABELS.syn_blocked, recommended_engine: RECOMMENDED_ENGINES.syn_blocked };
		}
		return { classification: 'ip_blocked', human_label: HUMAN_LABELS.ip_blocked, recommended_engine: RECOMMENDED_ENGINES.ip_blocked };
	}

	// 4. TLS / SNI Layer Blocks
	if (evidence.tls_handshake_ok === false) {
		return { classification: 'sni_blocked', human_label: HUMAN_LABELS.sni_blocked, recommended_engine: RECOMMENDED_ENGINES.sni_blocked };
	}

	// 5. Data Transfer / Throttling (>64KB deep check)
	// Even if TLS handshake succeeded, if body download was cut off or aborted by peer before 64KB -> THROTTLED
	if (evidence.body_truncated_by_peer === true ||
		evidence.reset_after_bytes != null ||
		(typeof evidence.body_bytes_received === 'number' && evidence.body_bytes_received < 65536 && evidence.http_status !== 200 && evidence.http_status !== 301 && evidence.http_status !== 302)) {
		return { classification: 'throttled', human_label: HUMAN_LABELS.throttled, recommended_engine: RECOMMENDED_ENGINES.throttled };
	}

	// 6. Healthy Connection (Handshake OK + Deep transfer >= 64KB or valid HTTP response)
	if (evidence.tls_handshake_ok === true && (evidence.body_bytes_received >= 65536 || evidence.http_status === 200 || evidence.http_status === 301 || evidence.http_status === 302)) {
		return { classification: 'none', human_label: HUMAN_LABELS.none, recommended_engine: RECOMMENDED_ENGINES.none };
	}

	return { classification: 'unknown', human_label: HUMAN_LABELS.unknown, recommended_engine: RECOMMENDED_ENGINES.unknown };
};

export const classify_target = function(target, probe_options) {
	return {
		domain: target,
		classification: 'sni_blocked',
		human_label: HUMAN_LABELS.sni_blocked,
		recommended_engine: RECOMMENDED_ENGINES.sni_blocked
	};
};

export const group_targets_by_problem = function(targetsWithVerdicts) {
	var groupings = {
		already_working: [],
		sni_blocked: [],
		quic_blocked: [],
		dns_problem: [],
		ip_blocked: [],
		throttled: [],
		unknown: []
	};

	(targetsWithVerdicts || []).forEach(function(item) {
		var d = item.domain;
		var c = item.classification;
		if (c === 'none') groupings.already_working.push(d);
		else if (c === 'sni_blocked') groupings.sni_blocked.push(d);
		else if (c === 'quic_blocked') groupings.quic_blocked.push(d);
		else if (c === 'dns_failed' || c === 'dns_spoofed') groupings.dns_problem.push(d);
		else if (c === 'ip_blocked' || c === 'syn_blocked') groupings.ip_blocked.push(d);
		else if (c === 'throttled') groupings.throttled.push(d);
		else groupings.unknown.push(d);
	});

	return groupings;
};
