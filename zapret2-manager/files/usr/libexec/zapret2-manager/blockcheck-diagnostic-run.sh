#!/bin/ash
set -u

# One-shot Avatar-equivalent BlockCheck diagnostic runner.  BlockCheckW is a
# separate optional fast engine; this runner owns the rich quick/full/dpi_only
# probe contract and emits evidence for blockcheck-model classification.
JDIR=/tmp/zapret2-manager/jobs
CLI=/usr/libexec/zapret2-manager/blockcheck-cli.uc
id="$1"
[ -n "$id" ] || exit 2
[ -f "$JDIR/$id.env" ] || exit 2
. "$JDIR/$id.env"

child=
cancel_exit() {
    if [ -n "${child:-}" ]; then kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true; fi
    rm -f "$JDIR/$id.cancel"
    ucode "$CLI" mark-finished "$id" cancelled "diagnostic probes cancelled" >/dev/null 2>&1
    exit 0
}
trap cancel_exit INT TERM
ucode "$CLI" mark-running "$id" "$$" >/dev/null 2>&1 || exit 1

domains="${DOMAINS:-}"
mode="${MODE:-quick}"
set -- $domains
total=$#
i=0
emit() { printf '%s\n' "$1" >>"$JDIR/$id.evidence"; }
cancelled() { [ -f "$JDIR/$id.cancel" ]; }
probe_domain() {
    d="$1"
    dns_status=unavailable; tcp_status=unavailable; tls_status=unavailable; http_status=unavailable; http_code=0
    dns_out=$(nslookup "$d" 2>/dev/null || true)
    if [ -n "$dns_out" ]; then dns_status=success; else dns_status=failed; fi
    if nc -z -w 3 "$d" 443 >/dev/null 2>&1; then tcp_status=success; else tcp_status=failed; fi
    body="$JDIR/$id.$i.body"
    http_code=$(curl -4 -k -sS --connect-timeout 3 --max-time 8 -o "$body" -w '%{http_code}' "https://$d/" 2>/dev/null || printf '000')
    case "$http_code" in 2*|3*|4*|5*) tls_status=success; http_status=success;; *) tls_status=failed; http_status=failed;; esac
    bytes=$(wc -c <"$body" 2>/dev/null || printf '0')
    rm -f "$body"
    emit "{\"domain\":\"$d\",\"dns\":{\"status\":\"$dns_status\"},\"tcp\":{\"status\":\"$tcp_status\"},\"tls\":{\"status\":\"$tls_status\"},\"http\":{\"status\":\"$http_status\",\"code\":$http_code},\"body\":{\"bytes\":$bytes}}"
}

for d in "$@"; do
    i=$((i + 1))
    cancelled && cancel_exit
    ucode "$CLI" mark-progress "$id" "$((i - 1))" "$total" probes >/dev/null 2>&1 || true
    probe_domain "$d"
    ucode "$CLI" mark-progress "$id" "$i" "$total" probes >/dev/null 2>&1 || true
done

if [ "$mode" = full ] || [ "$mode" = dpi_only ]; then
    if command -v curl >/dev/null 2>&1; then
        emit '{"domain":"__quic__","quic":{"blocked":false,"status":"dependency_unavailable","dependency":"curl-http3"}}'
    else
        emit '{"domain":"__quic__","quic":{"blocked":false,"status":"unavailable","dependency":"curl"}}'
    fi
fi
ucode "$CLI" mark-finished "$id" completed >/dev/null 2>&1
exit 0
