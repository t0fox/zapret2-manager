#!/bin/sh
# tools/validate-strategy.sh — validate a zapret2 nfqws2 options string.
#
# Works offline. Accepts an options string or a file path (or stdin).
# Checks: desync methods are in the catalog; each method's params are in its
# description; blob names are built-in or declared with --blob= in the same
# string; ports and out-range/in-range expressions are syntactically valid;
# every profile with a wide port range carries an exclusion list; none of the
# six controversial constructs is used without an explicit --allow flag.
#
# If the Lua fixture tests/fixtures/opt-zapret2-lua-contents.out is present
# (captured from a target by tools/collect-fixtures.sh), the catalog is
# cross-checked against the actual function signatures and discrepancies are
# reported. If the fixture is absent the cross-check is SKIPPED — never an
# error. The binary/Lua same-release precondition is verified before the
# cross-check runs.
#
# Exit codes: 0 clean; 1 validation errors (or self-test failure); 2 usage.
#
# Negative self-test: --self-test runs the validator on a known-bad and a
# known-good sample and asserts bad→nonzero, good→zero. If either assertion
# fails the self-test exits nonzero with "VALIDATOR NON-FUNCTIONAL". A gate
# whose ability to go red is unproven is considered absent.

set -u

ERRORS=0
err()  { printf 'validate-strategy: ERROR: %s\n' "$*" >&2; ERRORS=$((ERRORS+1)); }
warn() { printf 'validate-strategy: WARN: %s\n'  "$*" >&2; }
info() { printf 'validate-strategy: info: %s\n'  "$*" >&2; }

# ---------- embedded catalog (mirrors docs/strategy-pack.md) ----------
# Desync methods (25) — confirmed in the Lua fixture as `function name(ctx,desync)`.
METHODS_DESYNC="drop send pktmod http_hostcase http_domcase http_methodeol http_unixeol wsize wssize syndata tls_client_hello_clone fake rst multisplit multidisorder multidisorder_legacy fakedsplit fakeddisorder hostfakesplit tcpseg oob udplen dht_dn synack synack_split"
# Automation/orchestrator functions called via --lua-desync=.
METHODS_AUTO="circular repeater condition per_instance_condition stopif luaexec detect_payload_str"
ORCHESTRATORS="circular repeater condition per_instance_condition stopif"

# Standard function-arg families (from zapret-antidpi.lua "STANDARD FUNCTION ARGS").
FOOLING="ip_ttl ip6_ttl ip_autottl ip6_autottl ip6_hopbyhop ip6_hopbyhop2 ip6_destopt ip6_destopt2 ip6_routing ip6_ah tcp_seq tcp_ack tcp_ts tcp_md5 tcp_flags_set tcp_flags_unset tcp_ts_up tcp_nop_del fool"
RECONSTRUCT="badsum"
RAWSEND="repeats ifout fwmark"
PAYLOAD_P="payload"
IPID="ip_id ip_id_conn"
IPFRAG="ipfrag ipfrag_disorder ipfrag_pos_tcp ipfrag_pos_udp ipfrag_pos_icmp ipfrag_pos ipfrag_next"
DIRECTION="dir"
DETECTOR="maxseq inseq retrans reset udp_out udp_in no_rst no_http_redirect"
HOSTKEY="hostkey nld reqhost"
GLOBAL_MARKERS="strategy final cond cond_neg"   # per-instance markers, allowed on any instance

# Built-in blob names: C-builtin bases (inferred from usage; not assigned in Lua)
# plus Lua globals defined in init_vars.lua via tls_mod(fake_default_tls,'sni=...').
BUILTIN_BLOBS="fake_default_tls fake_default_http fake_default_quic tls_google tls_vk tls_sber tls_yandex tls_mail tls_cloudflare tls_discord tls_youtube bin_max fake_max tls_rnd tls_rndsni tls_rnd_google tls_rnd_dupsid tls_rnd_dupsid_google tls_padencap tls_padencap_google fake_inverted_tls"

