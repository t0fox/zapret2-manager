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
PROFILE=tcp_https
OWNER=scanner/session

if [ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ]; then
	[ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] || { printf '%s\n' '{"ok":false,"code":"EINPUT","stage":"input"}'; exit 1; }
	case "${Z2M_SCANNER_TEST_BASE:-}" in
		/tmp/z2m-router-e2e-*|/tmp/z2m-scanner-test-*) BASE=$Z2M_SCANNER_TEST_BASE; ROOT=$BASE/scanner ;;
		'') ;;
		*) exit 1 ;;
	esac
	NFQWS2=${Z2M_SCANNER_TEST_NFQWS2:-$NFQWS2}
	FIREWALL_HELPER=${Z2M_SCANNER_TEST_FIREWALL_HELPER:-$FIREWALL_HELPER}
	NFQ_PROC=${Z2M_SCANNER_TEST_NFQ_PROC:-$NFQ_PROC}
	LOCK=${Z2M_SCANNER_TEST_LOCK:-$LOCK}
fi

operation=${1:-}; session=${2:-}; candidate=${3:-}; generation=${4:-}; supplied_nonce=${5:-}; requested_profile=${6:-tcp_https}
case "$operation" in lock-acquire|lock-release|activate|stabilize|cleanup|session-cleanup) ;; *) exit 1 ;; esac
case "$session" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$candidate" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$generation" in ''|*[!0-9]*) exit 1 ;; esac
[ "$generation" -le 65535 ] || exit 1
case "$requested_profile" in tcp_https|tcp_http|udp_443) PROFILE=$requested_profile ;; *) exit 1 ;; esac

DIR="$ROOT/$session"
ARGV_FILE="$DIR/$candidate.argv"
ARGV_DIGEST_FILE="$ARGV_FILE.digest"
ARGV_META_FILE="$ARGV_FILE.meta"
PID_FILE="$DIR/$candidate.pid"
START_FILE="$DIR/$candidate.starttime"
PGROUP_FILE="$DIR/$candidate.pgroup"
RUNTIME_ARGV_DIGEST_FILE="$DIR/$candidate.argv.runtime.digest"
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
private_dir() {
	path=$1
	[ -d "$path" ] && [ ! -L "$path" ] || return 1
	set -- $(ls -ldn "$path" 2>/dev/null) || return 1
	expected_uid=0
	[ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ] && [ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] && expected_uid=$(id -u)
	[ "$(printf '%s' "$1" | cut -c2-10)" = 'rwx------' ] && [ "$3" = "$expected_uid" ] && [ "$4" = "$expected_uid" ]
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
queue_peer() { awk -v q="$QUEUE" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true; }
process_alive() { [ -r "/proc/$1/stat" ] && [ "$(starttime "$1")" = "$2" ]; }
process_exe() { readlink "/proc/$1/exe" 2>/dev/null || true; }
process_group() { awk '{print $5}' "/proc/$1/stat" 2>/dev/null || true; }

allocate_queue() {
	q=300
	while [ "$q" -le 399 ]; do
		if ! awk -v q="$q" '$1 == q { found=1 } END { exit found ? 0 : 1 }' "$NFQ_PROC" 2>/dev/null; then
			QUEUE=$q
			return 0
		fi
		q=$((q + 1))
	done
	return 1
}

reap_holder() {
	record=$(cat "$LOCK_OWNER" 2>/dev/null | tr -d '\n' || true)
	record_session=${record%%|*}; rest=${record#*|}; record_pid=${rest%%|*}; rest=${rest#*|}; record_nonce=${rest#*|}
	ready_record=$(cat "$DIR/lock.ready" 2>/dev/null | tr -d '\n' || true)
	ready_pid=$(cat "$DIR/lock-holder.pid" 2>/dev/null || true)
	if [ "$record_session" = "$session" ] && [ "$record_nonce" = "$nonce" ] &&
		[ "$ready_record" = "$session|$nonce|$record_pid" ] && [ "$ready_pid" = "$record_pid" ]; then
		case "$record_pid" in ''|*[!0-9]*) return ;; esac
		kill -TERM "$record_pid" 2>/dev/null || true
		i=0; while kill -0 "$record_pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
		kill -KILL "$record_pid" 2>/dev/null || true
		wait "$record_pid" 2>/dev/null || true
		rm -f "$LOCK_OWNER" "$DIR/lock-holder.pid" "$DIR/lock.ready"
	fi
}

nonce_marker="$session:$candidate:$generation:$(head -c 32 /dev/urandom | sha256sum | cut -c1-32 || true)"
lock_session=""; lock_pid=""; lock_start=""; lock_nonce=""
LAST_HELPER_RESPONSE=""
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
	[ "$(printf '%s' "$1" | cut -c2-10)" = 'rw-------' ] && [ "$3" = "$(id -u)" ] && [ "$4" = "$(id -g)" ]
}

