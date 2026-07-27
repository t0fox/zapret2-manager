#!/bin/ash
# blockcheck-run.sh <job-id> — the detached blockcheck job runner (SLICE 4).
#
# Orchestrates ONE upstream blockcheck2.sh scan as a managed job:
#   - marks the record running (pid identity), starts the scanner under
#     setsid (its own process group, so INT reaches the whole group);
#   - polls for a cancel flag → sends INT (the scanner unpreparse its own
#     firewall artifacts — never a raw -9 first);
#   - enforces the mode timeout → INT, grace, then -9 as the last resort;
#   - on scanner exit, marks the record succeeded/failed (the ucode side
#     parses the SUMMARY into recommendations and truncates the log).
#
# The scanner is CALLED, never reimplemented (architecture §1). All record
# writes go through jobs-cli.uc mark-* (ucode owns JSON; ash owns processes).

JDIR=/tmp/zapret2-manager/jobs
JOBS_CLI=/usr/libexec/zapret2-manager/jobs-cli.uc
SCANNER=/opt/zapret2/blockcheck2.sh

id="$1"
[ -n "$id" ] || exit 1
[ -f "$JDIR/$id.env" ] || exit 1

. "$JDIR/$id.env"

ucode "$JOBS_CLI" mark-running "$id" "$$" >/dev/null 2>&1

export BATCH TEST IPVS SCANLEVEL ENABLE_HTTP ENABLE_HTTPS_TLS12 ENABLE_HTTPS_TLS13 ENABLE_HTTP3 REPEATS PARALLEL DOMAINS

setsid "$SCANNER" >"$JDIR/$id.log" 2>&1 &
child=$!
ucode "$JOBS_CLI" mark-child "$id" "$child" >/dev/null 2>&1

elapsed=0
timeout="${TIMEOUT:-300}"
while kill -0 "$child" 2>/dev/null; do
	if [ -f "$JDIR/$id.cancel" ]; then
		# graceful: INT the scanner's process group (it unpreparse itself),
		# grace, then -9 as the last resort
		kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null
		sleep 3
		kill -9 -"$child" 2>/dev/null || kill -9 "$child" 2>/dev/null
		wait "$child" 2>/dev/null
		rm -f "$JDIR/$id.cancel"
		ucode "$JOBS_CLI" mark-cancelled "$id" >/dev/null 2>&1
		exit 0
	fi
	if [ "$elapsed" -ge "$timeout" ]; then
		kill -INT -"$child" 2>/dev/null || kill -INT "$child" 2>/dev/null
		sleep 3
		kill -9 -"$child" 2>/dev/null || kill -9 "$child" 2>/dev/null
		wait "$child" 2>/dev/null
		ucode "$JOBS_CLI" mark-failed "$id" "timeout after ${timeout}s" >/dev/null 2>&1
		exit 0
	fi
	sleep 2
	elapsed=$((elapsed + 2))
done

wait "$child"
rc=$?
ucode "$JOBS_CLI" mark-finished "$id" "$rc" >/dev/null 2>&1
exit 0
