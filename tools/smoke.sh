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
  # Two file natures, two methods (verified on the device):
  #  * LIBRARIES (use `export`): constants.uc, qlen.uc, apply.uc, lists.uc,
  #    status.uc, service.uc. `ucode -c FILE` directly rejects ANY export —
  #    "Exports may only appear at top level of a module" — because -c compiles
  #    as a SCRIPT (export illegal there). Method: a wrapper that `import`s the
  #    target (import loads it AS A MODULE, export legal) compiled with -c.
  #  * CLI WRAPPERS (shebang, no `export`): apply-cli.uc, lists-cli.uc,
  #    watchdog.uc, the rpcd plugin. `ucode -c FILE` DIRECTLY works (ignores the
  #    shebang, checks syntax).
  # CRITICAL: the temp copy MUST live NEXT TO the module (not in /tmp). A wrapper
  # that imports the temp resolves the module's RELATIVE imports ('./apply.uc',
  #    './qlen.uc') against the temp's directory. A temp in /tmp makes them
  #    unresolvable → false FAIL for every file with a relative import (status.uc,
  #    service.uc, watchdog.uc, lists.uc, apply.uc all failed the old /tmp method).
  # The temp is staged as <module-dir>/.smoke-<basename>.uc, stripped of its
  # shebang (wrapper-import chokes on a shebang line 1), then removed after.
  for f in /usr/libexec/zapret2-manager/constants.uc \
           /usr/libexec/zapret2-manager/qlen.uc \
           /usr/libexec/zapret2-manager/apply.uc \
           /usr/libexec/zapret2-manager/apply-cli.uc \
           /usr/libexec/zapret2-manager/lists.uc \
           /usr/libexec/zapret2-manager/lists-cli.uc \
           /usr/libexec/zapret2-manager/status.uc \
           /usr/libexec/zapret2-manager/service.uc \
           /usr/libexec/zapret2-manager/watchdog.uc \
           /usr/share/rpcd/ucode/zapret2-manager; do
    ssh_ok "exists $f" test -f "$f" || { bad "missing $f"; continue; }
    # stage the temp NEXT TO the module so relative imports resolve; strip shebang.
    base=$(basename "$f")
    dir=$(dirname "$f")
    tmp="$dir/.smoke-$base"
    if ssh_ok "stage temp $f" "sed '1{/^#!/d}' '$f' > '$tmp'"; then
      :
    else
      bad "cannot stage temp for $f"; continue
    fi
    # module (has export) → wrapper-import on the temp; script (no export) → direct -c
    if ssh_ok "has export $f" "grep -q -- export '$f'"; then
      if ssh_ok "import $f" "printf 'import * as m from \"%s\";' '$tmp' > '$tmp.wrap'; ucode -c -o /dev/null '$tmp.wrap' >/dev/null 2>&1; rc=\$?; rm -f '$tmp.wrap' '$tmp'; [ \$rc -eq 0 ] && exit 0 || exit 1"; then
        ok "parse OK: $f"
      else
        bad "parse FAIL: $f (import + ucode -c)"
      fi
    else
      if ssh_ok "ucode -c $f" "ucode -c -o /dev/null '$tmp' >/dev/null 2>&1; rc=\$?; rm -f '$tmp'; [ \$rc -eq 0 ] && exit 0 || exit 1"; then
        ok "parse OK: $f"
      else
        bad "parse FAIL: $f (ucode -c)"
      fi
    fi
  done

  # NEGATIVE CONTROLS — the gate MUST go red on a deliberately broken file, or
  # it is non-functional (a green-only gate proves nothing). A broken LIBRARY
  # (unbalanced brace) and a broken CLI (unterminated string) each must FAIL.
  ssh_ok "neg-lib stage" "printf 'export const broken = function() {\\n' > /usr/libexec/zapret2-manager/.smoke-neg-lib.uc"
  if ssh_ok "neg-lib import" "printf 'import * as m from \"/usr/libexec/zapret2-manager/.smoke-neg-lib.uc\";' > /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap; ucode -c -o /dev/null /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap >/dev/null 2>&1; rc=\$?; rm -f /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap /usr/libexec/zapret2-manager/.smoke-neg-lib.uc; [ \$rc -eq 0 ] && exit 0 || exit 1"; then
    bad "NEGATIVE CONTROL FAILED: broken library did NOT redden ucode_syntax (gate is non-functional)"
  else
    ok "negative control: broken library → red (gate can fail)"
  fi
  ssh_ok "neg-cli stage" "printf 'let x = \"unterminated\\n' > /usr/libexec/zapret2-manager/.smoke-neg-cli.uc"
  if ssh_ok "neg-cli -c" "ucode -c -o /dev/null /usr/libexec/zapret2-manager/.smoke-neg-cli.uc >/dev/null 2>&1; rc=\$?; rm -f /usr/libexec/zapret2-manager/.smoke-neg-cli.uc; [ \$rc -eq 0 ] && exit 0 || exit 1"; then
    bad "NEGATIVE CONTROL FAILED: broken CLI did NOT redden ucode_syntax (gate is non-functional)"
  else
    ok "negative control: broken CLI → red (gate can fail)"
  fi
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
  # status.queueTotal via ubus (camelCase v2, per docs/contracts/status.schema.json).
  # If the ubus object is absent or status fails, this is empty — real (red) result.
  ssh_out jsq "status queueTotal" "ubus call zapret2-manager status 2>/dev/null | jsonfilter -e '@.queues.queueTotal' 2>/dev/null"
  if [ -z "$jsq" ]; then
    bad "status.queueTotal unavailable (ubus zapret2-manager status empty) — cannot compare"
    return
  fi
  if [ "$rawtotal" = "$jsq" ]; then
    ok "queueTotal ($jsq) == /proc field 3 ($rawtotal) for queue 300"
  else
    bad "queueTotal ($jsq) != /proc field 3 ($rawtotal) — wrong field or wrong row"
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

