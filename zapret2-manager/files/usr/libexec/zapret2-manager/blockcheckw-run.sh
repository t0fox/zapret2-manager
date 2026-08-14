#!/bin/ash
set -u

JDIR=/tmp/zapret2-manager/jobs
CLI=/usr/libexec/zapret2-manager/blockcheckw-cli.uc
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

set --
if [ "$ENGINE" = status ]; then
    set -- status --domain-list "$DOMAINS_FILE" --dns auto --timeout 6 --output "$REPORT"
elif [ "$ENGINE" = scan ]; then
    domain=$(sed -n '1p' "$DOMAINS_FILE")
    set -- scan --domain "$domain" --protocols "$PROTOCOLS" --timeout "$TIMEOUT" --output "$REPORT"
elif [ "$ENGINE" = universal ]; then
    set -- universal --domain-list "$DOMAINS_FILE" --protocols "$PROTOCOLS" --sample "$SAMPLE" --output "$REPORT"
elif [ "$ENGINE" = check ]; then
	[ -n "${SOURCE_REPORT:-}" ] || exit 2
	set -- check --from-file "$SOURCE_REPORT" --domain "$(sed -n '1p' "$DOMAINS_FILE")" --passes "$PASSES" --output "$REPORT"
else
    exit 2
fi

setsid "$BINARY" --auto --no-conflict-cleanup -w "$WORKERS" "$@" >"$JDIR/$id.log" 2>&1 &
child=$!
ucode "$CLI" mark-child "$id" "$child" >/dev/null 2>&1 || { kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true; exit 1; }
elapsed=0
while kill -0 "$child" 2>/dev/null; do
    [ -f "$JDIR/$id.cancel" ] && cancel_exit
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
        kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true
        sleep 2
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
