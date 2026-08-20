#!/bin/ash
set -u

VERSION="$1"
DEST=/opt/blockcheckw/blockcheckw
REPO=rcd27/blockcheckw
case "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) printf '%s\n' '{"ok":false,"error":{"code":"EINPUT","message":"version is invalid"}}'; exit 2 ;; esac

arch=$(uname -m)
case "$arch" in
    x86_64|amd64) asset=x86_64;; i?86|i586|i686) asset=x86;; aarch64|arm64) asset=arm64;; armv7*|armv6*|arm*) asset=arm;; mips64*) asset=mips64;; mipsel*|mipsle*) asset=mipsel;; mips*) asset=mips;; ppc|powerpc) asset=ppc;; riscv64*) asset=riscv64;; *) printf '%s\n' '{"ok":false,"error":{"code":"EDEPENDENCY","message":"architecture is unsupported"}}'; exit 3;;
esac

tmp=$(mktemp -d /tmp/z2m-blockcheckw.XXXXXX 2>/dev/null) || { printf '%s\n' '{"ok":false,"error":{"code":"EDEPENDENCY","message":"temporary staging directory unavailable"}}'; exit 3; }
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM
name="blockcheckw-linux-$asset.tar.gz"
base="https://github.com/$REPO/releases/download/$VERSION"
if ! curl -fsSL --connect-timeout 5 --max-time 120 -o "$tmp/$name" "$base/$name" || ! curl -fsSL --connect-timeout 5 --max-time 120 -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt"; then
    printf '%s\n' '{"ok":false,"error":{"code":"ENETWORK","message":"BlockCheckW release download failed"}}'; exit 4
fi
if ! (cd "$tmp" && grep "  $name$" SHA256SUMS.txt | sha256sum -c -s -); then
    printf '%s\n' '{"ok":false,"error":{"code":"EVERIFY","message":"BlockCheckW checksum verification failed"}}'; exit 5
fi
if ! tar xzf "$tmp/$name" -C "$tmp" || [ ! -f "$tmp/blockcheckw" ]; then
    printf '%s\n' '{"ok":false,"error":{"code":"EVERIFY","message":"BlockCheckW archive is malformed"}}'; exit 5
fi
mkdir -p /opt/blockcheckw
old="$DEST.previous"
rm -f "$old"
if [ -f "$DEST" ]; then mv "$DEST" "$old" || { printf '%s\n' '{"ok":false,"error":{"code":"EIO","message":"current BlockCheckW could not be staged for rollback"}}'; exit 6; }; fi
mv "$tmp/blockcheckw" "$DEST" && chmod 0755 "$DEST"
if ! "$DEST" --version >/dev/null 2>&1; then
    rm -f "$DEST"
    [ -f "$old" ] && mv "$old" "$DEST"
    printf '%s\n' '{"ok":false,"error":{"code":"EVERIFY","message":"installed BlockCheckW failed post-install verification"}}'; exit 5
fi
rm -f "$old"
printf '{"ok":true,"version":"%s","path":"%s","compatibility":"UNKNOWN"}\n' "$VERSION" "$DEST"