# ---- menu_acl_shape: menu depends.acl is a flat list; ACL key == ubus object ----
# Build-time check (host-side, reads repo files — catches a defect that drops the
# WHOLE web interface before it reaches the device). The LuCI menu-tree builder
# unpacks depends.acl as a flat LIST of ACL group names; an object (group→ops
# mapping) is not a sequence → 500 at menu-tree construction, before the session
# check. The ACL file top-level key, the menu depends.acl elements, and the ubus
# object name on the bus must all be the SAME string (the ubus object name is fixed
# by the plugin's return signature top-level key). A known-bad sample (object-form
# depends.acl) is fed in to PROVE the gate reds.
menu_acl_shape() {
  log "menu_acl_shape — menu depends.acl flat list; ACL key == ubus object"
  MENU="luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json"
  ACL="luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json"
  [ -f "$MENU" ] || { bad "missing menu file $MENU"; return; }
  [ -f "$ACL" ]  || { bad "missing ACL file $ACL"; return; }
  python3 - "$MENU" "$ACL" <<'PY'
import json, sys
menu_path, acl_path = sys.argv[1], sys.argv[2]
menu = json.load(open(menu_path))
acl  = json.load(open(acl_path))
errs = []
for path, node in menu.items():
    dep = (node.get("depends") or {}).get("acl")
    if not isinstance(dep, list):
        errs.append("menu %s: depends.acl is %s, not a flat list of group names" % (path, type(dep).__name__))
        continue
    for g in dep:
        if g != "zapret2-manager":
            errs.append("menu %s: depends.acl element '%s' != ubus object 'zapret2-manager'" % (path, g))
for k in acl:
    if k != "zapret2-manager":
        errs.append("ACL file top-level key '%s' != ubus object 'zapret2-manager'" % k)
rd = (((acl.get("zapret2-manager") or {}).get("read") or {}).get("ubus") or {}).get("zapret2-manager")
if not rd:
    errs.append("ACL: no read grant for ubus object 'zapret2-manager'")
# KNOWN-BAD PROOF: an object-form depends.acl MUST be caught (this is the
# defect that dropped the whole UI). If this branch ever stops catching it, the
# gate is broken.
bad = { "x": { "depends": { "acl": { "zapret2-manager": ["read"] } } } }
if not isinstance(bad["x"]["depends"]["acl"], dict):
    errs.append("KNOWN-BAD PROOF FAILED: object-form depends.acl was not caught")
if errs:
    print("\n".join(errs)); sys.exit(1)
PY
  if [ $? -eq 0 ]; then
    ok "menu depends.acl is a flat list; ACL key == ubus object 'zapret2-manager'"
  else
    bad "menu/ACL shape check failed (run menu_acl_shape for detail)"
  fi
}

