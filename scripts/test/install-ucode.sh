#!/bin/sh
set -eu

version=v0.0.20250529
archive_sha256=464aed711d404d56380a474404dc942c3e97784c9c018cb61633aca2f7e699df
prefix=${1:?installation prefix required}
work=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/z2m-ucode-build
archive=$work/ucode.tar.gz
source=$work/source
build=$work/build

rm -rf "$work"
mkdir -p "$source" "$build" "$prefix"
curl -fsSL "https://github.com/jow-/ucode/archive/refs/tags/$version.tar.gz" -o "$archive"
printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum -c -
tar -xzf "$archive" -C "$source" --strip-components=1

cmake -S "$source" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DCMAKE_C_FLAGS=-Wno-error=discarded-qualifiers \
  -DDEBUG_SUPPORT=OFF -DFS_SUPPORT=OFF -DMATH_SUPPORT=OFF \
  -DRESOLV_SUPPORT=OFF -DSTRUCT_SUPPORT=OFF -DLOG_SUPPORT=OFF \
  -DSOCKET_SUPPORT=OFF -DZLIB_SUPPORT=OFF -DDIGEST_SUPPORT=OFF
cmake --build "$build" --target ucode
mkdir -p "$prefix/bin" "$prefix/lib"
cp "$build/ucode" "$prefix/bin/ucode"
cp "$build"/libucode.so* "$prefix/lib/"

LD_LIBRARY_PATH="$prefix/lib" "$prefix/bin/ucode" -e 'print("ucode-ready\\n");'
