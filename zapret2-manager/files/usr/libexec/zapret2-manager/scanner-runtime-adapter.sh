#!/bin/ash
# Fixed transient Scanner runtime owner. Only server-issued safe IDs cross the
# shell boundary; candidate tokens are read from verified server-owned files.
set -eu
umask 077

BASE=/tmp/zapret2-manager
ROOT=$BASE/scanner
NFQWS2=/opt/zapret2/nfq2/nfqws2
FIREWALL_HELPER=/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper
NFQ_PROC=/proc/net/netfilter/nfnetlink_queue
LOCK=/opt/zapret2/config.lock
QUEUE=300
QUEUE_MAX=307
OWNER=scanner/session
RUNTIME_COMPOSITION_UCODE=${Z2M_RUNTIME_UCODE_BIN:-/usr/bin/ucode}
RUNTIME_COMPOSITION_CLI=${Z2M_RUNTIME_COMPOSITION_CLI:-/usr/libexec/zapret2-manager/runtime-composition-cli.uc}
RUNTIME_COMPOSITION_TMP=""

# OpenWrt BusyBox sleep may not accept fractional seconds. Keep polling bounded.
short_sleep() { sleep 1; }

if [ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ]; then
	[ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] || { printf '%s\n' '{"ok":false,"code":"EINPUT","stage":"input"}'; exit 1; }
	NFQWS2=${Z2M_SCANNER_TEST_NFQWS2:-$NFQWS2}
	FIREWALL_HELPER=${Z2M_SCANNER_TEST_FIREWALL_HELPER:-$FIREWALL_HELPER}
	NFQ_PROC=${Z2M_SCANNER_TEST_NFQ_PROC:-$NFQ_PROC}
	LOCK=${Z2M_SCANNER_TEST_LOCK:-$LOCK}
fi

operation=${1:-}; session=${2:-}; candidate=${3:-}; generation=${4:-}; supplied_nonce=${5:-}
case "$operation" in lock-acquire|lock-release|activate|stabilize|cleanup|session-cleanup) ;; *) exit 1 ;; esac
case "$session" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$candidate" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$generation" in ''|*[!0-9]*) exit 1 ;; esac
[ "$generation" -le 65535 ] || exit 1

DIR="$ROOT/$session"
ARGV_FILE="$DIR/$candidate.argv"
ARGV_DIGEST_FILE="$ARGV_FILE.digest"
ARGV_META_FILE="$ARGV_FILE.meta"
PID_FILE="$DIR/$candidate.pid"
NFQWS_PID_FILE="$DIR/$candidate.nfqws2.pid"
START_FILE="$DIR/$candidate.starttime"
LOG_FILE="$DIR/$candidate.log"
HOSTLIST_FILE="$DIR/$candidate.hostlist"
OWNERSHIP_FILE="$DIR/$candidate.ownership"
CHAIN_DIGEST_FILE="$DIR/$candidate.chain.sha256"
HELPER_PID_FILE="$DIR/$candidate.helper.pid"
HELPER_TRANSPORT_FILE="$DIR/$candidate.helper.transport"
HELPER_REQUEST_FIFO="$DIR/$candidate.helper.request"
HELPER_RESPONSE_FIFO="$DIR/$candidate.helper.response"
LOCK_OWNER="$DIR/lock.descriptor"
OWNERSHIP_LOCK="$DIR/ownership.lock"
CLEANUP_EVIDENCE="$DIR/cleanup.evidence"
LIFECYCLE_JOURNAL="$DIR/$candidate.lifecycle"
queue_num=$QUEUE
helper_last_operation=""
helper_last_code=""
helper_last_message=""
private_dir() {
	path=$1
	[ -d "$path" ] && [ ! -L "$path" ] || return 1
	set -- $(ls -ldn "$path" 2>/dev/null) || return 1
	expected_uid=0
	[ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ] && [ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] && expected_uid=$(id -u)
	[ "$1" = drwx------ ] && [ "$3" = "$expected_uid" ] && [ "$4" = "$expected_uid" ]
}
if [ "$operation" != session-cleanup ]; then
	[ ! -L "$BASE" ] || exit 1
	if [ -e "$BASE" ]; then [ -d "$BASE" ] || exit 1; else mkdir "$BASE" 2>/dev/null || exit 1; fi
	[ ! -L "$ROOT" ] || exit 1
	if [ -e "$ROOT" ]; then [ -d "$ROOT" ] || exit 1; else mkdir "$ROOT" 2>/dev/null || exit 1; fi
	[ -d "$DIR" ] || mkdir "$DIR" 2>/dev/null || exit 1
	[ ! -L "$DIR" ] || exit 1
	chmod 700 "$BASE" "$ROOT" "$DIR" 2>/dev/null || exit 1
fi
private_dir "$BASE" && private_dir "$ROOT" && private_dir "$DIR" || {
	printf '%s\n' '{"ok":false,"code":"ECLEANUP","stage":"path_safety"}'; exit 1;
}

starttime() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true; }
argv_digest() { sha256sum "/proc/$1/cmdline" 2>/dev/null | awk '{print $1}' || true; }
queue_peer() { awk -v q="$queue_num" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true; }
queue_available() { [ -z "$(awk -v q="$1" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true)" ]; }
process_alive() { [ -r "/proc/$1/stat" ] && [ "$(starttime "$1")" = "$2" ] && [ "$(awk '{print $3}' "/proc/$1/stat" 2>/dev/null || true)" != Z ]; }
process_exe() { readlink "/proc/$1/exe" 2>/dev/null || true; }
text_digest() { printf '%s' "$1" | sha256sum 2>/dev/null | awk '{print $1}'; }

