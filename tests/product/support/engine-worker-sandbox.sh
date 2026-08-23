#!/usr/bin/env bash
# engine-worker-sandbox.sh — throwaway-root harness driving the REAL
# engine-operation-worker.sh through injected failures.
#
# usage: sudo bash engine-worker-sandbox.sh <worker.sh> <sync.sh> <materialize|capabilities>
# output: a single JSON verdict line on stdout
#
# The harness stubs every absolute-path boundary the worker touches:
#   /opt/zapret2 (seeded "previous install"), /etc/init.d/zapret2,
#   /etc/openwrt_release, /usr/libexec/zapret2-manager/{engine-cli.uc,strategy-runtime-assets-sync.sh},
#   /usr/share/zapret2-manager/runtime-assets, and PATH stubs for apk/pidof/nft/
#   uclient-fetch/jsonfilter/df/ubus. sha256sum/tar/gzip are the real ones.

set -u
WORKER="$1"; SYNC="$2"; INJECTION="$3"

die() { printf '{"fatal":%s}\n' "\"$1\"" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die 'root required'
[ -x /bin/sh ] || die '/bin/sh missing'

SB=$(mktemp -d "$HOME/z2m-wsandbox.XXXXXX")
trap 'rm -rf "$SB"' EXIT

# ---- fixture artifact ------------------------------------------------------
ART_ROOT="$SB/artifact/zapret2-r77-z2m-test"
mkdir -p "$ART_ROOT/binaries/linux-arm64" "$ART_ROOT/common" "$ART_ROOT/ipset" \
	"$ART_ROOT/files" "$ART_ROOT/lua" "$ART_ROOT/init.d/openwrt" "$ART_ROOT/blockcheck2.d"
printf '#!/bin/sh\necho "github version v1.5.9"\n' > "$ART_ROOT/binaries/linux-arm64/nfqws2"
printf '#!/bin/sh\nexit 0\n' > "$ART_ROOT/binaries/linux-arm64/ip2net"
printf '#!/bin/sh\nexit 0\n' > "$ART_ROOT/binaries/linux-arm64/mdig"
chmod +x "$ART_ROOT/binaries/linux-arm64/"*
printf 'NFQWS2_ENABLE=0\n' > "$ART_ROOT/config.default"
printf '#!/bin/sh\nexit 0\n' > "$ART_ROOT/blockcheck2.sh"
echo '{}' > "$ART_ROOT/blockcheck2.d/catalog.json"
echo x > "$ART_ROOT/files/fake_tls_1.bin"
echo 'function auto() end' > "$ART_ROOT/lua/zapret-auto.lua"
cat > "$ART_ROOT/init.d/openwrt/zapret2" <<'EOF'
#!/bin/sh
LUAOPT=""
start() { :; }
stop() { :; }
restart() { :; }
start_fw() { :; }
reload_ifsets() { :; }
list_table() { :; }
case "${1:-}" in start|stop|restart) "${1}" ;; *) exit 0 ;; esac
EOF
chmod +x "$ART_ROOT/init.d/openwrt/zapret2"
NFQWS2_SHA=$(sha256sum "$ART_ROOT/binaries/linux-arm64/nfqws2" | awk '{print $1}')
ARTIFACT="$SB/z2m-engine-r77-z2m-test-aarch64_cortex-a53.tar.gz"
tar -czf "$ARTIFACT" -C "$SB/artifact" zapret2-r77-z2m-test
ASSET_SHA=$(sha256sum "$ARTIFACT" | awk '{print $1}')
ASSET_SIZE=$(wc -c < "$ARTIFACT" | tr -d ' ')
WS_ASSET_SHA="$ASSET_SHA"; WS_ASSET_SIZE="$ASSET_SIZE"
export WS_ASSET_SHA WS_ASSET_SIZE
cat > "$SB/engine-manifest.json" <<EOF
{"schema":"zapret2-manager.engine-artifact.v1","artifactKind":"z2m-compatible-engine",
 "version":"r77-z2m-test","architecture":"aarch64_cortex-a53",
 "artifact":{"name":"z2m-engine-r77-z2m-test-aarch64_cortex-a53.tar.gz","sha256":"$ASSET_SHA","sizeBytes":$ASSET_SIZE,"container":"tar.gz"},
 "nfqws2Sha256":"$NFQWS2_SHA"}
