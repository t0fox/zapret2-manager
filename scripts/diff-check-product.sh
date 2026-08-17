#!/bin/sh
set -eu

# Product-owned files must satisfy Git's whitespace gate.  These two exact
# path families are imported canonical/runtime inputs whose byte fidelity is
# checked by their own provenance/integrity gates; normalizing them here would
# silently change the imported artifact.
git diff --check "$@" -- \
  . \
  ':(exclude)zapret2-manager/files/usr/share/zapret2-manager/catalog/forgejo/direct/**' \
  ':(exclude)zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/**'
