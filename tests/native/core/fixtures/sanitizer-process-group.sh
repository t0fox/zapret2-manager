#!/bin/sh
set -eu

MODE=${1:?mode required}

case "$MODE" in
	child)
		/bin/sleep 60 &
		wait
		;;
	leader-exit)
		/bin/sh -c 'trap "" HUP TERM; exec /bin/sleep 2' &
		/bin/sleep 1
		exit 0
		;;
	unrelated)
		trap '' HUP TERM
		while :; do /bin/sleep 60; done
		;;
	*) exit 2 ;;
esac
