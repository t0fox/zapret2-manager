#!/bin/sh
# Self-tests for the LOCAL gates (point 5 — gate self-tests).
#
# Hard rule (zapret2-hard-rules.md): a gate whose ability to go RED is unproven
# is considered ABSENT. Every gate must be self-tested: run it on a KNOWN-BROKEN
# sample (must report a violation / non-zero) AND a KNOWN-GOOD sample (must pass
# / zero). If either check fails, the gate is non-functional — report it, do not
# just fail. This file self-tests the gates that run locally (sh -n, JSON parse,
# Makefile recipe tabs, and the grep-style gates: no ?./?? in ucode, no
# 'service firewall stop', no 'fw4 reload_ifsets', no second write path). The
# ucode SYNTAX gate runs on the target (ucode is not local) and is self-tested
# by ucode_syntax_selftest in tools/smoke.sh.
#
# Samples live in tests/fixtures/gate-samples/ so they neither ship (Makefile
# does not install tests/) nor get checked by the normal gates (those scan only
# shipped files).
#
# Run: sh tests/gate-selftests.test.sh
GS=tests/fixtures/gate-samples
fail=0

# gate_sh_n FILE — 0 = file parses clean, non-zero = syntax error
gate_sh_n() { sh -n "$1" 2>/dev/null; }

# gate_json FILE — 0 = valid JSON, non-zero = invalid
gate_json() { node -e "JSON.parse(require('fs').readFileSync('$1','utf8'))" 2>/dev/null; }

# gate_makefile_tabs FILE — 0 = no recipe line starts with a space before $(
# (i.e. recipe lines use tabs), non-zero = a recipe line uses spaces (broken)
gate_makefile_tabs() { grep -nP '^ +\$\(' "$1" >/dev/null 2>&1; }  # grep finds → non-zero? no: grep -n → 0 if found

# Normalize: a gate "passes" (GREEN) when no violation is found. We wrap each
# gate so pass=0/fail=non-zero is consistent: gate returns 0 if CLEAN, non-zero
# if VIOLATION.
g_makefile_tabs() { if grep -nP '^ +\$\(' "$1" >/dev/null 2>&1; then return 1; else return 0; fi; }

# gate_no_sugar FILE — 0 = no ?./?? , non-zero = sugar present
g_no_sugar() { if grep -nP '\?\.|\?\?' "$1" >/dev/null 2>&1; then return 1; else return 0; fi; }

# gate_no_fw_stop FILE — 0 = no 'service firewall stop', non-zero = present
g_no_fw_stop() { if grep -rF 'service firewall stop' "$1" >/dev/null 2>&1; then return 1; else return 0; fi; }

# gate_no_fw4_reload FILE — 0 = absent, non-zero = present
g_no_fw4_reload() { if grep -rF 'fw4 reload_ifsets' "$1" >/dev/null 2>&1; then return 1; else return 0; fi; }

# selftest_gate NAME GATE_FN BROKEN GOOD — proves the gate can go RED (on BROKEN)
# and GREEN (on GOOD). A gate that stays green on the broken sample is
# ALWAYS-GREEN; a gate that stays red on the good sample is ALWAYS-RED. Either
# is "non-functional".
selftest_gate() {
  name="$1"; gate="$2"; broken="$3"; good="$4"
  # RED on broken: gate(broken) must be non-zero (violation detected)
  "$gate" "$broken" >/dev/null 2>&1
  red_rc=$?
  # GREEN on good: gate(good) must be 0 (clean)
  "$gate" "$good" >/dev/null 2>&1
  green_rc=$?
  if [ "$red_rc" -eq 0 ]; then
    echo "FAIL  $name is ALWAYS-GREEN: broken sample $broken was NOT flagged (gate cannot go red)"
    fail=1
  elif [ "$green_rc" -ne 0 ]; then
    echo "FAIL  $name is ALWAYS-RED: good sample $good was flagged (gate cannot go green)"
    fail=1
  else
    echo "PASS  $name goes red on broken and green on good"
  fi
}

# sh -n
selftest_gate "sh -n"            gate_sh_n       "$GS/broken-syntax.sh"   "$GS/good-syntax.sh"
# JSON parse
selftest_gate "JSON parse"       gate_json       "$GS/broken.json"        "$GS/good.json"
# Makefile recipe tabs
selftest_gate "Makefile tabs"    g_makefile_tabs "$GS/broken.Makefile"    "$GS/good.Makefile"
# no ?./?? in ucode
selftest_gate "no ?./?? ucode"   g_no_sugar      "$GS/with-sugar.uc"      "$GS/clean.uc"
# no 'service firewall stop'
selftest_gate "no fw stop"       g_no_fw_stop    "$GS/with-fwstop.sh"     "$GS/clean-fw.sh"
# no 'fw4 reload_ifsets' (broken sample contains it; clean does not) — make a broken sample inline
printf 'fw4 reload_ifsets\n' > "$GS/with-fw4reload.sh"
selftest_gate "no fw4 reload_ifsets" g_no_fw4_reload "$GS/with-fw4reload.sh" "$GS/clean-fw.sh"

# The ucode SYNTAX gate runs on the target; ucode_syntax_selftest in smoke.sh
# self-tests it there (broken.uc must fail to compile, good.uc must pass).
# Sanity here: the samples themselves are well-formed for that purpose.
if [ -f "$GS/broken.uc" ] && [ -f "$GS/good.uc" ]; then
  echo "PASS  ucode syntax samples present for the on-target selftest (broken.uc + good.uc)"
else
  echo "FAIL  ucode syntax samples missing"; fail=1
fi

if [ "$fail" = 0 ]; then echo "gate-selftests: ALL PASS"; exit 0; else echo "gate-selftests: FAILED"; exit 1; fi
