#!/bin/ash
# Run one trusted draft-profile strategy through upstream blockcheck2 custom.
# Browser input never reaches this script: its list file is created by ucode
# after resolving a profile id from /etc/zapret2-manager/state.json.
set -eu
ROOT=/tmp/zapret2-manager/orchestra-runs
SCANNER=/opt/zapret2/blockcheck2.sh
run_id=${1:-}; candidate_id=${2:-}; protocol=${3:-}; domain=${4:-}; probe=${5:-https}; timeout=${6:-20}
case "$run_id" in or-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) exit 64;; esac
case "$candidate_id" in
    p[0-9][0-9][0-9][0-9][0-9][0-9]|c-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]|z2gui-*) ;;
    *) exit 64 ;;
esac
case "$protocol" in tcp_https|quic_udp) ;; *) exit 64;; esac
case "$domain" in *[!A-Za-z0-9.-]*|'') exit 64;; esac
case "$probe" in https|websocket|bounded_download) ;; *) exit 64;; esac
case "$timeout" in *[!0-9]*|'') exit 64;; esac
dir="$ROOT/$run_id"; list="$dir/$candidate_id.$protocol"; log="$dir/$candidate_id.$protocol.log"
pidfile="$dir/$candidate_id.$protocol.pid"; startfile="$dir/$candidate_id.$protocol.starttime"
infra_marker() { printf '\nINFRA_ERROR code=%s\n' "$1" >> "$log"; }
if [ ! -f "$list" ] || [ ! -x "$SCANNER" ]; then
	infra_marker EPROBEDEPENDENCY
	exit 66
fi
child=
cleanup() {
	# This runner owns only its own scanner.  Never use a name-based pkill:
	# production nfqws2 must not be touched.  blockcheck uses a PID-named nft
	# table, so only that exact table is eligible for fallback cleanup.
	if [ -n "${child:-}" ] && kill -0 "$child" 2>/dev/null; then
		kill -INT "-$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
		wait "$child" 2>/dev/null || true
	fi
	if [ -n "${child:-}" ]; then
		for table in "blockcheck$child" "blockcheck${child}_test"; do
			nft list table inet "$table" >/dev/null 2>&1 && nft delete table inet "$table" 2>/dev/null || true
		done
	fi
	rm -f "$list" "$pidfile" "$startfile"
}
trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT
if [ "$protocol" = tcp_https ]; then
	TEST=custom BATCH=1 IPVS=4 SCANLEVEL=quick ENABLE_HTTP=0 ENABLE_HTTPS_TLS12=1 ENABLE_HTTPS_TLS13=0 ENABLE_HTTP3=0 REPEATS=1 PARALLEL=0 DOMAINS="$domain" LIST_HTTP=/dev/null LIST_HTTPS_TLS12="$list" LIST_HTTPS_TLS13=/dev/null LIST_QUIC=/dev/null setsid "$SCANNER" >"$log" 2>&1 &
else
	TEST=custom BATCH=1 IPVS=4 SCANLEVEL=quick ENABLE_HTTP=0 ENABLE_HTTPS_TLS12=0 ENABLE_HTTPS_TLS13=0 ENABLE_HTTP3=1 REPEATS=1 PARALLEL=0 DOMAINS="$domain" LIST_HTTP=/dev/null LIST_HTTPS_TLS12=/dev/null LIST_HTTPS_TLS13=/dev/null LIST_QUIC="$list" setsid "$SCANNER" >"$log" 2>&1 &
fi
child=$!
printf '%s\n' "$child" >"$pidfile.tmp"
mv -f "$pidfile.tmp" "$pidfile"
if [ -r "/proc/$child/stat" ]; then
	awk '{print $22}' "/proc/$child/stat" >"$startfile.tmp"
	mv -f "$startfile.tmp" "$startfile"
fi
elapsed=0
while kill -0 "$child" 2>/dev/null; do
	if [ "$elapsed" -ge "$timeout" ]; then
		kill -INT "-$child" 2>/dev/null || kill -INT "$child" 2>/dev/null || true
		sleep 2
		kill -KILL "-$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true
		wait "$child" 2>/dev/null || true
		child=
		printf '%s\n' 124 >"$dir/$candidate_id.$protocol.rc.tmp"
		mv -f "$dir/$candidate_id.$protocol.rc.tmp" "$dir/$candidate_id.$protocol.rc"
		exit 124
	fi
	sleep 1
	elapsed=$((elapsed + 1))
done
set +e; wait "$child"; rc=$?; set -e
if [ "$rc" -eq 0 ] && [ "$protocol" = tcp_https ]; then
	probe_body="$dir/$candidate_id.$protocol.probe-body"
	probe_headers="$dir/$candidate_id.$protocol.probe-headers"
	probe_rc=0
	case "$probe" in
		https) curl -4 -fsS --connect-timeout 8 --max-time "$timeout" -o "$probe_body" -D "$probe_headers" "https://$domain/" >/dev/null 2>&1 || probe_rc=$? ;;
		websocket) curl -4 -sS --http1.1 --connect-timeout 8 --max-time "$timeout" -o "$probe_body" -D "$probe_headers" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$domain/?v=10&encoding=json" >/dev/null 2>&1 || probe_rc=$? ;;
		bounded_download) curl -4 -fsS --connect-timeout 8 --max-time "$timeout" -o "$probe_body" -D "$probe_headers" "https://$domain/" >/dev/null 2>&1 || probe_rc=$? ;;
	esac
	probe_bytes=$(wc -c < "$probe_body" 2>/dev/null || echo 0)
	probe_status=$(awk 'NR==1 {print $2}' "$probe_headers" 2>/dev/null || echo 0)
	if [ "$probe" = websocket ] && [ "$probe_status" != 101 ] && [ "$probe_status" != 200 ]; then probe_rc=1; fi
	if [ "$probe" = bounded_download ] && [ "$probe_bytes" -le 0 ]; then probe_rc=1; fi
	if [ "$probe_rc" -ne 0 ]; then printf '\nPROBE_FAIL type=%s status=%s bodyBytes=%s\n' "$probe" "$probe_status" "$probe_bytes" >> "$log"; rc=7
	else printf '\nPROBE_EVIDENCE type=%s status=%s bodyBytes=%s\n' "$probe" "$probe_status" "$probe_bytes" >> "$log"; fi
	rm -f "$probe_body" "$probe_headers"
fi
child=
printf '%s\n' "$rc" >"$dir/$candidate_id.$protocol.rc.tmp"
mv -f "$dir/$candidate_id.$protocol.rc.tmp" "$dir/$candidate_id.$protocol.rc"
exit "$rc"
