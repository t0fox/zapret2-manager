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

# 2. zero object-key enumeration (for ... in) in shipped ucode. Ucode's
# `for (... in array)` is value iteration and is the established array pattern;
# only explicit object-key sources are incompatible with the contract here.
nforin=$(grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+(keys\s*\(|Object\.)' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$nforin" -eq 0 ]; then
  echo "PASS  no for-in object key enumeration in shipped ucode"
else
  echo "FAIL  $nforin explicit object-key loops in shipped ucode:"
  grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+(keys\s*\(|Object\.)' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
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
# STRIP comments (// to end-of-line) and string literals ("..." and '...') BEFORE
# counting, so brackets inside comments/strings do not cause false imbalances
# (the real ucode -c parses the code, not the raw text).
# Counting is tr+wc per bracket TYPE, not a read-loop: `read` iterates LINES and
# the filtered bracket string has no newlines, so a read-loop sees one giant
# "line" that never matches a single-char case — the previous version of this
# gate was degenerate always-green (proven by probe: unbalanced input scored
# d=0). tr|wc counts bytes directly and dash-safe (process substitution is a
# bash-ism; /bin/sh is dash on dev machines and ash on target).
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! awk '
    {
      quote=""; escaped=0
      for (i=1; i<=length($0); i++) {
        ch=substr($0,i,1); nextch=substr($0,i+1,1)
        if (quote != "") { if (escaped) escaped=0; else if (ch=="\\") escaped=1; else if (ch==quote) quote=""; continue }
        if (ch=="/" && nextch=="/") break
        if (ch=="\"" || ch=="\047") { quote=ch; continue }
        if (ch=="{") brace++; else if (ch=="}") brace--
        else if (ch=="(") paren++; else if (ch==")") paren--
        else if (ch=="[") bracket++; else if (ch=="]") bracket--
      }
    }
    END { if (brace || paren || bracket) { printf "FAIL  bracket imbalance in %s (brace=%d paren=%d bracket=%d)\\n", FILENAME, brace, paren, bracket; exit 1 } }
  ' "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  shipped ucode brackets balanced (local sanity, comments/strings stripped)"

# 5. every `export const <name> = function(...) { ... }` block CLOSES with
# `};` — a block closed with a bare `}` parses as a function DECLARATION
# expression tail and the next statement then fails with "Unexpected token,
# expecting ';'" AT LOAD TIME on the router (this exact defect shipped in
# profiles-draft.uc and broke the whole ubus object overnight; local Node
# tests cannot see it because ucode does not run in the build env).
# Self-test first (a gate that cannot go red is considered absent).
_exportclose() { # $1 = file → 0 clean, 1 violation
  awk '
    function code_only(raw,    i,ch,nextch,out,quote,escaped) {
      out=""; quote=""; escaped=0
      for (i=1; i<=length(raw); i++) {
        ch=substr(raw,i,1); nextch=substr(raw,i+1,1)
        if (quote != "") { if (escaped) escaped=0; else if (ch=="\\") escaped=1; else if (ch==quote) quote=""; continue }
        if (ch=="/" && nextch=="/") break
        if (ch=="\"" || ch=="\047") { quote=ch; continue }
        out=out ch
      }
      return out
    }
    {
      line=code_only($0)
      if (inblock == 0 && line ~ /^export[ \t]+const[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*function/) {
        inblock=1; depth=0; startline=NR
      }
      if (inblock) {
        n=split(line, chars, "")
        for (i=1; i<=n; i++) {
          if (chars[i]=="{") depth++
          else if (chars[i]=="}") depth--
        }
        if (depth<=0) {
          if (line !~ /^[ \t]*\}[ \t]*;[ \t]*$/ && line !~ /\}[ \t]*;[ \t]*$/) {
            printf "FAIL  export-const block opened at line %d closes without `};`: %s\n", startline, FILENAME
            failed=1; exit 1
          }
          inblock=0
        }
      }
    }
    END { if (inblock && !failed) { printf "FAIL  export-const block opened at line %d never closes: %s\n", startline, FILENAME; exit 1 } }
  ' "$1"
}
_tmpbad=$(mktemp)
printf 'export const broken = function() {\n\treturn 1;\n}\n\nexport const after = function() { return 2; };\n' > "$_tmpbad"
_tmpgood=$(mktemp)
printf 'export const fine = function() {\n\treturn 1;\n};\n\nexport const also = 7;\n' > "$_tmpgood"
if _exportclose "$_tmpbad" >/dev/null 2>&1; then echo "FAIL  self-test: unclosed export-const not flagged"; fail=1; fi
if ! _exportclose "$_tmpgood" 2>/dev/null; then echo "FAIL  self-test: clean export-const flagged"; fail=1; fi
rm -f "$_tmpbad" "$_tmpgood"
[ "$fail" -eq 0 ] && echo "PASS  export-const close self-test (red on bad, green on good)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _exportclose "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  all export-const blocks close with };"

# 6. ucode does NOT hoist function declarations in module mode: a function
# must be DECLARED before its first call site in the same file, or the call
# fails at RUNTIME with "access to undeclared variable" (the profile_fragment
# defect that shipped to the router and broke profiles_list). Mutual
# recursion would false-positive here — there is none in this tree (helpers
# precede callers by convention).
_fnorder() { # $1 = file → 0 clean, 1 violation
  awk '
    function code_only(raw,    i,ch,nextch,out,quote,escaped) {
      out=""; quote=""; escaped=0
      for (i=1; i<=length(raw); i++) {
        ch=substr(raw,i,1); nextch=substr(raw,i+1,1)
        if (quote != "") { if (escaped) escaped=0; else if (ch=="\\") escaped=1; else if (ch==quote) quote=""; continue }
        if (ch=="/" && nextch=="/") break
        if (ch=="\"" || ch=="\047") { quote=ch; continue }
        out=out ch
      }
      return out
    }
    NR==FNR {
      line=code_only($0)
      if (match(line, /^[ \t]*function[ \t]+[A-Za-z_][A-Za-z0-9_]*/)) {
        name=line; sub(/^[ \t]*function[ \t]+/, "", name); sub(/[^A-Za-z0-9_].*$/, "", name)
        if (!(name in decl)) decl[name]=FNR
      }
      if (match(line, /^[ \t]*export[ \t]+const[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*function/)) {
        name=line; sub(/^[ \t]*export[ \t]+const[ \t]+/, "", name); sub(/[^A-Za-z0-9_].*$/, "", name)
        if (!(name in decl)) decl[name]=FNR
      }
      next
    }
    {
      line=code_only($0)
      if (line ~ /^[ \t]*(function|export[ \t]+const)[ \t]+/) sub(/^[^{]*\{/, "", line)
      while (match(line, /[A-Za-z_][A-Za-z0-9_]*[ \t]*\(/)) {
        cname=substr(line, RSTART, RLENGTH); sub(/[^A-Za-z0-9_].*$/, "", cname)
        rest=substr(line, RSTART+RLENGTH)
        if (cname in decl && FNR < decl[cname]) {
          printf "FAIL  %s called at line %d before its declaration at line %d: %s\n", cname, FNR, decl[cname], FILENAME
          exit 1
        }
        line=rest
      }
    }
  ' "$1" "$1"
}
_tmpbad=$(mktemp)
printf 'function caller() { return helper(); }\nfunction helper() { return 1; }\n' > "$_tmpbad"
_tmpgood=$(mktemp)
printf 'function helper() { return 1; }\nfunction caller() { return helper(); }\n' > "$_tmpgood"
if _fnorder "$_tmpbad" >/dev/null 2>&1; then echo "FAIL  self-test: use-before-declare not flagged"; fail=1; fi
if ! _fnorder "$_tmpgood" 2>/dev/null; then echo "FAIL  self-test: declare-before-use flagged"; fail=1; fi
rm -f "$_tmpbad" "$_tmpgood"
[ "$fail" -eq 0 ] && echo "PASS  function-order self-test (red on bad, green on good)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _fnorder "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  all function declarations precede their call sites"

# 7. no binary tilde: `a ~ b` is NOT XOR — it SEGFAULTS the ucode compiler on
# the target (proven: backup.uc checksum crashed the whole interpreter at
# module load, taking backup_list down). XOR is `^`; unary `~x` stays legal.
_notilde() { # $1 = file → 0 clean, 1 violation (comments stripped first —
  # the rule documents itself with a `a ~ b` example that must not self-flag)
  sed 's://.*$::' "$1" | grep -nE '[A-Za-z0-9_)] +~ +' | sed "s|^|FAIL  binary tilde (compiler segfault on target): $1:|"
  ! sed 's://.*$::' "$1" | grep -qE '[A-Za-z0-9_)] +~ +'
}
_tmpbad=$(mktemp); printf 'let h = 1;\nh = h ~ c;\n' > "$_tmpbad"
_tmpgood=$(mktemp); printf 'let h = 1;\nh = h ^ c;\nlet n = ~mask;\n' > "$_tmpgood"
if _notilde "$_tmpbad" >/dev/null 2>&1; then echo "FAIL  self-test: binary tilde not flagged"; fail=1; fi
if ! _notilde "$_tmpgood" >/dev/null 2>&1; then echo "FAIL  self-test: unary tilde flagged"; fail=1; fi
rm -f "$_tmpbad" "$_tmpgood"
[ "$fail" -eq 0 ] && echo "PASS  no-tilde self-test (red on bad, green on good)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _notilde "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  no binary tilde in shipped ucode"

# 8. no ord(<identifier>[...]): ucode strings are NOT indexable — ord(s[i])
# is a runtime "not an array or object" error (backup.uc had it). ord() of a
# substr()/char variable is the house pattern.
_noordidx() { # $1 = file → 0 clean, 1 violation
  grep -nE 'ord\([A-Za-z_][A-Za-z0-9_]*\[' "$1" | sed "s|^|FAIL  ord() of an indexed value (strings are not indexable): $1:|"
  ! grep -qE 'ord\([A-Za-z_][A-Za-z0-9_]*\[' "$1"
}
_tmpbad=$(mktemp); printf 'let c = ord(s[1]);\n' > "$_tmpbad"
_tmpgood=$(mktemp); printf 'let c = ord(substr(s, 1, 1));\nlet d = ord(ch);\n' > "$_tmpgood"
if _noordidx "$_tmpbad" >/dev/null 2>&1; then echo "FAIL  self-test: ord(indexed) not flagged"; fail=1; fi
if ! _noordidx "$_tmpgood" >/dev/null 2>&1; then echo "FAIL  self-test: ord(substr) flagged"; fail=1; fi
rm -f "$_tmpbad" "$_tmpgood"
[ "$fail" -eq 0 ] && echo "PASS  no-ord-index self-test (red on bad, green on good)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _noordidx "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  no ord() of indexed values in shipped ucode"

# 9. import completeness: every z2m_*/cat_* identifier used in a file must
# have a matching import (the profiles-apply.uc defect: z2m_tokenize used,
# never imported; the jobs.uc defect: cat_domain_include_path used, never
# imported — runtime "access to undeclared variable" on target; local node
# tests cannot see it).
_importsok() { # $1 = file → 0 clean, 1 violation
  # identifiers this file EXPORTS itself need no import (profiles.uc defines
  # the z2m_* aliases, catalog.uc the cat_* aliases)
  exported=$(grep -oE 'export const ((z2m|cat)_[A-Za-z0-9_]+)' "$1" | awk '{print $3}' | sort -u)
  used=$(grep -oE '(z2m|cat)_[A-Za-z0-9_]+' "$1" | sort -u)
  bad=0
  for u in $used; do
    if echo "$exported" | grep -qx "$u"; then continue; fi
    if ! grep -q "import .*$u" "$1"; then
      echo "FAIL  $u used without import in $1"
      bad=1
    fi
  done
  return $bad
}
_tmpbad=$(mktemp)
printf 'import { z2m_parse } from "./profiles.uc";\nlet m = z2m_parse(x);\nlet t = z2m_tokenize(x);\nlet d = cat_load();\n' > "$_tmpbad"
_tmpgood=$(mktemp)
printf 'import { z2m_parse, z2m_tokenize } from "./profiles.uc";\nimport { cat_load } from "./catalog.uc";\nlet m = z2m_parse(x);\nlet t = z2m_tokenize(x);\nlet d = cat_load();\n' > "$_tmpgood"
if _importsok "$_tmpbad" >/dev/null 2>&1; then echo "FAIL  self-test: missing import not flagged"; fail=1; fi
if ! _importsok "$_tmpgood" >/dev/null 2>&1; then echo "FAIL  self-test: complete imports flagged"; fail=1; fi
rm -f "$_tmpbad" "$_tmpgood"
[ "$fail" -eq 0 ] && echo "PASS  import-completeness self-test (red on bad, green on good)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _importsok "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  all z2m_* uses are imported"

if [ "$fail" = 0 ]; then echo "ucode-no-sugar: ALL PASS"; exit 0; else echo "ucode-no-sugar: FAILED"; exit 1; fi