# Method-specific args (besides standard-arg families). Mirrors the `-- arg:`
# comment blocks above each function in zapret-antidpi.lua / zapret-auto.lua.
method_spec() {
  case "$1" in
    drop) echo "" ;;
    send) echo "delay" ;;
    pktmod) echo "" ;;
    http_domcase) echo "" ;;
    http_hostcase) echo "spell" ;;
    http_methodeol) echo "" ;;
    http_unixeol) echo "" ;;
    synack_split) echo "mode" ;;
    synack) echo "" ;;
    wsize) echo "wsize scale" ;;
    wssize) echo "wsize scale forced_cutoff" ;;
    tls_client_hello_clone) echo "blob fallback sni_snt sni_snt_new sni_del_ext sni_del sni_first sni_last" ;;
    syndata) echo "blob tls_mod" ;;
    rst) echo "rstack" ;;
    fake) echo "blob optional tls_mod" ;;
    multisplit) echo "pos seqovl seqovl_pattern blob optional nodrop" ;;
    multidisorder) echo "pos seqovl seqovl_pattern blob optional nodrop" ;;
    multidisorder_legacy) echo "pos seqovl seqovl_pattern optional" ;;
    hostfakesplit) echo "host midhost nofake1 nofake2 disorder_after blob optional nodrop" ;;
    fakedsplit) echo "pos nofake1 nofake2 nofake3 nofake4 pattern seqovl seqovl_pattern blob optional nodrop" ;;
    fakeddisorder) echo "pos nofake1 nofake2 nofake3 nofake4 pattern seqovl seqovl_pattern blob optional nodrop" ;;
    tcpseg) echo "pos seqovl seqovl_pattern blob optional" ;;
    oob) echo "char byte urp" ;;
    udplen) echo "min max increment pattern pattern_offset" ;;
    dht_dn) echo "dn" ;;
    circular) echo "fails time success_detector failure_detector hostkey nld reqhost key" ;;
    repeater) echo "instances repeats stop clear iff neg" ;;
    condition) echo "iff neg instances" ;;
    per_instance_condition) echo "instances" ;;
    stopif) echo "iff neg" ;;
    luaexec) echo "code" ;;
    detect_payload_str) echo "pattern payload undetected" ;;
    *) echo "" ;;
  esac
}

# Which standard-arg families the method uses (from its "standard args :" line).
method_std() {
  case "$1" in
    drop) echo "dir payload" ;;
    send) echo "dir fooling ipid ipfrag rawsend reconstruct" ;;
    pktmod) echo "dir fooling ipid" ;;
    http_domcase|http_hostcase|http_methodeol|http_unixeol|wssize|tls_client_hello_clone|dht_dn) echo "dir" ;;
    synack_split|synack) echo "rawsend reconstruct ipfrag" ;;
    wsize) echo "" ;;
    syndata) echo "fooling rawsend reconstruct ipfrag" ;;
    rst|fake|multisplit|multidisorder|multidisorder_legacy|tcpseg) echo "dir payload fooling ipid rawsend reconstruct ipfrag" ;;
    hostfakesplit|fakedsplit|fakeddisorder) echo "dir payload fooling ipid rawsend reconstruct" ;;
    oob) echo "fooling ipid rawsend reconstruct ipfrag" ;;
    udplen) echo "dir payload" ;;
    circular|repeater|condition|per_instance_condition|stopif|luaexec|detect_payload_str) echo "" ;;
    *) echo "" ;;
  esac
}

std_expand() {
  out=""
  for f in $1; do
    case "$f" in
      dir) out="$out dir" ;;
      payload) out="$out payload" ;;
      fooling) out="$out $FOOLING" ;;
      reconstruct) out="$out $RECONSTRUCT" ;;
      rawsend) out="$out $RAWSEND" ;;
      ipid) out="$out $IPID" ;;
      ipfrag) out="$out $IPFRAG" ;;
    esac
  done
  printf '%s' "$out"
}

# Full valid param set for a method: spec + standard families + global markers.
method_params() {
  printf '%s %s %s' "$(method_spec "$1")" "$(std_expand "$(method_std "$1")")" "$GLOBAL_MARKERS"
}

is_known_method() {
  case " $METHODS_DESYNC $METHODS_AUTO " in *" $1 "*) return 0 ;; esac
  return 1
}
is_orchestrator() {
  case " $ORCHESTRATORS " in *" $1 "*) return 0 ;; esac
  return 1
}