EOF

# ---- package baseline for materialization ----------------------------------
PKG=/usr/share/zapret2-manager/runtime-assets
mkdir -p "$PKG/bin" "$PKG/lua" "$PKG/lists"
cp -a "$ART_ROOT/files/fake_tls_1.bin" "$PKG/bin/"
cp -a "$ART_ROOT/lua/zapret-auto.lua" "$PKG/lua/"
echo d > "$PKG/lists/discord.txt"

# ---- previous install seed -------------------------------------------------
rm -rf /opt/zapret2
mkdir -p /opt/zapret2/init.d/openwrt/custom.d /opt/zapret2/ipset /opt/zapret2/nfq2 /opt/zapret2/lua /opt/zapret2/files
echo PREVIOUS_MARKER > /opt/zapret2/PREVIOUS_MARKER
printf '#!/bin/sh\necho "github version v1.5.9"\n' > /opt/zapret2/nfq2/nfqws2
chmod +x /opt/zapret2/nfq2/nfqws2
for helper in ip2net mdig; do
	mkdir -p "/opt/zapret2/$helper"
	printf '#!/bin/sh\nexit 0\n' > "/opt/zapret2/$helper/$helper"
	chmod +x "/opt/zapret2/$helper/$helper"
done
printf 'NFQWS2_ENABLE=0\n' > /opt/zapret2/config
cp -a /opt/zapret2/config /opt/zapret2/config.default
cat > /opt/zapret2/init.d/openwrt/zapret2 <<'EOF'
#!/bin/sh
LUAOPT=""
case "${1:-}" in start|stop|restart) exit 0;; *) exit 0;; esac
EOF
chmod +x /opt/zapret2/init.d/openwrt/zapret2

cat > /etc/init.d/zapret2 <<'EOF'
#!/bin/sh
echo "$1" >> /tmp/z2m-ws-init-calls.log
start() { :; }
stop() { :; }
restart() { :; }
start_fw() { :; }
reload_ifsets() { :; }
list_table() { :; }
extra_command "start" "x"
case "${1:-}" in start) echo 1234 > /tmp/z2m-ws-nfqws-pid ;; stop) rm -f /tmp/z2m-ws-nfqws-pid ;; esac
exit 0
EOF
chmod +x /etc/init.d/zapret2
printf '%s\n' 'DISTRIB_ARCH="aarch64_cortex-a53"' 'DISTRIB_RELEASE=25.12.5' > /etc/openwrt_release

# ---- PATH stubs ------------------------------------------------------------
BIN="$SB/bin"; mkdir -p "$BIN"
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }

stub pidof 'if [ -f /tmp/z2m-ws-nfqws-pid ]; then cat /tmp/z2m-ws-nfqws-pid; else exit 1; fi'
stub apk 'case "$*" in *"-e zapret2-manager"*|*"-e luci-app-zapret2-manager"*) exit 0;; *"info -e -v"*) echo "zapret2-1.5.9";; *"-e zapret2"*) [ -f /tmp/z2m-ws-legacy-apk ] && exit 0 || exit 1;; *) exit 0;; esac'
stub nft 'case "$*" in *list*table*) : ;; *) : ;; esac; exit 0'
stub df 'echo "Filesystem 1024-blocks Used Available Capacity Mounted"; echo "/overlay 9999999 100000 9899999 1% /overlay"; echo "/tmp 9999999 100000 9899999 1% /tmp"'
stub ubus 'printf "{\"ok\":true,\"runtimeSummary\":{\"status\":\"running\"}}\n"'
stub status.uc true
stub flock '[ "$1" != "-n" ] && exit 1; exit 0'

cat > "$BIN/uclient-fetch" <<STUB
#!/bin/sh
out=""; url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -O) out="\$2"; shift 2 ;;
    -T) shift 2 ;;
    -q) shift ;;
    --user-agent=*) shift ;;
    *) url="\$1"; shift ;;
  esac
done
case "\$url" in
  *z2m-engine-*.tar.gz) cp "$ARTIFACT" "\$out" ;;
  *.manifest.json) cp "$SB/engine-manifest.json" "\$out" ;;
  *) printf 'unknown fetch %s\\n' "\$url" >&2; exit 1 ;;
esac
exit 0
STUB
chmod +x "$BIN/uclient-fetch"

