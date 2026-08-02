#!/bin/ash
set -eu

fail() { printf '%s\n' "{\"ok\":false,\"status\":\"missing-dependency\",\"reasonCode\":\"$1\",\"error\":{\"code\":\"EPROBEDEPENDENCY\",\"message\":\"$2\",\"details\":{\"reasonCode\":\"$1\"}}}"; exit 1; }

transport=/usr/bin/ncat
[ -x "$transport" ] || fail TRANSPORT_MISSING 'required transport /usr/bin/ncat is missing; install package ncat'
version=$("$transport" --version 2>&1 | head -n 1 | tr '"' "'" || true)
case "$version" in *Ncat*) ;; *) fail TRANSPORT_INVALID 'transport is not Ncat';; esac

# blockcheck2.sh uses exactly: ncat -z -w 2 <IPv4> <port>.
probe=$("$transport" -z -w 1 192.0.2.1 9 >/dev/null 2>&1; echo $?)
case "$probe" in 0|1|2) ;; *) fail TRANSPORT_FLAGS 'ncat does not support required -z/-w TCP probe flags';; esac

tmp=/tmp/z2m-preflight.$$
trap 'rm -f "$tmp"' EXIT INT TERM
printf 'stdin-ok\n' >"$tmp" || fail TEMP_UNWRITABLE 'temporary directory is not writable'
[ -s "$tmp" ] || fail TEMP_PROBE 'temporary file probe failed'
[ -x /opt/zapret2/blockcheck2.sh ] || fail SCANNER_MISSING 'zapret2 blockcheck2.sh is missing'
[ -x /opt/zapret2/nfq2/nfqws2 ] || fail NFQWS2_MISSING 'required zapret2 binary /opt/zapret2/nfq2/nfqws2 is missing'
[ -x /usr/bin/curl ] || fail CURL_MISSING 'required curl probe executable is missing'
manifest=/usr/libexec/zapret2-manager/services/discord.json
[ -r "$manifest" ] || fail CATALOG_MISSING 'Discord service manifest is missing'
grep -q '"probe": "https"' "$manifest" || fail TARGET_MANIFEST_INVALID 'Discord HTTPS target is not declared'
grep -q '"probe": "websocket"' "$manifest" || fail TARGET_MANIFEST_INVALID 'Discord WebSocket target is not declared'
grep -q '"probe": "bounded_download"' "$manifest" || fail TARGET_MANIFEST_INVALID 'Discord bounded-download target is not declared'

printf '%s\n' "{\"ok\":true,\"status\":\"ready\",\"reasonCode\":null,\"createsRun\":false,\"transport\":\"$transport\",\"transportVersion\":\"$version\",\"dependencies\":[{\"id\":\"transport\",\"path\":\"$transport\",\"ready\":true},{\"id\":\"scanner\",\"path\":\"/opt/zapret2/blockcheck2.sh\",\"ready\":true},{\"id\":\"curl\",\"path\":\"/usr/bin/curl\",\"ready\":true},{\"id\":\"service-catalog\",\"path\":\"$manifest\",\"ready\":true}],\"targets\":[{\"id\":\"web\",\"probe\":\"https\",\"adapter\":\"orchestra-candidate-run.sh\",\"ready\":true},{\"id\":\"gateway\",\"probe\":\"websocket\",\"adapter\":\"orchestra-candidate-run.sh\",\"ready\":true},{\"id\":\"cdn\",\"probe\":\"bounded_download\",\"adapter\":\"orchestra-candidate-run.sh\",\"ready\":true}],\"capabilities\":[\"tcp\",\"ipv4\",\"zero-io\",\"timeout-w\"]}"