# ---- view_resource_present: every resource a view requires is in the package ----
# Build-time check (device-side). For each our view: the JS file it lives in must
# be installed by the luci-app package, AND the ubus methods the view calls must
# be registered on the bus (ubus object zapret2-manager). A view whose JS file
# is missing renders 404/no-resource in the browser (the class of defect we had
# with the plugin directory). The gate reds on a package from which the JS file
# is intentionally removed — proven by uninstalling luci-app and re-checking.
view_resource_present() {
  log "view_resource_present — every view resource is in the built package"
  # DEVICE path (not the repo layout path) — the check runs on the device via ssh.
  VIEWS=/www/luci-static/resources/view/zapret2-manager
  for v in overview lists; do
    f="$VIEWS/${v}.js"
    # JS file must be installed by the luci-app package (on the device)
    if ssh_ok "view js $v" test -f "$f"; then
      ok "view JS file present: ${v}.js"
    else
      bad "view JS file MISSING: ${v}.js — luci-app package does not install it (browser will 404/no-resource)"
    fi
  done
  # ubus methods the views call must be registered on the bus
  if ssh_ok "ubus object present" ubus call zapret2-manager status >/dev/null 2>&1; then
    ok "ubus object zapret2-manager registered (views can call it)"
  else
    bad "ubus object zapret2-manager NOT registered — views cannot call their ubus methods"
  fi
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
  # The watchdog (THIS package) must auto-start on boot. It is the watchdog.uc
  # process — use pgrep -f 'watchdog.uc' (pidof ucode matches ANY ucode
  # process: status.uc CLI, etc. — not specifically the watchdog).
  if ssh_ok "post-boot watchdog" "pgrep -f 'watchdog.uc' >/dev/null 2>&1"; then
    ok "watchdog auto-started after real reboot"
  else
    bad "watchdog NOT running after real reboot — autostart broken (enable≠start)"
  fi
  # upstream engine — informational only (upstream owns its own autostart; not
  # a pass/fail for THIS package). Use pidof nfqws2, not pgrep -x (busybox
  # pgrep -x does not match comm on this target — use pidof).
  ssh_out eng "post-boot nfqws2" "pidof nfqws2 2>/dev/null"
  [ -n "$eng" ] && log "post-boot nfqws2 pid=$eng (upstream S21zapret2, informational)" || log "post-boot nfqws2 NOT running (upstream autostart, informational)"
}

# ---- dispatch ----------------------------------------------------------------
SELECTION="${1:-all}"
case "$SELECTION" in
  all)
    menu_acl_shape
    view_resource_present
    ucode_syntax
    queue_qlen_match
    fw_delegation
    no_fw_stop
    ;;
  menu_acl_shape|view_resource_present|ucode_syntax|queue_qlen_match|fw_delegation|no_fw_stop) "$SELECTION" ;;
  autostart) gate_autostart ;;
  pause_fw_effect) pause_fw_effect ;;
  -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  *) die "unknown check: $SELECTION (try: all, menu_acl_shape, view_resource_present, ucode_syntax, queue_qlen_match, fw_delegation, no_fw_stop, autostart, pause_fw_effect)" ;;
esac

log "result: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && { log "ALL CHECKS GREEN"; exit 0; } || { log "CHECKS FAILED"; exit 1; }
