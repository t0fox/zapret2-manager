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
trap 'rm -f "$test_list"' 0 HUP INT TERM
root_test=tests/native/core/fs-helper.test.mjs
test -f "$root_test"

find tests/native -type f -name '*.test.mjs' ! -path "$root_test" -print | LC_ALL=C sort |
while IFS= read -r test_file; do
  printf '%s\0' "$test_file"
done > "$test_list"

count=$(tr -cd '\0' < "$test_list" | wc -c)
[ "$count" -gt 0 ] || { echo 'no native tests found' >&2; exit 1; }
xargs -0 node --test < "$test_list"

if [ "$(id -u)" -eq 0 ]; then
  node --test "$root_test"
else
  command -v sudo >/dev/null
  sudo --preserve-env=TMPDIR,UCODE_BIN,UCODE_LIBRARY_PATH "$node_bin" --test tests/native/core/fs-helper.test.mjs
fi
