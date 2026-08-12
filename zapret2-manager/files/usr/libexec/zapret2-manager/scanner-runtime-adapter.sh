#!/bin/ash
# Fixed transient Scanner runtime owner. Only server-issued safe IDs cross the
# shell boundary; candidate tokens are read from the server-owned argv file.
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

fail() {
	printf '%s\n' "{\"ok\":false,\"code\":\"$1\",\"stage\":\"$2\"}"
	exit 1
}

# Test shims may replace fixed binaries only in the server-owned native test
# environment; production ignores this variable and keeps the constants above.
if [ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ]; then
	[ "${Z2M_SCANNER_SERVER_TEST:-0}" = 1 ] || fail EINPUT input
	NFQWS2=${Z2M_SCANNER_TEST_NFQWS2:-$NFQWS2}
	NFT=${Z2M_SCANNER_TEST_NFT:-$NFT}
	INIT=${Z2M_SCANNER_TEST_INIT:-$INIT}
	NFQ_PROC=${Z2M_SCANNER_TEST_NFQ_PROC:-$NFQ_PROC}
	LOCK=${Z2M_SCANNER_TEST_LOCK:-$LOCK}
fi

safe_id() {
	case "$1" in
		[A-Za-z0-9][A-Za-z0-9._-]*) return 0 ;;
		*) return 1 ;;
	esac
}

operation=${1:-}
session=${2:-}
candidate=${3:-}
generation=${4:-}
case "$operation" in
	lock-acquire|lock-release|activate|stabilize|cleanup) ;;
	*) fail EINPUT input ;;
esac
safe_id "$session" || fail EINPUT input
safe_id "$candidate" || fail EINPUT input
case "$generation" in
	*[!0-9]*|'') fail EINPUT input ;;
esac

DIR="$ROOT/$session"
ARGV_FILE="$DIR/$candidate.argv"
PID_FILE="$DIR/$candidate.pid"
START_FILE="$DIR/$candidate.starttime"
LOG_FILE="$DIR/$candidate.log"
HOSTLIST_FILE="$DIR/$candidate.hostlist"
LOCK_OWNER="$DIR/lock.pid"
mkdir -p "$DIR" 2>/dev/null || fail EIO setup

starttime() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true; }
argv_digest() { sha256sum "/proc/$1/cmdline" 2>/dev/null | awk '{print $1}' || true; }
queue_peer() { awk -v q="$QUEUE" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true; }
process_alive() { [ -r "/proc/$1/stat" ] && [ "$(starttime "$1")" = "$2" ]; }
process_exe() { readlink "/proc/$1/exe" 2>/dev/null || true; }
chain_owned() { "$NFT" list chain inet "$TABLE" "$CHAIN" 2>/dev/null | grep -F 'z2m-scanner' >/dev/null 2>&1; }
lock_held() {
	[ -r "$LOCK_OWNER" ] || return 1
	owner=$(cat "$LOCK_OWNER")
	case "$owner" in *[!0-9]*|'') return 1;; esac
	kill -0 "$owner" 2>/dev/null || return 1
	flock -n "$LOCK" -c true >/dev/null 2>&1 && return 1
	return 0
}

lock_acquire() {
	[ ! -e "$LOCK_OWNER" ] || { lock_held && fail ELOCKED lock; rm -f "$LOCK_OWNER"; }
	flock -n "$LOCK" sh -c "echo \"\$PPID\" >'$LOCK_OWNER'; while :; do sleep 1; done" >/dev/null 2>&1 &
	owner=$!
	i=0
	while [ "$i" -lt 20 ] && ! lock_held; do sleep 0.05; i=$((i + 1)); done
	lock_held || { kill "$owner" 2>/dev/null || true; rm -f "$LOCK_OWNER"; fail ELOCKED lock; }
	printf '%s\n' "{\"ok\":true,\"owner\":\"config/global\",\"held\":true,\"lockPid\":$owner}"
}

lock_release() {
	[ -r "$LOCK_OWNER" ] || fail ELOCKED lock
	owner=$(cat "$LOCK_OWNER")
	case "$owner" in *[!0-9]*|'') fail ELOCKED lock;; esac
	kill "$owner" 2>/dev/null || fail ELOCKED lock
	i=0
	while kill -0 "$owner" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	kill -0 "$owner" 2>/dev/null && fail ELOCKED lock
	rm -f "$LOCK_OWNER"
	[ ! -e "$LOCK_OWNER" ] || fail ELOCKED lock
	printf '%s\n' '{"ok":true,"released":true}'
}

emit_activation() {
	pid=$1; start=$2; digest=$3
	printf '%s\n' "{\"ok\":true,\"identityVerified\":true,\"expectedProcess\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$TABLE\",\"owner\":\"$OWNER\",\"ownedRules\":[\"$CHAIN\"]},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid}}"
}

