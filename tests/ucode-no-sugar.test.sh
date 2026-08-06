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

n=$(grep -rnP '\?\.|\?\?' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then
  echo "PASS  no ?. / ?? in shipped ucode"
else
  echo "FAIL  $n occurrences of ?. / ?? in shipped ucode:"
  grep -rnP '\?\.|\?\?' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

nforin=$(grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+(keys\s*\(|Object\.)' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$nforin" -eq 0 ]; then
  echo "PASS  no for-in object key enumeration in shipped ucode"
else
  echo "FAIL  $nforin explicit object-key loops in shipped ucode:"
  grep -rnP 'for\s*\(\s*(let|const|var)\s+[A-Za-z_]\w*\s+in\s+(keys\s*\(|Object\.)' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

nslice=$(grep -rnP '\[\d+:\d*\]|\[\d*:\d+\]' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | wc -l | tr -d ' ')
if [ "$nslice" -eq 0 ]; then
  echo "PASS  no array-slice syntax in shipped ucode"
else
  echo "FAIL  $nslice array slices in shipped ucode:"
  grep -rnP '\[\d+:\d*\]|\[\d*:\d+\]' zapret2-manager/files luci-app-zapret2-manager/files --include=*.uc 2>/dev/null | sed 's/^/  /'
  fail=1
fi

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

_exportclose() {
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

_fnorder() {
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

_notilde() {
  awk '
    function prefix_keyword(word) {
      return word == "return" || word == "throw" || word == "case" ||
        word == "delete" || word == "typeof" || word == "void" || word == "new"
    }
    function flush_lex_word() {
      if (lex_word != "") {
        lex_can_end = !prefix_keyword(lex_word)
        lex_word = ""
      }
    }
    function code_only(raw,    i,ch,nextch,out) {
      out=""
      for (i=1; i<=length(raw); i++) {
        ch=substr(raw,i,1); nextch=substr(raw,i+1,1)
        if (in_block) {
          if (ch=="*" && nextch=="/") { in_block=0; i++ }
          continue
        }
        if (literal != "") {
          if (escaped) { escaped=0; continue }
          if (ch=="\\") { escaped=1; continue }
          if (literal=="/" && ch=="[") { regex_class=1; continue }
          if (literal=="/" && ch=="]" && regex_class) { regex_class=0; continue }
          if (ch==literal && !regex_class) {
            literal=""; out=out "x"; lex_can_end=1
          }
          continue
        }
        if (ch ~ /[A-Za-z0-9_]/) {
          lex_word=lex_word ch; out=out ch
          continue
        }
        flush_lex_word()
        if (ch=="/" && nextch=="/") break
        if (ch=="/" && nextch=="*") { in_block=1; i++; continue }
        if (ch=="\"" || ch=="\047") { literal=ch; escaped=0; continue }
        if (ch=="/" && !lex_can_end) { literal="/"; escaped=0; regex_class=0; continue }
        out=out ch
        if (ch !~ /[ \t]/) {
          if (ch==")" || ch=="]" || ch=="}") lex_can_end=1
          else lex_can_end=0
        }
      }
      flush_lex_word()
      if (literal=="\"" || literal=="\047") escaped=0
      return out
    }
    function has_binary_tilde(line,    i,ch,word) {
      for (i=1; i<=length(line); i++) {
        ch=substr(line,i,1)
        if (ch ~ /[A-Za-z0-9_]/) {
          word=""
          while (i<=length(line) && substr(line,i,1) ~ /[A-Za-z0-9_]/) {
            word=word substr(line,i,1); i++
          }
          detector_can_end = !prefix_keyword(word)
          i--
          continue
        }
        if (ch ~ /[ \t]/) continue
        if (ch=="~") {
          if (detector_can_end) return 1
          detector_can_end=0
        }
        else if (ch ~ /[]A-Za-z0-9_)}]/) detector_can_end=1
        else detector_can_end=0
      }
      return 0
    }
    {
      if (has_binary_tilde(code_only($0))) {
        printf "FAIL  binary tilde (compiler segfault on target): %s:%d:%s\n", FILENAME, FNR, $0
        failed=1
      }
    }
    END { exit failed }
  ' "$1"
}
_tilde_samples=tests/fixtures/gate-samples
if _notilde "$_tilde_samples/tilde-binary-broken.uc" >/dev/null 2>&1; then echo "FAIL  self-test: binary tilde not flagged"; fail=1; fi
if _notilde "$_tilde_samples/tilde-string-binary-broken.uc" >/dev/null 2>&1; then echo "FAIL  self-test: binary tilde after string literal not flagged"; fail=1; fi
if _notilde "$_tilde_samples/tilde-regex-binary-broken.uc" >/dev/null 2>&1; then echo "FAIL  self-test: binary tilde after regex literal not flagged"; fail=1; fi
if ! _notilde "$_tilde_samples/tilde-unary-valid.uc" >/dev/null 2>&1; then echo "FAIL  self-test: unary tilde flagged"; fail=1; fi
if ! _notilde "$_tilde_samples/tilde-string-valid.uc" >/dev/null 2>&1; then echo "FAIL  self-test: tilde inside quoted string flagged"; fail=1; fi
if ! _notilde "$_tilde_samples/tilde-comment-valid.uc" >/dev/null 2>&1; then echo "FAIL  self-test: tilde inside block or line comment flagged"; fail=1; fi
if ! _notilde "$_tilde_samples/tilde-multiline-valid.uc" >/dev/null 2>&1; then echo "FAIL  self-test: tilde inside continued string flagged"; fail=1; fi
[ "$fail" -eq 0 ] && echo "PASS  no-tilde self-test (binary rejected; unary, literals, and comments accepted)"
for f in $(find zapret2-manager/files luci-app-zapret2-manager/files -name '*.uc' 2>/dev/null); do
  if ! _notilde "$f"; then fail=1; fi
done
[ "$fail" -eq 0 ] && echo "PASS  no binary tilde in shipped ucode"

_noordidx() {
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

_importsok() {
  exported=$(grep -oE 'export const ((z2m|cat)_[A-Za-z0-9_]+)' "$1" | awk '{print $3}' | sort -u)
  used=$(grep -oE '(z2m|cat)_[A-Za-z0-9_]+' "$1" | sort -u)
  flattened=$(tr '\n' ' ' < "$1")
  bad=0
  for u in $used; do
    if echo "$exported" | grep -qx "$u"; then continue; fi
    if ! printf '%s\n' "$flattened" | grep -Eq "import[[:space:]]*\{[^}]*([^A-Za-z0-9_]|^)$u([^A-Za-z0-9_]|$)[^}]*\}[[:space:]]*from"; then
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
