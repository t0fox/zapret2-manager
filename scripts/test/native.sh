#!/bin/sh
# Native foundation gate.
#
# Orchestration contract:
#   - Independent phases never hide each other: a failure in one phase does
#     not prevent the remaining independent phases from running.
#   - True prerequisites stay fail-fast inside their dependent branch (e.g.
#     broker tests cannot run without the compiled production broker).
#   - Every phase reports PASS / FAIL / SKIPPED; the script exits non-zero
#     iff at least one required phase failed or was skipped because its
#     prerequisite failed. A pure environment skip (no sudo for the root
#     live integration) is reported as SKIPPED and does not fail the gate,
#     but it is never presented as live-correctness evidence.
#   - Raw stdout/stderr of every phase is streamed to this script's output
#     and kept in per-phase log files under $TMPDIR.

set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

STATUS_DIR=$(mktemp -d "${TMPDIR:-/tmp}/z2m-native-status.XXXXXXXXXX")
mkdir -p "$STATUS_DIR"
trap 'rm -rf "$STATUS_DIR"' 0 HUP INT TERM

SUMMARY_FILE=${GITHUB_STEP_SUMMARY:-}
summary() {
  if [ -n "$SUMMARY_FILE" ]; then
    printf '%s\n' "$*" >> "$SUMMARY_FILE"
  fi
  printf '%s\n' "$*"
}

record() {
  # record <name> <PASS|FAIL|SKIPPED> [detail]
  printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$STATUS_DIR/results.tsv"
}

run_logged() {
  # run_logged <logfile> <command...>  -> exit code of command
  logfile=$1
  shift
  "$@" > "$logfile" 2>&1
  rc=$?
  cat "$logfile"
  return $rc
}

# ---------------------------------------------------------------------------
# Prerequisites (fail-fast: no check can run without these)
# ---------------------------------------------------------------------------
require() {
  "$@" >/dev/null 2>&1 || {
    printf 'native tests require: %s\n' "$*" >&2
    exit 1
  }
}
[ "$(uname -s)" = Linux ] || { echo 'native tests require Linux' >&2; exit 1; }
require command -v node
node_bin=$(node -p 'process.execPath')
require command -v cc
require command -v pkg-config
require pkg-config --exists json-c

: "${TMPDIR:=$HOME/z2m-work/native-tmp}"
export TMPDIR
mkdir -p "$TMPDIR"

test_list="$TMPDIR/native-tests.$$.list"
production_broker="$TMPDIR/z2m-helperd-production.$$"

root_tests='tests/native/bootstrap.test.mjs tests/native/core/fs-helper.test.mjs tests/native/core/atomic-write-json-property.test.mjs tests/native/core/atomic-write-json-cas.test.mjs'
for root_test in $root_tests; do
  test -f "$root_test"
done

summary '## Native CI'
summary ''
summary '| Check | Result |'
summary '|---|---|'

# ---------------------------------------------------------------------------
# Phase 1: production broker build — prerequisite for the broker suites only
# ---------------------------------------------------------------------------
broker_status=FAIL
if run_logged "$TMPDIR/broker-build.log" cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -ljson-c -o "$production_broker"; then
  broker_status=PASS
else
  broker_status=FAIL
fi
record 'production-broker build' "$broker_status"

# ---------------------------------------------------------------------------
# Phase 2: fixed serial Node suites (independent of each other)
# ---------------------------------------------------------------------------
if [ "$broker_status" = PASS ]; then
  run_logged "$TMPDIR/broker-suite.log" node --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs &&
    record 'native-helper-broker' PASS || record 'native-helper-broker' FAIL
else
  cat "$TMPDIR/broker-build.log" >&2
  record 'native-helper-broker' SKIPPED 'prerequisite production broker build failed'
fi

run_logged "$TMPDIR/native-helper-suite.log" node --test --test-concurrency=1 tests/native/core/native-helper.test.mjs &&
  record 'native-helper' PASS || record 'native-helper' FAIL

run_logged "$TMPDIR/package-helper.log" node --test --test-concurrency=1 tests/native/package-helper.test.mjs &&
  record 'package-helper' PASS || record 'package-helper' FAIL