private_file() {
	path=$1
	[ -f "$path" ] && [ ! -L "$path" ] || return 1
	set -- $(ls -ldn "$path" 2>/dev/null) || return 1
	[ "$(printf '%s' "$1" | cut -c2-10)" = 'rw-------' ] && [ "$3" = "$(id -u)" ] && [ "$4" = "$(id -g)" ]
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
	while ! helper_gone && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	if ! helper_gone; then kill -KILL "$helper_pid" 2>/dev/null || true; fi
	i=0
	while ! helper_gone && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	wait "$helper_pid" 2>/dev/null || true
	stop_ok=true
	helper_gone || stop_ok=false
	[ "$stop_ok" = true ]
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
		rules_prepare) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.prepared' 2>/dev/null)" = true ] || return 1 ;;
		rules_enable) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.enabled' 2>/dev/null)" = true ] || return 1 ;;
		rules_disable) [ "$(printf '%s' "$response" | jsonfilter -e '@.data.disabled' 2>/dev/null)" = true ] || return 1 ;;
		*) return 1 ;;
	esac
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.tableName' 2>/dev/null)" = "$table_name" ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.evidence.tableName' 2>/dev/null)" = "$table_name" ] || return 1
	[ "$(printf '%s' "$response" | jsonfilter -e '@.data.evidence.ownerFlagRequested' 2>/dev/null)" = true ] || return 1
	if [ "$operation_name" = rules_prepare ] || [ "$operation_name" = rules_enable ]; then
		[ "$(printf '%s' "$response" | jsonfilter -e '@.data.queue' 2>/dev/null)" = "$QUEUE" ] || return 1
		[ "$(printf '%s' "$response" | jsonfilter -e '@.data.profile' 2>/dev/null)" = "$PROFILE" ] || return 1
		[ "$(printf '%s' "$response" | jsonfilter -e '@.data.generation' 2>/dev/null)" = "$generation" ] || return 1
		[ -n "$(printf '%s' "$response" | jsonfilter -e '@.data.chainName' 2>/dev/null)" ] || return 1
	fi
	LAST_HELPER_RESPONSE=$response
}

