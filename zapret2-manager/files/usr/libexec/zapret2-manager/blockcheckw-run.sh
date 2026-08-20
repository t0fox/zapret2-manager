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
    ucode -e "import * as cli from '$CLI'; cli.blockcheckw_mark_finished(ARGV[0], +ARGV[1], ARGV[2]);" "$id" 130 cancelled >/dev/null 2>&1
    exit 0
}
trap cancel_exit INT TERM
ucode -e "import * as cli from '$CLI'; cli.blockcheckw_mark_running(ARGV[0], +ARGV[1]);" "$id" "$$" >/dev/null 2>&1 || exit 1

set --
DNS_MODE="${DNS:-auto}"
if [ "$ENGINE" = status ]; then
    set -- status --domain-list "$DOMAINS_FILE" --dns "$DNS_MODE" --timeout 6 --output "$REPORT"
elif [ "$ENGINE" = scan ]; then
    domain=$(sed -n '1p' "$DOMAINS_FILE")
    set -- scan --domain "$domain" --protocols "$PROTOCOLS" --dns "$DNS_MODE" --timeout "$TIMEOUT" --output "$REPORT"
    if [ -n "${FROM_STRATEGIES_FILE:-}" ] && [ -f "$FROM_STRATEGIES_FILE" ]; then
        set -- "$@" --from-file "$FROM_STRATEGIES_FILE"
    fi
elif [ "$ENGINE" = universal ]; then
    set -- universal --domain-list "$DOMAINS_FILE" --protocols "$PROTOCOLS" --dns "$DNS_MODE" --sample "$SAMPLE" --output "$REPORT"
elif [ "$ENGINE" = check ]; then
	[ -n "${SOURCE_REPORT:-}" ] || exit 2
	set -- check --from-file "$SOURCE_REPORT" --domain "$(sed -n '1p' "$DOMAINS_FILE")" --dns "$DNS_MODE" --passes "$PASSES" --output "$REPORT"
else
    exit 2
fi

setsid "$BINARY" --auto --no-conflict-cleanup -w "$WORKERS" "$@" >"$JDIR/$id.log" 2>&1 &
child=$!
ucode -e "import * as cli from '$CLI'; cli.blockcheckw_mark_child(ARGV[0], +ARGV[1]);" "$id" "$child" >/dev/null 2>&1 || { kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true; exit 1; }
elapsed=0
while kill -0 "$child" 2>/dev/null; do
    [ -f "$JDIR/$id.cancel" ] && cancel_exit
    if [ "${TIMEOUT:-7200}" -gt 0 ] && [ "$elapsed" -ge "${TIMEOUT:-7200}" ]; then
        kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true
        sleep 2
        kill -KILL -"$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        ucode -e "import * as cli from '$CLI'; cli.blockcheckw_mark_finished(ARGV[0], +ARGV[1], ARGV[2]);" "$id" 124 error >/dev/null 2>&1
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done
wait "$child"; rc=$?
ucode -e "import * as cli from '$CLI'; cli.blockcheckw_mark_finished(ARGV[0], +ARGV[1]);" "$id" "$rc" >/dev/null 2>&1
exit 0
