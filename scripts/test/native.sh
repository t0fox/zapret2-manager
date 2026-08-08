#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

[ "$(uname -s)" = Linux ] || { echo 'native tests require Linux' >&2; exit 1; }
command -v node >/dev/null
command -v cc >/dev/null
command -v pkg-config >/dev/null
pkg-config --exists json-c

: "${TMPDIR:=$HOME/z2m-work/native-tmp}"
export TMPDIR
mkdir -p "$TMPDIR"

set --
find tests/native -type f -name '*.test.mjs' -print | LC_ALL=C sort |
while IFS= read -r test_file; do
  printf '%s\0' "$test_file"
done > "$TMPDIR/native-tests.$$.list"

count=$(tr -cd '\0' < "$TMPDIR/native-tests.$$.list" | wc -c)
[ "$count" -gt 0 ] || { echo 'no native tests found' >&2; exit 1; }
xargs -0 node --test < "$TMPDIR/native-tests.$$.list"
rm -f "$TMPDIR/native-tests.$$.list"
