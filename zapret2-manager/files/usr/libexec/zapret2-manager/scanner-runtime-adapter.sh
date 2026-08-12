#!/bin/ash
# Fixed transient Scanner runtime owner. Only server-issued safe IDs cross the
# shell boundary; candidate tokens are read from verified server-owned files.
set -eu

ROOT=/tmp/zapret2-manager/scanner
NFQWS2=/opt/zapret2/nfq2/nfqws2
NFT=/usr/sbin/nft
NFQ_PROC=/proc/net/netfilter/nfnetlink_queue
INIT=/etc/init.d/zapret2
LOCK=/opt/zapret2/config.lock
TABLE=zapret2
CHAIN=z2m_scanner
QUEUE=300
OWNER=scanner/session

if [ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ]; then
	[ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] || { printf '%s\n' '{"ok":false,"code":"EINPUT","stage":"input"}'; exit 1; }
	NFQWS2=${Z2M_SCANNER_TEST_NFQWS2:-$NFQWS2}
	NFT=${Z2M_SCANNER_TEST_NFT:-$NFT}
	INIT=${Z2M_SCANNER_TEST_INIT:-$INIT}
	NFQ_PROC=${Z2M_SCANNER_TEST_NFQ_PROC:-$NFQ_PROC}
	LOCK=${Z2M_SCANNER_TEST_LOCK:-$LOCK}
fi

operation=${1:-}; session=${2:-}; candidate=${3:-}; generation=${4:-}; supplied_nonce=${5:-}
case "$operation" in lock-acquire|lock-release|activate|stabilize|cleanup|session-cleanup) ;; *) exit 1 ;; esac
case "$session" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$candidate" in [A-Za-z0-9][A-Za-z0-9._-]*) ;; *) exit 1 ;; esac
case "$generation" in ''|*[!0-9]*) exit 1 ;; esac

DIR="$ROOT/$session"
ARGV_FILE="$DIR/$candidate.argv"
ARGV_DIGEST_FILE="$ARGV_FILE.digest"
PID_FILE="$DIR/$candidate.pid"
START_FILE="$DIR/$candidate.starttime"
LOG_FILE="$DIR/$candidate.log"
HOSTLIST_FILE="$DIR/$candidate.hostlist"
OWNERSHIP_FILE="$DIR/$candidate.ownership"
CHAIN_DIGEST_FILE="$DIR/$candidate.chain.sha256"
LOCK_OWNER="$DIR/lock.descriptor"
if [ "$operation" = session-cleanup ]; then
	[ -d "$DIR" ] || { printf '%s\n' '{"ok":false,"code":"ECLEANUP","stage":"cleanup"}'; exit 1; }
else
	mkdir -p "$DIR" 2>/dev/null || exit 1
fi

starttime() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true; }
argv_digest() { sha256sum "/proc/$1/cmdline" 2>/dev/null | awk '{print $1}' || true; }
queue_peer() { awk -v q="$QUEUE" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true; }
process_alive() { [ -r "/proc/$1/stat" ] && [ "$(starttime "$1")" = "$2" ]; }
process_exe() { readlink "/proc/$1/exe" 2>/dev/null || true; }

