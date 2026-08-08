#!/bin/sh
# Self-test for the hotplug guard hook (point 3 — guard telemetry).
#
# With pause now held by NFQWS2_ENABLE=0 (point 1 closed via apply.uc), the
# guard hook is no longer the coercion mechanism: in normal operation it does
# NOTHING, and it only emits an event (severity NON-info) if it finds a running
# nfqws2 despite an active pause — meaning the primary mechanism did not hold.
# The active stop is REMOVED from the hook.
#
# This is a LOCAL static check (ucode does not run here; the hook is /bin/sh so
# sh -n covers syntax elsewhere). It asserts the hook's source:
#   - NO active stop command (/etc/init.d/zapret2 stop) in the hook
#   - an event IS still written (events.ndjson) when a process is found
#   - the event severity is NON-informational (crit or error, not info/warn)
#   - the hook still checks for a running process (pgrep -x nfqws2)
#   - the hook still gates on the paused flag
#
# Run: sh tests/guard-telemetry.test.sh
HOOK="zapret2-manager/files/etc/hotplug.d/iface/90-zapret2-manager"
fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS  $3"; else echo "FAIL  $3 (got=$1 want=$2)"; fail=1; fi; }
check_contains() { if grep -F -- "$2" "$1" >/dev/null; then echo "PASS  $3"; else echo "FAIL  $3 (missing '$2' in $1)"; fail=1; fi; }
check_absent() { if grep -F -- "$2" "$1" >/dev/null; then echo "FAIL  $3 (forbidden '$2' present in $1)"; fail=1; else echo "PASS  $3"; fi; }

# 1. NO active stop in the hook (the guard is telemetry-only now)
check_absent "$HOOK" '/etc/init.d/zapret2 stop' "guard hook has no active stop"
# also no stop_daemons / stop_fw variant used as the coercion
check_absent "$HOOK" '/etc/init.d/zapret2 stop_daemons' "guard hook has no stop_daemons"
check_absent "$HOOK" '/etc/init.d/zapret2 stop_fw' "guard hook has no stop_fw"

# 2. an event is still written (telemetry survives)
check_contains "$HOOK" 'events.ndjson' "guard hook still writes an event"

# 3. the event severity is NON-informational (crit or error)
if grep -F '"severity":"crit"' "$HOOK" >/dev/null || grep -F '"severity":"error"' "$HOOK" >/dev/null; then
	echo "PASS  guard event severity is non-info (crit/error)"
else
	echo "FAIL  guard event severity is non-info (got info/warn/absent)"; fail=1
fi
# explicitly NOT info
check_absent "$HOOK" '"severity":"info"' "guard event is not severity info"

# 4. still detects a running process during pause
check_contains "$HOOK" 'pgrep -x nfqws2' "guard still checks for a running nfqws2"

# 5. still gates on the paused flag
check_contains "$HOOK" '/tmp/zapret2-manager/paused' "guard gates on the paused flag"

# 6. hook itself is syntactically valid sh
if sh -n "$HOOK" 2>/dev/null; then echo "PASS  hook sh -n ok"; else echo "FAIL  hook sh -n"; fail=1; fi

if [ "$fail" = 0 ]; then echo "guard-telemetry: ALL PASS"; exit 0; else echo "guard-telemetry: FAILED"; exit 1; fi
