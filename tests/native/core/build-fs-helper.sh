#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
SRC="$ROOT/zapret2-manager/src/z2m-core-helper"
OUT=${1:?output path required}
shift

case "$OUT" in
	-*|'') echo "output path must be the first argument and must not be option-like" >&2; exit 2 ;;
esac

OUT_DIR=$(dirname -- "$OUT")
OUT_NAME=$(basename -- "$OUT")
test -n "$OUT_NAME" && test "$OUT_NAME" != . && test "$OUT_NAME" != .. || {
	echo "output filename is required" >&2
	exit 2
}
test -d "$OUT_DIR" || {
	echo "output directory must already exist" >&2
	exit 2
}
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd -P)
case "$OUT_DIR/" in
	/tmp/*) ;;
	*) echo "output directory must be under /tmp" >&2; exit 2 ;;
esac
case "$OUT_DIR/" in
	"$ROOT/"*) echo "output directory must be outside the worktree" >&2; exit 2 ;;
esac
OUT="$OUT_DIR/$OUT_NAME"

CC=${CC:-cc}
case "$CC" in
	*' '*) echo "CC must name one compiler executable" >&2; exit 2 ;;
esac
COMPILER=$(command -v -- "$CC") || {
	echo "compiler executable not found" >&2
	exit 2
}
COMPILER=$(readlink -f -- "$COMPILER")
test -x "$COMPILER" || {
	echo "compiler executable is not executable" >&2
	exit 2
}

"$COMPILER" -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE "$@" \
	"$SRC/main.c" "$SRC/protocol.c" "$SRC/errors.c" \
	"$SRC/roots.c" "$SRC/paths.c" "$SRC/files.c" "$SRC/base64.c" \
	$(pkg-config --cflags --libs json-c) -o "$OUT"