marker="z2m-scanner:$session:$candidate:$generation"
lock_nonce=""
if [ -r "$LOCK_OWNER" ]; then
	lock_record=$(cat "$LOCK_OWNER" 2>/dev/null || true)
	lock_session=${lock_record%%|*}; lock_rest=${lock_record#*|}
	lock_pid=${lock_rest%%|*}; lock_rest=${lock_rest#*|}
	lock_start=${lock_rest%%|*}; lock_nonce=${lock_rest#*|}
fi

lock_held() {
	[ "$lock_session" = "$session" ] || return 1
	case "$lock_pid" in ''|*[!0-9]*) return 1 ;; esac
	case "$lock_start" in ''|*[!0-9]*) return 1 ;; esac
	[ -n "$lock_nonce" ] || return 1
	[ "$(starttime "$lock_pid")" = "$lock_start" ] || return 1
	kill -0 "$lock_pid" 2>/dev/null || return 1
	flock -n "$LOCK" -c true >/dev/null 2>&1 && return 1
	return 0
}

chain_owned() {
	chain_text=$("$NFT" list chain inet "$TABLE" "$CHAIN" 2>/dev/null || true)
	marker_count=$(printf '%s\n' "$chain_text" | grep -F -c "$marker" || true)
	queue_count=$(printf '%s\n' "$chain_text" | grep -F -c "queue num $QUEUE" || true)
	exact_digest=$(cat "$CHAIN_DIGEST_FILE" 2>/dev/null || true)
	actual_digest=$(printf '%s\n' "$chain_text" | sha256sum | awk '{print $1}')
	[ "$marker_count" = 1 ] && [ "$queue_count" = 1 ] && [ -n "$exact_digest" ] && [ "$actual_digest" = "$exact_digest" ]
}

emit_cleanup() {
	printf '%s\n' "{\"ok\":$1,\"processRemoved\":$2,\"firewallRemoved\":$3,\"nfqueueRemoved\":$4,\"hostlistRemoved\":$5,\"temporaryFilesRemoved\":$6,\"ownedOnly\":$7,\"evidence\":\"$8\"}"
}

cleanup_internal() {
	process_removed=true; firewall_removed=true; nfqueue_removed=true; hostlist_removed=true; temporary_removed=true; owned_only=true; evidence=complete
	if [ -r "$PID_FILE" ] && [ -r "$START_FILE" ]; then
		pid=$(cat "$PID_FILE"); start=$(cat "$START_FILE")
		if process_alive "$pid" "$start"; then
			kill -TERM "$pid" 2>/dev/null || true; i=0
			while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
			if process_alive "$pid" "$start"; then kill -KILL "$pid" 2>/dev/null || true; fi
			i=0; while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
		fi
		if process_alive "$pid" "$start"; then process_removed=false; owned_only=false; evidence=process; fi
	else
		if [ ! -r "$OWNERSHIP_FILE" ]; then process_removed=false; owned_only=false; evidence=identity; fi
	fi
	if [ "$process_removed" = true ]; then
		if chain_owned; then
			"$NFT" delete chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1 || { firewall_removed=false; owned_only=false; evidence=firewall; }
		else
			firewall_removed=false; owned_only=false; evidence=ownership-mismatch
		fi
	fi
	i=0; while [ -n "$(queue_peer)" ] && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	[ -z "$(queue_peer)" ] || { nfqueue_removed=false; owned_only=false; evidence=nfqueue; }
	rm -f "$ARGV_FILE" "$ARGV_DIGEST_FILE" "$PID_FILE" "$START_FILE" "$LOG_FILE" "$HOSTLIST_FILE" "$OWNERSHIP_FILE" "$CHAIN_DIGEST_FILE"
	[ ! -e "$ARGV_FILE" ] && [ ! -e "$ARGV_DIGEST_FILE" ] && [ ! -e "$PID_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$LOG_FILE" ] && [ ! -e "$HOSTLIST_FILE" ] && [ ! -e "$OWNERSHIP_FILE" ] && [ ! -e "$CHAIN_DIGEST_FILE" ] || { temporary_removed=false; owned_only=false; evidence=temporary; }
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
	[ ! -e "$LOCK_OWNER" ] || { lock_held && fail ELOCKED lock; fail ETAMPERED lock; }
	flock -n "$LOCK" sh -c 'printf "%s\n" "$$" > "$1"; while :; do sleep 1; done' sh "$DIR/lock-holder.pid" >/dev/null 2>&1 &
	owner=$!; i=0; while [ "$i" -lt 20 ] && [ ! -s "$DIR/lock-holder.pid" ]; do sleep 0.05; i=$((i + 1)); done
	owner=$(cat "$DIR/lock-holder.pid" 2>/dev/null || true); start=$(starttime "$owner"); nonce="$session:$generation:$owner:$start"
	printf '%s|%s|%s|%s\n' "$session" "$owner" "$start" "$nonce" >"$LOCK_OWNER"
	lock_session=$session; lock_pid=$owner; lock_start=$start; lock_nonce=$nonce
	i=0; while [ "$i" -lt 20 ] && ! lock_held; do sleep 0.05; i=$((i + 1)); done
	lock_held || { kill "$owner" 2>/dev/null || true; rm -f "$LOCK_OWNER"; fail ELOCKED lock; }
	printf '%s\n' "{\"ok\":true,\"owner\":\"config/global\",\"held\":true,\"lockPid\":$owner,\"session\":\"$session\",\"nonce\":\"$nonce\"}"
}

lock_release() {
	lock_held || fail ETAMPERED lock
	[ "$supplied_nonce" = "$lock_nonce" ] || fail ETAMPERED lock
	kill "$lock_pid" 2>/dev/null || fail ELOCKED lock
	i=0; while kill -0 "$lock_pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	kill -0 "$lock_pid" 2>/dev/null && fail ELOCKED lock
	rm -f "$LOCK_OWNER"; [ ! -e "$LOCK_OWNER" ] || fail ETAMPERED lock
	rm -f "$DIR/lock-holder.pid"
	printf '%s\n' "{\"ok\":true,\"released\":true,\"session\":\"$session\",\"nonce\":\"$lock_nonce\"}"
}

activate() {
	lock_held || fail ELOCKED lock
	[ -x "$NFQWS2" ] || fail EDEPENDENCY activate
	[ -r "$ARGV_FILE" ] && [ -r "$ARGV_DIGEST_FILE" ] || fail EINPUT activate
	compiled_digest=$(cat "$ARGV_DIGEST_FILE"); [ -n "$compiled_digest" ] || fail EINPUT activate
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
	"$NFT" list table inet "$TABLE" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	if "$NFT" list chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1; then fail EOWNERSHIP firewall; fi
	"$INIT" stop >/dev/null 2>&1 || fail EDEPENDENCY runtime
	[ -z "$(queue_peer)" ] || fail EOWNERSHIP runtime
	"$NFT" add chain inet "$TABLE" "$CHAIN" "{ type filter hook forward priority -150; policy accept; }" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	RESOURCE_CREATED=1
	"$NFT" add rule inet "$TABLE" "$CHAIN" queue num "$QUEUE" comment "$marker" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	printf '%s|%s|%s|%s\n' "$session" "$candidate" "$generation" "$marker" >"$OWNERSHIP_FILE"
	"$NFT" list chain inet "$TABLE" "$CHAIN" 2>/dev/null | sha256sum | awk '{print $1}' >"$CHAIN_DIGEST_FILE" || fail EOWNERSHIP firewall
	setsid "$NFQWS2" --qnum="$QUEUE" "$@" >"$LOG_FILE" 2>&1 &
	pid=$!; start=$(starttime "$pid"); [ -n "$start" ] || fail EIDENTITY activate
	printf '%s\n' "$pid" >"$PID_FILE"; printf '%s\n' "$start" >"$START_FILE"
	[ "$(process_exe "$pid")" = "$NFQWS2" ] || fail EIDENTITY activate
	digest=$(argv_digest "$pid"); case "$digest" in [a-f0-9][a-f0-9]*) ;; *) fail EIDENTITY activate ;; esac
	peer=$(queue_peer); [ "$peer" = "$pid" ] || fail EOWNERSHIP activate
	chain_owned || fail EOWNERSHIP firewall
	printf '%s\n' "{\"ok\":true,\"identityVerified\":true,\"expectedProcess\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$TABLE\",\"owner\":\"$OWNER\",\"ownedRules\":[\"$marker\"],\"generation\":$generation},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid},\"compiledDigest\":\"$compiled_digest\"}"
}

