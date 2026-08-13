#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_ROOT="$(dirname "$SCRIPT_DIR")"
LOCK_PATH="$WORKTREE_ROOT/tools/docs-site/quartz.lock.json"
ARTIFACTS_DIR="$WORKTREE_ROOT/.artifacts/quartz"
DOCS_DIR="$WORKTREE_ROOT/docs"

if [[ ! -f "$LOCK_PATH" ]]; then
  echo "quartz.lock.json not found at $LOCK_PATH" >&2
  exit 1
fi

TAG=$(jq -r '.tag' "$LOCK_PATH")
COMMIT=$(jq -r '.commit' "$LOCK_PATH")
NODE_REQUIRED=$(jq -r '.node' "$LOCK_PATH")

# Step 1: Verify Node 22+
NODE_VERSION=$(node -v | sed 's/v//')
MAJOR=${NODE_VERSION%%.*}
if (( MAJOR < NODE_REQUIRED )); then
  echo "Node $NODE_REQUIRED+ required, found $NODE_VERSION" >&2
  exit 1
fi
echo "Node $NODE_VERSION OK"

QUARTZ_DIR="$ARTIFACTS_DIR/$TAG"

bootstrap_quartz() {
  if [[ ! -d "$QUARTZ_DIR" ]]; then
    mkdir -p "$ARTIFACTS_DIR"
    echo "Cloning Quartz $TAG ($COMMIT)..."
    git clone --depth 1 -b "$TAG" https://github.com/jackyzha0/quartz.git "$QUARTZ_DIR"
  fi
  pushd "$QUARTZ_DIR" >/dev/null
  ACTUAL=$(git rev-parse HEAD | tr -d '\n')
  if [[ "$ACTUAL" != "$COMMIT" ]]; then
    echo "SHA mismatch: expected $COMMIT, got $ACTUAL" >&2
    exit 1
  fi
  echo "SHA verified: $ACTUAL"
  if [[ ! -d node_modules ]]; then
    echo "Running npm ci..."
    npm ci
  fi
  popd >/dev/null
}

case "${1:-verify}" in
  verify)
    bootstrap_quartz
    echo "VERIFY OK"
    ;;
  serve)
    bootstrap_quartz
    echo "Starting Quartz dev server on docs/..."
    pushd "$QUARTZ_DIR" >/dev/null
    echo "URL: http://localhost:8080"
    npx quartz dev -d "$DOCS_DIR"
    popd >/dev/null
    ;;
  build)
    bootstrap_quartz
    echo "Building Quartz production site from docs/..."
    pushd "$QUARTZ_DIR" >/dev/null
    npx quartz build -d "$DOCS_DIR"
    popd >/dev/null
    echo "Build complete. Output in $QUARTZ_DIR/public"
    ;;
  clean)
    if [[ -d "$ARTIFACTS_DIR" ]]; then
      rm -rf "$ARTIFACTS_DIR"
      echo "Cleaned $ARTIFACTS_DIR"
    fi
    ;;
  *)
    echo "Unknown command: $1" >&2
    exit 1
    ;;
esac
