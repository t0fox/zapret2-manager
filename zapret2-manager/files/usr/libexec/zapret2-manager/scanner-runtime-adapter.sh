#!/bin/ash
# Fixed transient Scanner runtime owner. Only server-issued safe IDs cross the
# shell boundary; candidate tokens are read from verified server-owned files.
set -eu
umask 077

BASE=/tmp/zapret2-manager
ROOT=$BASE/scanner
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
ARGV_META_FILE="$ARGV_FILE.meta"
PID_FILE="$DIR/$candidate.pid"
START_FILE="$DIR/$candidate.starttime"
LOG_FILE="$DIR/$candidate.log"
HOSTLIST_FILE="$DIR/$candidate.hostlist"
OWNERSHIP_FILE="$DIR/$candidate.ownership"
CHAIN_DIGEST_FILE="$DIR/$candidate.chain.sha256"
LOCK_OWNER="$DIR/lock.descriptor"
OWNERSHIP_LOCK="$DIR/ownership.lock"
SESSION_JOURNAL="$DIR/session.journal"
CLEANUP_EVIDENCE="$DIR/cleanup.evidence"
if [ "$operation" = session-cleanup ]; then
	[ -d "$DIR" ] && [ ! -L "$DIR" ] || { printf '%s\n' '{"ok":false,"code":"ECLEANUP","stage":"cleanup"}'; exit 1; }
else
	[ ! -L "$BASE" ] || exit 1
	[ -d "$BASE" ] || mkdir "$BASE" 2>/dev/null || exit 1
	[ ! -L "$ROOT" ] || exit 1
	[ -d "$ROOT" ] || mkdir "$ROOT" 2>/dev/null || exit 1
	chmod 700 "$ROOT" 2>/dev/null || exit 1
	[ -d "$DIR" ] || mkdir "$DIR" 2>/dev/null || exit 1
	[ ! -L "$DIR" ] || exit 1
	chmod 700 "$DIR" 2>/dev/null || exit 1
fi

starttime() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null || true; }
argv_digest() { sha256sum "/proc/$1/cmdline" 2>/dev/null | awk '{print $1}' || true; }
queue_peer() { awk -v q="$QUEUE" '$1 == q { print $2; exit }' "$NFQ_PROC" 2>/dev/null || true; }
process_alive() { [ -r "/proc/$1/stat" ] && [ "$(starttime "$1")" = "$2" ]; }
process_exe() { readlink "/proc/$1/exe" 2>/dev/null || true; }

nonce_marker="$session:$candidate:$generation:$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || true)"
lock_nonce=""
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
	chain_text=$("$NFT" list chain inet "$TABLE" "$CHAIN" 2>/dev/null || true)
	owned_marker=$marker
	if [ -r "$OWNERSHIP_FILE" ]; then
		owned_record=$(cat "$OWNERSHIP_FILE" 2>/dev/null || true)
		owned_marker=$(printf '%s\n' "$owned_record" | cut -d '|' -f4)
	fi
	marker_count=$(printf '%s\n' "$chain_text" | grep -F -c "$owned_marker" || true)
	queue_count=$(printf '%s\n' "$chain_text" | grep -F -c "queue num $QUEUE" || true)
	exact_digest=$(cat "$CHAIN_DIGEST_FILE" 2>/dev/null || true)
	actual_digest=$(printf '%s\n' "$chain_text" | sha256sum | awk '{print $1}')
	[ "$marker_count" = 1 ] && [ "$queue_count" = 1 ] && [ -n "$exact_digest" ] && [ "$actual_digest" = "$exact_digest" ]
}

