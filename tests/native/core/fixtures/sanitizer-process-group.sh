#!/bin/sh
set -eu

MODE=${1:?mode required}
PID_FILE=${2:?PID file required}
printf '%s\n' "$$" > "$PID_FILE"

case "$MODE" in
	child)
		/bin/sleep 60 &
		wait
		;;
	leader-exit)
		/bin/sh -c 'trap "" HUP TERM; exec /bin/sleep 60' &
		/bin/sleep 1
		exit 0
		;;
	unrelated)
		exec /bin/sleep 60
		;;
	*) exit 2 ;;
esac