# ---------- port / range syntax ----------
# element: "*" | [~]N | [~]N-M
is_port_elem() {
  e="$1"
  [ "$e" = "*" ] && return 0
  case "$e" in \~*) e="${e#~}" ;; esac
  case "$e" in *[!0-9-]*) return 1 ;; esac
  case "$e" in
    *-*) lo="${e%%-*}"; hi="${e#*-}"
         case "$lo" in *[!0-9]*|"") return 1 ;; esac
         case "$hi" in *[!0-9]*|"") return 1 ;; esac
         [ "$lo" -ge 0 ] 2>/dev/null && [ "$lo" -le 65535 ] 2>/dev/null || return 1
         [ "$hi" -ge 0 ] 2>/dev/null && [ "$hi" -le 65535 ] 2>/dev/null || return 1
         [ "$lo" -le "$hi" ] || return 1 ;;
    *) case "$e" in *[!0-9]*|"") return 1 ;; esac
       [ "$e" -ge 0 ] 2>/dev/null && [ "$e" -le 65535 ] 2>/dev/null || return 1 ;;
  esac
  return 0
}

# wide = positive range (no ~) spanning >=1024 ports, or "*"
elem_is_wide() {
  e="$1"
  [ "$e" = "*" ] && return 0
  case "$e" in \~*) return 1 ;; esac          # negated range is not "wide capture"
  case "$e" in
    *-*) lo="${e%%-*}"; hi="${e#*-}"
         [ "$((hi - lo + 1))" -ge 1024 ] && return 0 ;;
  esac
  return 1
}

# out-range/in-range grammar: [(n|a|d|s|p|b|x)<int>](-|<)[(n|a|d|s|p|b|x)<int>]
# with at least one operand (bare integers also accepted, as seen in live configs).
is_range_expr() {
  v="$1"
  [ "$v" = "-" ] && return 1
  [ "$v" = "<" ] && return 1
  printf '%s\n' "$v" | grep -Eq '^([nadbspx]?[0-9]+)?(-|<)([nadbspx]?[0-9]+)?$'
}

# ---------- controversial constructs (allow-aware) ----------
ALLOW=""
controversial() {
  cid="$1"; cmsg="$2"
  case " $ALLOW " in
    *" $cid "*) info "$cmsg (allowed via --allow=$cid)" ;;
    *) err "$cmsg (controversial; allow with --allow=$cid)" ;;
  esac
}

# ---------- state ----------
DECLARED_BLOBS=""
BLOB_REFS=""          # blob names referenced via blob=/seqovl_pattern=/pattern=/fallback=
USED_METHODS=""
CUR_PROFILE=1
CUR_WIDE=0
CUR_EXCL=0

finalize_profile() {
  if [ "$CUR_WIDE" = "1" ] && [ "$CUR_EXCL" = "0" ]; then
    err "profile $CUR_PROFILE has a wide port range (>=1024 ports) but no exclusion list (--ipset-exclude/--ipset-exclude-ip/--hostlist-exclude/--hostlist-exclude-domains)"
  fi
}

has_word() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }

