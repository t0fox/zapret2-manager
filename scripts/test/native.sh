#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

[ "$(uname -s)" = Linux ] || { echo 'native tests require Linux' >&2; exit 1; }
command -v node >/dev/null
node_bin=$(node -p 'process.execPath')
command -v cc >/dev/null
command -v pkg-config >/dev/null
pkg-config --exists json-c

: "${TMPDIR:=$HOME/z2m-work/native-tmp}"
export TMPDIR
mkdir -p "$TMPDIR"

test_list="$TMPDIR/native-tests.$$.list"
production_broker="$TMPDIR/z2m-helperd-production.$$"
trap 'rm -f "$test_list" "$production_broker"' 0 HUP INT TERM
root_tests='tests/native/bootstrap.test.mjs tests/native/core/fs-helper.test.mjs tests/native/core/atomic-write-json-property.test.mjs tests/native/core/atomic-write-json-cas.test.mjs'
for root_test in $root_tests; do
  test -f "$root_test"
done

cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  zapret2-manager/src/z2m-helperd/z2m-helperd.c \
  zapret2-manager/src/z2m-helperd/transport.c \
  zapret2-manager/src/z2m-helperd/supervise.c \
  -ljson-c -o "$production_broker"

node --test --test-concurrency=1 tests/native/core/native-helper-broker.test.mjs
node --test --test-concurrency=1 tests/native/core/native-helper.test.mjs
node --test --test-concurrency=1 tests/native/package-helper.test.mjs

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
xargs -0 node --test < "$test_list"

if [ "$(id -u)" -eq 0 ]; then
  scripts/test/native-root.sh "$node_bin"
else
  command -v sudo >/dev/null
  sudo --preserve-env=UCODE_BIN,UCODE_LIBRARY_PATH scripts/test/native-root.sh "$node_bin"
fi