firewall_delete_owned() {
	# nft cannot atomically compare and delete a chain. Production fails closed;
	# only the controlled shim enables the test ownership transaction.
	[ "${Z2M_SCANNER_RUNTIME_SHIM:-0}" = 1 ] && [ "${Z2M_SCANNER_TEST_NFT_CAS:-0}" = 1 ] || return 42
	flock -x "$OWNERSHIP_LOCK" sh -c '
		nft=$1; table=$2; chain=$3; queue=$4; marker=$5; expected=$6
		text=$("$nft" list chain inet "$table" "$chain" 2>/dev/null || true)
		count=$(printf "%s\\n" "$text" | grep -F -c "$marker" || true)
		queues=$(printf "%s\\n" "$text" | grep -F -c "queue num $queue" || true)
		actual=$(printf "%s\\n" "$text" | sha256sum | cut -d " " -f1)
		[ "$count" = 1 ] && [ "$queues" = 1 ] && [ "$actual" = "$expected" ] || exit 42
		"$nft" delete chain inet "$table" "$chain" >/dev/null 2>&1 || exit 43
		text=$("$nft" list chain inet "$table" "$chain" 2>/dev/null || true)
		[ -z "$text" ] || exit 44
	' sh "$NFT" "$TABLE" "$CHAIN" "$QUEUE" "$marker" "$(cat "$CHAIN_DIGEST_FILE" 2>/dev/null || true)"
}

atomic_private_write() {
	path=$1; content=$2; tmp="$path.tmp.$$.${RANDOM:-0}"
	[ ! -L "$path" ] || return 1
	(umask 077; set -C; printf '%b' "$content" > "$tmp") 2>/dev/null || return 1
	[ ! -L "$tmp" ] && chmod 600 "$tmp" && (sync -f "$tmp" 2>/dev/null || sync) && mv -f "$tmp" "$path" || { rm -f "$tmp"; return 1; }
	[ -f "$path" ] && [ ! -L "$path" ] && (sync -f "$path" 2>/dev/null || sync) && [ "$(cat "$path" 2>/dev/null || true)" = "$(printf '%b' "$content")" ]
}

journal_required() {
	entry=$1
	old=$(cat "$SESSION_JOURNAL" 2>/dev/null || true)
	atomic_private_write "$SESSION_JOURNAL" "$old$entry\n"
}

journal() { journal_required "$1" || { JOURNAL_FAILED=1; fail EIO journal; }; }

emit_cleanup() {
	printf '%s\n' "{\"ok\":$1,\"processRemoved\":$2,\"firewallRemoved\":$3,\"nfqueueRemoved\":$4,\"hostlistRemoved\":$5,\"temporaryFilesRemoved\":$6,\"ownedOnly\":$7,\"evidence\":\"$8\"}"
}

