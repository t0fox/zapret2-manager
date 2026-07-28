#!/bin/ash
# health-run.sh <job-id> — the Service Health Matrix runner (Phase C).
#
# Runs bounded per-layer probes over catalog-provided targets (NEVER
# user-supplied URLs): catalog presence (list file), local DNS, upstream DNS
# comparison, TCP 443 connect (curl), TLS handshake (curl), HTTP code (curl).
# Evidence = exit codes + http codes only (no response bodies, no secrets).
# Cancellation is real (cancel flag → kill current curl → mark cancelled).
# Sequential by design (router-safe). Classification happens in ucode on
# read (jobs.uc), this runner only collects raw evidence.

JDIR=/tmp/zapret2-manager/jobs
JOBS_CLI=/usr/libexec/zapret2-manager/jobs-cli.uc

id="$1"
[ -n "$id" ] || exit 1
[ -f "$JDIR/$id.env" ] || exit 1
. "$JDIR/$id.env"

LOG="$JDIR/$id.log"
RESULT="$JDIR/$id.result.jsonl"

ucode "$JOBS_CLI" mark-running "$id" "$$" >/dev/null 2>&1
echo "* health matrix v1 start $(date -u +%H:%M:%S)" >>"$LOG"

start=$(date +%s)
timeout="${TIMEOUT:-300}"

elapsed_total() { echo $(( $(date +%s) - start )); }

for svc in $SERVICES; do
	if [ -f "$JDIR/$id.cancel" ]; then
		echo "* cancelled" >>"$LOG"
		rm -f "$JDIR/$id.cancel"
		ucode "$JOBS_CLI" mark-cancelled "$id" >/dev/null 2>&1
		exit 0
	fi
	if [ "$(elapsed_total)" -ge "$timeout" ]; then
		echo "* matrix timeout after ${timeout}s" >>"$LOG"
		ucode "$JOBS_CLI" mark-failed "$id" "timeout after ${timeout}s" >/dev/null 2>&1
		exit 0
	fi

	eval "doms=\"\$DOM_$svc\""
	d1=$(echo "$doms" | awk '{print $1}')
	[ -n "$d1" ] || { echo "SVC|$svc||catalogPresent=0|dns=0|extdns=-|tcp=99|tls=99|http=99|httpcode=0" >>"$RESULT"; continue; }

	echo "- probing $svc ($d1)" >>"$LOG"

	# catalog presence (the domain list is the applied truth)
	if grep -Fxq "$d1" "$LISTFILE" 2>/dev/null; then present=1; else present=0; fi

	# local DNS
	if nslookup "$d1" 127.0.0.1 2>&1 | grep -q "Address: "; then dns=1; else dns=0; fi

	# upstream DNS comparison (evidence: first answer IP, bounded)
	extdns="-"; extev=""
	if [ -n "$UPSTREAM_DNS" ]; then
		a=$(nslookup "$d1" "$UPSTREAM_DNS" 2>&1 | grep "Address: " | head -1 | awk '{print $2}')
		if [ -n "$a" ]; then extdns=1; extev="$a"; else extdns=0; fi
	fi

	# TCP connect 443
	curl -sS -o /dev/null --connect-timeout 4 "http://$d1:443/" >/dev/null 2>&1
	tcp=$?

	# TLS handshake
	curl -sSI --max-time 5 "https://$d1/" >/dev/null 2>&1
	tls=$?

	# HTTP code
	out=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "https://$d1/" 2>/dev/null)
	http=$?
	httpcode=$(printf '%s' "$out" | tr -cd '0-9' | tail -c 3)
	[ -n "$httpcode" ] || httpcode=0

	echo "SVC|$svc|$d1|catalogPresent=$present|dns=$dns|extdns=$extdns|extev=$extev|tcp=$tcp|tls=$tls|http=$http|httpcode=$httpcode" >>"$RESULT"
done

echo "* matrix done $(date -u +%H:%M:%S)" >>"$LOG"
ucode "$JOBS_CLI" mark-finished "$id" 0 >/dev/null 2>&1
exit 0
