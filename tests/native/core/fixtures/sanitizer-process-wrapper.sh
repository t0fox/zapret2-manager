#!/bin/sh
set -eu

PID_FILE=${1:?PID file required}
shift
printf '%s\n' "$$" > "$PID_FILE"
exec "$@"