reap_holder() {
	record=$(cat "$LOCK_OWNER" 2>/dev/null | tr -d '\n' || true)
	record_session=${record%%|*}; rest=${record#*|}; record_pid=${rest%%|*}; rest=${rest#*|}; record_nonce=${rest#*|}
	ready_record=$(cat "$DIR/lock.ready" 2>/dev/null | tr -d '\n' || true)
	ready_pid=$(cat "$DIR/lock-holder.pid" 2>/dev/null || true)
	if [ "$record_session" = "$session" ] && [ "$record_nonce" = "$nonce" ] &&
		[ "$ready_record" = "$session|$nonce|$record_pid" ] && [ "$ready_pid" = "$record_pid" ]; then
		case "$record_pid" in ''|*[!0-9]*) return ;; esac
		kill -TERM "$record_pid" 2>/dev/null || true
		i=0; while kill -0 "$record_pid" 2>/dev/null && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
		kill -KILL "$record_pid" 2>/dev/null || true
		wait "$record_pid" 2>/dev/null || true
		rm -f "$LOCK_OWNER" "$DIR/lock-holder.pid" "$DIR/lock.ready"
	fi
}

# Kept for compatibility with the historical marker contract; no entropy is
# consumed here because this marker is not used as an identity or lock nonce.
nonce_marker="$session:$candidate:$generation"
lock_session=""; lock_pid=""; lock_start=""; lock_nonce=""
if [ -r "$LOCK_OWNER" ]; then
	lock_record=$(cat "$LOCK_OWNER" 2>/dev/null || true)
	lock_session=${lock_record%%|*}; lock_rest=${lock_record#*|}
	lock_pid=${lock_rest%%|*}; lock_rest=${lock_rest#*|}
	lock_start=${lock_rest%%|*}; lock_nonce=${lock_rest#*|}
fi
marker="z2m-scanner:$session:$candidate:$generation:$lock_nonce"
[ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ] && [ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] && [ -n "${Z2M_TEST_MARKER:-}" ] && marker=$Z2M_TEST_MARKER

lock_held() {
	[ "$lock_session" = "$session" ] || return 1
	case "$lock_pid" in ''|*[!0-9]*) return 1 ;; esac
	case "$lock_start" in ''|*[!0-9]*) return 1 ;; esac
	[ -n "$lock_nonce" ] || return 1
	case "$lock_nonce" in *[!a-f0-9]*) return 1 ;; esac
	[ "$(printf '%s' "$lock_nonce" | wc -c)" = 64 ] || return 1
	[ "$(starttime "$lock_pid")" = "$lock_start" ] || return 1
	kill -0 "$lock_pid" 2>/dev/null || return 1
	flock -n "$LOCK" -c true >/dev/null 2>&1 && return 1
	return 0
}

chain_owned() {
	helper_request ownership_status
}

private_fifo() {
	path=$1
	[ -p "$path" ] && [ ! -L "$path" ] || return 1
	set -- $(ls -ldn "$path" 2>/dev/null) || return 1
	[ "$1" = prw------- ] && [ "$3" = "$(id -u)" ] && [ "$4" = "$(id -g)" ]
}

private_file() {
	path=$1
	[ -f "$path" ] && [ ! -L "$path" ] || return 1
	set -- $(ls -ldn "$path" 2>/dev/null) || return 1
	[ "$1" = -rw------- ] && [ "$3" = "$(id -u)" ] && [ "$4" = "$(id -g)" ]
}

helper_identity() {
	[ -r "$HELPER_PID_FILE" ] && [ -r "$HELPER_TRANSPORT_FILE" ] || return 1
	[ ! -L "$HELPER_PID_FILE" ] && [ ! -L "$HELPER_TRANSPORT_FILE" ] || return 1
	private_file "$HELPER_PID_FILE" && private_file "$HELPER_TRANSPORT_FILE" || return 1
	helper_record=$(cat "$HELPER_PID_FILE" 2>/dev/null | tr -d '\n' || true)
	helper_pid=${helper_record%%|*}; helper_rest=${helper_record#*|}
	helper_start=${helper_rest%%|*}; helper_rest=${helper_rest#*|}
	helper_operation=${helper_rest%%|*}; helper_rest=${helper_rest#*|}
	helper_nonce=${helper_rest%%|*}; helper_table=${helper_rest#*|}
	case "$helper_pid" in ''|*[!0-9]*) return 1 ;; esac
	case "$helper_start" in ''|*[!0-9]*) return 1 ;; esac
	case "$helper_nonce" in ''|*[!a-f0-9]*) return 1 ;; esac
	[ "$(printf '%s' "$helper_nonce" | wc -c)" = 64 ] || return 1
	[ "$helper_operation" = "$operation_id" ] && [ "$helper_nonce" = "$operation_nonce" ] || return 1
	[ "$helper_table" = "$table_name" ] || return 1
	[ "$(starttime "$helper_pid")" = "$helper_start" ] || return 1
	[ "$(process_exe "$helper_pid")" = "$FIREWALL_HELPER" ] || return 1
	kill -0 "$helper_pid" 2>/dev/null || return 1
	transport_table=$(sed -n 's/^table=//p' "$HELPER_TRANSPORT_FILE")
	transport_request=$(sed -n 's/^request=//p' "$HELPER_TRANSPORT_FILE")
	transport_response=$(sed -n 's/^response=//p' "$HELPER_TRANSPORT_FILE")
	[ "$transport_table" = "$helper_table" ] && [ "$transport_request" = "$HELPER_REQUEST_FIFO" ] &&
		[ "$transport_response" = "$HELPER_RESPONSE_FIFO" ] || return 1
	private_fifo "$HELPER_REQUEST_FIFO" && private_fifo "$HELPER_RESPONSE_FIFO"
}

helper_gone() {
	[ ! -r "/proc/$helper_pid/stat" ] || [ "$(awk '{print $3}' "/proc/$helper_pid/stat" 2>/dev/null || true)" = Z ]
}

helper_stop_reap() {
	case "${helper_pid:-}" in ''|*[!0-9]*) return 0 ;; esac
	kill -TERM "$helper_pid" 2>/dev/null || true
	i=0
	while ! helper_gone && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
	if ! helper_gone; then kill -KILL "$helper_pid" 2>/dev/null || true; fi
	i=0
	while ! helper_gone && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
	wait "$helper_pid" 2>/dev/null || true
	helper_gone
}