# ---------------------------------------------------------------------------
# Phase 3: full native/product matrix — every file runs regardless of any
# earlier file's result. File-level execution stays serial on purpose:
# several suites exercise the fixed production socket path
# (/tmp/zapret2-manager/runtime/z2m-helperd.sock) and concurrent runs would
# unlink or replace one another's socket. Per-file test concurrency remains
# controlled inside each suite via --test-concurrency=1.
# ---------------------------------------------------------------------------
find tests/native -type f -name '*.test.mjs' \
  ! -path tests/native/bootstrap.test.mjs \
  ! -path tests/native/core/fs-helper.test.mjs \
  ! -path tests/native/core/atomic-write-json-property.test.mjs \
  ! -path tests/native/core/atomic-write-json-cas.test.mjs \
  ! -path tests/native/core/native-helper-broker.test.mjs \
  ! -path tests/native/core/native-helper.test.mjs \
  ! -path tests/native/package-helper.test.mjs \
  ! -path tests/native/core/native-helper-transport-probe.test.mjs \
  ! -path tests/native/core/native-helper-broker-spike.test.mjs \
  ! -path tests/native/core/native-helper-production-e2e.test.mjs \
  -print | LC_ALL=C sort |
while IFS= read -r test_file; do
  printf '%s\0' "$test_file"
done > "$test_list"
find tests/product -type f -name '*.test.mjs' -print | LC_ALL=C sort |
while IFS= read -r test_file; do
  printf '%s\0' "$test_file"
done >> "$test_list"

count=$(tr -cd '\0' < "$test_list" | wc -c)
[ "$count" -gt 0 ] || { echo 'no native tests found' >&2; exit 1; }

matrix_log="$TMPDIR/matrix.log"
: > "$matrix_log"
while IFS= read -r test_file; do
  [ -n "$test_file" ] || continue
  if node --test --test-concurrency=1 "$test_file" >> "$matrix_log" 2>&1; then
    record "matrix:$test_file" PASS
  else
    record "matrix:$test_file" FAIL
    printf 'FAILED FILE: %s\n' "$test_file"
  fi
done < "$test_list"
cat "$matrix_log"

# ---------------------------------------------------------------------------
# Phase 4: privileged/live integration (single connected scenario)
# ---------------------------------------------------------------------------
if [ "$(id -u)" -eq 0 ]; then
  if run_logged "$TMPDIR/native-root.log" scripts/test/native-root.sh "$node_bin"; then
    record 'native-root (live integration)' PASS
  else
    record 'native-root (live integration)' FAIL
  fi
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  if sudo --preserve-env=UCODE_BIN,UCODE_LIBRARY_PATH,UCODE_MODULE_PATH sh scripts/test/native-root.sh "$node_bin" > "$TMPDIR/native-root.log" 2>&1; then
    cat "$TMPDIR/native-root.log"
    record 'native-root (live integration)' PASS
  else
    cat "$TMPDIR/native-root.log"
    record 'native-root (live integration)' FAIL
  fi
else
  record 'native-root (live integration)' SKIPPED 'no passwordless sudo in this environment; live correctness not verified here'
fi

# ---------------------------------------------------------------------------
# Final aggregation gate
# ---------------------------------------------------------------------------
summary ''
failed=0
skipped=0
passed=0
while IFS="$(printf '\t')" read -r name status detail; do
  case "$status" in
    PASS)
      passed=$((passed + 1))
      summary "| $name | ✅ PASS |"
      ;;
    FAIL)
      failed=$((failed + 1))
      summary "| $name | ❌ FAIL ${detail:+— $detail} |"
      ;;
    SKIPPED)
      skipped=$((skipped + 1))
      summary "| $name | ⏭ SKIPPED ${detail:+— $detail} |"
      ;;
  esac
done < "$STATUS_DIR/results.tsv"

summary ''
summary "Passed: $passed  Failed: $failed  Skipped: $skipped"

if [ "$failed" -gt 0 ]; then
  summary ''
  summary 'RESULT: FAILED'
  exit 1
fi
summary ''
summary 'RESULT: PASSED'
