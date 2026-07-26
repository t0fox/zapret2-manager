'use strict';
// Shared constants for zapret2-manager. See docs/architecture.md.
// Paths marked [VERIFY] must be confirmed against the real zapret2 upstream
// (docs/manual.md) on first build — see docs/upstream-mapping.md.

export const NFQUEUE = 300;
export const QLEN_WARN = 50;
export const QLEN_CRIT_CONSECUTIVE = 3;

// Index of the qlen field in a row of /proc/net/netfilter/nfnetlink_queue,
// 0-based, after trim+whitespace-tokenize. Linux nfnetlink_queue proc layout
// (queue_num, peer_portid, queue_total, copy_mode, copy_range, queue_dropped,
// user_dropped, queue_len, ...). [VERIFY] on the target kernel; change here only.
export const QLEN_FIELD_INDEX = 7;

export const CACHE_TTL_SEC = 3;

export const DAEMON = 'nfqws2';      // [VERIFY] exact process name
export const NFT_TABLE = 'zapret2';  // [VERIFY] table name (and family)

export const PATHS = {
	applied_conf:   '/opt/zapret2/config',            // [VERIFY] upstream main config
	uci_conf:       '/etc/config/zapret2',             // [VERIFY] UCI view of intent
	draft_state:    '/etc/zapret2-manager/state.json',
	status_json:    '/tmp/zapret2-manager/status.json',
	qlen_state:     '/tmp/zapret2-manager/qlen.state.json',
	events_ndjson:  '/tmp/zapret2-manager/events.ndjson',
	paused_flag:    '/tmp/zapret2-manager/paused',
	nfqueue_proc:   '/proc/net/netfilter/nfnetlink_queue',
	collector:      '/usr/libexec/zapret2-manager/status.uc'
};