remove_private_helper_artifacts() {
	private_file "$HELPER_PID_FILE" && rm -f "$HELPER_PID_FILE" || true
	private_file "$HELPER_TRANSPORT_FILE" && rm -f "$HELPER_TRANSPORT_FILE" || true
	private_fifo "$HELPER_REQUEST_FIFO" && rm -f "$HELPER_REQUEST_FIFO" || true
	private_fifo "$HELPER_RESPONSE_FIFO" && rm -f "$HELPER_RESPONSE_FIFO" || true
}

helper_start_abort() {
	helper_stop_reap || true
	remove_private_helper_artifacts
	return 42
}

helper_response_ok() {
	request_id=$1; operation_name=$2; response=$3
	[ "$(printf '%s' "$response" | jsonfilter -e '@.protocolVersion' 2>/dev/null)" = 2 ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.requestId' 2>/dev/null)" = "$request_id" ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.ok' 2>/dev/null)" = true ] || return 1
	case "$operation_name" in
		ownership_create) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.created' 2>/dev/null)" = true ] || return 1 ;;
		ownership_ready) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.ready' 2>/dev/null)" = true ] || return 1 ;;
		ownership_delete) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.deleted' 2>/dev/null)" = true ] || return 1 ;;
		ownership_status) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.exists' 2>/dev/null)" = true ] && [ "$(printf '%s' "$response" | jsonfilter -e '@.data.owned' 2>/dev/null)" = true ] || return 1 ;;
		ownership_nfqueue_prepare) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.chainCreated' 2>/dev/null)" = true ] && [ "$(printf '%s' "$response" | jsonfilter -e '@.data.ruleCreated' 2>/dev/null)" = true ] || return 1 ;;
		ownership_nfqueue_bind) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.queueBound' 2>/dev/null)" = true ] || return 1 ;;
		ownership_nfqueue_activate) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.active' 2>/dev/null)" = true ] || return 1 ;;
		*) return 1 ;;
	esac
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.tableName' 2>/dev/null)" = "$table_name" ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.evidence.tableName' 2>/dev/null)" = "$table_name" ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.evidence.ownerFlagRequested' 2>/dev/null)" = true ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.evidence.kernelReadBack' 2>/dev/null)" = true ]
}

lifecycle_transition() {
	state=$1; evidence=$2
	old=$(cat "$LIFECYCLE_JOURNAL" 2>/dev/null || true)
	case "$old" in *"state=$state"*) return 0 ;; esac
	[ "$(printf '%s' "$old" | wc -c)" -lt 8192 ] || return 1
	atomic_private_write "$LIFECYCLE_JOURNAL" "$old${old:+\n}state=$state\nevidence=$evidence\n"
}

allocate_queue() {
	queue_num=$QUEUE
	while [ "$queue_num" -le "$QUEUE_MAX" ]; do
		queue_available "$queue_num" && return 0
		queue_num=$((queue_num + 1))
	done
	return 1
}

wait_queue_peer() {
	i=0
	while [ "$i" -lt 5 ]; do
		if awk -v expected_queue="$queue_num" -v expected_peer="$nfq_pid" \
			'$1 == expected_queue && $2 == expected_peer { found = 1 } END { exit found ? 0 : 1 }' \
			/proc/net/netfilter/nfnetlink_queue 2>/dev/null; then return 0; fi
		short_sleep; i=$((i + 1))
	done
	return 1
}

helper_request() {
	helper_operation_name=$1
	helper_last_operation=$helper_operation_name
	request_id="scanner:$session:$candidate:$generation:$(printf '%s' "$helper_operation_name" | tr -c 'A-Za-z0-9._:-' '_')"
	if [ "$helper_operation_name" = ownership_create ]; then
		table_name="z2m_sc_$(printf '%s' "$session" | sha256sum | cut -c1-8)_$(printf '%s' "$candidate" | sha256sum | cut -c1-8)_$(printf '%04x' "$generation")_$(printf '%s' "$operation_nonce" | cut -c1-32)"
		[ "$(printf '%s' "$table_name" | wc -c)" = 62 ] || return 42
		operation_id="$session:$candidate:$generation"
		helper_start_lifecycle
	else
		table_name=$(sed -n 's/^table=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		queue_num=$(sed -n 's/^queue=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		case "$queue_num" in ''|*[!0-9]*) return 42 ;; esac
		[ "$queue_num" -ge "$QUEUE" ] && [ "$queue_num" -le "$QUEUE_MAX" ] || return 42
		if [ -r "$OWNERSHIP_FILE" ]; then
			owned_record=$(cat "$OWNERSHIP_FILE" 2>/dev/null | tr -d '\n' || true)
			operation_id=$(printf '%s' "$owned_record" | cut -d '|' -f4)
			operation_nonce=$(printf '%s' "$owned_record" | cut -d '|' -f5)
		fi
		helper_identity || return 42
	fi
	exec 8<>"$HELPER_REQUEST_FIFO" || return 42
	exec 9<>"$HELPER_RESPONSE_FIFO" || { exec 8>&-; return 42; }
	helper_peer=0
	case "$helper_operation_name" in ownership_nfqueue_bind|ownership_nfqueue_activate)
		[ -r "$PID_FILE" ] || { exec 8>&-; exec 9>&-; return 42; }
		pid_record=$(cat "$PID_FILE" 2>/dev/null | tr -d '\n' || true); helper_peer=${pid_record%%|*} ;;
	esac
	request=$(printf '{"protocolVersion":2,"requestId":"%s","operation":"%s","arguments":{"tableName":"%s","operationId":"%s","nonce":"%s","queue":%s,"peerPid":%s}}\n' \
		"$request_id" "$helper_operation_name" "$table_name" "$operation_id" "$operation_nonce" "$queue_num" "$helper_peer")
	printf '%s\n' "$request" >&8 || { exec 8>&-; exec 9>&-; return 42; }
	IFS= read -r response <&9 || { exec 8>&-; exec 9>&-; return 42; }
	exec 8>&-; exec 9>&-
	helper_last_code=$(printf '%s' "$response" | jsonfilter -e '@.error.code' 2>/dev/null || true)
	helper_last_message=$(printf '%s' "$response" | jsonfilter -e '@.error.message' 2>/dev/null || true)
	if ! helper_response_ok "$request_id" "$helper_operation_name" "$response"; then
		[ "$helper_operation_name" = ownership_create ] && helper_start_abort || true
		return 42
	fi
}

