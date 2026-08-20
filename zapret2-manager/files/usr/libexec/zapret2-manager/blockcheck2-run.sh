#!/bin/ash
set -u

JDIR=/tmp/zapret2-manager/jobs
CLI=/usr/libexec/zapret2-manager/blockcheck2-cli.uc
id="$1"
[ -n "$id" ] || exit 2
[ -f "$JDIR/$id.env" ] || exit 2
. "$JDIR/$id.env"

cancel_exit() {
    if [ -n "${child:-}" ]; then kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true; sleep 1; kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true; fi
    rm -f "$JDIR/$id.cancel"
    ucode -e "import * as cli from '$CLI'; cli.blockcheck2_mark_finished(ARGV[0], +ARGV[1], ARGV[2]);" "$id" 130 cancelled >/dev/null 2>&1
    exit 0
}
trap cancel_exit INT TERM

ucode -e "import * as cli from '$CLI'; cli.blockcheck2_mark_running(ARGV[0], +ARGV[1]);" "$id" "$$" >/dev/null 2>&1 || exit 1
setsid "$SCRIPT" >"$JDIR/$id.log" 2>&1 &
child=$!
ucode -e "import * as cli from '$CLI'; cli.blockcheck2_mark_child(ARGV[0], +ARGV[1]);" "$id" "$child" >/dev/null 2>&1 || { kill -TERM "$child" 2>/dev/null || true; exit 1; }
elapsed=0
while kill -0 "$child" 2>/dev/null; do
    if [ -f "$JDIR/$id.cancel" ]; then
        kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
        sleep 3
        kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        cancel_exit
    fi
    if [ "${TIMEOUT:-2400}" -gt 0 ] && [ "$elapsed" -ge "${TIMEOUT:-2400}" ]; then
        kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
        sleep 3
        kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        ucode -e "import * as cli from '$CLI'; cli.blockcheck2_mark_finished(ARGV[0], +ARGV[1], ARGV[2]);" "$id" 124 error >/dev/null 2>&1
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done
wait "$child"; rc=$?
ucode -e "import * as cli from '$CLI'; cli.blockcheck2_mark_finished(ARGV[0], +ARGV[1]);" "$id" "$rc" >/dev/null 2>&1
exit 0
