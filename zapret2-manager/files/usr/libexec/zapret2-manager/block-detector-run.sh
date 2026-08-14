#!/bin/ash
set -u
CLI=/usr/libexec/zapret2-manager/block-detector-cli.uc
. /tmp/zapret2-manager/jobs/block-detector.env 2>/dev/null || INTERVAL=300
cancel() { ucode "$CLI" stopped >/dev/null 2>&1; exit 0; }
trap cancel INT TERM
while :; do
    ucode "$CLI" tick >/dev/null 2>&1 || exit 1
    [ -f /tmp/zapret2-manager/jobs/block-detector.cancel ] && { rm -f /tmp/zapret2-manager/jobs/block-detector.cancel; cancel; }
    sleep "${INTERVAL:-300}" & wait $!
done
