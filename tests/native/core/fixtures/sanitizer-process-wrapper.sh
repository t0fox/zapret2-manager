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

wait_gate() {
	GATE=$1
	test -n "$GATE" || return 0
	case "$GATE" in
		/tmp/z2m-sanitizer-gate-*) ;;
		*) printf '%s\n' 'invalid sanitizer test gate' >&2; exit 2 ;;
	esac
	while test -e "$GATE"; do /bin/sleep 0.01; done
}

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
wait_gate "${Z2M_SANITIZER_BEFORE_MARKER_RENAME_GATE:-}"
/bin/mv "$MARKER_TMP" "$PID_FILE"
wait_gate "${Z2M_SANITIZER_AFTER_MARKER_RENAME_GATE:-}"
test "$READY_MODE" = silent || printf '%s\n' "$MARKER"
exec "$@" "$TOKEN" "$SCENARIO_PATH"