helper_request() {
	helper_operation_name=$1
	request_id="scanner:$session:$candidate:$generation:$(printf '%s' "$helper_operation_name" | tr -c 'A-Za-z0-9._:-' '_')"
	if [ "$helper_operation_name" = ownership_create ]; then
		table_name="z2m_sc_$(printf '%s' "$session" | sha256sum | cut -c1-8)_$(printf '%s' "$candidate" | sha256sum | cut -c1-8)_$(printf '%04x' "$generation")_$(printf '%s' "$operation_nonce" | cut -c1-32)"
		[ "$(printf '%s' "$table_name" | wc -c)" = 62 ] || return 42
		operation_id="$session:$candidate:$generation"
		helper_start_lifecycle
	else
		table_name=$(sed -n 's/^table=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		if [ -r "$OWNERSHIP_FILE" ]; then
			owned_record=$(cat "$OWNERSHIP_FILE" 2>/dev/null | tr -d '\n' || true)
			operation_id=$(printf '%s' "$owned_record" | cut -d '|' -f4)
			operation_nonce=$(printf '%s' "$owned_record" | cut -d '|' -f5)
			owned_queue=$(printf '%s' "$owned_record" | cut -d '|' -f8)
			owned_profile=$(printf '%s' "$owned_record" | cut -d '|' -f9)
			case "$owned_queue" in ''|*[!0-9]*) ;; *) QUEUE=$owned_queue ;; esac
			case "$owned_profile" in tcp_https|tcp_http|udp_443) PROFILE=$owned_profile ;; esac
		fi
		helper_identity || return 42
	fi
	exec 8<>"$HELPER_REQUEST_FIFO" || return 42
	exec 9<>"$HELPER_RESPONSE_FIFO" || { exec 8>&-; return 42; }
	if [ "$helper_operation_name" = ownership_create ] || [ "$helper_operation_name" = ownership_ready ] ||
		[ "$helper_operation_name" = ownership_delete ] || [ "$helper_operation_name" = ownership_status ]; then
		request=$(printf '{"protocolVersion":2,"requestId":"%s","operation":"%s","arguments":{"tableName":"%s","operationId":"%s","nonce":"%s"}}\n' \
			"$request_id" "$helper_operation_name" "$table_name" "$operation_id" "$operation_nonce")
	else
		request=$(printf '{"protocolVersion":2,"requestId":"%s","operation":"%s","arguments":{"tableName":"%s","operationId":"%s","nonce":"%s","generation":%s,"queue":%s,"profile":"%s"}}\n' \
			"$request_id" "$helper_operation_name" "$table_name" "$operation_id" "$operation_nonce" "$generation" "$QUEUE" "$PROFILE")
	fi
	printf '%s\n' "$request" >&8 || { exec 8>&-; exec 9>&-; return 42; }
	IFS= read -r response <&9 || { exec 8>&-; exec 9>&-; return 42; }
	exec 8>&-; exec 9>&-
	if ! helper_response_ok "$request_id" "$helper_operation_name" "$response"; then
		[ "$helper_operation_name" = ownership_create ] && helper_start_abort || true
		return 42
	fi
	if [ "$helper_operation_name" = rules_prepare ]; then
		chain_name=$(printf '%s' "$response" | jsonfilter -e '@.data.chainName' 2>/dev/null)
		atomic_private_write "$HELPER_TRANSPORT_FILE" "table=$table_name\nchain=$chain_name\nqueue=$QUEUE\nprofile=$PROFILE\ngeneration=$generation\nrequest=$HELPER_REQUEST_FIFO\nresponse=$HELPER_RESPONSE_FIFO\n" || return 42
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
	atomic_private_write "$HELPER_TRANSPORT_FILE" "table=$table_name\nrequest=$HELPER_REQUEST_FIFO\nresponse=$HELPER_RESPONSE_FIFO\n" || helper_start_abort
	helper_identity || helper_start_abort
}

firewall_disable_owned() {
	[ -r "$HELPER_PID_FILE" ] || return 0
	helper_request rules_disable
}