helper_start_lifecycle() {
	[ -x "$FIREWALL_HELPER" ] || return 42
	[ ! -e "$HELPER_PID_FILE" ] && [ ! -e "$HELPER_TRANSPORT_FILE" ] &&
		[ ! -e "$HELPER_REQUEST_FIFO" ] && [ ! -e "$HELPER_RESPONSE_FIFO" ] || return 42
	mkfifo "$HELPER_REQUEST_FIFO" "$HELPER_RESPONSE_FIFO" 2>/dev/null || helper_start_abort
	chmod 600 "$HELPER_REQUEST_FIFO" "$HELPER_RESPONSE_FIFO" 2>/dev/null || helper_start_abort
	private_fifo "$HELPER_REQUEST_FIFO" && private_fifo "$HELPER_RESPONSE_FIFO" || helper_start_abort
	exec 8<>"$HELPER_REQUEST_FIFO" || helper_start_abort
	exec 9<>"$HELPER_RESPONSE_FIFO" || { exec 8>&-; helper_start_abort; }
	"$FIREWALL_HELPER" <&8 >&9 2>/dev/null &
	helper_pid=$!; helper_start=$(starttime "$helper_pid")
	exec 8>&-; exec 9>&-
	[ -n "$helper_start" ] || helper_start_abort
	atomic_private_write "$HELPER_PID_FILE" "$helper_pid|$helper_start|$operation_id|$operation_nonce|$table_name\n" || helper_start_abort
	atomic_private_write "$HELPER_TRANSPORT_FILE" "table=$table_name\nqueue=$queue_num\nrequest=$HELPER_REQUEST_FIFO\nresponse=$HELPER_RESPONSE_FIFO\n" || helper_start_abort
	helper_identity || helper_start_abort
}

