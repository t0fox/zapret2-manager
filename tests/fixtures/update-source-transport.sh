#!/bin/sh
set -eu

url="$1"
output="$2"
meta="$output.meta.json"
count_file="${Z2M_FIXTURE_COUNT_FILE:-}"

if [ -n "$count_file" ]; then
	printf '%s\n' "$url" >> "$count_file"
fi

if [ "${Z2M_FIXTURE_DELAY_SEC:-0}" != "0" ]; then
	sleep "$Z2M_FIXTURE_DELAY_SEC"
fi

mode="${Z2M_FIXTURE_MODE:-ok}"
case "$mode" in
	ok)
		printf '%s' "${Z2M_FIXTURE_BODY:-{\"kind\":\"fixture\",\"value\":1}}" > "$output"
		printf '%s' '{"status":200,"headers":{"x-ratelimit-limit":"60","x-ratelimit-remaining":"59","etag":"fixture-etag","last-modified":"Sat, 29 Aug 2026 00:00:00 GMT"}}' > "$meta"
		;;
	malformed)
		printf '%s' '{"kind":' > "$output"
		printf '%s' '{"status":200}' > "$meta"
		;;
	not_modified)
		: > "$output"
		printf '%s' '{"status":304}' > "$meta"
		;;
	blockcheckw)
		printf '%s' '{"tag_name":"v1.2.3","name":"BlockCheckW 1.2.3"}' > "$output"
		printf '%s' '{"status":200,"headers":{"x-ratelimit-limit":"60","x-ratelimit-remaining":"59"}}' > "$meta"
		;;
	engine)
		printf '%s' '[{"tag_name":"v1.0.5","draft":false,"prerelease":false,"published_at":"2026-08-29T00:00:00Z","id":105,"assets":[{"name":"zapret2-v1.0.5-openwrt-embedded.tar.gz","state":"uploaded","size":1024,"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","browser_download_url":"https://github.com/bol-van/zapret2/releases/download/v1.0.5/zapret2-v1.0.5-openwrt-embedded.tar.gz"},{"name":"sha256sum.txt","state":"uploaded","size":64,"digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","browser_download_url":"https://github.com/bol-van/zapret2/releases/download/v1.0.5/sha256sum.txt"}]}]' > "$output"
		printf '%s' '{"status":200,"headers":{"x-ratelimit-limit":"60","x-ratelimit-remaining":"59"}}' > "$meta"
		;;
	engine_empty)
		printf '%s' '[]' > "$output"
		printf '%s' '{"status":200,"headers":{"x-ratelimit-limit":"60","x-ratelimit-remaining":"59"}}' > "$meta"
		;;
	rate)
		: > "$output"
		printf '%s' "{\"status\":403,\"headers\":{\"x-ratelimit-limit\":\"60\",\"x-ratelimit-remaining\":\"0\",\"x-ratelimit-reset\":\"${Z2M_FIXTURE_RESET_AT:-4102444800}\"}}" > "$meta"
		;;
	rate_inferred)
		: > "$output"
		printf '%s\n' 'HTTP/1.1 403 Forbidden' >&2
		exit 22
		;;
	timeout)
		: > "$output"
		sleep "${Z2M_FIXTURE_TIMEOUT_SEC:-1}"
		exit 124
		;;
	error)
		: > "$output"
		printf '%s' '{"status":599}' > "$meta"
		exit 7
		;;
esac
