#!/bin/sh
# tools/collect-fixtures.sh — snapshot the live zapret2 router into tests/fixtures.
#
# One command pulls a full upstream-state snapshot and lays it out in
# tests/fixtures/, one file per fixture, each paired with a <name>.rc file
# holding the exit code of the command that produced it.
#
# ssh rc=255 means the connection DROPPED — it is NOT a command result. Such a
# fixture is retried, and if the drop persists it is recorded as SSH_DROP so a
# missing output can never be mistaken for a command that returned nothing
# (this exact confusion once produced a fake telemetry event).
#
# Existing fixtures are NEVER overwritten: this script only ADDS files. Re-run
# after deleting a fixture to refresh it; old files may have come from a
# different source.
#
# Usage:
#   tools/collect-fixtures.sh
#   ROUTER=root@192.168.1.1 OUT=tests/fixtures tools/collect-fixtures.sh
#
# Env:
#   ROUTER  ssh target            (default root@192.168.1.1)
#   OUT     fixture output dir    (default <repo>/tests/fixtures)

set -u

ROUTER="${ROUTER:-root@192.168.1.1}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$HERE/tests/fixtures}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

mkdir -p "$OUT"

# take <name> <remote-command>
# Saves <name>.out (stdout+stderr) and <name>.rc (exit code of the command).
# rc=255 → connection drop: retried up to 3x, then recorded as SSH_DROP.
# Skips silently if <name>.out already exists (never overwrite).
take() {
  name="$1"; cmd="$2"
  out="$OUT/$name.out"; rcfile="$OUT/$name.rc"
  if [ -e "$out" ]; then
    printf '[fix] skip  %s (exists)\n' "$name"
    return 0
  fi
  attempt=0
  rc=255
  while [ "$attempt" -lt 3 ]; do
    attempt=$((attempt+1))
    ssh $SSH_OPTS "$ROUTER" "$cmd" > "$out" 2>&1
    rc=$?
    [ "$rc" -ne 255 ] && break
    [ "$attempt" -ge 3 ] && break
    printf '[fix] retry %s (ssh rc=255, attempt %d)\n' "$name" "$attempt" >&2
    sleep 2
  done
  if [ "$rc" -eq 255 ]; then
    printf 'SSH_DROP\n' > "$rcfile"
    printf 'SSH_CONNECTION_DROPPED_AFTER_%d_ATTEMPTS\n' "$attempt" > "$out"
    printf '[fix] DROP  %s (connection dropped)\n' "$name" >&2
  else
    printf '%s\n' "$rc" > "$rcfile"
    printf '[fix] took %s (rc=%s)\n' "$name" "$rc"
  fi
}

# nfqws2 binary is not at a fixed path across builds; the version-flag takes
# below probe the likely spots and run the flag on the first executable found.
# The remote command exits with the version call's rc (so .rc reflects the flag),
# or 127 if no binary was found. Each flag is a SEPARATE fixture with its own rc.

# --- init subcommands (read-only; never stop_fw / restart_fw) ----------------
take init-list_table   '/etc/init.d/zapret2 list_table'
take init-list_ifsets  '/etc/init.d/zapret2 list_ifsets'

# --- NFQUEUE -----------------------------------------------------------------
take proc-nfnetlink_queue 'cat /proc/net/netfilter/nfnetlink_queue'

# --- config sources ----------------------------------------------------------
take opt-zapret2-config   'cat /opt/zapret2/config'
take etc-config-zapret2   'cat /etc/config/zapret2'
take opt-zapret2-version  'cat /opt/zapret2/version'

# --- process listing + daemon argv -------------------------------------------
take ps-full              'ps w'
take nfqws2-cmdline       'P=$(pgrep -x nfqws2 2>/dev/null | head -1); [ -n "$P" ] && { printf "PID=%s\n" "$P"; tr "\0" " " < /proc/$P/cmdline; echo; } || echo NFQWS2_NOT_RUNNING'
take nfqws2-cmdline-nfqws 'P=$(pgrep -x nfqws 2>/dev/null | head -1); [ -n "$P" ] && { printf "PID=%s\n" "$P"; tr "\0" " " < /proc/$P/cmdline; echo; } || echo NFQWS_NOT_RUNNING'