stabilize() {
	lock_held || fail ELOCKED lock
	[ -r "$PID_FILE" ] && [ -r "$START_FILE" ] || fail EIDENTITY stabilize
	pid=$(cat "$PID_FILE"); start=$(cat "$START_FILE")
	if ! process_alive "$pid" "$start"; then printf '%s\n' '{"ok":true,"stable":false,"candidateFailure":"PROCESS_EXIT"}'; return 0; fi
	peer=$(queue_peer); [ "$peer" = "$pid" ] || fail EOWNERSHIP stabilize
	chain_owned || fail EOWNERSHIP stabilize
	digest=$(argv_digest "$pid"); [ -n "$digest" ] || fail EIDENTITY stabilize
	[ "$(process_exe "$pid")" = "$NFQWS2" ] || fail EIDENTITY stabilize
	printf '%s\n' "{\"ok\":true,\"stable\":true,\"identityVerified\":true,\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$TABLE\",\"owner\":\"$OWNER\",\"ownedRules\":[\"$marker\"],\"generation\":$generation},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid}}"
}

cleanup() {
	lock_held || fail ELOCKED lock
	[ -r "$OWNERSHIP_FILE" ] || fail EIDENTITY cleanup
	cleanup=$(cleanup_internal)
	case "$cleanup" in *'"ownedOnly":true'*) printf '%s\n' "$cleanup" ;; *) fail ECLEANUP cleanup ;; esac
}

session_cleanup() {
	lock_held && fail ELOCKED cleanup
	[ ! -e "$LOCK_OWNER" ] || fail ETAMPERED cleanup
	rmdir "$DIR" 2>/dev/null || fail ECLEANUP cleanup
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
