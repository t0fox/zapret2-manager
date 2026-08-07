#!/bin/sh
set -eu

PID_FILE=${1:?PID file required}
shift
TOKEN=${1:?cleanup token required}
shift
SCENARIO_PATH=${1:?scenario path required}
shift

STAT=$(/bin/cat "/proc/$$/stat")
REST=${STAT#*) }
PGID=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $3}')
SID=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $4}')
START_TIME=$(printf '%s\n' "$REST" | /usr/bin/awk '{print $20}')
MARKER_TMP="$PID_FILE.tmp.$$"
printf '{"pid":%s,"startTime":"%s","pgid":%s,"sid":%s,"token":"%s","scenarioPath":"%s"}\n' \
	"$$" "$START_TIME" "$PGID" "$SID" "$TOKEN" "$SCENARIO_PATH" > "$MARKER_TMP"
/bin/mv "$MARKER_TMP" "$PID_FILE"
exec "$@" "$TOKEN" "$SCENARIO_PATH"
