#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
HELPER="$ROOT/tools/router-scoped-capture.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

cat >"$TMP/tcpdump" <<'EOF'
#!/bin/sh
case " $* " in *' --help '*) echo 'tcpdump -C file_size -W file_count'; exit 0;; esac
out=''
prev=''
for arg in "$@"; do
  [ "$prev" = -w ] && out="$arg"
  prev="$arg"
done
printf pcap >"$out"
sleep 30
EOF
chmod 755 "$TMP/tcpdump"

stale="$TMP/z2m-capture-stale"
foreign_dir="$TMP/foreign-dir"
mkdir "$stale" "$foreign_dir"
touch -d '2 hours ago' "$stale"
output="$(TCPDUMP_BIN="$TMP/tcpdump" TMPDIR="$TMP" MAX_BYTES=1048576 sh "$HELPER" 192.168.1.203 1)" || fail "bounded capture failed: $output"
echo "$output" | grep -q 'bytes=4 ' || fail "byte summary missing: $output"
echo "$output" | grep -q 'cleanup=ok' || fail "cleanup summary missing: $output"
[ ! -e "$stale" ] || fail 'stale helper directory survived'
[ -d "$foreign_dir" ] || fail 'foreign directory was removed'
foreign="$TMP/foreign.pcap"
printf foreign >"$foreign"
if TCPDUMP_BIN="$TMP/tcpdump" TMPDIR="$TMP/does-not-exist" sh "$HELPER" 192.168.1.203 1 >/dev/null 2>&1; then fail 'low-space path succeeded'; fi
[ "$(cat "$foreign")" = foreign ] || fail 'foreign file changed'

set +e
TCPDUMP_BIN="$TMP/tcpdump" TMPDIR="$TMP" sh "$HELPER" 192.168.1.203 30 >"$TMP/signal.out" 2>&1 &
pid=$!
sleep 1
kill -TERM "$pid"
wait "$pid"
signal_rc=$?
set -e
[ "$signal_rc" -ne 0 ] || fail 'signal capture unexpectedly succeeded'
find "$TMP" -maxdepth 1 -type d -name 'z2m-capture-*' | grep -q . && fail 'signal left capture directory'
[ "$(cat "$foreign")" = foreign ] || fail 'foreign file changed'

grep -q 'mktemp -d.*z2m-capture-' "$HELPER" || fail 'unique capture directory missing'
grep -q '65536' "$HELPER" || fail '64 MiB floor missing'
grep -q '\${MAX_BYTES:-16777216}' "$HELPER" || fail '16 MiB default missing'
grep -q '\${2:-120}' "$HELPER" || fail '120 second default missing'
grep -q 'trap cleanup EXIT' "$HELPER" || fail 'cleanup trap missing'
grep -q 'kill "$TCPDUMP_PID"' "$HELPER" || fail 'owned-process kill missing'
! grep -Eq 'PowerShell|powershell|G:\\|\$pid|/tmp/\*' "$HELPER" || fail 'unsafe shell pattern found'
echo 'PASS: bounded capture size/time, signal/stale cleanup, low-space rejection'
