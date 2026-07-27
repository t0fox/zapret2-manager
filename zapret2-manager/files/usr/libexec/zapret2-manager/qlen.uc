'use strict';
// qlen.uc — shared parser for /proc/net/netfilter/nfnetlink_queue.
//
// Used by both the status collector (status.uc) and the watchdog (watchdog.uc)
// so they read the queue identically. Raw values only — signal computation
// (consecutive-critical, dropped-delta) lives in the watchdog, which is the
// only place that runs on a fixed 60s cycle; the collector surfaces the
// watchdog's last-computed state for display.
//
// Row selection is by matching field 1 (queue_number) to NFQUEUE, NOT by row
// order: several queues may be registered and their order is not guaranteed.
// If our queue is not present at all, that is null (the queue is not
// registered in the kernel → nfqws2 is not connected to it), NOT zero — a
// diagnostically important distinction.

import { readfile } from 'fs';
import {
	NFQUEUE,
	NFQ_FIELD_QUEUE_NUMBER, NFQ_FIELD_QUEUE_TOTAL, NFQ_FIELD_COPY_RANGE,
	NFQ_FIELD_QUEUE_DROPPED, NFQ_FIELD_QUEUE_USER_DROPPED
} from './constants.uc';

function tokenize(s) {
	let out = [];
	let cur = '';
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == ' ' || c == '\t' || c == '\r') {
			if (length(cur)) { push(out, cur); cur = ''; }
		} else {
			cur += c;
		}
	}
	if (length(cur)) push(out, cur);
	return out;
}

// field(n) → 0-based index for a 1-based field number.
function field(n) { return n - 1; }

// parse_queue() → { registered, queue_total, copy_range, queue_dropped,
//   queue_user_dropped, row } with raw integer values (null when not
//   registered). Cumulative counters are returned raw; delta math is the
//   watchdog's job.
export const parse_queue = function() {
	let raw = readfile('/proc/net/netfilter/nfnetlink_queue');
	if (!raw)
		return { registered: false, queue_total: null, copy_range: null,
			queue_dropped: null, queue_user_dropped: null, row: null,
			reason: 'nfnetlink_queue unavailable' };

	let want = '' + NFQUEUE;
	let lines = split(raw, '\n');
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (!length(line)) continue;
		let f = tokenize(line);
		if (length(f) < field(NFQ_FIELD_QUEUE_USER_DROPPED) + 1) continue;
		if (f[field(NFQ_FIELD_QUEUE_NUMBER)] != want) continue;   // match field 1
		return {
			registered: true,
			queue_total:        +f[field(NFQ_FIELD_QUEUE_TOTAL)],
			copy_range:         +f[field(NFQ_FIELD_COPY_RANGE)],
			queue_dropped:      +f[field(NFQ_FIELD_QUEUE_DROPPED)],
			queue_user_dropped: +f[field(NFQ_FIELD_QUEUE_USER_DROPPED)],
			row: line
		};
	}

	// Our queue number is not registered in the kernel at all.
	return { registered: false, queue_total: null, copy_range: null,
		queue_dropped: null, queue_user_dropped: null, row: null,
		reason: 'queue ' + NFQUEUE + ' not registered in kernel' };
};
