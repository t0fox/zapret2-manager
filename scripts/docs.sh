#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1 && command -v node.exe >/dev/null 2>&1; then
  NODE_BIN="node.exe"
fi
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js 22+ is required (tried node and node.exe)." >&2
  exit 1
fi
SCRIPT_PATH="$SCRIPT_DIR/docs.mjs"
if [[ "$NODE_BIN" == "node.exe" && "$SCRIPT_PATH" == /mnt/* && -x "$(command -v wslpath 2>/dev/null || true)" ]]; then
  SCRIPT_PATH="$(wslpath -w "$SCRIPT_PATH")"
elif [[ "$NODE_BIN" == "node.exe" && "$SCRIPT_PATH" == /c/* && -x "$(command -v cygpath 2>/dev/null || true)" ]]; then
  SCRIPT_PATH="$(cygpath -w "$SCRIPT_PATH")"
fi
"$NODE_BIN" "$SCRIPT_PATH" "$@"
exit $?