firewall_delete_owned() {
	table_name=$(cat "$HELPER_TRANSPORT_FILE" 2>/dev/null | sed -n 's/^table=//p' || true)
	operation_id="$session:$candidate:$generation"
	helper_record=$(cat "$HELPER_PID_FILE" 2>/dev/null | tr -d '\n' || true)
	helper_rest=${helper_record#*|}; helper_rest=${helper_rest#*|}; helper_rest=${helper_rest#*|}
	operation_nonce=${helper_rest%%|*}
	helper_request ownership_delete || return 42
	helper_stop_reap || return 42
	remove_private_helper_artifacts
	delete_ok=true
	[ ! -e "$HELPER_PID_FILE" ] || delete_ok=false
	[ ! -e "$HELPER_REQUEST_FIFO" ] || delete_ok=false
	[ "$delete_ok" = true ]
}

atomic_private_write() {
	path=$1; content=$2; tmp="$path.tmp.$$.${RANDOM:-0}"
	[ ! -L "$path" ] || return 1
	(umask 077; set -C; printf '%b' "$content" > "$tmp") 2>/dev/null || return 1
	[ ! -L "$tmp" ] && chmod 600 "$tmp" && (sync -f "$tmp" 2>/dev/null || sync) && mv -f "$tmp" "$path" || { rm -f "$tmp"; return 1; }
	[ -f "$path" ] && [ ! -L "$path" ] && (sync -f "$path" 2>/dev/null || sync) && [ "$(cat "$path" 2>/dev/null || true)" = "$(printf '%b' "$content")" ]
}

emit_cleanup() {
	printf '%s\n' "{\"ok\":$1,\"processRemoved\":$2,\"firewallRemoved\":$3,\"nfqueueRemoved\":$4,\"hostlistRemoved\":$5,\"temporaryFilesRemoved\":$6,\"ownedOnly\":$7,\"evidence\":\"$8\"}"
}

cleanup_internal() {
	if [ ! -r "$OWNERSHIP_FILE" ] && [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null; then
		emit_cleanup true true true true true true true complete
		return 0
	fi
	process_removed=true; firewall_removed=true; nfqueue_removed=true; hostlist_removed=true; temporary_removed=true; owned_only=true; evidence=complete
	if [ -r "$OWNERSHIP_FILE" ]; then
		owned_record=$(cat "$OWNERSHIP_FILE" 2>/dev/null | tr -d '\n' || true)
		operation_id=$(printf '%s' "$owned_record" | cut -d '|' -f4)
		operation_nonce=$(printf '%s' "$owned_record" | cut -d '|' -f5)
		table_name=$(sed -n 's/^table=//p' "$HELPER_TRANSPORT_FILE" 2>/dev/null || true)
		helper_record=$(cat "$HELPER_PID_FILE" 2>/dev/null | tr -d '\n' || true)
		helper_pid=${helper_record%%|*}
		helper_identity || { process_removed=false; firewall_removed=false; owned_only=false; evidence=identity; }
		if [ "$firewall_removed" = true ]; then
			firewall_disable_owned || { firewall_removed=false; owned_only=false; evidence=redirect; }
		fi
	fi
	if [ -r "$PID_FILE" ] && [ -r "$START_FILE" ]; then
		pid=$(cat "$PID_FILE"); start=$(cat "$START_FILE")
		if process_alive "$pid" "$start"; then
			kill -TERM "$pid" 2>/dev/null || true; i=0
			while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
		if process_alive "$pid" "$start"; then kill -KILL "$pid" 2>/dev/null || true; fi
			i=0; while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
		wait "$pid" 2>/dev/null || true
		fi
		if process_alive "$pid" "$start"; then process_removed=false; owned_only=false; evidence=process; fi
	else
		if [ ! -r "$OWNERSHIP_FILE" ]; then process_removed=false; owned_only=false; evidence=identity; fi
	fi
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ]; then
		if [ -r "$HELPER_PID_FILE" ]; then
			firewall_delete_owned || { firewall_removed=false; owned_only=false; evidence=ownership-mismatch; }
			helper_stop_reap || { firewall_removed=false; owned_only=false; evidence=helper; }
		fi
	fi
	i=0; while [ -n "$(queue_peer)" ] && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	[ -z "$(queue_peer)" ] || { nfqueue_removed=false; owned_only=false; evidence=nfqueue; }
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ]; then
		atomic_private_write "$CLEANUP_EVIDENCE" 'evidence=complete\n' || { temporary_removed=false; owned_only=false; evidence=temporary; }
	fi
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ] && [ "$temporary_removed" = true ]; then
		rm -f "$ARGV_FILE" "$ARGV_DIGEST_FILE" "$ARGV_META_FILE" "$PID_FILE" "$START_FILE" "$PGROUP_FILE" "$RUNTIME_ARGV_DIGEST_FILE" "$LOG_FILE" "$HOSTLIST_FILE" "$CHAIN_DIGEST_FILE"
		remove_private_helper_artifacts
		[ ! -e "$ARGV_FILE" ] && [ ! -e "$ARGV_DIGEST_FILE" ] && [ ! -e "$ARGV_META_FILE" ] && [ ! -e "$PID_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$PGROUP_FILE" ] && [ ! -e "$RUNTIME_ARGV_DIGEST_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$LOG_FILE" ] && [ ! -e "$HOSTLIST_FILE" ] && [ ! -e "$CHAIN_DIGEST_FILE" ] && [ ! -e "$HELPER_PID_FILE" ] && [ ! -e "$HELPER_TRANSPORT_FILE" ] && [ ! -e "$HELPER_REQUEST_FIFO" ] && [ ! -e "$HELPER_RESPONSE_FIFO" ] && [ ! -e "$HELPER_PID_FILE" ] || { temporary_removed=false; owned_only=false; evidence=temporary; }
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
	if [ "${RESOURCE_CREATED:-0}" = 1 ] && [ "${ROLLING_BACK:-0}" = 0 ]; then
		ROLLING_BACK=1; cleanup=$(cleanup_internal)
		printf '%s\n' "{\"ok\":false,\"code\":\"$code\",\"stage\":\"$stage\",\"cleanup\":$cleanup}"
	else
		printf '%s\n' "{\"ok\":false,\"code\":\"$code\",\"stage\":\"$stage\"}"
	fi
	exit 1
}