cleanup_internal() {
	if [ ! -r "$OWNERSHIP_FILE" ] && [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null; then
		emit_cleanup true true true true true true true complete
		return 0
	fi
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
			firewall_delete_owned || { firewall_removed=false; owned_only=false; evidence=ownership-mismatch; journal "cleanup.evidence=$evidence"; }
		else
			firewall_removed=false; owned_only=false; evidence=ownership-mismatch
		fi
	fi
	i=0; while [ -n "$(queue_peer)" ] && [ "$i" -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
	[ -z "$(queue_peer)" ] || { nfqueue_removed=false; owned_only=false; evidence=nfqueue; }
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ]; then
		atomic_private_write "$CLEANUP_EVIDENCE" 'evidence=complete\n' || { temporary_removed=false; owned_only=false; evidence=temporary; }
		[ "$temporary_removed" = true ] && journal "state=cleanup-verified|owner=$OWNER|session=$session|candidate=$candidate|generation=$generation|nonce=$lock_nonce"
	fi
	if [ "$process_removed" = true ] && [ "$firewall_removed" = true ] && [ "$nfqueue_removed" = true ] && [ "$temporary_removed" = true ]; then
		rm -f "$ARGV_FILE" "$ARGV_DIGEST_FILE" "$ARGV_META_FILE" "$PID_FILE" "$START_FILE" "$LOG_FILE" "$HOSTLIST_FILE" "$CHAIN_DIGEST_FILE"
		[ ! -e "$ARGV_FILE" ] && [ ! -e "$ARGV_DIGEST_FILE" ] && [ ! -e "$ARGV_META_FILE" ] && [ ! -e "$PID_FILE" ] && [ ! -e "$START_FILE" ] && [ ! -e "$LOG_FILE" ] && [ ! -e "$HOSTLIST_FILE" ] && [ ! -e "$CHAIN_DIGEST_FILE" ] || { temporary_removed=false; owned_only=false; evidence=temporary; }
		if [ "$temporary_removed" = true ]; then
			rm -f "$OWNERSHIP_FILE"
			[ ! -e "$OWNERSHIP_FILE" ] || { temporary_removed=false; owned_only=false; evidence=ownership-metadata; }
			[ "$temporary_removed" = true ] && journal "state=owned-resources-removed|owner=$OWNER|session=$session|candidate=$candidate|generation=$generation|nonce=$lock_nonce"
		fi
	else
		temporary_removed=false; owned_only=false; journal "cleanup.evidence=$evidence"
	fi
	emit_cleanup true "$process_removed" "$firewall_removed" "$nfqueue_removed" "$hostlist_removed" "$temporary_removed" "$owned_only" "$evidence"
}

fail() {
	code=$1; stage=$2
	if [ "${JOURNAL_FAILED:-0}" = 1 ]; then
		printf '%s\n' "{\"ok\":false,\"code\":\"$code\",\"stage\":\"$stage\",\"evidence\":\"journal-unavailable\"}"
		exit 1
	fi
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
	nonce=$(od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
	case "$nonce" in *[!a-f0-9]*|'') fail ELOCKED lock ;; esac
	[ "$(printf '%s' "$nonce" | wc -c)" = 64 ] || fail ELOCKED lock
	flock -n "$LOCK" sh -c 'umask 077; set -C; holder="$1"; descriptor="$2"; ready="$3"; session="$4"; nonce="$5"; start=$(awk '\''{print $22}'\'' "/proc/$$/stat"); printf "%s|%s|%s|%s\n" "$session" "$$" "$start" "$nonce" > "$descriptor" || exit 61; printf "%s\n" "$$" > "$holder" || exit 62; printf "%s\n" ready > "$ready" || exit 63; trap '\''rm -f "$descriptor" "$holder" "$ready"; exit 0'\'' TERM INT HUP; while :; do sleep 1; done' sh "$DIR/lock-holder.pid" "$LOCK_OWNER" "$DIR/lock.ready" "$session" "$nonce" >/dev/null 2>&1 &
	owner=$!; i=0; while [ "$i" -lt 20 ] && [ ! -s "$DIR/lock.ready" ]; do sleep 0.05; i=$((i + 1)); done
	[ -s "$DIR/lock.ready" ] || { kill "$owner" 2>/dev/null || true; fail ELOCKED lock; }
	lock_record=$(cat "$LOCK_OWNER" 2>/dev/null | tr -d '\n' || true)
	lock_session=${lock_record%%|*}; lock_rest=${lock_record#*|}; lock_pid=${lock_rest%%|*}; lock_rest=${lock_rest#*|}; lock_start=${lock_rest%%|*}; lock_nonce=${lock_rest#*|}
	[ "$lock_session" = "$session" ] && [ -n "$lock_pid" ] && [ -n "$lock_start" ] && [ "$lock_nonce" = "$nonce" ] || fail ELOCKED lock
	lock_session=$lock_session; lock_pid=$lock_pid; lock_start=$lock_start; lock_nonce=$lock_nonce
	journal_required "lock.owner=$lock_session|$lock_pid|$lock_start|$lock_nonce" || {
		JOURNAL_FAILED=1; kill -TERM "$lock_pid" 2>/dev/null || true
		rm -f "$LOCK_OWNER" "$DIR/lock-holder.pid" "$DIR/lock.ready"
		fail EIO journal
	}
	lock_held || fail ELOCKED lock
	printf '%s\n' "{\"ok\":true,\"owner\":\"config/global\",\"held\":true,\"lockPid\":$lock_pid,\"session\":\"$session\",\"nonce\":\"$nonce\"}"
}

lock_release() {
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
	printf '%s' "$meta" | grep -F -q "\"session\":\"$session\"" || fail ETAMPERED activate
	printf '%s' "$meta" | grep -F -q "\"candidate\":\"$candidate\"" || fail ETAMPERED activate
	printf '%s' "$meta" | grep -F -q "\"generation\":$generation" || fail ETAMPERED activate
	printf '%s' "$meta" | grep -F -q "\"nonce\":\"$lock_nonce\"" || fail ETAMPERED activate
	printf '%s' "$meta" | grep -F -q "\"compiledDigest\":\"$compiled_digest\"" || fail ETAMPERED activate
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
	"$NFT" list table inet "$TABLE" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	if "$NFT" list chain inet "$TABLE" "$CHAIN" >/dev/null 2>&1; then fail EOWNERSHIP firewall; fi
	"$INIT" stop >/dev/null 2>&1 || fail EDEPENDENCY runtime
	[ -z "$(queue_peer)" ] || fail EOWNERSHIP runtime
	journal "state=activating|owner=$OWNER|session=$session|candidate=$candidate|generation=$generation|nonce=$lock_nonce|resource-created.process=false|resource-created.firewall=false|resource-created.nfqueue=false|resource-created.argv=true"
	"$NFT" add chain inet "$TABLE" "$CHAIN" "{ type filter hook forward priority -150; policy accept; }" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	RESOURCE_CREATED=1
	journal "resource-created.firewall=true|resource-created.nfqueue=false"
	"$NFT" add rule inet "$TABLE" "$CHAIN" queue num "$QUEUE" comment "$marker" >/dev/null 2>&1 || fail EDEPENDENCY firewall
	atomic_private_write "$OWNERSHIP_FILE" "$session|$candidate|$generation|$marker|$lock_nonce\n" || fail EIO ownership
	journal "resource=$candidate|$generation|$nonce_marker|created"
	journal "state=candidate-activated|owner=$OWNER|session=$session|candidate=$candidate|generation=$generation|nonce=$lock_nonce"
	chain_digest=$("$NFT" list chain inet "$TABLE" "$CHAIN" 2>/dev/null | sha256sum | awk '{print $1}')
	[ -n "$chain_digest" ] || fail EOWNERSHIP firewall
	atomic_private_write "$CHAIN_DIGEST_FILE" "$chain_digest\n" || fail EIO ownership
	argv_after=$(sha256sum "$ARGV_FILE" | awk '{print $1}'); [ "$argv_after" = "$compiled_digest" ] || fail ETAMPERED activate
	prelaunch_digest=$(sha256sum "$ARGV_FILE" | awk '{print $1}'); [ "$prelaunch_digest" = "$compiled_digest" ] || fail ETAMPERED activate
	setsid "$NFQWS2" --qnum="$QUEUE" "$@" >"$LOG_FILE" 2>&1 &
	pid=$!; start=$(starttime "$pid"); [ -n "$start" ] || fail EIDENTITY activate
	atomic_private_write "$PID_FILE" "$pid\n" || fail EIO identity
	atomic_private_write "$START_FILE" "$start\n" || fail EIO identity
	journal "resource-created.process=true|pid=$pid|starttime=$start"
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
	[ -r "$OWNERSHIP_FILE" ] || { [ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null || fail EIDENTITY cleanup; }
	cleanup=$(cleanup_internal)
	case "$cleanup" in *'"ownedOnly":true'*) printf '%s\n' "$cleanup" ;; *) fail ECLEANUP cleanup ;; esac
}

session_cleanup() {
	lock_held && fail ELOCKED cleanup
	[ ! -e "$LOCK_OWNER" ] || fail ETAMPERED cleanup
	if [ -e "$OWNERSHIP_FILE" ] || [ -e "$PID_FILE" ] || [ -e "$CHAIN_DIGEST_FILE" ]; then
		[ -r "$CLEANUP_EVIDENCE" ] && grep -F -q 'evidence=complete' "$CLEANUP_EVIDENCE" 2>/dev/null || fail ECLEANUP cleanup
	fi
	recovery_evidence="$ROOT/$session.recovery.evidence"
	atomic_private_write "$recovery_evidence" "session=$session\nverified=true\n" || fail ECLEANUP cleanup
	rm -f "$SESSION_JOURNAL" "$CLEANUP_EVIDENCE" "$OWNERSHIP_LOCK" "$DIR/lock.ready"
	rmdir "$DIR" 2>/dev/null || { atomic_private_write "$recovery_evidence" "session=$session\nverified=false\n" || true; fail ECLEANUP cleanup; }
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