cat > "$BIN/jsonfilter" <<'STUB'
#!/bin/sh
key=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-e" ]; then key="$arg"; fi
  prev="$arg"
done
case "$key" in
  '@.action') echo install ;;
  '@.preserveConfig') echo true ;;
  '@.candidate.artifactKind') echo z2m-compatible-engine ;;
  '@.candidate.schema') echo zapret2-manager.engine-artifact.v1 ;;
  '@.candidate.architecture') echo aarch64_cortex-a53 ;;
  '@.candidate.downloadUrl') echo "https://github.com/t0fox/zapret2-manager/releases/download/engine-r77/z2m-engine-r77-z2m-test-aarch64_cortex-a53.tar.gz" ;;
  '@.candidate.sha256') echo "$WS_ASSET_SHA" ;;
  '@.candidate.size') echo "$WS_ASSET_SIZE" ;;
  '@.candidate.version') echo r77-z2m-test ;;
  '@.candidate.container') echo tar.gz ;;
  '@.candidate.checksumUrl') echo none ;;
  '@.candidate.checksumSha256') echo none ;;
  '@.candidate.checksumName') echo none ;;
  '@.candidate.nfqws2Sha256') echo "$WS_NFQWS2_SHA" ;;
  *) : ;;
esac
exit 0
STUB
chmod +x "$BIN/jsonfilter"

# engine-cli.uc stub: phases recorded, commit-state records evidence.
CLI_DIR=/usr/libexec/zapret2-manager
mkdir -p "$CLI_DIR"
# The worker invokes /usr/bin/ucode by absolute path; provide a wrapper around
# the locally built interpreter when none exists.
UCODE_MADE=0
if [ ! -e /usr/bin/ucode ]; then
	cat > /usr/bin/ucode <<'STUB'
#!/bin/sh
# Router ucode tolerates trailing --flags passed to scripts; this host build
# does not. Strip leading dashes from args AFTER the first (script) path.
LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-/opt/ucode/lib}" \
exec /opt/ucode/bin/ucode "$@"
STUB
	chmod +x /usr/bin/ucode
	UCODE_MADE=1
fi
# engine-cli.uc stub: phase/failed/complete recorded locally; commit-state
# DELEGATES to the real CLI so the true engine-manager.uc capability gate
# (capabilities.json path + 3/3 enforcement) is exercised on every run.
CLI_DIR=/usr/libexec/zapret2-manager
mkdir -p "$CLI_DIR"
# Repo root inferred from the sync script location (…/files/usr/libexec/zapret2-manager/x)
REPO_OF_SYNC=$(cd "$(dirname "$SYNC")/../../../../.." && pwd)
if [ -f "$REPO_OF_SYNC/zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc" ]; then
	SRC_LIB="$REPO_OF_SYNC/zapret2-manager/files/usr/libexec/zapret2-manager"
elif [ -f "$HOME/z2m-build/zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc" ]; then
	SRC_LIB="$HOME/z2m-build/zapret2-manager/files/usr/libexec/zapret2-manager"
else
	die 'real engine-cli.uc source not found for commit-state delegation'
fi
cp "$SRC_LIB/engine-manager.uc" "$CLI_DIR/engine-manager.uc"
cp "$SRC_LIB/engine-catalog.uc" "$CLI_DIR/engine-catalog.uc"
mkdir -p "$CLI_DIR/core"
cp "$SRC_LIB/core/private-temp.uc" "$CLI_DIR/core/private-temp.uc"
# commit-state entry point: imports the REAL manager (capability gate) and
# prints the verdict JSON. Kept as a separate file so the phase/failed logger
# stub stays dependency-free.
cat > "$CLI_DIR/commit-entry.uc" <<'STUB'
'use strict';
import { writefile } from 'fs';
import { commit_state } from './engine-manager.uc';
let r = commit_state(length(ARGV) ? ARGV[0] : '');
let payload = sprintf('%J', r) + '\n';
writefile('/tmp/z2m-commit-out.json', payload);
print(payload);
STUB
chmod 0644 "$CLI_DIR/commit-entry.uc"
cat > "$CLI_DIR/engine-cli.uc" <<'STUB'
#!/usr/bin/ucode
'use strict';
import { popen } from 'fs';
let mode = length(ARGV) > 0 ? ARGV[0] : '';
let code = length(ARGV) > 2 ? ARGV[2] : '';
let jobid = length(ARGV) > 1 ? ARGV[1] : '';
if (mode == 'commit-state') {
	// REAL backend via tiny entry module: true capability gate under test.
	popen('printf "%s\\n" "commit-state:start" >> /tmp/z2m-ws-cli-calls.log');
	let p = popen('/opt/ucode/bin/ucode /usr/libexec/zapret2-manager/commit-entry.uc ' + jobid + ' 2>/tmp/z2m-commit-err', 'r');
	let out = p ? p.read('all') : '';
	if (p) p.close();
	let parsed = null;
	try { parsed = json(out || ''); } catch (e) { parsed = null; }
	let verdict = (parsed != null && parsed.ok == true) ? 'ok' : 'fail';
	popen('printf "%s:%s\\n" "commit-state" "' + verdict + '" >> /tmp/z2m-ws-cli-calls.log');
	print(out || '{"ok":false}');
	exit(0);
}
popen('printf "%s:%s\\n" "' + mode + '" "' + code + '" >> /tmp/z2m-ws-cli-calls.log');
print('{"ok":true}\n');
exit(0);
STUB
chmod +x "$CLI_DIR/engine-cli.uc"
cp "$SYNC" "$CLI_DIR/strategy-runtime-assets-sync.sh"

