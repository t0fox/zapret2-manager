#!/bin/sh
# log-rotate.sh — trim the upstream autohostlist log when it exceeds 1 MB to
# the last 500 lines. Called each watchdog cycle (source=lists).
#
# The log path is NOT hardcoded: it is set by the AUTOHOSTLIST_DEBUGLOG variable
# in /opt/zapret2/config and differs per installation. We read it from there.
# Confirmed by external source.
#
# If the variable is unset or the file does not exist, rotation is a SKIP —
# not an error and not a warning. Rotation rule: larger than 1 MB → keep the
# last 500 lines.

CONFIG="${ZAPRET2_CONFIG:-/opt/zapret2/config}"
EVENTS=/tmp/zapret2-manager/events.ndjson
MAX_BYTES=$((1024 * 1024))   # 1 MB
KEEP_LINES=500

# Read AUTOHOSTLIST_DEBUGLOG=... from the config (first match, strip quotes).
LOG=""
if [ -f "$CONFIG" ]; then
	LOG=$(sed -n 's/^[[:space:]]*AUTOHOSTLIST_DEBUGLOG=//p' "$CONFIG" 2>/dev/null | head -n 1)
	# strip surrounding quotes
	LOG="${LOG#\"}"; LOG="${LOG%\"}"
	LOG="${LOG#\'}"; LOG="${LOG%\'}"
fi

# Unset or no file → skip (not an error).
[ -n "$LOG" ] || exit 0
[ -f "$LOG" ] || exit 0

# Size in bytes.
size=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
[ -n "$size" ] || exit 0
[ "$size" -gt "$MAX_BYTES" ] || exit 0

# Trim to the last KEEP_LINES lines atomically.
tmp="${LOG}.trimmed.$$"
tail -n "$KEEP_LINES" "$LOG" > "$tmp" && mv -f "$tmp" "$LOG" || rm -f "$tmp"

# Record a lists event (ndjson, with a source field). See events.v1.json.
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
id="lists-$$-$(date +%s 2>/dev/null || echo 0)"
printf '{"schema":"events.v1","ts":"%s","id":"%s","category":"lists","severity":"info","source":"lists","msg":"autohostlist log rotated to last %s lines (was %s bytes)","path":"%s","keep_lines":%s,"was_bytes":%s}\n' \
	"$ts" "$id" "$KEEP_LINES" "$size" "$LOG" "$KEEP_LINES" "$size" >> "$EVENTS" 2>/dev/null || true

exit 0
