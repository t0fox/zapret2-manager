#!/bin/ash
set -eu

fail() { printf '%s\n' "{\"ok\":false,\"error\":{\"code\":\"EPROBEDEPENDENCY\",\"message\":\"$1\",\"details\":{}}}"; exit 1; }

transport=/usr/bin/ncat
[ -x "$transport" ] || fail 'required transport /usr/bin/ncat is missing; install package ncat'
version=$("$transport" --version 2>&1 | head -n 1 | tr '"' "'" || true)
case "$version" in *Ncat*) ;; *) fail 'transport is not Ncat';; esac

# blockcheck2.sh uses exactly: ncat -z -w 2 <IPv4> <port>.
probe=$("$transport" -z -w 1 192.0.2.1 9 >/dev/null 2>&1; echo $?)
case "$probe" in 0|1|2) ;; *) fail 'ncat does not support required -z/-w TCP probe flags';; esac

tmp=/tmp/z2m-preflight.$$
trap 'rm -f "$tmp"' EXIT INT TERM
printf 'stdin-ok\n' >"$tmp" || fail 'temporary directory is not writable'
[ -s "$tmp" ] || fail 'temporary file probe failed'
[ -x /opt/zapret2/blockcheck2.sh ] || fail 'zapret2 blockcheck2.sh is missing'
[ -x /opt/zapret2/nfq2/nfqws2 ] || fail 'required zapret2 binary /opt/zapret2/nfq2/nfqws2 is missing'

printf '%s\n' "{\"ok\":true,\"transport\":\"$transport\",\"transportVersion\":\"$version\",\"capabilities\":[\"tcp\",\"ipv4\",\"zero-io\",\"timeout-w\"]}"
