#!/bin/sh
# Failing build test for Task 2 (ownership helper skeleton)
# Must fail until main.c + ownership.c + ownership.h exist and produce a working binary

set -e

HELPER_DIR="src/z2m-scanner-ownership-helper"
BINARY="$HELPER_DIR/z2m-scanner-ownership-helper"

if [ ! -f "$HELPER_DIR/main.c" ] || [ ! -f "$HELPER_DIR/ownership.c" ] || [ ! -f "$HELPER_DIR/ownership.h" ]; then
    echo "FAIL: source files missing (main.c ownership.c ownership.h)"
    exit 1
fi

if [ ! -x "$BINARY" ]; then
    echo "FAIL: binary not built or not executable"
    exit 1
fi

VERSION_OUTPUT="$("$BINARY" --version 2>&1 || true)"
if echo "$VERSION_OUTPUT" | grep -q "z2m-scanner-ownership-helper v0"; then
    echo "PASS: ownership helper builds and reports version"
    exit 0
else
    echo "FAIL: binary did not report expected version string"
    echo "Got: $VERSION_OUTPUT"
    exit 1
fi
