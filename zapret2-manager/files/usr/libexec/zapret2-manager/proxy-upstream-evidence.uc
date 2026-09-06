'use strict';

// The Rust provider can reach Telegram through its built-in Cloudflare route
// even when a direct Telegram DC probe is blocked. Keep that observation
// separate from the generic proxy health model: a log line is evidence only
// when it is a recent, positive provider event. A stale success or a failed
// lookup must remain degraded.

import { popen } from 'fs';

const MAX_LOG_LINES = 200;
const DEFAULT_MAX_AGE_SEC = 300;

function command(text) {
	let p = popen(text + ' 2>/dev/null', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '';
	let rc = p.close();
	return { rc: rc, out: out };
}

function log_epoch(line) {
	if (type(line) != 'string' || length(line) < 19) return null;
	let stamp = substr(line, 0, 19);
	if (!match(stamp, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/)) return null;
	// BusyBox date is available on the supported OpenWrt targets and accepts a
	// fixed format. The timestamp is regex-validated before it enters the
	// command, so the log cannot become shell input.
	let parsed = command("busybox date -u -D '%Y-%m-%dT%H:%M:%S' -d '" + stamp + "' +%s");
	let value = trim(parsed.out);
	return parsed.rc == 0 && match(value, /^[0-9]+$/) ? +value : null;
}

function success_kind(line) {
	if (type(line) != 'string') return null;
	if (index(line, 'CF proxy connected') >= 0) return 'connected';
	if (index(line, 'CF proxy pool hit') >= 0) return 'pool-hit';
	return null;
}

export const proxy_upstream_log_evidence = function(input) {
	let value = type(input) == 'object' && input != null ? input : {};
	let lines = type(value.lines) == 'array' ? value.lines : [];
	let now = type(value.now) == 'int' ? value.now : time();
	let maxAge = type(value.maxAgeSec) == 'int' && value.maxAgeSec >= 1 && value.maxAgeSec <= 3600
		? value.maxAgeSec : DEFAULT_MAX_AGE_SEC;
	let first = length(lines) > MAX_LOG_LINES ? length(lines) - MAX_LOG_LINES : 0;
	let newest = null;
	for (let i = first; i < length(lines); i++) {
		let line = lines[i], kind = success_kind(line);
		if (kind == null) continue;
		let stamp = substr(line, 0, 19);
		if (!match(stamp, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/)) continue;
		// ISO UTC timestamps sort chronologically, so parse only the newest
		// positive event. This keeps a health read bounded even with a noisy log.
		if (newest == null || stamp > newest.stamp)
			newest = { stamp: stamp, kind: kind };
	}
	if (newest != null) {
		let epoch = log_epoch(newest.stamp);
		let age = epoch == null ? null : now - epoch;
		if (age != null && age >= 0 && age <= maxAge) return {
		attempted: true,
		ok: true,
		method: 'cf-log',
		target: 'CF fallback',
		observedAt: newest.stamp + 'Z',
		ageSec: age,
		evidence: newest.kind,
		detail: 'recent CF proxy success observed in tg-ws-proxy log (' + age + 's old)'
		};
	}
	return {
		attempted: true,
		ok: false,
		method: 'cf-log',
		target: null,
		evidence: null,
		detail: 'no recent CF proxy success in the bounded tg-ws-proxy log suffix'
	};
};