# native-preflight.uc stub: verdict depends on injection.
case "$INJECTION" in
capabilities)
	cat > "$CLI_DIR/preflight-cli.uc" <<'STUB'
#!/usr/bin/ucode
'use strict';
print('{"ok":false,"Z2K_TLS_MOD":true,"ANTIDPI_REPEATS_LOOP":true,"AUTO_FAMILY_SPLIT":false,"luaSmoke":false,"nfqws2Sha256":null}');
print("\n");
exit(0);
STUB
	;;
*)
	cat > "$CLI_DIR/preflight-cli.uc" <<STUB
#!/usr/bin/ucode
'use strict';
print('{"ok":true,"Z2K_TLS_MOD":true,"ANTIDPI_REPEATS_LOOP":true,"AUTO_FAMILY_SPLIT":true,"luaSmoke":true,"nfqws2Sha256":"$NFQWS2_SHA"}');
print("\n");
exit(0);
STUB
	;;
esac
chmod +x "$CLI_DIR/native-preflight.uc"

# Commit scenario: postflight must pass end-to-end. Seed the runtime state it
# expects: previous OFFICIAL engine-state (detached install), no running
# daemon (config enabled=0 -> postflight expects daemon absent).
if [ "$INJECTION" = commit ]; then
	mkdir -p /etc/zapret2-manager /tmp/zapret2-manager
	# postflight's status proof: host ucode rejects '--no-print' style args,
	# so pre-stage the collector output the check requires.
	printf '{"ok":true}\n' > /tmp/zapret2-manager/status.json
	cat > /etc/zapret2-manager/engine-state.json <<EOF
{"schema":"engine-state.v2","installedOrigin":"OFFICIAL","installedRelease":"v1.5.9","packageVersion":null,"assetName":"prev.tar.gz","assetSha256":"$(printf 'a%.0s' {1..64})","architecture":"aarch64_cortex-a53","container":"tar.gz","installedAt":1700000000}
EOF
fi

# postflight must fail on host: make status collector absent so worker stops
# at EPOSTFLIGHT only when everything before it passed. We instead want the
# success path to reach commit: stub status.uc via PATH is not enough because
# worker calls `/usr/bin/ucode .../status.uc --no-print`. Provide a fake.
cat > "$CLI_DIR/status.uc" <<'STUB'
#!/usr/bin/ucode
'use strict';
import { writefile } from 'fs';
writefile('/tmp/zapret2-manager/status.json', '{"ok":true}\n');
exit(0);
STUB
chmod +x "$CLI_DIR/status.uc"

# Materialize injection: the staged sync hook itself fails hard.
if [ "$INJECTION" = materialize ]; then
	printf '#!/bin/sh\nexit 1\n' > "$CLI_DIR/strategy-runtime-assets-sync.sh"
	chmod +x "$CLI_DIR/strategy-runtime-assets-sync.sh"
fi

