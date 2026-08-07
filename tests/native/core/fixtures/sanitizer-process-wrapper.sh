#!/bin/sh
set -eu

PID_FILE=${1:?PID file required}
shift
TOKEN=${1:?cleanup token required}
shift
SCENARIO_PATH=${1:?scenario path required}
shift
READY_MODE=${1:?ready mode required}
shift

case "$READY_MODE" in
	ready|silent) ;;
	*) printf '%s\n' 'invalid ready mode' >&2; exit 2 ;;
esac

STAT=$(/bin/cat "/proc/$$/stat")
REST=${STAT#*) }
PGID=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $3}')
SID=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $4}')
START_TIME=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $20}')
MARKER_TMP="$PID_FILE.tmp.$$"
MARKER=$(printf '{"pid":%s,"startTime":"%s","pgid":%s,"sid":%s,"token":"%s","scenarioPath":"%s"}' \
	"$$" "$START_TIME" "$PGID" "$SID" "$TOKEN" "$SCENARIO_PATH")
printf '%s\n' "$MARKER" > "$MARKER_TMP"
/bin/mv "$MARKER_TMP" "$PID_FILE"
test "$READY_MODE" = silent || printf '%s\n' "$MARKER"
exec "$@" "$TOKEN" "$SCENARIO_PATH"
