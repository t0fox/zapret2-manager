#!/bin/sh
# tools/smoke.sh — per-branch gate verification on a LIVE router.
#
# "Mock tests are not proof." Every branch is verified here, against the real
# device. Gates are run after `tools/deploy.sh` has installed the branch's
# packages.
#
# Hard rules baked into this script (docs/architecture.md §7):
#   - ssh rc=255 = dropped connection, NOT a result. ssh_ok treats it as failure.
#   - grep on bracketed patterns uses -F (brackets are regex char classes).
#   - autostart is verified by a REAL reboot, not a symlink check.
#   - never `service firewall stop` / full fw restart. No gate does either.
#
# Usage:
#   tools/smoke.sh                # run all gates for installed branches
#   tools/smoke.sh 02             # run only branch 02
#   tools/smoke.sh autostart      # DESTRUCTIVE: reboot router, verify service auto-starts
#   DEPLOY_HOST=192.168.1.1 tools/smoke.sh
#
# Exit status: 0 = all selected gates passed, 1 = any failed.

set -u

HOST="${DEPLOY_HOST:-192.168.1.1}"
SSH_OPTS="-o ConnectTimeout=8 -o BatchMode=yes"
PASS=0; FAIL=0

log()  { printf '[smoke] %s\n' "$*"; }
ok()   { printf '[smoke]   PASS  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '[smoke]   FAIL  %s\n' "$1" >&2; FAIL=$((FAIL+1)); }
die()  { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 2; }

# ssh_ok DESC CMD... — returns 0 if CMD succeeded on router, 1 if it failed,
# dies if the connection itself dropped (rc=255).
ssh_ok() {
  _desc="$1"; shift
  ssh $SSH_OPTS "root@${HOST}" "$@" >/dev/null 2>&1
  _rc=$?
  [ "$_rc" -eq 255 ] && die "ssh comms failure (rc=255) during: $_desc"
  return "$_rc"
}

# ssh_out VAR DESC CMD... — captures stdout into VAR; dies on rc=255.
ssh_out() {
  _var="$1"; _desc="$2"; shift 2
  _val=$(ssh $SSH_OPTS "root@${HOST}" "$@" 2>/dev/null)
  _rc=$?
  [ "$_rc" -eq 255 ] && die "ssh comms failure (rc=255) during: $_desc"
  eval "$_var=\"\$_val\""
}

# ucode_syntax_check — parse every shipped ucode file with the interpreter on
# the target. This is the REAL grammar check (brace counting is not). ucode
# supports `-p` (parse only, no execution). If the flag differs on the target,
# adjust here; the principle is: the interpreter accepts the file.
ucode_syntax_check() {
  log "ucode syntax check (interpreter on target)"
  for f in /usr/libexec/zapret2-manager/constants.uc \
           /usr/libexec/zapret2-manager/apply.uc \
           /usr/libexec/zapret2-manager/qlen.uc \
           /usr/libexec/zapret2-manager/status.uc \
           /usr/libexec/zapret2-manager/service.uc \
           /usr/libexec/zapret2-manager/watchdog.uc \
           /usr/share/rpcd/ucode/zapret2-manager.uc; do
    ssh_ok "parse $f" test -f "$f" || { bad "missing $f"; continue; }
    # `ucode -p FILE` parses and exits 0 on success. Redirect stderr to spot
    # the parse error if any.
    ssh_ok "ucode -p $f" "ucode -p '$f' >/dev/null 2>&1" \
      && ok "parse OK: $f" || bad "parse FAIL: $f (ucode -p)"
  done
}

want() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (got '$1' want '$2')"; }
want_nz() { [ -n "$1" ] && ok "$2" || bad "$2 (empty)"; }
want_contains() { printf '%s' "$1" | grep -F -- "$2" >/dev/null && ok "$3" || bad "$3 (missing '$2')"; }

# ---- branch 00: repo skeleton (local checks) ---------------------------------
gate_00() {
  log "gate 00 — repo skeleton (local)"
  cd "$(dirname "$0")/.." || die "cannot cd to repo root"
  for f in README.md LICENSE .gitignore docs/architecture.md docs/upstream-mapping.md tools/deploy.sh tools/smoke.sh; do
    [ -f "$f" ] && ok "present: $f" || bad "missing: $f"
  done
  grep -F -- "MIT License" LICENSE >/dev/null && ok "LICENSE is MIT" || bad "LICENSE not MIT"
  grep -F -- "edwardgushchin/luci-app-zapret2" README.md >/dev/null && ok "MIT baseline attributed" || bad "MIT baseline not attributed"
  grep -F -- "RevolutionTR/keenetic-zapret2-manager" README.md >/dev/null && ok "GPL-3 ideas attributed" || bad "GPL-3 ideas not attributed"
}

# ---- branch 01: package skeleton ---------------------------------------------
gate_01() {
  log "gate 01 — package skeleton"
  ssh_ok "apk present" command -v apk || { bad "no apk on router"; return; }
  for p in zapret2-manager luci-app-zapret2-manager; do
    ssh_ok "apk info $p" apk info "$p" && ok "$p installed" || bad "$p not installed"
  done
  # Menu + ACL shipped
  ssh_ok "menu entry" test -f /usr/share/luci/menu.d/luci-app-zapret2-manager.json \
    && ok "menu entry present" || bad "menu entry missing"
  ssh_ok "acl file" test -f /usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
    && ok "acl present" || bad "acl missing"
  # Overview view file present (path per architecture §9; [VERIFY] on target)
  ssh_ok "overview view" "test -f /www/luci-static/resources/view/zapret2-manager/overview.js" \
    && ok "overview.js present" || bad "overview.js missing"
  # Postinst cleared caches and reloaded daemons: caches must be gone/regenerable.
  ssh_ok "page reachable" "uclient-fetch -q -O /dev/null 'http://127.0.0.1/cgi-bin/luci/admin/services/zapret2-manager' 2>/dev/null" \
    && ok "LuCI admin page reachable" || bad "LuCI admin page unreachable"
}

# ---- branch 02: status.json + ubus -------------------------------------------
gate_02() {
  log "gate 02 — status.json + ubus status"
  ucode_syntax_check
  # status.json exists and is valid JSON with the three levels
  ssh_ok "status.json exists" test -f /tmp/zapret2-manager/status.json \
    || { bad "status.json missing"; return; }
  ssh_out j "read status.json" cat /tmp/zapret2-manager/status.json
  want_contains "$j" '"runtime"' "status has RUNTIME level"
  want_contains "$j" '"applied"' "status has APPLIED level"
  want_contains "$j" '"draft"'   "status has DRAFT level"
  # third liveness signal: queues block (queue 300)
  want_contains "$j" '"queues"' "status has queues block"
  want_contains "$j" '"queue_total"' "queues block has queue_total (field 3)"
  want_contains "$j" '"queue_dropped"' "queues block has queue_dropped (field 6)"
  want_contains "$j" '"registered"' "queues block has registered flag"
  # row is matched by queue number, not row order: if another queue exists, the
  # parser must still return queue 300's values. Cross-check queue_total against
  # the raw proc file for queue 300 (field 3).
  ssh_out rawq "raw nfnetlink_queue" cat /proc/net/netfilter/nfnetlink_queue
  ssh_out jsq "status queue_total" "ubus call zapret2-manager status | jsonfilter -e '@.queues.queue_total' 2>/dev/null"
  # Find queue 300's field 3 in the raw file and compare. grep -F for '['? no
  # brackets here; awk by first column.
  rawtotal=$(printf '%s' "$rawq" | awk '$1==300{print $3; exit}')
  if [ -n "$rawtotal" ] && [ -n "$jsq" ] && [ "$rawtotal" = "$jsq" ]; then
    ok "queue_total matches /proc field 3 for queue 300 (row match by number)"
  else
    bad "queue_total ($jsq) != raw field 3 ($rawtotal) — wrong field or wrong row"
  fi
  # ubus status method works
  ssh_out ub "ubus call" ubus call zapret2-manager status
  want_contains "$ub" '"runtime"' "ubus status returns RUNTIME"
  # 3s cache: two rapid calls should be served from cache (same stamp)
  ssh_out t1 "cache stamp 1" "ubus call zapret2-manager status | jsonfilter -e '@.collected_at' 2>/dev/null || ubus call zapret2-manager status"
  ssh_out t2 "cache stamp 2" "ubus call zapret2-manager status | jsonfilter -e '@.collected_at' 2>/dev/null || ubus call zapret2-manager status"
  want "$t1" "$t2" "3s cache serves identical stamp on rapid calls"
}

# ---- branch 03: overview page ------------------------------------------------
gate_03() {
  log "gate 03 — overview page (read-only)"
  ssh_out js "read overview.js" cat /www/luci-static/resources/view/zapret2-manager/overview.js
  want_contains "$js" "runtime" "overview reads RUNTIME"
  want_contains "$js" "applied" "overview reads APPLIED"
  want_contains "$js" "qlen"    "overview shows qlen"
  # read-only at this step: no mutation handlers in overview.js
  printf '%s' "$js" | grep -F -- 'onclick' >/dev/null && \
    printf '%s' "$js" | grep -F -- 'save' >/dev/null \
    && bad "overview.js has mutation code at step 03" || ok "overview.js is read-only"
  # divergence warning + diff button present
  want_contains "$js" "diff" "overview has diff affordance for runtime/applied divergence"
}

# ---- branch 04: service control ----------------------------------------------
gate_04() {
  log "gate 04 — service control + paused flag"
  # ubus methods respond
  for m in start stop restart restart_daemons start_fw confirm_alive rollback; do
    ssh_ok "ubus $m responds" ubus call zapret2-manager "$m" || bad "ubus $m missing/failed"
  done
  # stop sets paused flag and stops nfqws2
  ssh_ok "stop" ubus call zapret2-manager stop || bad "stop failed"
  ssh_ok "paused flag set on stop" test -f /tmp/zapret2-manager/paused || bad "paused flag not set after stop"
  # while paused, a manual ubus start must clear the flag and raise nfqws2
  ssh_ok "start clears paused + raises" ubus call zapret2-manager start || bad "start failed"
  ssh_ok "paused flag cleared on start" test ! -f /tmp/zapret2-manager/paused || bad "paused flag not cleared after start"
  ssh_ok "nfqws2 raised after start" pgrep -x nfqws2 || bad "nfqws2 not running after start"
  # hotplug guard installed and paused-aware (grep -F: the path has no brackets,
  # but we keep -F discipline for the paused-flag literal)
  ssh_ok "hotplug guard installed" test -f /etc/hotplug.d/iface/90-zapret2-manager \
    && ok "guard present" || bad "hotplug guard missing"
  ssh_out g "guard paused check" "grep -F -- '/tmp/zapret2-manager/paused' /etc/hotplug.d/iface/90-zapret2-manager"
  want_nz "$g" "guard checks paused flag"
  # start_fw and reload_ifsets both delegate to /etc/init.d/zapret2 (never fw4,
  # never a full fw restart). start_fw installs rules; reload_ifsets re-reads
  # ifsets — two distinct ops.
  ssh_out sf "service.uc start_fw" "grep -F -- '/etc/init.d/zapret2 start_fw' /usr/libexec/zapret2-manager/service.uc"
  want_nz "$sf" "start_fw uses /etc/init.d/zapret2 start_fw"
  ssh_out ri "service.uc reload_ifsets" "grep -F -- '/etc/init.d/zapret2 reload_ifsets' /usr/libexec/zapret2-manager/service.uc"
  want_nz "$ri" "reload_ifsets uses /etc/init.d/zapret2 reload_ifsets"
  ssh_out nosf "service.uc no fw stop" "grep -F -- 'service firewall stop' /usr/libexec/zapret2-manager/service.uc; true"
  [ -z "$nosf" ] && ok "service.uc never calls 'service firewall stop'" || bad "service.uc calls 'service firewall stop'"
  # FORBIDDEN: no full firewall restart button in any shipped UI JS
  ssh_out alljs "scan UI for forbidden fw restart" "grep -rF -- 'service firewall stop' /www/luci-static/resources/view/zapret2-manager/ 2>/dev/null; true"
  [ -z "$alljs" ] && ok "no 'service firewall stop' in UI" || bad "UI references 'service firewall stop'"
}

# ---- pause_fw_effect: answers the REVIEW 1 open question on the live router --
# Does NFQWS2_ENABLE=0 stop only the daemons, or also prevent firewall rule
# installation? Enter pause, snapshot the zapret2 table via list_table, compare.
# If the table is gone after pause → NFQWS2_ENABLE=0 also stops fw rules →
# PAUSE_STOPS_FW can stay false. If the table is still present → NFQWS2_ENABLE=0
# stops only daemons → set PAUSE_STOPS_FW=true so pause entry calls stop_fw.
# This is informational; it prints the answer and does not pass/fail the gate.
pause_fw_effect() {
  log "pause_fw_effect — does NFQWS2_ENABLE=0 also stop fw rules?"
  ssh_ok "ensure running before pause" ubus call zapret2-manager start || true
  sleep 1
  ssh_out before "table before pause" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
  ssh_ok "enter pause" ubus call zapret2-manager stop || true
  sleep 2
  ssh_out after "table after pause" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
  ssh_ok "resume" ubus call zapret2-manager start || true
  if [ -z "$after" ] || [ "$after" -eq 0 ]; then
    log "ANSWER: NFQWS2_ENABLE=0 also clears the zapret2 table → PAUSE_STOPS_FW=false is correct."
  else
    log "ANSWER: NFQWS2_ENABLE=0 leaves the zapret2 table present (rows before=$before after=$after) → set PAUSE_STOPS_FW=true in constants.uc so pause calls stop_fw."
  fi
}

# ---- branch 05: passthrough --------------------------------------------------
gate_05() {
  log "gate 05 — passthrough toggle"
  ssh_ok "passthrough on"  ubus call zapret2-manager passthrough '{"enabled":true}'  || bad "passthrough on failed"
  ssh_out pt "passthrough state" ubus call zapret2-manager status
  want_contains "$pt" '"passthrough"' "status reports passthrough"
  # in passthrough, nfqws2 running + rules present but no fake-send flag
  ssh_ok "nfqws2 still running in passthrough" pgrep -x nfqws2 || bad "nfqws2 down in passthrough"
  ssh_ok "passthrough off" ubus call zapret2-manager passthrough '{"enabled":false}' || bad "passthrough off failed"
}

# ---- branch 06: watchdog -----------------------------------------------------
gate_06() {
  log "gate 06 — watchdog daemon"
  ssh_ok "init enabled" /etc/init.d/zapret2-manager enabled || bad "watchdog not enabled"
  ssh_ok "start watchdog" /etc/init.d/zapret2-manager start || bad "watchdog start failed"
  sleep 2
  ssh_ok "watchdog running" pgrep -f "zapret2-manager.*watch" && ok "watchdog process alive" || bad "watchdog process absent"
  ssh_ok "events log exists" test -f /tmp/zapret2-manager/events.ndjson || { bad "events.ndjson missing"; return; }
  # events carry a source field from the allowed set
  ssh_out ev "last event" "tail -1 /tmp/zapret2-manager/events.ndjson"
  want_contains "$ev" '"source"' "events carry source field"
  # paused flag skips the whole cycle: set paused, then force one cycle via the
  # init's 'check' extra-command; while paused the watchdog must write no events.
  ssh_ok "set paused" touch /tmp/zapret2-manager/paused
  ssh_out before "events size" "wc -l < /tmp/zapret2-manager/events.ndjson"
  ssh_ok "force cycle" "/etc/init.d/zapret2-manager check 2>/dev/null || true"
  ssh_out after "events size after" "wc -l < /tmp/zapret2-manager/events.ndjson"
  [ "$before" = "$after" ] && ok "paused: watchdog cycle skipped (no new events)" || bad "paused: watchdog wrote events"
  # while paused, the watchdog init's start must not raise nfqws2 (it never does
  # — it starts only the watchdog — but assert it explicitly).
  ssh_ok "init start no-op while paused" "/etc/init.d/zapret2-manager start || true"
  ssh_ok "nfqws2 not raised by init while paused" "! pgrep -x nfqws2 >/dev/null" && ok "paused holds: init did not raise nfqws2" || bad "paused violated: init raised nfqws2"
  ssh_ok "clear paused" rm -f /tmp/zapret2-manager/paused
  # log rotation helper present (autohostlist log >1MB → last 500 lines)
  ssh_ok "rotation helper exists" "test -x /usr/libexec/zapret2-manager/log-rotate.sh" \
    && ok "log-rotate helper present" || bad "log-rotate helper missing"
}

# ---- autostart: DESTRUCTIVE real-reboot gate ---------------------------------
gate_autostart() {
  log "gate autostart — REAL REBOOT (destructive)"
  printf '[smoke] This reboots %s. Continue? [y/N] ' "$HOST"
  read -r ans
  [ "$ans" = "y" ] || { log "aborted"; exit 0; }
  # enable the watchdog/init so it should start on boot
  ssh_ok "enable init" /etc/init.d/zapret2-manager enable || die "cannot enable init"
  # send reboot; ssh will drop — that is expected, NOT a 255-style failure here
  ssh $SSH_OPTS "root@${HOST}" reboot >/dev/null 2>&1
  _rc=$?
  # rc=255 after reboot is the connection dying mid-call — expected. Do not die.
  log "reboot sent (ssh rc=$_rc, drop expected). Waiting for router to come back..."
  i=0
  while [ "$i" -lt 60 ]; do
    sleep 5; i=$((i+1))
    if ssh $SSH_OPTS "root@${HOST}" true >/dev/null 2>&1; then
      _rc=$?
      [ "$_rc" -eq 255 ] && { log "still down (rc=255)"; continue; }
      log "router back after ~$((i*5))s"
      break
    fi
  done
  [ "$i" -ge 60 ] && die "router did not come back in 300s"
  # NOW verify the service actually started on boot (the real test)
  if ssh_ok "post-boot nfqws2" pgrep -x nfqws2; then
    ok "nfqws2 auto-started after real reboot"
  else
    bad "nfqws2 NOT running after real reboot — autostart broken (enable≠start)"
  fi
  if ssh_ok "post-boot watchdog" pgrep -f "zapret2-manager.*watch"; then
    ok "watchdog auto-started after real reboot"
  else
    bad "watchdog NOT running after real reboot"
  fi
}

# ---- dispatch ----------------------------------------------------------------
SELECTION="${1:-all}"
case "$SELECTION" in
  all) for n in 00 01 02 03 04 05 06; do "gate_$n" 2>/dev/null || true; done ;;
  00|01|02|03|04|05|06) "gate_$SELECTION" ;;
  autostart) gate_autostart ;;
  pause_fw_effect) pause_fw_effect ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  *) die "unknown gate: $SELECTION (try: all, 00-06, autostart, pause_fw_effect)" ;;
esac

log "result: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && { log "ALL GATES GREEN"; exit 0; } || { log "GATES FAILED"; exit 1; }