lock_acquire() {
	[ ! -e "$LOCK_OWNER" ] && [ ! -e "$DIR/lock-holder.pid" ] && [ ! -e "$DIR/lock.ready" ] || {
		lock_held && fail ELOCKED lock; fail ETAMPERED lock;
	}
	nonce=$(head -c 64 /dev/urandom | sha256sum | awk '{print $1}')
	case "$nonce" in *[!a-f0-9]*|'') fail ELOCKED lock ;; esac
	[ "$(printf '%s' "$nonce" | wc -c)" = 64 ] || fail ELOCKED lock
	flock -n "$LOCK" sh -c 'umask 077; set -C; holder="$1"; descriptor="$2"; ready="$3"; session="$4"; nonce="$5"; start=$(awk '\''{print $22}'\'' "/proc/$$/stat"); printf "%s|%s|%s|%s\n" "$session" "$$" "$start" "$nonce" > "$descriptor" || exit 61; printf "%s\n" "$$" > "$holder" || exit 62; printf "%s|%s|%s\n" "$session" "$nonce" "$$" > "$ready" || exit 63; trap '\''rm -f "$descriptor" "$holder" "$ready"; exit 0'\'' TERM INT HUP; while :; do sleep 1; done' sh "$DIR/lock-holder.pid" "$LOCK_OWNER" "$DIR/lock.ready" "$session" "$nonce" >/dev/null 2>&1 &
	owner=$!; i=0; while [ "$i" -lt 20 ] && [ ! -s "$DIR/lock.ready" ]; do sleep 0.05; i=$((i + 1)); done
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
	i=0; while kill -0 "$current_pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
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
	[ "$meta" = "$expected_meta" ] || fail ETAMPERED activate
	argv_before=$(sha256sum "$ARGV_FILE" | awk '{print $1}'); [ "$argv_before" = "$compiled_digest" ] || fail ETAMPERED activate
	set --
	while IFS= read -r token || [ -n "$token" ]; do
		[ -n "$token" ] || fail EINPUT activate
		case "$token" in
			--qnum=*|--daemon*|--pidfile=*|--user=*|--log*=*|--lua-init=*) fail EINPUT activate ;;
			--hostlist=*|--hostlist-exclude=*|--hostlist-auto=*|--ipset=*) value=${token#*=}; case "$value" in /opt/zapret2/*|/tmp/zapret2-manager/scanner/*) ;; *) fail EINPUT activate ;; esac ;;
			*[!A-Za-z0-9_.,:=+/@%~#-]*) fail EINPUT activate ;;
		esac
		set -- "$@" "$token"
	done < "$ARGV_FILE"
	operation_id="$session:$candidate:$generation"
	operation_nonce="$lock_nonce"
	PROFILE="$requested_profile"
	allocate_queue || fail EQUEUE allocate
	table_name=""
	helper_request ownership_create || fail EDEPENDENCY firewall
	RESOURCE_CREATED=1
	helper_request ownership_ready || fail EOWNERSHIP firewall
	helper_request rules_prepare || fail EOWNERSHIP rules
	chain_name=$(printf '%s' "$LAST_HELPER_RESPONSE" | jsonfilter -e '@.data.chainName' 2>/dev/null)
	[ -n "$chain_name" ] || fail EOWNERSHIP rules
	set -- "$@" "--qnum=$QUEUE"
	argv_before=$(sha256sum "$ARGV_FILE" | awk '{print $1}'); [ "$argv_before" = "$compiled_digest" ] || fail ETAMPERED activate
	"$NFQWS2" "$@" >"$LOG_FILE" 2>&1 &
	pid=$!
	start=$(starttime "$pid"); exe=$(process_exe "$pid"); group=$(process_group "$pid"); runtime_digest=$(argv_digest "$pid")
	[ -n "$start" ] && [ "$exe" = "$NFQWS2" ] && [ -n "$group" ] && [ -n "$runtime_digest" ] || fail EPROCESS launch
	atomic_private_write "$PID_FILE" "$pid\n" || fail EIO process
	atomic_private_write "$START_FILE" "$start\n" || fail EIO process
	atomic_private_write "$PGROUP_FILE" "$group\n" || fail EIO process
	atomic_private_write "$RUNTIME_ARGV_DIGEST_FILE" "$runtime_digest\n" || fail EIO process
	atomic_private_write "$OWNERSHIP_FILE" "$session|$candidate|$generation|$operation_id|$operation_nonce|$table_name|$chain_name|$QUEUE|$PROFILE\n" || fail EIO ownership
	i=0
	while [ "$i" -lt 20 ] && { [ "$(queue_peer)" != "$pid" ] || [ "$(argv_digest "$pid")" != "$runtime_digest" ]; }; do
		process_alive "$pid" "$start" || fail ECRASH bind
		sleep 0.05; i=$((i + 1))
	done
	process_alive "$pid" "$start" || fail ECRASH bind
	[ "$(process_exe "$pid")" = "$NFQWS2" ] || fail EIDENTITY bind
	[ "$(queue_peer)" = "$pid" ] || fail EQUEUE bind
	[ "$(argv_digest "$pid")" = "$runtime_digest" ] || fail EIDENTITY bind
	# The table chain is empty until the exact process and queue binding are
	# verified; only this operation enables the packet redirect.
	helper_request rules_enable || fail EOWNERSHIP rules
	owner_flag_requested=$(printf '%s' "$LAST_HELPER_RESPONSE" | jsonfilter -e '@.data.evidence.ownerFlagRequested' 2>/dev/null)
	kernel_read_back=$(printf '%s' "$LAST_HELPER_RESPONSE" | jsonfilter -e '@.data.evidence.kernelReadBack' 2>/dev/null)
	[ -n "$kernel_read_back" ] || kernel_read_back=false
	[ "$owner_flag_requested" = true ] || fail EOWNERSHIP rules
	[ "$kernel_read_back" = true ] || [ "$kernel_read_back" = false ] || fail EOWNERSHIP rules
	printf '%s\n' "{\"ok\":true,\"state\":\"ACTIVE\",\"identityVerified\":true,\"expectedProcess\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$runtime_digest\",\"processGroup\":$group,\"owner\":\"$OWNER\",\"generation\":$generation},\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$runtime_digest\",\"processGroup\":$group,\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$table_name\",\"chain\":\"$chain_name\",\"owner\":\"$OWNER\",\"ownerFlagRequested\":$owner_flag_requested,\"kernelReadBack\":$kernel_read_back,\"ruleGeneration\":$generation,\"profile\":\"$PROFILE\",\"qnum\":$QUEUE,\"rulesReady\":true,\"activationOrder\":\"queue-bound-before-redirect\",\"ownedRules\":[\"$chain_name\"]},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid,\"queue\":$QUEUE}}"
}

stabilize() {
	lock_held || fail ELOCKED lock
	[ -r "$PID_FILE" ] && [ -r "$START_FILE" ] && [ -r "$RUNTIME_ARGV_DIGEST_FILE" ] || fail EIDENTITY stabilize
	pid=$(cat "$PID_FILE"); start=$(cat "$START_FILE"); runtime_digest=$(cat "$RUNTIME_ARGV_DIGEST_FILE")
	i=0
	while [ "$i" -lt 20 ]; do
		process_alive "$pid" "$start" || fail ECRASH stabilize
		[ "$(process_exe "$pid")" = "$NFQWS2" ] || fail EIDENTITY stabilize
		[ "$(argv_digest "$pid")" = "$runtime_digest" ] || fail EIDENTITY stabilize
		[ "$(queue_peer)" = "$pid" ] || fail EQUEUE stabilize
		helper_request ownership_status || fail EOWNERSHIP stabilize
		[ "$(printf '%s' "$LAST_HELPER_RESPONSE" | jsonfilter -e '@.data.rulesEnabled' 2>/dev/null)" = true ] || fail ERULES stabilize
		printf '%s\n' "{\"ok\":true,\"stable\":true,\"state\":\"ACTIVE\",\"pid\":$pid,\"startTime\":$start,\"queue\":$QUEUE,\"ruleGeneration\":$generation,\"checks\":{\"process\":true,\"argv\":true,\"queue\":true,\"rules\":true}}"
		return 0
	done
	fail ETIMEOUT stabilize
}

cleanup() {
	lock_held || fail ELOCKED lock
	[ -r "$OWNERSHIP_FILE" ] || { [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null || fail EIDENTITY cleanup; }
	cleanup=$(cleanup_internal)
	case "$cleanup" in *'"ownedOnly":true'*) printf '%s\n' "$cleanup" ;; *) fail ECLEANUP cleanup ;; esac
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
	rm -f "$DIR"/*.argv "$DIR"/*.argv.digest "$DIR"/*.argv.meta "$DIR"/*.argv.runtime.digest "$DIR"/*.pid "$DIR"/*.starttime "$DIR"/*.pgroup "$DIR"/*.helper.pid "$DIR"/*.helper.transport "$DIR"/*.helper.request "$DIR"/*.helper.response
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
