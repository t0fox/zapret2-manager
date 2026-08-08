#!/bin/sh
# Target-side bounded capture. Invoke this script from a WSL/bash command.
set -eu

CLIENT_IP="${1:?usage: router-scoped-capture.sh CLIENT_IP [SECONDS]}"
DURATION="${2:-120}"
MAX_BYTES="${MAX_BYTES:-16777216}"
TCPDUMP_BIN="${TCPDUMP_BIN:-tcpdump}"
INTERFACE="${INTERFACE:-br-lan}"
WORK_DIR=""
TCPDUMP_PID=""
WATCH_PID=""
CAPTURE_RC=125
START_EPOCH="$(date +%s)"

case "$CLIENT_IP" in *[!0-9.]*|'') echo "invalid IPv4 client address" >&2; exit 2;; esac
case "$DURATION" in *[!0-9]*|''|0) echo "invalid duration" >&2; exit 2;; esac
case "$MAX_BYTES" in *[!0-9]*|''|0) echo "invalid MAX_BYTES" >&2; exit 2;; esac
MAX_MIB=$((MAX_BYTES / 1048576))
[ "$MAX_MIB" -gt 0 ] || { echo "MAX_BYTES must be at least 1048576" >&2; exit 2; }

CAPTURE_DIR="${TMPDIR:-/tmp}"
AVAILABLE_KB="$(df -k "$CAPTURE_DIR" | awk 'NR==2 {print $4}')"
[ "${AVAILABLE_KB:-0}" -ge 65536 ] || {
  echo "insufficient free space: ${AVAILABLE_KB:-0} KiB (need 65536 KiB)" >&2
  exit 3
}
# Only stale directories created by this helper are eligible; foreign /tmp
# files and directories never match this prefix.
find "$CAPTURE_DIR" -maxdepth 1 -type d -name 'z2m-capture-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/z2m-capture-XXXXXX")"

cleanup() {
  set +e
  [ -z "$WATCH_PID" ] || { kill "$WATCH_PID" 2>/dev/null; wait "$WATCH_PID" 2>/dev/null; }
  [ -z "$TCPDUMP_PID" ] || { kill "$TCPDUMP_PID" 2>/dev/null; wait "$TCPDUMP_PID" 2>/dev/null; }
  END_EPOCH="$(date +%s)"
  BYTES="$(find "$WORK_DIR" -type f -name '*.pcap*' -exec wc -c {} + 2>/dev/null | awk '{sum += $1} END {print sum + 0}')"
  DURATION_ACTUAL=$((END_EPOCH - START_EPOCH))
  [ "$CAPTURE_RC" -ne 0 ] || [ "$BYTES" -le "$MAX_BYTES" ] || CAPTURE_RC=125
  printf 'capture bytes=%s duration=%ss cleanup=ok rc=%s\n' "$BYTES" "$DURATION_ACTUAL" "$CAPTURE_RC"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

HELP="$($TCPDUMP_BIN --help 2>&1 || true)"
if printf '%s\n' "$HELP" | grep -q -- '-C' && printf '%s\n' "$HELP" | grep -q -- '-W'; then
  "$TCPDUMP_BIN" -ni "$INTERFACE" "host $CLIENT_IP" -C 1 -W "$MAX_MIB" \
    -w "$WORK_DIR/capture.pcap" >"$WORK_DIR/tcpdump.log" 2>&1 &
else
  "$TCPDUMP_BIN" -ni "$INTERFACE" "host $CLIENT_IP" -w - 2>"$WORK_DIR/tcpdump.log" \
    | dd of="$WORK_DIR/capture.pcap" bs=1048576 count="$MAX_MIB" 2>>"$WORK_DIR/tcpdump.log" &
fi
TCPDUMP_PID=$!
(
  sleep "$DURATION"
  kill "$TCPDUMP_PID" 2>/dev/null || true
) &
WATCH_PID=$!
set +e
wait "$TCPDUMP_PID"
CAPTURE_RC=$?
set -e
[ "$CAPTURE_RC" -eq 143 ] || [ "$CAPTURE_RC" -eq 130 ] || true
[ "$CAPTURE_RC" -eq 143 ] && CAPTURE_RC=0 || true
[ "$CAPTURE_RC" -eq 130 ] && CAPTURE_RC=0 || true
exit "$CAPTURE_RC"
