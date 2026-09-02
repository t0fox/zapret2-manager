#!/bin/sh
set -eu

# This script is deliberately a narrow bridge to the pinned upstream shell
# libraries. The caller materializes the five verified files below in a fresh
# private directory and removes that directory after this process exits.

root=${1:-}
case "$root" in
    /tmp/z2m-z2k-compile.[A-Za-z0-9]*) ;;
    *) exit 64 ;;
esac
[ -d "$root" ] || exit 66

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export ZAPRET2_DIR="$root"
export CONFIG_DIR="$root/config.d"
export STRATEGIES_CONF="$CONFIG_DIR/strategies.conf"
export QUIC_STRATEGIES_CONF="$CONFIG_DIR/quic_strategies.conf"
export Z2K_NFQWS2_TEMPLATES=0

mkdir -p "$CONFIG_DIR" \
    "$root/lists" \
    "$root/extra_strats/TCP/RKN" \
    "$root/extra_strats/TCP/YT" \
    "$root/extra_strats/TCP/YT_GV" \
    "$root/extra_strats/UDP/YT"

# The official generator emits hostlist references while materializing the
# category profiles. These files only make those references well-formed in the
# private compiler tree; the Z2M resource binder resolves their roles after
# compilation and never publishes these temporary paths.
for category in RKN YT YT_GV; do
    [ -s "$root/extra_strats/TCP/$category/List.txt" ] || printf '%s\n' example.com > "$root/extra_strats/TCP/$category/List.txt"
done
[ -s "$root/extra_strats/UDP/YT/List.txt" ] || printf '%s\n' example.com > "$root/extra_strats/UDP/YT/List.txt"
[ -s "$root/lists/whitelist.txt" ] || printf '%s\n' example.com > "$root/lists/whitelist.txt"
[ -s "$root/lists/discovered-domains.txt" ] || printf '%s\n' example.com > "$root/lists/discovered-domains.txt"

# config_official.sh reads this switch from the private Z2K config file.
printf '%s\n' Z2K_NFQWS2_TEMPLATES=0 > "$root/config"

# Only these three upstream libraries are part of the compiler API. In
# particular, do not source installation/configuration or any webpanel/service
# code.
. "$root/lib/utils.sh"
. "$root/lib/strategies.sh"
. "$root/lib/config_official.sh"

# Upstream helpers are intentionally allowed to report diagnostics, but their
# stdout must not contaminate the strict NFQWS2_OPT envelope.
print_info() { :; }
print_success() { :; }
print_warning() { :; }
print_error() { :; }

generate_strategies_conf "$root/strats_new2.txt" "$STRATEGIES_CONF" >/dev/null
generate_quic_strategies_conf "$root/quic_strats.ini" "$QUIC_STRATEGIES_CONF" >/dev/null
# Use the same upstream materializer as the official installation path. This
# keeps strategy-file creation and the later official generator on one source
# of truth; the harness does not reimplement pool selection or profile shape.
create_default_strategy_files >/dev/null

# The sole semantic output of this harness is the official generator result.
# The upstream function emits a shell assignment; strip only that transport
# wrapper and preserve every generated option/profile byte inside our envelope.
generated="$root/nfqws2.opt"
generate_nfqws2_opt_from_strategies > "$generated"
[ "$(sed -n '1p' "$generated")" = 'NFQWS2_OPT="' ] || exit 65
[ "$(tail -n 1 "$generated")" = '"' ] || exit 65
[ "$(wc -l < "$generated")" -ge 3 ] || exit 65
printf '%s\n' Z2M_NFQWS2_OPT_BEGIN
sed -n '2,$p' "$generated" | sed '$d'
printf '%s\n' Z2M_NFQWS2_OPT_END
