#!/bin/sh
set -u

if [ "$#" -ne 5 ]; then
	exit 2
fi

seconds=$1
harness=$2
root=$3
stdout_path=$4
stderr_path=$5
case "$seconds" in
	''|*[!0-9]*) exit 2 ;;
esac

if command -v timeout >/dev/null 2>&1; then
	exec timeout "$seconds" sh "$harness" "$root" >"$stdout_path" 2>"$stderr_path"
fi

# Some OpenWrt images omit both coreutils timeout and the BusyBox applet.
# Keep the same bounded contract with only POSIX shell primitives.
marker=$root/timeout
rm -f "$marker"
(
	sh "$harness" "$root" >"$stdout_path" 2>"$stderr_path"
) &
child=$!
(
	sleep "$seconds"
	if kill -0 "$child" 2>/dev/null; then
		kill "$child" 2>/dev/null || true
		: >"$marker"
	fi
) &
watchdog=$!

wait "$child"
rc=$?
kill "$watchdog" 2>/dev/null || true
wait "$watchdog" 2>/dev/null || true
if [ -f "$marker" ]; then
	rc=124
fi
exit "$rc"
