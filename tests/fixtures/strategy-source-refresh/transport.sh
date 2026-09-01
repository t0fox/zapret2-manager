#!/bin/sh
set -eu

url="$1"
out="$2"
mode="${Z2M_FIXTURE_MODE:-ok}"
root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

if [ "$mode" = "error" ]; then
	exit 1
fi
if [ "$mode" = "avatar-error" ] && echo "$url" | grep -q 'avatarDD/zapret-gui'; then
	exit 1
fi
if [ "$mode" = "z2k-error" ] && echo "$url" | grep -q 'necronicle/z2k'; then
	exit 1
fi

case "$url" in
	*api.github.com/repos/avatarDD/zapret-gui/commits*)
		printf '%s\n' '[{"sha":"f9dd3ea47a2239514f396a843b475c92c33f0b4c"}]' > "$out"
		;;
	*api.github.com/repos/necronicle/z2k/commits*)
		if [ "$mode" = "v2" ]; then
			printf '%s\n' '[{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]' > "$out"
		elif [ "$mode" = "mismatch" ]; then
			printf '[{"sha":"cccccccccccccccccccccccccccccccccccccccc","contentSha256":"%064d"}]\n' 0 > "$out"
		else
			printf '%s\n' '[{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]' > "$out"
		fi
		;;
	*raw.githubusercontent.com/necronicle/z2k/*/strats_new2.txt)
		if [ "$mode" = "v2" ]; then
			cp "$root/tests/fixtures/strategy-source-z2k/multi-profile.txt" "$out"
		else
			cp "$root/tests/fixtures/strategy-source-z2k/strats_new2.txt" "$out"
		fi
		;;
	*)
		exit 1
		;;
esac
