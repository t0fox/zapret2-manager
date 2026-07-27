#!/bin/sh
# tests/shipped-sh-syntax.test.sh — every shipped ash script must parse clean.
#
# `sh -n` is a real parse (the same shell family that runs the scripts on the
# router). The gate first proves it can go red/green on the gate-samples
# (a gate that cannot fail is considered absent — architecture §7), then
# checks every .sh shipped under zapret2-manager/files/.
#
# Run: sh tests/shipped-sh-syntax.test.sh
fail=0

# self-test: the checker must go red on broken and green on good
if sh -n tests/fixtures/gate-samples/broken-syntax.sh 2>/dev/null; then
  echo "FAIL  self-test: broken-syntax.sh parsed clean (checker cannot go red)"; fail=1
fi
if ! sh -n tests/fixtures/gate-samples/good-syntax.sh 2>/dev/null; then
  echo "FAIL  self-test: good-syntax.sh did not parse (checker cannot go green)"; fail=1
fi
[ "$fail" -eq 0 ] && echo "PASS  sh -n self-test (red on broken, green on good)"

for f in $(find zapret2-manager/files -name '*.sh' 2>/dev/null); do
  if sh -n "$f" 2>/dev/null; then
    echo "PASS  $f"
  else
    echo "FAIL  $f does not parse"; fail=1
  fi
done

if [ "$fail" = 0 ]; then echo "shipped-sh-syntax: ALL PASS"; exit 0; else echo "shipped-sh-syntax: FAILED"; exit 1; fi