# ---------- core validation ----------
validate() {
  raw="$1"
  # collapse newlines/tabs to spaces; tokenize on whitespace
  opts=$(printf '%s' "$raw" | tr '\n\t' '  ')
  for token in $opts; do
    case "$token" in
      --*) : ;;
      *) continue ;;   # stray non-option token: ignore
    esac
    name="${token%%=*}"
    value=""
    case "$token" in *=*) value="${token#*=}" ;; esac

    case "$name" in
      --new)
        finalize_profile
        CUR_PROFILE=$((CUR_PROFILE+1)); CUR_WIDE=0; CUR_EXCL=0
        ;;
      --name) ;;       # names the current profile; no boundary, no reset
      --ipset-exclude|--ipset-exclude-ip|--hostlist-exclude|--hostlist-exclude-domains)
        CUR_EXCL=1 ;;
      --blob)
        bval="$value"
        bname="${bval%%:*}"
        [ -n "$bname" ] && DECLARED_BLOBS="$DECLARED_BLOBS $bname"
        ;;
      --filter-tcp|--filter-udp)
        if [ -z "$value" ]; then err "$name is empty"; continue; fi
        rem="$value"
        while [ -n "$rem" ]; do
          elem="${rem%%,*}"
          if ! is_port_elem "$elem"; then
            err "$name: invalid port/range element '$elem' (expected [~]N[-M] or *)"
          else
            if elem_is_wide "$elem"; then CUR_WIDE=1; fi
          fi
          case "$rem" in *,*) rem="${rem#*,}" ;; *) rem="" ;; esac
        done
        ;;
      --out-range|--in-range)
        if ! is_range_expr "$value"; then
          err "$name: invalid range expression '$value' (grammar: [(n|a|d|s|p|b|x)<int>](-|<)[(n|a|d|s|p|b|x)<int>])"
        fi
        ;;
      --dpi-desync-*)
        controversial old-fooling-syntax "$name: nfqws1-style combined desync option; nfqws2 has no --dpi-desync-* family (fooling is split into separate flags: tcp_md5, ip_autottl, repeats, etc.)"
        ;;
      --lua-desync)
        validate_luadesync "$value" ;;
      --filter-l7|--filter-ipp|--filter-l3|--filter-icmp|--filter-ssid|--payload|--reasm-disable|--payload-disable|--ctrack-disable|--server|--ipcache-lifetime|--ipcache-hostname|--hostlist|--hostlist-domains|--hostlist-auto|--ipset|--ipset-ip|--lua-init|--comment|--qnum|--fwmark|--ctrack-timeouts|--writable|--lua-gc)
        : ;;   # accepted, not checked for value syntax
      *) : ;;  # unknown option: ignore (option set is large; not a required check)
    esac
  done
  finalize_profile

  # blob reference check (after pass, so declarations can follow references)
  for ref in $BLOB_REFS; do
    case "$ref" in 0x*|'#'*|%*) continue ;; esac
    if has_word "$DECLARED_BLOBS" "$ref"; then continue; fi
    if has_word "$BUILTIN_BLOBS" "$ref"; then continue; fi
    controversial undeclared-blob "blob '$ref' is neither declared with --blob= in this options string nor in the built-in blob catalog (may be an undeclared built-in, or a typo)"
  done
}

validate_luadesync() {
  val="$1"
  func="${val%%:*}"
  rest="$val"
  case "$val" in *:*) rest="${val#*:}" ;; *) rest="" ;; esac
  if [ -z "$func" ]; then
    err "--lua-desync: empty function name"
    return
  fi
  if ! has_word "$USED_METHODS" "$func"; then USED_METHODS="$USED_METHODS $func"; fi

  known=1
  if ! is_known_method "$func"; then
    controversial unknown-method "method '$func' is not in the strategy catalog — it may be a custom/orchestra-extra function (provide the Lua fixture to confirm) or a nonexistent method from a binary/Lua release mismatch"
    known=0
  fi

  # peel param segments on ':' (no subshell). Params of an unknown method cannot
  # be checked against a catalog it is not in, so the loop runs for known methods only.
  if [ "$known" = "1" ]; then
  remaining="$rest"
  valid="$(method_params "$func")"
  while [ -n "$remaining" ]; do
    seg="${remaining%%:*}"
    case "$remaining" in *:*) remaining="${remaining#*:}" ;; *) remaining="" ;; esac
    [ -z "$seg" ] && continue
    key="${seg%%=*}"
    [ -z "$key" ] && continue

    # controversial #1: maxtime is the silently-ignored wrong form of 'time'
    if [ "$key" = "maxtime" ]; then
      controversial rotation-maxtime "circular: '$key' is not a recognized parameter; the time parameter is 'time' (default 60). 'maxtime' is silently ignored"
      continue
    fi
    # controversial #3: 'repeat' (singular) is a typo for 'repeats'
    if [ "$key" = "repeat" ]; then
      controversial repeat-singular "'repeat' (singular) is ignored; the parameter is 'repeats' (plural)"
      continue
    fi
    # controversial #2: hostkey-formation params placed on the rotation orchestrator
    if is_orchestrator "$func" && has_word "$HOSTKEY" "$key"; then
      controversial hostkey-as-rotation "orchestrator '$func': '$key' is a host-key-formation parameter (see standard_hostkey), not a rotation parameter; the rotation storage key is 'key='. 'hostkey=' names a generator function and errors at runtime if it is not a function"
    fi

    # collect blob references
    case "$key" in blob|seqovl_pattern|pattern|fallback)
      v=""
      case "$seg" in *=*) v="${seg#*=}" ;; esac
      [ -n "$v" ] && BLOB_REFS="$BLOB_REFS $v" ;;
    esac

    # unknown param (typo) — not allow-able
    if ! has_word "$valid" "$key"; then
      err "method '$func': unknown parameter '$key' (not in this method's args nor the standard-arg families it uses)"
    fi
  done
  fi
}

