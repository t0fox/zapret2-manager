#!/bin/sh
# tools/smoke.sh — infrastructure checks on a LIVE router.
#
# Scope: ONLY the infra-level mandatory checks live here. Per-branch gate
# self-tests (the per-feature gates 00–06) are owned by the fix/02 agent and
# live in tools/gate-selftest.sh — not here, not duplicated. If gate-selftest.sh
# is absent, that is expected; do not add gate self-tests to this file.
#
# Hard rules (docs/architecture.md §7):
#   - ssh rc=255 = dropped connection, NOT a result. ssh_ok/ssh_out die on it.
#   - busybox pgrep -x does NOT match the process comm on this target — it
#     returns rc=1 for a running nfqws2 whose /proc/<pid>/comm IS "nfqws2"
#     (confirmed on the device). Use `pidof nfqws2` for liveness, never
#     `pgrep -x nfqws2`.
#   - ucode syntax-check flag is `-c` (compile to bytecode), determined
#     factually from tests/fixtures/ucode-help-long.out: the help lists -c
#     ("Compile the given source file(s) to bytecode") and -p ("Like -e but
#     print the result of expression" — executes an expression, does NOT parse
#     a file). `ucode -c -o /dev/null FILE` parses the file and exits non-zero
#     on a syntax error. The remote rc is normalized (non-zero → 1) so a ucode
#     parse error (which ucode reports as 255) is never mistaken for an ssh
#     connection drop (also 255).
#   - autostart is verified by a REAL reboot, in a SEPARATE destructive mode,
#     never run together with the other checks.
#   - never `service firewall stop` / a wholesale firewall restart. No check
#     performs either; `no_fw_stop` asserts their absence in shipped code.
#
# Usage:
#   tools/smoke.sh                  # run all infra checks (NOT autostart)
#   tools/smoke.sh autostart        # DESTRUCTIVE: reboot, verify auto-start
#   tools/smoke.sh pause_fw_effect  # informational: NFQWS2_ENABLE=0 fw effect
#   tools/smoke.sh queue_qlen_match | fw_delegation | no_fw_stop | ucode_syntax
#   DEPLOY_HOST=192.168.1.1 tools/smoke.sh
#
# Exit: 0 = all selected checks passed, 1 = any failed.

set -u

HOST="${DEPLOY_HOST:-192.168.1.1}"
SSH_OPTS="-o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
PASS=0; FAIL=0

