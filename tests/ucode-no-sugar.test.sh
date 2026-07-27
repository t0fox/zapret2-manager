#!/bin/sh
# Self-test / gate for point 6: no optional access (?.) or null-merge (??) in
# shipped ucode, and no reliance on object-key enumeration or array slices.
#
# The ucode interpreter version on the target is unverified; a fall on
# unsupported syntax happens at plugin LOAD and looks like an empty LuCI page
# with no error. So the shipped ucode must not use ?. / ?? (optional chaining /
# nullish coalescing) — replace them with explicit key-existence + null checks.
# This continues the index-loop principle (array iterations are already index
# loops): the code must not depend on unconfirmed interpreter capabilities.
#
# Scans SHIPPED ucode only (zapret2-manager/files + luci-app.../files), NOT
# tests/fixtures (the gate-samples deliberately contain ?./?? to self-test the
# no-sugar gate — they do not ship).
#
# Run: sh tests/ucode-no-sugar.test.sh
fail=0

# 1. zero ?. and ?? in shipped ucode
n=$(grep -rnP '\?\.|\?\?' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then
  echo "PASS  no ?. / ?? in shipped ucode"
else
  echo "FAIL  $n occurrences of ?. / ?? in shipped ucode:"
  grep -rnP '\?\.|\?\?' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

# 2. zero object-key enumeration (for ... in) in shipped ucode — key-vs-value
# iteration order/semantics are not relied on. (Index loops over arrays are
# fine and are the established pattern.)
nforin=$(grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$nforin" -eq 0 ]; then
  echo "PASS  no for-in object key enumeration in shipped ucode"
else
  echo "FAIL  $nforin for-in loops in shipped ucode (rely on key enumeration):"
  grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

# 3. zero array-slice syntax (arr[a:b]) in shipped ucode — slices are an
# unconfirmed capability. Match a numeric subscript with a colon: arr[1:3],
# arr[1:], arr[:2]. Index access ([n]) is fine. ALLCAPS markers like
# [VERIFY:ROUTER] are not slices and are excluded by requiring a digit.
nslice=$(grep -rnP '\[\d+:\d*\]|\[\d*:\d+\]' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$nslice" -eq 0 ]; then
  echo "PASS  no array-slice syntax in shipped ucode"
else
  echo "FAIL  $nslice array slices in shipped ucode:"
  grep -rnP '\[\d+:\d*\]|\[\d*:\d+\]' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

# 4. all shipped ucode is bracket-balanced (cheap local sanity; the real syntax
# check is ucode -c on the target — see smoke.sh ucode_syntax_check, which is
# self-tested by ucode_syntax_selftest).
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  d=0; p=0; b=0
  while IFS= read -r ch; do
    case "$ch" in
      '{') d=$((d+1)) ;; '}') d=$((d-1)) ;;
      '(') p=$((p+1)) ;; ')') p=$((p-1)) ;;
      '[') b=$((b+1)) ;; ']') b=$((b-1)) ;;
    esac
  done < <(tr -cd '{}()\[\]' < "$f")
  if [ "$d" -ne 0 ] || [ "$p" -ne 0 ] || [ "$b" -ne 0 ]; then
    echo "FAIL  bracket imbalance in $f (brace=$d paren=$p bracket=$b)"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "PASS  shipped ucode brackets balanced (local sanity)"

if [ "$fail" = 0 ]; then echo "ucode-no-sugar: ALL PASS"; exit 0; else echo "ucode-no-sugar: FAILED"; exit 1; fi