activate() {
	lock_held || fail ELOCKED lock
	[ -x "$NFQWS2" ] || fail EDEPENDENCY activate
	[ -r "$ARGV_FILE" ] || fail EINPUT activate
	set --
	while IFS= read -r token || [ -n "$token" ]; do
		[ -n "$token" ] || fail EINPUT activate
		case "$token" in
			--qnum=*|--daemon*|--pidfile=*|--user=*|--log*=*|--lua-init=*) fail EINPUT activate ;;
			--hostlist=*|--hostlist-exclude=*|--hostlist-auto=*|--ipset=*)
				value=${token#*=}
				case "$value" in /opt/zapret2/*|/tmp/zapret2-manager/scanner/*) ;; *) fail EINPUT activate ;; esac
			;;
			*[!A-Za-z0-9_.,:=+/@%~#-]*) fail EINPUT activate ;;
		esac
		set -- "$@" "$token"
	done < "$ARGV_FILE"
	"$NFT" list table inet "$TABLE" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	if "$NFT" list chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1; then fail EOWNERSHIP firewall; fi
	"$INIT" stop >/dev/null 2>&1 || fail EDEPENDENCY runtime
	[ -z "$(queue_peer)" ] || fail EOWNERSHIP runtime
	"$NFT" add chain inet "$TABLE" "$CHAIN" "{ type filter hook forward priority -150; policy accept; }" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	"$NFT" add rule inet "$TABLE" "$CHAIN" queue num "$QUEUE" comment z2m-scanner >/dev/null 2>&1 || {
		"$NFT" delete chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1 || true
		fail EDEPENDENCY firewall
	}
	setsid "$NFQWS2" --qnum="$QUEUE" "$@" >"$LOG_FILE" 2>&1 &
	pid=$!; start=$(starttime "$pid"); [ -n "$start" ] || fail EIDENTITY activate
	[ "$(process_exe "$pid")" = "$NFQWS2" ] || { kill -TERM "$pid" 2>/dev/null || true; fail EIDENTITY activate; }
	digest=$(argv_digest "$pid"); case "$digest" in [a-f0-9][a-f0-9]*) ;; *) kill -TERM "$pid" 2>/dev/null || true; fail EIDENTITY activate ;; esac
	printf '%s\n' "$pid" >"$PID_FILE"; printf '%s\n' "$start" >"$START_FILE"
	peer=$(queue_peer); [ "$peer" = "$pid" ] || { kill -TERM "$pid" 2>/dev/null || true; "$NFT" delete chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1 || true; fail EOWNERSHIP activate; }
	emit_activation "$pid" "$start" "$digest"
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
	printf '%s\n' "{\"ok\":true,\"stable\":true,\"identityVerified\":true,\"process\":{\"pid\":$pid,\"startTime\":$start,\"exe\":\"$NFQWS2\",\"argvSha256\":\"$digest\",\"owner\":\"$OWNER\",\"generation\":$generation},\"firewall\":{\"table\":\"$TABLE\",\"owner\":\"$OWNER\",\"ownedRules\":[\"$CHAIN\"]},\"nfqueue\":{\"registered\":true,\"peer_portid\":$pid}}"
}

cleanup() {
	lock_held || fail ELOCKED lock
	[ -r "$PID_FILE" ] && [ -r "$START_FILE" ] || fail EIDENTITY cleanup
	pid=$(cat "$PID_FILE"); start=$(cat "$START_FILE")
	if process_alive "$pid" "$start"; then
		kill -TERM "$pid" 2>/dev/null || true; i=0
		while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
		if process_alive "$pid" "$start"; then kill -KILL "$pid" 2>/dev/null || true; fi
		i=0; while process_alive "$pid" "$start" && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	fi
	process_alive "$pid" "$start" && fail ECLEANUP process
	chain_owned || fail ECLEANUP firewall
	"$NFT" delete chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1 || fail ECLEANUP firewall
	i=0
	while [ -n "$(queue_peer)" ] && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	peer=$(queue_peer); [ -z "$peer" ] || fail ECLEANUP nfqueue
	rm -f "$ARGV_FILE" "$PID_FILE" "$START_FILE" "$LOG_FILE" "$HOSTLIST_FILE"
	[ ! -e "$ARGV_FILE" ] && [ ! -e "$PID_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$LOG_FILE" ] && [ ! -e "$HOSTLIST_FILE" ] || fail ECLEANUP temporary
	printf '%s\n' '{"ok":true,"processRemoved":true,"firewallRemoved":true,"nfqueueRemoved":true,"hostlistRemoved":true,"temporaryFilesRemoved":true,"ownedOnly":true,"order":["process","firewall","nfqueue","hostlist","temporary-files"]}'
}

case "$operation" in
	lock-acquire) lock_acquire ;;
	lock-release) lock_release ;;
	activate) activate ;;
	stabilize) stabilize ;;
	cleanup) cleanup ;;
esac
