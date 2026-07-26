#!/bin/sh
# log-rotate.sh — trim the upstream autohostlist log when it exceeds 1 MB to
# the last 500 lines. Called each watchdog cycle (source=lists).
#
# The log path is upstream-specific. Override with ZAPRET2_AUTOHOST_LOG; the
# default is a best-guess and MUST be confirmed against the real zapret2
# layout. [VERIFY] — see docs/upstream-mapping.md.

LOG="${ZAPRET2_AUTOHOST_LOG:-/opt/zapret2/logs/autohostlist.log}"
EVENTS=/tmp/zapret2-manager/events.ndjson
MAX_BYTES=$((1024 * 1024))   # 1 MB
KEEP_LINES=500

[ -f "$LOG" ] || exit 0

# Size in bytes.
size=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
[ -n "$size" ] || exit 0
[ "$size" -gt "$MAX_BYTES" ] || exit 0

# Trim to the last KEEP_LINES lines atomically.
tmp="${LOG}.trimmed.$$"
tail -n "$KEEP_LINES" "$LOG" > "$tmp" && mv -f "$tmp" "$LOG" || rm -f "$tmp"

# Record a lists event (ndjson, with a source field).
ts=$(date +%s 2>/dev/null || echo 0)
mkdir -p /tmp/zapret2-manager
printf '{"ts":%s,"source":"lists","level":"info","msg":"autohostlist log rotated to last %s lines (was %s bytes)"}\n' \
	"$ts" "$KEEP_LINES" "$size" >> "$EVENTS" 2>/dev/null || true

exit 0
