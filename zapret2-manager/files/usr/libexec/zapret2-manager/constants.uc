'use strict';
// Shared constants for zapret2-manager. See docs/architecture.md.
// Facts confirmed by external source (this project's task spec) are stated
// plainly; anything still needing a live router is marked [VERIFY:ROUTER]
// with the smoke.sh check that answers it — see docs/upstream-mapping.md.

export const NFQUEUE = 300;
export const QLEN_WARN = 50;
export const QLEN_CRIT_CONSECUTIVE = 3;

// /proc/net/netfilter/nfnetlink_queue row layout — confirmed by external
// source. The kernel prints nine space-separated fields per queue, in this
// 1-based order:
//   1 queue_number   2 peer_portid   3 queue_total   4 copy_mode
//   5 copy_range     6 queue_dropped 7 queue_user_dropped   8 id_sequence
//   9 (constant 1)
// Field 3 (queue_total) is the INSTANTANEOUS queue length — the threshold 50
// and the three-consecutive rule apply to it. Fields 6 and 7 are CUMULATIVE
// monotonic counters since queue creation; their absolute value must NEVER be
// compared to a threshold (one old spike would lock state=critical forever).
// They are consumed as per-cycle deltas only (see watchdog.uc).
//
// Constants hold the 1-based field numbers exactly as above; the parser
// subtracts 1 for 0-based array access, so the numbers stay self-documenting
// and match the kernel layout.
export const NFQ_FIELD_QUEUE_NUMBER       = 1;
export const NFQ_FIELD_PEER_PORTID        = 2;
export const NFQ_FIELD_QUEUE_TOTAL        = 3;
export const NFQ_FIELD_COPY_RANGE         = 5;
export const NFQ_FIELD_QUEUE_DROPPED      = 6;
export const NFQ_FIELD_QUEUE_USER_DROPPED = 7;

export const CACHE_TTL_SEC = 3;

export const DAEMON = 'nfqws2';
export const NFT_TABLE = 'zapret2';

// Pause uses upstream's standard variable NFQWS2_ENABLE. When the applied
// config carries NFQWS2_ENABLE=0, upstream's start (from init, hotplug, or a
// manual call) is a no-op BY UPSTREAM'S OWN LOGIC — no flap, no duplicated
// firewall logic, no editing of upstream's files by us. The change flows
// through the config-generation apply mechanism (same path as any other
// change, including 90s rollback). confirmed (external source) that the
// variable exists.
//
// OPEN QUESTION (one flag, one place): does NFQWS2_ENABLE=0 stop only the
// daemons, or also prevent firewall rule installation? If it also stops fw
// rules, set PAUSE_STOPS_FW=false (no extra call needed). If it stops only
// daemons, set PAUSE_STOPS_FW=true so pause entry also calls stop_fw. The
// answer is produced on the live router by smoke.sh `pause_fw_effect`.
export const NFQWS2_ENABLE_VAR = 'NFQWS2_ENABLE';
export const PAUSE_STOPS_FW = false;   // [VERIFY:ROUTER] → smoke.sh pause_fw_effect

// 90s auto-rollback by timeout. The MECHANISM stays (schedule_rollback /
// rollback / confirm_alive), but the timer is NOT armed by default — a
// premature rollback drops the link to the device, and a stale-timer defect
// was already found in this mechanism (review). Set ROLLBACK_TIMEOUT_ENABLED
// = true ONLY after the timer path is confirmed on the device. Until then the
// snapshot to last-good still happens (manual rollback via the 'rollback'
// ubus method is available); only the AUTOMATIC timer is off.
export const ROLLBACK_TIMEOUT_ENABLED = false;   // [VERIFY:ROUTER] → smoke.sh rollback_timer
export const ROLLBACK_TTL = 90;

// Passthrough is OUR entity (no upstream option exists). It is modelled as a
// profile with no strategies — see service.uc and docs/upstream-mapping.md.
// It is NOT stored as a UCI flag (would desync from reality and create a 4th
// state level). The PASSTHROUGH_PROFILE_NAME is the draft-state profile that
// carries an empty strategy list.
export const PASSTHROUGH_PROFILE_NAME = 'passthrough';

export const PATHS = {
	applied_conf:   '/opt/zapret2/config',
	uci_conf:       '/etc/config/zapret2',
	applied_version:'/opt/zapret2/version',
	draft_state:    '/etc/zapret2-manager/state.json',
	status_json:    '/tmp/zapret2-manager/status.json',
	qlen_state:     '/tmp/zapret2-manager/qlen.state.json',
	watchdog_state: '/tmp/zapret2-manager/watchdog.state.json',
	last_good:      '/tmp/zapret2-manager/last-good',
	pending_rollback:'/tmp/zapret2-manager/pending-rollback',
	events_ndjson:  '/tmp/zapret2-manager/events.ndjson',
	paused_flag:    '/tmp/zapret2-manager/paused',
	nfqueue_proc:   '/proc/net/netfilter/nfnetlink_queue',
	collector:      '/usr/libexec/zapret2-manager/status.uc',
	qlen_lib:       '/usr/libexec/zapret2-manager/qlen.uc'
};

