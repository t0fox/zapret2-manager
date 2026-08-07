#!/bin/sh
set -eu

PGID=${1:?PGID required}
SID=${2:?SID required}
PROC_ROOT=${3:-/proc}
TEST_HOOK=${4:-none}
COUNT=0

case "$PROC_ROOT" in
	/*) ;;
	*) printf '%s\n' 'proc-scan: invalid proc root' >&2; exit 2 ;;
esac
case "$TEST_HOOK" in
	none) ;;
	vanish-stat:[0-9]*)
		case "$PROC_ROOT" in
			/tmp/z2m-proc-scan-*) ;;
			*) printf '%s\n' 'proc-scan: test hook requires isolated root' >&2; exit 2 ;;
		esac
		;;
	*) printf '%s\n' 'proc-scan: invalid test hook' >&2; exit 2 ;;
esac

parse_stat() {
	PARSED_STAT=$1
	case "$PARSED_STAT" in
		*') '*) ;;
		*) return 1 ;;
	esac
	PARSED_REST=${PARSED_STAT##*) }
	set -- $PARSED_REST
	test "$#" -ge 20 || return 1
	case "$3:$4:${20}" in
		*[!0-9:]*) return 1 ;;
	esac
	STAT_STATE=$1
	STAT_PGID=$3
	STAT_SID=$4
	STAT_START=${20}
}

for PROC in "$PROC_ROOT"/[0-9]*; do
	test -d "$PROC" || continue
	PID=${PROC##*/}
	if ! STAT=$(/bin/cat "$PROC/stat" 2>/dev/null); then
		if test "$TEST_HOOK" = "vanish-stat:$PID"; then
			/bin/rm -rf "$PROC"
		fi
		test ! -e "$PROC" && continue
		printf 'proc-scan: stat-read-failed pid=%s\n' "$PID" >&2
		exit 1
	fi
	if ! parse_stat "$STAT"; then
		test ! -e "$PROC" && continue
		printf 'proc-scan: stat-parse-failed pid=%s\n' "$PID" >&2
		exit 1
	fi
	test "$STAT_PGID" = "$PGID" && test "$STAT_SID" = "$SID" || continue
	MEMBER_START=$STAT_START
	MEMBER_STATE=$STAT_STATE
	if ! CMDLINE=$(/usr/bin/tr '\000\011\012' '   ' < "$PROC/cmdline" 2>/dev/null); then
		if ! RECHECK=$(/bin/cat "$PROC/stat" 2>/dev/null); then
			test ! -e "$PROC" && continue
			printf 'proc-scan: stat-recheck-failed pid=%s\n' "$PID" >&2
			exit 1
		fi
		if ! parse_stat "$RECHECK"; then
			test ! -e "$PROC" && continue
			printf 'proc-scan: stat-recheck-parse-failed pid=%s\n' "$PID" >&2
			exit 1
		fi
		test "$STAT_START" != "$MEMBER_START" && continue
		test "$STAT_PGID" != "$PGID" && continue
		test "$STAT_SID" != "$SID" && continue
		printf 'proc-scan: cmdline-read-failed pid=%s\n' "$PID" >&2
		exit 1
	fi
	if ! RECHECK=$(/bin/cat "$PROC/stat" 2>/dev/null); then
		test ! -e "$PROC" && continue
		printf 'proc-scan: stat-recheck-failed pid=%s\n' "$PID" >&2
		exit 1
	fi
	if ! parse_stat "$RECHECK"; then
		test ! -e "$PROC" && continue
		printf 'proc-scan: stat-recheck-parse-failed pid=%s\n' "$PID" >&2
		exit 1
	fi
	test "$STAT_START" = "$MEMBER_START" || continue
	test "$STAT_PGID" = "$PGID" && test "$STAT_SID" = "$SID" || continue
	printf '%s\t%s\t%s\t%s\t%.2048s\n' "$PID" "$STAT_STATE" "$PGID" "$SID" "$CMDLINE"
	COUNT=$((COUNT + 1))
	test "$COUNT" -lt 32 || break
done