# ---- job -------------------------------------------------------------------
ID="eng-$(date +%s)-deadbeefcafe"
OPS=/tmp/zapret2-manager/engine-operations
mkdir -p "$OPS"
export WS_NFQWS2_SHA="$NFQWS2_SHA"
cat > "$OPS/$ID.json" <<EOF
{"schema":"engine-operation.v2","id":"$ID","action":"install","phase":"queued","progress":0,
 "preserveConfig":true,
 "candidate":{"schema":"zapret2-manager.engine-artifact.v1","artifactKind":"z2m-compatible-engine",
  "version":"r77-z2m-test","architecture":"aarch64_cortex-a53","container":"tar.gz",
  "downloadUrl":"https://github.com/t0fox/zapret2-manager/releases/download/engine-r77/z2m-engine-r77-z2m-test-aarch64_cortex-a53.tar.gz",
  "sha256":"$WS_ASSET_SHA","size":$WS_ASSET_SIZE,
  "checksumUrl":"https://github.com/bol-van/zapret2/releases/download/v1.5.9/sha256sum.txt",
  "checksumSha256":"none","checksumName":"none","nfqws2Sha256":"$WS_NFQWS2_SHA"},
 "requiredCapabilities":["Z2K_TLS_MOD","ANTIDPI_REPEATS_LOOP","AUTO_FAMILY_SPLIT"]}
EOF
echo "$ID" > /tmp/z2m-ws-active-id
: > /tmp/z2m-ws-init-calls.log; : > /tmp/z2m-ws-cli-calls.log

# ---- run -------------------------------------------------------------------
if [ "${WS_DEBUG:-0}" = 1 ]; then
	PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" sh -x "$WORKER" "$ID" >"$SB/worker.out" 2>"$SB/worker.err"
else
	PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" sh "$WORKER" "$ID" >"$SB/worker.out" 2>"$SB/worker.err"
fi
worker_rc=$?
cp "$SB/worker.err" "$HOME/z2m-worker-debug-last.err" 2>/dev/null || true
if [ "${WS_DEBUG:-0}" = 1 ]; then
	printf '%s\n' '== worker.err tail (filtered):' >&2
	tail -40 "$SB/worker.err" | grep -vE '/usr/bin/ucode' >&2
fi

phase=queued
errorCode=null
if grep -q 'phase:rolling_back' /tmp/z2m-ws-cli-calls.log 2>/dev/null; then phase=rolled_back; fi
if grep -q 'complete' /tmp/z2m-ws-cli-calls.log 2>/dev/null; then phase=completed; fi
failedCode=$(grep -o 'failed:[A-Za-z0-9_]*' /tmp/z2m-ws-cli-calls.log 2>/dev/null | tail -n1 | cut -d: -f2)
[ -n "$failedCode" ] && errorCode="$failedCode"
committedState=false
grep -q 'commit-state:ok' /tmp/z2m-ws-cli-calls.log 2>/dev/null && committedState=true
oldTreeRestored=false
grep -q PREVIOUS_MARKER /opt/zapret2/PREVIOUS_MARKER 2>/dev/null && oldTreeRestored=true

printf '{"workerRc":%s,"phase":"%s","errorCode":"%s","oldTreeRestored":%s,"committedState":%s,"cliCalls":"%s"}\n' \
	"$worker_rc" "$phase" "$errorCode" "$oldTreeRestored" "$committedState" "$(tr '\n' ',' < /tmp/z2m-ws-cli-calls.log)"

# cleanup global touches
cp -a "$CLI_DIR" /root/z2m-cli-last 2>/dev/null || true
rm -f /etc/init.d/zapret2 /etc/openwrt_release
rm -rf /opt/zapret2 "$PKG" "$CLI_DIR/engine-cli.uc" "$CLI_DIR/engine-cli-real.uc" \
	"$CLI_DIR/z2m-root-bootstrap" "$CLI_DIR/engine-manager.uc" "$CLI_DIR/engine-catalog.uc" \
	"$CLI_DIR/core" "$CLI_DIR/native-preflight.uc" "$CLI_DIR/status.uc" "$CLI_DIR/strategy-runtime-assets-sync.sh"
[ "$UCODE_MADE" = 1 ] && rm -f /usr/bin/ucode
rm -rf /tmp/zapret2-manager
if [ "${WS_KEEP:-0}" = 1 ]; then
	trap - EXIT
	printf '%s\n' "== kept sandbox: $SB (worker.err above)" >&2
else
	rm -rf "$SB"
fi
exit 0
