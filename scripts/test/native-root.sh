#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo 'root-required native tests must run as root' >&2; exit 1; }
node_bin=${1:?node executable required}

root_tmp=$(mktemp -d /tmp/z2m-native-root.XXXXXXXXXX)
trap 'rm -rf -- "$root_tmp"' 0 HUP INT TERM
TMPDIR=$root_tmp
export TMPDIR

"$node_bin" --test tests/native/bootstrap.test.mjs tests/native/core/fs-helper.test.mjs