firewall_delete_owned() {
	table_name=$(cat "$HELPER_TRANSPORT_FILE" 2>/dev/null | sed -n 's/^table=//p' || true)
	operation_id="$session:$candidate:$generation"
	helper_record=$(cat "$HELPER_PID_FILE" 2>/dev/null | tr -d '\n' || true)
	helper_rest=${helper_record#*|}; helper_rest=${helper_rest#*|}; helper_rest=${helper_rest#*|}
	operation_nonce=${helper_rest%%|*}
	helper_request ownership_status || return 42
	helper_request ownership_delete || return 42
	helper_stop_reap || return 42
	remove_private_helper_artifacts
	[ ! -e "$HELPER_PID_FILE" ] && [ ! -e "$HELPER_REQUEST_FIFO" ]
}

atomic_private_write() {
	path=$1; content=$2; tmp="$path.tmp.$$.${RANDOM:-0}"
	[ ! -L "$path" ] || return 1
	(umask 077; set -C; printf '%b' "$content" > "$tmp") 2>/dev/null || return 1
	[ ! -L "$tmp" ] && chmod 600 "$tmp" && (sync -f "$tmp" 2>/dev/null || sync) && mv -f "$tmp" "$path" || { rm -f "$tmp"; return 1; }
	[ -f "$path" ] && [ ! -L "$path" ] && (sync -f "$path" 2>/dev/null || sync) && [ "$(cat "$path" 2>/dev/null || true)" = "$(printf '%b' "$content")" ]
}

emit_cleanup() {
	local table_checked=false
	[ "$2" = true ] && [ "$3" = true ] && [ "$4" = true ] && [ "$7" = true ] && table_checked=true
	printf '%s\n' "{\"ok\":$1,\"processRemoved\":$2,\"firewallRemoved\":$3,\"nfqueueRemoved\":$4,\"hostlistRemoved\":$5,\"temporaryFilesRemoved\":$6,\"ownedOnly\":$7,\"tableChecked\":$table_checked,\"tablePresent\":false,\"evidence\":\"$8\"}"
}

cleanup_internal() {
	if [ ! -r "$OWNERSHIP_FILE" ] && [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null; then
		emit_cleanup true true true true true true true complete
		return 0
	fi
	process_removed=true; firewall_removed=true; nfqueue_removed=true; hostlist_removed=true; temporary_removed=true; owned_only=true; evidence=complete
	if [ -r "$HELPER_PID_FILE" ]; then
		if [ -r "$OWNERSHIP_FILE" ]; then
			owned_record=$(cat "$OWNERSHIP_FILE" 2>/dev/null | tr -d '\n' || true)
			operation_id=$(printf '%s' "$owned_record" | cut -d '|' -f4)
			operation_nonce=$(printf '%s' "$owned_record" | cut -d '|' -f5)
		fi
		table_name=$(sed -n 's/^table=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		helper_record=$(cat "$HELPER_PID_FILE" 2>/dev/null | tr -d '\n' || true)
		queue_num=$(sed -n 's/^queue=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		case "$queue_num" in ''|*[!0-9]*) process_removed=false; firewall_removed=false; owned_only=false; evidence=identity ;; esac
		[ "$queue_num" -ge "$QUEUE" ] 2>/dev/null && [ "$queue_num" -le "$QUEUE_MAX" ] 2>/dev/null || { process_removed=false; firewall_removed=false; owned_only=false; evidence=identity; }
		helper_pid=${helper_record%%|*}
		helper_identity || { process_removed=false; firewall_removed=false; owned_only=false; evidence=identity; }
	fi
	if [ -r "$PID_FILE" ] && [ -r "$START_FILE" ]; then
		pid_record=$(cat "$PID_FILE" 2>/dev/null | tr -d '\n' || true)
		pid=${pid_record%%|*}; start=$(cat "$START_FILE")
		if process_alive "$pid" "$start"; then
			kill -TERM "$pid" 2>/dev/null || true; i=0
			while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
			if process_alive "$pid" "$start"; then kill -KILL "$pid" 2>/dev/null || true; fi
			i=0; while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
		fi
		if process_alive "$pid" "$start"; then process_removed=false; owned_only=false; evidence=process; fi
	else
		if [ ! -r "$OWNERSHIP_FILE" ]; then process_removed=false; owned_only=false; evidence=identity; fi
	fi
	if [ "$process_removed" = true ]; then
		if chain_owned; then
			firewall_delete_owned || { firewall_removed=false; owned_only=false; evidence=ownership-mismatch; }
		else
			firewall_removed=false; owned_only=false; evidence=ownership-mismatch
		fi
	fi
	if [ "$firewall_removed" = true ] && [ -r "$HELPER_PID_FILE" ]; then
		helper_stop_reap || { firewall_removed=false; owned_only=false; evidence=helper; }
	fi
	i=0; while [ -n "$(queue_peer)" ] && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
	[ -z "$(queue_peer)" ] || { nfqueue_removed=false; owned_only=false; evidence=nfqueue; }
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ]; then
		atomic_private_write "$CLEANUP_EVIDENCE" 'evidence=complete\n' || { temporary_removed=false; owned_only=false; evidence=temporary; }
	fi
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ] && [ "$temporary_removed" = true ]; then
		rm -f "$ARGV_FILE" "$ARGV_DIGEST_FILE" "$ARGV_META_FILE" "$PID_FILE" "$NFQWS_PID_FILE" "$START_FILE" "$LOG_FILE" "$HOSTLIST_FILE" "$CHAIN_DIGEST_FILE"
		remove_private_helper_artifacts
		[ ! -e "$ARGV_FILE" ] && [ ! -e "$ARGV_DIGEST_FILE" ] && [ ! -e "$ARGV_META_FILE" ] && [ ! -e "$PID_FILE" ] && [ ! -e "$NFQWS_PID_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$LOG_FILE" ] && [ ! -e "$HOSTLIST_FILE" ] && [ ! -e "$CHAIN_DIGEST_FILE" ] && [ ! -e "$HELPER_PID_FILE" ] && [ ! -e "$HELPER_TRANSPORT_FILE" ] && [ ! -e "$HELPER_REQUEST_FIFO" ] && [ ! -e "$HELPER_RESPONSE_FIFO" ] || { temporary_removed=false; owned_only=false; evidence=temporary; }
		if [ "$temporary_removed" = true ]; then
			rm -f "$OWNERSHIP_FILE"
			[ ! -e "$OWNERSHIP_FILE" ] || { temporary_removed=false; owned_only=false; evidence=ownership-metadata; }
		fi
	else
		temporary_removed=false; owned_only=false
	fi
	emit_cleanup true "$process_removed" "$firewall_removed" "$nfqueue_removed" "$hostlist_removed" "$temporary_removed" "$owned_only" "$evidence"
}

fail() {
	code=$1; stage=$2
	[ -z "${RUNTIME_COMPOSITION_TMP:-}" ] || rm -rf "$RUNTIME_COMPOSITION_TMP"
	extra=""
	[ -n "${helper_last_operation:-}" ] && extra="$extra,\"helperOperation\":\"$helper_last_operation\""
	[ -n "${helper_last_code:-}" ] && extra="$extra,\"helperCode\":\"$helper_last_code\""
	[ -n "${helper_last_message:-}" ] && extra="$extra,\"helperMessage\":\"$helper_last_message\""
	if [ "${RESOURCE_CREATED:-0}" = 1 ] && [ "${ROLLING_BACK:-0}" = 0 ]; then
		ROLLING_BACK=1; cleanup=$(cleanup_internal)
		printf '%s\n' "{\"ok\":false,\"code\":\"$code\",\"stage\":\"$stage\"$extra,\"cleanup\":$cleanup}"
	else
		printf '%s\n' "{\"ok\":false,\"code\":\"$code\",\"stage\":\"$stage\"$extra}"
	fi
	exit 1
}

lock_acquire() {
	[ ! -e "$LOCK_OWNER" ] && [ ! -e "$DIR/lock-holder.pid" ] && [ ! -e "$DIR/lock.ready" ] || {
		lock_held && fail ELOCKED lock; fail ETAMPERED lock;
	}
	nonce=$(head -c 32 /dev/urandom | sha256sum | cut -c1-64)
	case "$nonce" in *[!a-f0-9]*|'') fail ELOCKED lock ;; esac
	[ "$(printf '%s' "$nonce" | wc -c)" = 64 ] || fail ELOCKED lock
	flock -n "$LOCK" sh -c 'umask 077; set -C; holder="$1"; descriptor="$2"; ready="$3"; session="$4"; nonce="$5"; start=$(awk '\''{print $22}'\'' "/proc/$$/stat"); printf "%s|%s|%s|%s\n" "$session" "$$" "$start" "$nonce" > "$descriptor" || exit 61; printf "%s\n" "$$" > "$holder" || exit 62; printf "%s|%s|%s\n" "$session" "$nonce" "$$" > "$ready" || exit 63; trap '\''rm -f "$descriptor" "$holder" "$ready"; exit 0'\'' TERM INT HUP; i=0; while [ "$i" -lt 600 ]; do sleep 1; i=$((i+1)); done; rm -f "$descriptor" "$holder" "$ready"; exit 0' sh "$DIR/lock-holder.pid" "$LOCK_OWNER" "$DIR/lock.ready" "$session" "$nonce" >/dev/null 2>&1 &
	owner=$!; i=0; while [ "$i" -lt 20 ] && [ ! -s "$DIR/lock.ready" ]; do short_sleep; i=$((i + 1)); done
	ready_record=$(cat "$DIR/lock.ready" 2>/dev/null | tr -d '\n' || true)
	ready_pid=$(cat "$DIR/lock-holder.pid" 2>/dev/null || true)
	[ "$ready_record" = "$session|$nonce|$ready_pid" ] || { reap_holder; kill "$owner" 2>/dev/null || true; wait "$owner" 2>/dev/null || true; fail ELOCKED lock; }
	lock_record=$(cat "$LOCK_OWNER" 2>/dev/null | tr -d '\n' || true)
	lock_session=${lock_record%%|*}; lock_rest=${lock_record#*|}; lock_pid=${lock_rest%%|*}; lock_rest=${lock_rest#*|}; lock_start=${lock_rest%%|*}; lock_nonce=${lock_rest#*|}
	[ "$lock_session" = "$session" ] && [ -n "$lock_pid" ] && [ -n "$lock_start" ] && [ "$lock_nonce" = "$nonce" ] || { reap_holder; kill "$owner" 2>/dev/null || true; wait "$owner" 2>/dev/null || true; fail ELOCKED lock; }
	lock_session=$lock_session; lock_pid=$lock_pid; lock_start=$lock_start; lock_nonce=$lock_nonce
	lock_held || { reap_holder; kill "$owner" 2>/dev/null || true; wait "$owner" 2>/dev/null || true; fail ELOCKED lock; }
	printf '%s\n' "{\"ok\":true,\"owner\":\"config/global\",\"held\":true,\"lockPid\":$lock_pid,\"session\":\"$session\",\"nonce\":\"$nonce\"}"
}

lock_release() {
	[ -z "${Z2M_TEST_LOG:-}" ] || printf '%s\n' lock-release >> "$Z2M_TEST_LOG"
	[ ! -L "$OWNERSHIP_LOCK" ] || fail ETAMPERED lock
	exec 9>"$OWNERSHIP_LOCK" || fail ETAMPERED lock
	flock -x 9 || fail ETAMPERED lock
	current_record=$(cat "$LOCK_OWNER" 2>/dev/null | tr -d '\n' || true)
	current_session=${current_record%%|*}; current_rest=${current_record#*|}
	current_pid=${current_rest%%|*}; current_rest=${current_rest#*|}
	current_start=${current_rest%%|*}; current_nonce=${current_rest#*|}
	[ "$current_session" = "$session" ] || fail ETAMPERED lock
	[ "$supplied_nonce" = "$current_nonce" ] || fail ETAMPERED lock
	case "$current_pid" in ''|*[!0-9]*) fail ETAMPERED lock ;; esac
	actual_start=$(starttime "$current_pid")
	[ "$actual_start" = "$current_start" ] || fail ETAMPERED lock
	flock -n "$LOCK" -c true >/dev/null 2>&1 && fail ETAMPERED lock
	kill -TERM "$current_pid" 2>/dev/null || fail ELOCKED lock
	i=0; while kill -0 "$current_pid" 2>/dev/null && [ "$i" -lt 20 ]; do short_sleep; i=$((i + 1)); done
	kill -0 "$current_pid" 2>/dev/null && fail ELOCKED lock
	actual_start=$(starttime "$current_pid")
	[ -z "$actual_start" ] || [ "$actual_start" != "$current_start" ] || fail ETAMPERED lock
	[ ! -L "$LOCK_OWNER" ] || fail ETAMPERED lock
	rm -f "$LOCK_OWNER" "$DIR/lock-holder.pid" "$DIR/lock.ready"
	[ ! -e "$LOCK_OWNER" ] || fail ETAMPERED lock
	printf '%s\n' "{\"ok\":true,\"released\":true,\"session\":\"$session\",\"nonce\":\"$current_nonce\"}"
}

activate() {
	lock_held || fail ELOCKED lock
	[ -x "$NFQWS2" ] || fail EDEPENDENCY activate
	[ -r "$ARGV_FILE" ] && [ -r "$ARGV_DIGEST_FILE" ] || fail EINPUT activate
	[ -r "$ARGV_META_FILE" ] || fail EINPUT activate
	compiled_digest=$(cat "$ARGV_DIGEST_FILE"); [ -n "$compiled_digest" ] || fail EINPUT activate
	[ ! -L "$ARGV_FILE" ] && [ ! -L "$ARGV_DIGEST_FILE" ] || fail ETAMPERED activate
	[ ! -L "$ARGV_META_FILE" ] || fail ETAMPERED activate
	meta=$(cat "$ARGV_META_FILE" 2>/dev/null || true)
	expected_meta=$(printf '{ "schema": 1, "session": "%s", "candidate": "%s", "generation": %s, "nonce": "%s", "compiledDigest": "%s" }\n' "$session" "$candidate" "$generation" "$lock_nonce" "$compiled_digest")
	if [ "$meta" != "$expected_meta" ]; then
		printf '%s\n' "{\"ok\":false,\"code\":\"ETAMPERED\",\"stage\":\"activate\",\"check\":\"meta\",\"metaSha256\":\"$(text_digest "$meta")\",\"expectedMetaSha256\":\"$(text_digest "$expected_meta")\"}"
		exit 1
	fi
	argv_stream=$(awk 'BEGIN { sep="" } { printf "%s%s", sep, $0; sep=" " }' "$ARGV_FILE")
	argv_before=$(printf '%s' "$argv_stream" | sha256sum | awk '{print $1}'); if [ "$argv_before" != "$compiled_digest" ]; then
		printf '%s\n' "{\"ok\":false,\"code\":\"ETAMPERED\",\"stage\":\"activate\",\"check\":\"argv-digest\",\"actual\":\"$argv_before\",\"expected\":\"$compiled_digest\"}"
		exit 1
	fi
	set --
	while IFS= read -r token || [ -n "$token" ]; do
		[ -n "$token" ] || fail EINPUT activate
		case "$token" in
			--qnum=*|--daemon*|--pidfile=*|--user=*|--log*=*|--lua-init=*) fail EINPUT activate ;;
			--hostlist=*|--hostlist-exclude=*|--hostlist-auto=*|--ipset=*) value=${token#*=}; case "$value" in /opt/zapret2/*|/tmp/zapret2-manager/scanner/*|/etc/zapret2-manager/lists/whitelist.txt) ;; *) fail EINPUT activate ;; esac ;;
			*[!A-Za-z0-9_.,:=+/@%~#-]*) fail EINPUT activate ;;
		esac
		set -- "$@" "$token"
		done < "$ARGV_FILE"
	# Scanner must consume the same resolver-owned installed closure as the
	# production runtime.  The overlay is diagnostic-only; only explicit
	# LUA_INIT rows become process arguments, in resolver order.
	RUNTIME_COMPOSITION_TMP=$(mktemp -d /tmp/z2m-runtime-scanner.XXXXXX 2>/dev/null) || fail EDEPENDENCY runtime
	_runtime_input="$RUNTIME_COMPOSITION_TMP/input.json"
	_runtime_spec="$RUNTIME_COMPOSITION_TMP/activation.tsv"
	[ -x "$RUNTIME_COMPOSITION_UCODE" ] || fail EDEPENDENCY runtime
	[ -r "$RUNTIME_COMPOSITION_CLI" ] || fail EDEPENDENCY runtime
	printf '%s\n' '{}' > "$_runtime_input" || fail EDEPENDENCY runtime
	"$RUNTIME_COMPOSITION_UCODE" "$RUNTIME_COMPOSITION_CLI" scanner "$_runtime_input" activation-tsv > "$_runtime_spec" 2>/dev/null || fail EDEPENDENCY runtime
	[ -s "$_runtime_spec" ] || fail EDEPENDENCY runtime
	grep -q '^SNAPSHOT|' "$_runtime_spec" || fail EDEPENDENCY runtime
	resolver_luaopt "$_runtime_spec" || fail EDEPENDENCY runtime
	_lua_init_count=0
	while IFS='|' read -r _kind _id _type _entry_kind _source _target _sha _order; do
		[ "$_kind" = LUA_INIT ] || continue
		[ "$_type" = lifecycle-managed ] || [ "$_type" = package-static ] || fail EDEPENDENCY runtime
		[ "$_entry_kind" = lua ] || fail EDEPENDENCY runtime
		runtime_target_rel "$_target" || fail EDEPENDENCY runtime
		case "$_target" in /runtime-assets/lua/*) : ;; *) fail EDEPENDENCY runtime ;; esac
		_init_path="/opt/zapret2/$RUNTIME_TARGET_REL"
		[ -r "$_init_path" ] && [ ! -L "$_init_path" ] || fail EDEPENDENCY runtime
		case "$_sha" in ''|*[!A-Fa-f0-9]*) fail EDEPENDENCY runtime ;; esac
		[ "${#_sha}" -eq 64 ] || fail EDEPENDENCY runtime
		[ "$(sha256sum "$_init_path" | awk '{print $1}')" = "$_sha" ] || fail EDEPENDENCY runtime
		case "$_order" in ''|*[!0-9]*) fail EDEPENDENCY runtime ;; esac
		set -- "$@" "--lua-init=@$_init_path"
		_lua_init_count=$((_lua_init_count + 1))
	done < "$_runtime_spec"
	[ "$_lua_init_count" -gt 0 ] || fail EDEPENDENCY runtime
	rm -rf "$RUNTIME_COMPOSITION_TMP"
	RUNTIME_COMPOSITION_TMP=""
	operation_id="$session:$candidate:$generation"
	operation_nonce="$lock_nonce"
	table_name=""
	allocate_queue || fail EDEPENDENCY nfqueue
	lifecycle_transition PREPARED input || fail EIO journal
	helper_request ownership_create || fail EDEPENDENCY firewall
	RESOURCE_CREATED=1
	lifecycle_transition TABLE_CREATED kernel-owner-readback || fail EIO journal
	helper_request ownership_ready || fail EOWNERSHIP firewall
	atomic_private_write "$OWNERSHIP_FILE" "$session|$candidate|$generation|$operation_id|$operation_nonce\n" || fail EIO ownership
	# Bounded NFQUEUE rule creation under the owned table only.
	# Server-issued values only; no client-controlled raw nft.
		helper_request ownership_nfqueue_prepare || fail EOWNERSHIP firewall
	lifecycle_transition RULES_READY helper-kernel-readback || fail EIO journal
	# Spawn nfqws2 under exact identity; candidate args already sanitized upstream.
	set -- "$@" "--qnum=$queue_num" "--pidfile=$NFQWS_PID_FILE" "--user=daemon"
	"$NFQWS2" "$@" >"$LOG_FILE" 2>&1 &
	nfq_pid=$!
	nfq_start=$(starttime "$nfq_pid")
	[ -n "$nfq_start" ] || fail EDEPENDENCY nfqws2
	atomic_private_write "$PID_FILE" "$nfq_pid|$nfq_start\n" || fail EIO pid
	atomic_private_write "$START_FILE" "$nfq_start\n" || fail EIO start
	# Verify NFQUEUE registration and exact process identity before enabling final hook.
	wait_queue_peer || fail EOWNERSHIP nfqueue
	helper_request ownership_nfqueue_bind || fail EOWNERSHIP nfqueue
	lifecycle_transition PROCESS_BOUND queue-peer-readback || fail EIO journal
	# Atomically enable final redirect rule under the owned table only.
	helper_request ownership_nfqueue_activate || fail EOWNERSHIP activate
	lifecycle_transition ACTIVE helper-active-readback || fail EIO journal
	nfq_digest=$(argv_digest "$nfq_pid"); [ -n "$nfq_digest" ] || fail EIDENTITY activate
	[ "$(process_exe "$nfq_pid")" = "$NFQWS2" ] || fail EIDENTITY activate
	printf '%s\n' "{\"ok\":true,\"activated\":true,\"identityVerified\":true,\"kernelReadBack\":true,\"chainCreated\":true,\"ruleCreated\":true,\"active\":true,\"expectedProcess\":{\"pid\":$nfq_pid,\"startTime\":$nfq_start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$nfq_digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"process\":{\"pid\":$nfq_pid,\"startTime\":$nfq_start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$nfq_digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$table_name\",\"owner\":\"$OWNER\",\"ownedRules\":[\"z2m_scan_prerouting\"]},\"nfqueue\":{\"registered\":true,\"peer_portid\":$nfq_pid,\"queue\":$queue_num}}"
}

stabilize() {
	lock_held || fail ELOCKED lock
	[ -r "$OWNERSHIP_FILE" ] || fail EIDENTITY stabilize
	[ -r "$PID_FILE" ] || fail EIDENTITY stabilize
	pid_record=$(cat "$PID_FILE" 2>/dev/null | tr -d '\n' || true)
	pid=${pid_record%%|*}; start=${pid_record#*|}
	[ -n "$pid" ] && [ -n "$start" ] || fail EIDENTITY stabilize
	queue_num=$(sed -n 's/^queue=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
	case "$queue_num" in ''|*[!0-9]*) fail EIDENTITY stabilize ;; esac
	[ "$queue_num" -ge "$QUEUE" ] && [ "$queue_num" -le "$QUEUE_MAX" ] || fail EIDENTITY stabilize
	deadline=$(( $(date +%s) + 30 ))
	while :; do
		if ! process_alive "$pid" "$start"; then
			printf '%s\n' '{"ok":false,"candidateFailure":true,"reason":"process_exit"}'; return 0
		fi
		q=$(queue_peer)
		if [ -n "$q" ] && [ "$q" = "$pid" ]; then
			helper_request ownership_status || { printf '%s\n' '{"ok":false,"infrastructure":true,"reason":"ownership_lost"}'; return 0; }
			digest=$(argv_digest "$pid"); [ -n "$digest" ] || { printf '%s\n' '{"ok":false,"infrastructure":true,"reason":"identity_unavailable"}'; return 0; }
			printf '%s\n' "{\"ok\":true,\"stable\":true,\"identityVerified\":true,\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$table_name\",\"owner\":\"$OWNER\",\"ownedRules\":[\"z2m_scan_prerouting\"]},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid,\"queue\":$queue_num}}"; return 0
		fi
		now=$(date +%s)
		[ "$now" -lt "$deadline" ] || { printf '%s\n' '{"ok":false,"infrastructure":true,"reason":"timeout"}'; return 0; }
		short_sleep
	done
}

cleanup() {
	lock_held || fail ELOCKED lock
	[ -r "$OWNERSHIP_FILE" ] || { [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null || fail EIDENTITY cleanup; }
	lifecycle_transition CLEANING cleanup-start || fail EIO journal
	cleanup=$(cleanup_internal)
	case "$cleanup" in *'"ownedOnly":true'*) lifecycle_transition CLEANED cleanup-complete || fail EIO journal; printf '%s\n' "$cleanup" ;; *) fail ECLEANUP cleanup ;; esac
}

session_cleanup() {
	[ -z "${Z2M_TEST_LOG:-}" ] || printf '%s\n' session-cleanup >> "$Z2M_TEST_LOG"
	lock_held && fail ELOCKED cleanup
	[ ! -e "$LOCK_OWNER" ] || fail ETAMPERED cleanup
	if [ -e "$OWNERSHIP_FILE" ] || [ -e "$PID_FILE" ] || [ -e "$CHAIN_DIGEST_FILE" ]; then
		[ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null || fail ECLEANUP cleanup
	fi
	recovery_evidence="$ROOT/$session.recovery.evidence"
	atomic_private_write "$recovery_evidence" "session=$session\nverified=true\ndurability=tmpfs_visible\n" || fail ECLEANUP cleanup
	# Remove only the fixed runtime sidecars; unknown files keep rmdir fail-closed.
	rm -f "$DIR"/*.argv "$DIR"/*.argv.digest "$DIR"/*.argv.meta "$DIR"/*.pid "$DIR"/*.nfqws2.pid "$DIR"/*.helper.pid "$DIR"/*.helper.transport "$DIR"/*.helper.request "$DIR"/*.helper.response "$DIR"/*.lifecycle
	rm -f "$CLEANUP_EVIDENCE" "$OWNERSHIP_LOCK" "$DIR/lock.ready"
	rmdir "$DIR" 2>/dev/null || { atomic_private_write "$recovery_evidence" "session=$session\nverified=false\ndurability=tmpfs_visible\n" || true; fail ECLEANUP cleanup; }
	[ ! -e "$DIR" ] || fail ECLEANUP cleanup
	printf '%s\n' '{"ok":true,"removed":true,"verified":true,"sessionDirectoryRemoved":true}'
}

case "$operation" in
	lock-acquire) lock_acquire ;;
	lock-release) lock_release ;;
	activate) activate ;;
	stabilize) stabilize ;;
	cleanup) cleanup ;;
	session-cleanup) session_cleanup ;;
esac
