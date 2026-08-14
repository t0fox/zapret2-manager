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
    ucode "$CLI" mark-finished "$id" 130 cancelled >/dev/null 2>&1
    exit 0
}
trap cancel_exit INT TERM

ucode "$CLI" mark-running "$id" "$$" >/dev/null 2>&1 || exit 1
setsid "$SCRIPT" >"$JDIR/$id.log" 2>&1 &
child=$!
ucode "$CLI" mark-child "$id" "$child" >/dev/null 2>&1 || { kill -TERM "$child" 2>/dev/null || true; exit 1; }
elapsed=0
while kill -0 "$child" 2>/dev/null; do
    if [ -f "$JDIR/$id.cancel" ]; then
        kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
        sleep 3
        kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        cancel_exit
    fi
    if [ "$elapsed" -ge "${TIMEOUT:-2400}" ]; then
        kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
        sleep 3
        kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        ucode "$CLI" mark-finished "$id" 124 error >/dev/null 2>&1
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done
wait "$child"; rc=$?
ucode "$CLI" mark-finished "$id" "$rc" >/dev/null 2>&1
exit 0
