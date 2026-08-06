#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
SRC="$ROOT/zapret2-manager/src/z2m-core-helper"
OUT=${1:?output path required}
shift

cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE "$@" \
	"$SRC/main.c" "$SRC/protocol.c" "$SRC/errors.c" \
	"$SRC/roots.c" "$SRC/paths.c" "$SRC/files.c" "$SRC/base64.c" \
	$(pkg-config --cflags --libs json-c) -o "$OUT"
