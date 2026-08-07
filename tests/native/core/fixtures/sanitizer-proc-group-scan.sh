#!/bin/sh
set -eu

PGID=${1:?PGID required}
SID=${2:?SID required}
COUNT=0

for PROC in /proc/[0-9]*; do
	PID=${PROC##*/}
	STAT=$(/bin/cat "$PROC/stat" 2>/dev/null) || continue
	REST=${STAT#*) }
	set -- $REST
	test "$3" = "$PGID" && test "$4" = "$SID" || continue
	CMDLINE=$(/usr/bin/tr '\000' ' ' < "$PROC/cmdline" 2>/dev/null) || continue
	printf '%s\t%s\t%s\t%s\t%s\n' "$PID" "$1" "$3" "$4" "$CMDLINE"
	COUNT=$((COUNT + 1))
	test "$COUNT" -lt 32 || break
done
