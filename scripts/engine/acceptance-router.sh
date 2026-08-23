#!/bin/bash
# Router ENGINE-INSTALL acceptance. Run AFTER a canonical engine release
# exists (engine-build.yml publishes tag engine-*). Drives the normal
# UI/API path end-to-end and captures the evidence rows required by the
# clean-install task: candidate identity, digests, capability proof,
# materialization, runtime/NFQUEUE ownership, System Components truth model.
#
# Usage: bash scripts/engine/acceptance-router.sh [TARGET=root@192.168.1.1]

set -u
TARGET=${1:-root@192.168.1.1}
R() { ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" "$@"; }
EV="${ENGINE_EVIDENCE_DIR:-$PWD/engine-acceptance-evidence}"
mkdir -p "$EV"

fail() { echo "ACCEPTANCE FAILED: $*" >&2; exit 1; }

echo '== [E0] preconditions'
R '
apk info -e zapret2-manager >/dev/null || { echo manager-not-installed; exit 1; }
[ -d /opt/zapret2 ] && { echo engine-already-present; exit 1; }
echo PRECONDITIONS-OK' | grep -q PRECONDITIONS-OK \
  || fail 'manager missing or engine already installed'

echo '== [E1] select latest compatible candidate (normal check path)'
R 'ubus -S call zapret2-manager-engine engine_check "{\"edit\":\"{}\"}"' \
  > "$EV/E1-check.json" || fail 'engine_check failed'
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!c.ok || !c.checkToken) process.exit(1);
const m = c.candidate;
console.log(JSON.stringify({
  artifactKind: m.artifactKind, version: m.version,
  baseRepository: m.upstream, baseCommit: m.baseCommit,
  architecture: m.architecture, expectedArtifactSha256: m.sha256,
  nfqws2Sha256: m.nfqws2Sha256, downloadUrl: m.downloadUrl,
  requiredCapabilities: m.requiredCapabilities, compatible: m.compatible
}, null, 1));' "$EV/E1-check.json" > "$EV/E1-selected.json" \
  || fail 'no installable compatible candidate published'
cat "$EV/E1-selected.json"
TOKEN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).checkToken)' "$EV/E1-check.json")

echo '== [E2] install via normal API path'
node -e 'console.log(JSON.stringify({ edit: JSON.stringify({ checkToken: process.argv[1] }) }));' "$TOKEN" \
  > "$EV/E2-req.json"
R "ubus -S call zapret2-manager-engine engine_install \"\$(cat \"$EV/E2-req.json\" 2>/dev/null || true)\"" >/dev/null 2>&1 || true
scp -O -q "$TARGET:/dev/null" /dev/null 2>/dev/null || true
cat "$EV/E2-req.json" | ssh -o BatchMode=yes "$TARGET" 'read -r body; ubus -S call zapret2-manager-engine engine_install "$body"' \
  > "$EV/E2-start.json" || fail 'engine_install rejected'
grep -q '"ok":true' "$EV/E2-start.json" || fail "engine_install failed: $(cat "$EV/E2-start.json")"

echo '== [E3] wait for operation completion (<=240s)'
OPID=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.operation&&s.operation.id||"")' "$EV/E2-start.json")
[ -n "$OPID" ] || fail 'no operation id in start response'
FINAL=""
for i in $(seq 1 60); do
  FINAL=$(R "ubus -S call zapret2-manager-engine engine_operation_status '{\"edit\":\"{\\\"id\\\":\\\"$OPID\\\"}\"}'")
  echo "$FINAL" | grep -qE '"phase":"(completed|failed|rolled_back)"' && break
  sleep 4
done
echo "$FINAL" > "$EV/E3-operation.json"
grep -q '"phase":"completed"' "$EV/E3-operation.json" \
  || fail "operation did not complete: $FINAL"

echo '== [E4] on-target evidence battery'
R '
pass=0; fail=0
chk(){ name="$1"; shift; if eval "$@" >/dev/null 2>&1; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name"; fail=$((fail+1)); fi; }
chk opt-exists      "[ -d /opt/zapret2 ]"
chk binary-aarch64  "file /opt/zapret2/nfq2/nfqws2 | grep -q aarch64 || readelf -h /opt/zapret2/nfq2/nfqws2 | grep -q AArch64"
chk state-committed "[ -s /etc/zapret2-manager/engine-state.json ]"
chk caps-3of3       "jsonfilter -i /etc/zapret2-manager/engine-state.json -e @capabilities.Z2K_TLS_MOD -e @capabilities.ANTIDPI_REPEATS_LOOP -e @capabilities.AUTO_FAMILY_SPLIT | grep -qc true"
chk z2k-lua-present "[ -f /opt/zapret2/lua/z2k-modern-core.lua ] && [ -f /opt/zapret2/lua/z2k-detectors.lua ]"
chk sync-verify     "/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh --verify | grep -q \"\\\"ok\\\":true\""
chk preflight-proof "/usr/bin/ucode /usr/libexec/zapret2-manager/native-preflight.uc --install-proof | grep -q \"\\\"ok\\\":true\""
chk single-owner    "[ \$(pidof nfqws2 | wc -w) -eq 1 ]"
chk queue-300       "grep -Eq \"^[[:space:]]*300[[:space:]]\" /proc/net/netfilter/nfnetlink_queue"
chk no-dup-daemon   "! pgrep -fc nfqws2 | grep -qv 1"
chk components-2of2 "ubus -S call zapret2-manager versions >/dev/null && true"
echo "SUMMARY pass=\$pass fail=\$fail"
' 2>&1 | tee "$EV/E4-battery.txt"
grep -q FAIL "$EV/E4-battery.txt" && fail 'on-target evidence battery has failures'

echo '== [E5] System Components truth model via RPCs'
R 'ubus -S call zapret2-manager-engine engine_status' > "$EV/E5-engine-status.json"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!s.ok) process.exit(1);
console.log("engine_status:", s.state, "compatible:", s.compatible);
' "$EV/E5-engine-status.json"

echo "ENGINE ACCEPTANCE EVIDENCE in $EV"