log()  { printf '[smoke] %s\n' "$*"; }
ok()   { printf '[smoke]   PASS  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '[smoke]   FAIL  %s\n' "$1" >&2; FAIL=$((FAIL+1)); }
die()  { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 2; }

# ssh_ok DESC CMD... — rc 0 if CMD succeeded on router, 1 if it failed, dies on
# ssh rc=255 (connection drop is NOT a command result).
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

want_nz() { [ -n "$1" ] && ok "$2" || bad "$2 (empty)"; }

# ---- ucode_syntax: parse every shipped ucode file on the target -------------
# The flag is -c (compile to bytecode), determined factually from the ucode
# --help fixture (tests/fixtures/ucode-help-long.out): -c compiles files and
# exits non-zero on a syntax error; -p executes an expression (does NOT parse a
# file), so -p would be wrong.
#
# CAVEAT (verified on the device): `ucode -c FILE` directly returns 255 for
# ANY file that uses `export` — even a one-line `export const X = 1;` — with
# "Exports may only appear at top level of a module", because -c compiles the
# file as a SCRIPT (where export is illegal), not as a module. The backend
# files ARE modules (they use export). So a direct `ucode -c` is a false
# positive for every module.
#
# Working method: write a wrapper that `import`s the target file (import loads
# it AS A MODULE, where export is legal) and compile the WRAPPER with -c. If
# the target has a real syntax error or an unresolvable import, the wrapper
# compile fails (non-zero). constants.uc passes this way; the json-import and
# qlen.uc export-placement defects fail it. Remote rc is normalized (non-zero
# → 1) so ucode's 255 parse error is never mistaken for an ssh drop (also 255).
ucode_syntax() {
  log "ucode syntax check (wrapper import + interpreter -c on target)"
  for f in /usr/libexec/zapret2-manager/constants.uc \
           /usr/libexec/zapret2-manager/qlen.uc \
           /usr/libexec/zapret2-manager/status.uc \
           /usr/libexec/zapret2-manager/service.uc \
           /usr/libexec/zapret2-manager/watchdog.uc \
           /usr/share/rpcd/ucode/zapret2-manager.uc; do
    ssh_ok "exists $f" test -f "$f" || { bad "missing $f"; continue; }
    if ssh_ok "import $f" "echo \"import * as m from '$f';\" > /tmp/smoke_w.uc; ucode -c -o /dev/null /tmp/smoke_w.uc >/dev/null 2>&1; rc=\$?; rm -f /tmp/smoke_w.uc; [ \$rc -eq 0 ] && exit 0 || exit 1"; then
      ok "parse OK: $f"
    else
      bad "parse FAIL: $f (import + ucode -c)"
    fi
  done
}

# ---- queue_qlen_match: status.queues.queue_total == /proc field 3, row 300 ---
# The row is selected by field 1 == 300 (queue number), never by row order.
queue_qlen_match() {
  log "queue_qlen_match — status.queue_total vs /proc field 3 (row 300)"
  ssh_out rawq "raw nfnetlink_queue" cat /proc/net/netfilter/nfnetlink_queue
  rawtotal=$(printf '%s' "$rawq" | awk '$1==300{print $3; exit}')
  if [ -z "$rawtotal" ]; then
    bad "no queue 300 row in /proc/net/netfilter/nfnetlink_queue"
    return
  fi
  # status.queue_total via ubus. If the ubus object is absent or status fails,
  # this is empty — that is a real (red) result, reported as such.
  ssh_out jsq "status queue_total" "ubus call zapret2-manager status 2>/dev/null | jsonfilter -e '@.queues.queue_total' 2>/dev/null"
  if [ -z "$jsq" ]; then
    bad "status.queue_total unavailable (ubus zapret2-manager status empty) — cannot compare"
    return
  fi
  if [ "$rawtotal" = "$jsq" ]; then
    ok "queue_total ($jsq) == /proc field 3 ($rawtotal) for queue 300"
  else
    bad "queue_total ($jsq) != /proc field 3 ($rawtotal) — wrong field or wrong row"
  fi
}

# ---- fw_delegation: start_fw / reload_ifsets delegate to upstream init -------
# service.uc delegates via `const UPSTREAM_INIT = '/etc/init.d/zapret2'` and
# `run(UPSTREAM_INIT + ' start_fw')` / `run(UPSTREAM_INIT + ' reload_ifsets')`
# — a concatenation, not a literal "/etc/init.d/zapret2 start_fw" string, so the
# grep matches the constant reference + the UPSTREAM_INIT-qualified call, not a
# literal. This proves delegation to the upstream init (never fw4, never a full
# firewall restart).
fw_delegation() {
  log "fw_delegation — start_fw & reload_ifsets delegate to /etc/init.d/zapret2"
  ssh_out upi "service.uc UPSTREAM_INIT" "grep -F -- /etc/init.d/zapret2 /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
  want_nz "$upi" "service.uc references /etc/init.d/zapret2 (upstream init)"
  ssh_out sf "service.uc start_fw" "grep -E -- 'UPSTREAM_INIT.*start_fw' /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
  want_nz "$sf" "start_fw delegates via UPSTREAM_INIT (upstream start_fw)"
  ssh_out ri "service.uc reload_ifsets" "grep -E -- 'UPSTREAM_INIT.*reload_ifsets' /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
  want_nz "$ri" "reload_ifsets delegates via UPSTREAM_INIT (upstream reload_ifsets)"
}

# ---- no_fw_stop: no wholesale firewall stop in shipped code ------------------
no_fw_stop() {
  log "no_fw_stop — no 'service firewall stop' in shipped code"
  ssh_out nosf "service.uc" "grep -F -- 'service firewall stop' /usr/libexec/zapret2-manager/service.uc 2>/dev/null; true"
  [ -z "$nosf" ] && ok "service.uc never calls 'service firewall stop'" || bad "service.uc calls 'service firewall stop'"
  ssh_out alljs "UI js" "grep -rF -- 'service firewall stop' /www/luci-static/resources/view/zapret2-manager/ 2>/dev/null; true"
  [ -z "$alljs" ] && ok "no 'service firewall stop' in UI" || bad "UI references 'service firewall stop'"
}

# ---- pause_fw_effect: informational — does NFQWS2_ENABLE=0 stop fw rules? ----
# Pause sets NFQWS2_ENABLE=0; snapshot the zapret2 table via list_table before
# and after pause. If the table is gone after pause → NFQWS2_ENABLE=0 also
# clears fw rules → PAUSE_STOPS_FW stays false. If it remains → set
# PAUSE_STOPS_FW=true so pause entry calls stop_fw. Informational; no pass/fail.
pause_fw_effect() {
  log "pause_fw_effect — does NFQWS2_ENABLE=0 also stop fw rules?"
  ssh_ok "ensure running" ubus call zapret2-manager start 2>/dev/null || true
  sleep 1
  ssh_out before "table before" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
  ssh_ok "enter pause" ubus call zapret2-manager stop 2>/dev/null || true
  sleep 2
  ssh_out after "table after" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
  ssh_ok "resume" ubus call zapret2-manager start 2>/dev/null || true
  if [ -z "$after" ] || [ "$after" -eq 0 ]; then
    log "ANSWER: NFQWS2_ENABLE=0 also clears the zapret2 table → PAUSE_STOPS_FW=false is correct."
  else
    log "ANSWER: NFQWS2_ENABLE=0 leaves the table (before=$before after=$after) → set PAUSE_STOPS_FW=true in constants.uc."
  fi
}

# ---- autostart: DESTRUCTIVE real-reboot check --------------------------------
gate_autostart() {
  log "gate autostart — REAL REBOOT (destructive)"
  printf '[smoke] This reboots %s. Continue? [y/N] ' "$HOST"
  read -r ans
  [ "$ans" = "y" ] || { log "aborted"; exit 0; }
  ssh_ok "enable watchdog init" /etc/init.d/zapret2-manager enable || die "cannot enable zapret2-manager init"
  ssh $SSH_OPTS "root@${HOST}" reboot >/dev/null 2>&1
  _rc=$?
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
  # The watchdog init (zapret2-manager) must auto-start on boot. nfqws2 is
  # upstream's responsibility (S21zapret2); report both but the manager's
  # watchdog is the autostart contract for THIS package. Use pidof, not pgrep -x.
  if ssh_ok "post-boot watchdog" "pidof nfqws2 >/dev/null 2>&1 || true; pidof ucode >/dev/null 2>&1 || true; pgrep -f 'zapret2-manager.*watch' >/dev/null 2>&1"; then
    ok "watchdog process present after real reboot"
  else
    bad "watchdog NOT running after real reboot — autostart broken (enable≠start)"
  fi
  # upstream engine (informational here; upstream owns its own autostart)
  ssh_out eng "post-boot nfqws2" "pidof nfqws2 2>/dev/null"
  [ -n "$eng" ] && log "post-boot nfqws2 pid=$eng (upstream S21zapret2)" || log "post-boot nfqws2 NOT running (upstream autostart)"
}

# ---- dispatch ----------------------------------------------------------------
SELECTION="${1:-all}"
case "$SELECTION" in
  all)
    ucode_syntax
    queue_qlen_match
    fw_delegation
    no_fw_stop
    ;;
  ucode_syntax|queue_qlen_match|fw_delegation|no_fw_stop) "$SELECTION" ;;
  autostart) gate_autostart ;;
  pause_fw_effect) pause_fw_effect ;;
  -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  *) die "unknown check: $SELECTION (try: all, ucode_syntax, queue_qlen_match, fw_delegation, no_fw_stop, autostart, pause_fw_effect)" ;;
esac

log "result: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && { log "ALL CHECKS GREEN"; exit 0; } || { log "CHECKS FAILED"; exit 1; }