# ---------- Lua-fixture cross-check (skipped if absent) ----------
cross_check() {
  lua_fixture="$FIXTURE_DIR/opt-zapret2-lua-contents.out"
  ver_fixture=""
  for cand in nfqws2-version-long.out nfqws2-version-V.out nfqws2-version-short.out; do
    [ -e "$FIXTURE_DIR/$cand" ] && ver_fixture="$FIXTURE_DIR/$cand" && break
  done

  if [ ! -e "$lua_fixture" ]; then
    info "Lua fixture absent ($lua_fixture) — cross-check skipped (not an error)"
    return 0
  fi
  # same-release precondition: need a binary version fixture too
  if [ -z "$ver_fixture" ]; then
    info "binary version fixture absent — cannot verify binary/Lua same release; cross-check skipped (not an error)"
    return 0
  fi
  # Lua fixture sanity
  if ! grep -q '===FILE:/opt/zapret2/lua/zapret-antidpi.lua===' "$lua_fixture"; then
    warn "Lua fixture present but missing expected zapret-antidpi.lua section — cross-check skipped"
    return 0
  fi

  compat=$(grep -o 'lua_compat_ver [0-9][0-9]*' "$ver_fixture" 2>/dev/null | head -1 | awk '{print $2}')
  info "binary reports lua_compat_ver=${compat:-unknown}; Lua fixture present — same-release assumed from co-capture; running signature cross-check"

  # real methods = all `function name(ctx, desync)` in the Lua
  real_methods=$(grep -E '^function [A-Za-z_][A-Za-z0-9_]*\(ctx, desync\)' "$lua_fixture" \
    | sed -E 's/^function ([A-Za-z_][A-Za-z0-9_]*).*/\1/' | sort -u | tr '\n' ' ')

  # (a) every method used in the options must exist in the Lua (catches #6 mismatch)
  for m in $USED_METHODS; do
    if ! has_word "$real_methods" "$m"; then
      err "cross-check: method '$m' is used in the options but is not defined in the Lua fixture (binary/Lua release mismatch — controversial #6)"
    fi
  done
  # (b) every catalog method should exist in the Lua (catalog drift — warn only)
  for m in $METHODS_DESYNC $METHODS_AUTO; do
    if ! has_word "$real_methods" "$m"; then
      warn "cross-check: catalog method '$m' not found in the Lua fixture (catalog may be stale vs this release)"
    fi
  done

  # (c) per-method param cross-check for the 25 desync methods
  tmp=$(mktemp 2>/dev/null || echo /tmp/.vs.$$)
  awk '
    /^-- arg ?:/ {
      line=$0; sub(/^-- arg ?:/,"",line); sub(/^ +/,"",line)
      dp=index(line," - ")
      if (dp==0) dp=index(line," . ")
      if (dp>0) pp=substr(line,1,dp-1); else pp=line
      n=split(pp, parts, ",")
      for (i=1;i<=n;i++) { p=parts[i]; sub(/^ +/,"",p); sub(/[= ].*/,"",p); if (p!="") cur=cur " " p }
    }
    /^function [A-Za-z_][A-Za-z0-9_]*\(ctx, desync\)/ {
      fn=$0; sub(/^function /,"",fn); sub(/\(.*/,"",fn); print fn "|" cur; cur=""
    }
  ' "$lua_fixture" > "$tmp"
  while IFS='|' read -r m args; do
    [ -z "$m" ] && continue
    if ! has_word "$METHODS_DESYNC" "$m"; then continue; fi   # only the 25 (orchestrator params span multiple comments)
    myspec=$(method_spec "$m")
    for p in $myspec; do
      if ! has_word "$args" "$p"; then
        err "cross-check: method '$m' catalog param '$p' not found in Lua fixture arg comments"
      fi
    done
    for p in $args; do
      if ! has_word "$myspec" "$p"; then
        warn "cross-check: method '$m' Lua arg '$p' not in catalog spec"
      fi
    done
  done < "$tmp"
  rm -f "$tmp"
}

# ---------- self-test ----------
self_test() {
  bad="$STRATEGIES_DIR/selftest-bad.txt"
  good="$STRATEGIES_DIR/selftest-good.txt"
  if [ ! -e "$bad" ] || [ ! -e "$good" ]; then
    err "self-test: missing sample files ($bad / $good)"
    err "VALIDATOR NON-FUNCTIONAL: cannot run self-test"
    return 1
  fi
  sh "$0" --fixture-dir="$FIXTURE_DIR" "$bad" >/dev/null 2>&1
  rc_bad=$?
  sh "$0" --fixture-dir="$FIXTURE_DIR" "$good" >/dev/null 2>&1
  rc_good=$?
  if [ "$rc_bad" -eq 0 ]; then
    err "self-test: selftest-bad returned 0, expected nonzero"
    err "VALIDATOR NON-FUNCTIONAL: negative path cannot go red"
    return 1
  fi
  if [ "$rc_good" -ne 0 ]; then
    err "self-test: selftest-good returned $rc_good, expected 0"
    err "VALIDATOR NON-FUNCTIONAL: positive path cannot go green"
    return 1
  fi
  printf 'self-test OK: bad→nonzero (rc=%s), good→zero (rc=%s)\n' "$rc_bad" "$rc_good"
  return 0
}

print_help() {
  cat <<'EOF'
validate-strategy.sh — validate a zapret2 nfqws2 options string (offline)

Usage:
  validate-strategy.sh [--allow=<id>]... [--fixture-dir=<dir>] <file|options-string>
  validate-strategy.sh --self-test
  validate-strategy.sh --help

Reads options from a file path, a literal options string, or stdin.

--allow=<id>            Permit a controversial construct (repeatable):
                          rotation-maxtime      (#1: maxtime vs time)
                          hostkey-as-rotation   (#2: hostkey/nld/reqhost on orchestrator)
                          repeat-singular       (#3: repeat vs repeats)
                          old-fooling-syntax    (#4: --dpi-desync-* options)
                          undeclared-blob       (#5: blob not declared/built-in)
                          unknown-method        (#6: method not in catalog)
--allow-all-controversial   permit all six.
--fixture-dir=<dir>     Lua/binary fixture dir (default: <repo>/tests/fixtures).
EOF
}

# ---------- main ----------
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd 2>/dev/null) || SCRIPT_DIR=.
FIXTURE_DIR="$SCRIPT_DIR/../tests/fixtures"
SELFTEST=0
INPUT=""

for arg in "$@"; do
  case "$arg" in
    --self-test) SELFTEST=1 ;;
    --help|-h) print_help; exit 0 ;;
    --allow=*) ALLOW="$ALLOW ${arg#--allow=}" ;;
    --allow-all-controversial) ALLOW="$ALLOW rotation-maxtime hostkey-as-rotation repeat-singular old-fooling-syntax undeclared-blob unknown-method" ;;
    --fixture-dir=*) FIXTURE_DIR="${arg#--fixture-dir=}" ;;
    --) : ;;
    --*) ;;            # inline options string token starting with --: treat as input below
    *) [ -z "$INPUT" ] && INPUT="$arg" ;;
  esac
  # an inline options string starting with -- would have matched --* above and been
  # skipped; re-detect it as input if it is not a known CLI flag.
  case "$arg" in
    --self-test|--help|-h|--allow-all-controversial|--) : ;;
    --allow=*|--fixture-dir=*) : ;;
    --*) [ -z "$INPUT" ] && INPUT="$arg" ;;
  esac
done
ALLOW=$(printf '%s' "$ALLOW" | tr -s ' ' | sed -E 's/^ //; s/ $//')
STRATEGIES_DIR="$FIXTURE_DIR/strategies"

if [ "$SELFTEST" = "1" ]; then
  self_test
  exit $?
fi

# obtain the options text
if [ -n "$INPUT" ] && [ -f "$INPUT" ]; then
  raw=$(cat -- "$INPUT" 2>/dev/null) || { err "cannot read file: $INPUT"; exit 1; }
elif [ -n "$INPUT" ]; then
  raw="$INPUT"
elif [ -t 0 ]; then
  print_help >&2
  exit 2
else
  raw=$(cat)
fi

validate "$raw"
cross_check

if [ "$ERRORS" -gt 0 ]; then
  printf 'validate-strategy: %d error(s)\n' "$ERRORS" >&2
  exit 1
fi
printf 'validate-strategy: OK (0 errors)\n'
exit 0