# --- daemon version flags (separate rc per flag) -----------------------------
take nfqws2-version-long  'for c in /opt/zapret2/nfq2/nfqws2 /opt/zapret2/nfqws2 /opt/zapret2/nfq2/nfqws /opt/zapret2/nfqws "$(command -v nfqws2 2>/dev/null)" "$(command -v nfqws 2>/dev/null)"; do [ -x "$c" ] || continue; printf "BIN=%s\n" "$c"; "$c" --version 2>&1; exit $?; done; echo NO_NFQWS_BINARY_FOUND; exit 127'
take nfqws2-version-short 'for c in /opt/zapret2/nfq2/nfqws2 /opt/zapret2/nfqws2 /opt/zapret2/nfq2/nfqws /opt/zapret2/nfqws "$(command -v nfqws2 2>/dev/null)" "$(command -v nfqws 2>/dev/null)"; do [ -x "$c" ] || continue; printf "BIN=%s\n" "$c"; "$c" -v 2>&1; exit $?; done; echo NO_NFQWS_BINARY_FOUND; exit 127'
take nfqws2-version-V     'for c in /opt/zapret2/nfq2/nfqws2 /opt/zapret2/nfqws2 /opt/zapret2/nfq2/nfqws /opt/zapret2/nfqws "$(command -v nfqws2 2>/dev/null)" "$(command -v nfqws 2>/dev/null)"; do [ -x "$c" ] || continue; printf "BIN=%s\n" "$c"; "$c" -V 2>&1; exit $?; done; echo NO_NFQWS_BINARY_FOUND; exit 127'

# --- directory listings ------------------------------------------------------
take etc-rc.d-listing              'ls -la /etc/rc.d'
take opt-zapret2-listing           'ls -la /opt/zapret2'
take opt-zapret2-nfq2-listing      'ls -la /opt/zapret2/nfq2'
take opt-zapret2-blockcheck2.d-ls  'ls -la /opt/zapret2/blockcheck2.d'
take usr-share-rpcd-ucode-listing  'ls -la /usr/share/rpcd/ucode'
take usr-libexec-rpcd-listing      'ls -la /usr/libexec/rpcd'
take etc-hotplug.d-iface-listing   'ls -la /etc/hotplug.d/iface'

# --- lua files under /opt/zapret2 (index + bundled contents) -----------------
take opt-zapret2-lua-list      'find /opt/zapret2 -type f -name "*.lua" -print'
take opt-zapret2-lua-contents  'find /opt/zapret2 -type f -name "*.lua" | while IFS= read -r f; do printf "===FILE:%s===\n" "$f"; cat "$f"; printf "\n===END:%s===\n" "$f"; done'

# --- /etc/hotplug.d/iface contents (bundled) ---------------------------------
take etc-hotplug.d-iface-contents 'for f in /etc/hotplug.d/iface/*; do [ -f "$f" ] || continue; printf "===FILE:%s===\n" "$f"; cat "$f"; printf "\n===END:%s===\n" "$f"; done'

# --- ubus objects ------------------------------------------------------------
take ubus-list        'ubus list'

# --- ucode interpreter: version + help (reveals the syntax-check flag) -------
take ucode-version-long   'ucode --version 2>&1'
take ucode-version-short  'ucode -v 2>&1'
take ucode-help-long      'ucode --help 2>&1'
take ucode-help-short     'ucode -h 2>&1'

# --- extras that anchor the snapshot (base image, upstream package) ----------
take openwrt-release         'cat /etc/openwrt_release'
take apk-info-zapret2        'apk info zapret2 2>&1'
take apk-info-zapret2-mgr    'apk info zapret2-manager 2>&1'

# --- summary -----------------------------------------------------------------
printf '\n[fix] === summary ===\n'
for rc in "$OUT"/*.rc; do
  [ -e "$rc" ] || continue
  name="$(basename "$rc" .rc)"
  code="$(cat "$rc")"
  bytes="$(wc -c < "$OUT/$name.out" 2>/dev/null | tr -d ' ')"
  printf '[fix] %-34s rc=%-10s bytes=%s\n' "$name" "$code" "${bytes:-0}"
done
printf '[fix] fixtures in: %s\n' "$OUT"
