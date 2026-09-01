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

if echo "$url" | grep -q 'github.com/avatarDD/zapret-gui/archive/'; then
	commit=$(printf '%s' "$url" | sed -n 's#.*archive/\([0-9a-f]*\)\.tar\.gz#\1#p')
	archive_root="${Z2M_AVATAR_FIXTURE_ROOT:-${Z2M_STRATEGY_AVATAR_PACKAGE_ROOT:-}}"
	[ -n "$commit" ] && [ -d "$archive_root" ] || exit 1
	tmp=$(mktemp -d)
	name="zapret-gui-$commit"
	mkdir -p "$tmp/$name"
	cp -R "$archive_root"/. "$tmp/$name/catalogs/"
	tar -czf "$out" -C "$tmp" "$name"
	rm -rf "$tmp"
	exit 0
fi

case "$url" in
	*api.github.com/repos/avatarDD/zapret-gui/commits*)
		if [ "$mode" = "avatar-v2" ]; then
			printf '%s\n' '[{"sha":"1111111111111111111111111111111111111111"}]' > "$out"
		elif [ "$mode" = "avatar-corrupt" ]; then
			printf '%s\n' '[{"sha":"2222222222222222222222222222222222222222"}]' > "$out"
		else
			printf '%s\n' '[{"sha":"f9dd3ea47a2239514f396a843b475c92c33f0b4c"}]' > "$out"
		fi
		;;
	*api.github.com/repos/necronicle/z2k/commits*)
		if [ "$mode" = "two-files" ]; then
			printf '%s\n' '[{"sha":"dddddddddddddddddddddddddddddddddddddddd"}]' > "$out"
		elif [ "$mode" = "v2" ]; then
			printf '%s\n' '[{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]' > "$out"
		elif [ "$mode" = "mismatch" ]; then
			printf '[{"sha":"cccccccccccccccccccccccccccccccccccccccc","contentSha256":"%064d"}]\n' 0 > "$out"
		else
			printf '%s\n' '[{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]' > "$out"
		fi
		;;
	*raw.githubusercontent.com/necronicle/z2k/*/strats_new2.txt)
		if [ "$mode" = "z2k-invalid" ]; then
			printf '%s\n' 'not a valid z2k strategy corpus' > "$out"
		elif [ "$mode" = "v2" ]; then
			cp "$root/tests/fixtures/strategy-source-z2k/multi-profile.txt" "$out"
		else
			cp "$root/tests/fixtures/strategy-source-z2k/strats_new2.txt" "$out"
		fi
		;;
	*raw.githubusercontent.com/necronicle/z2k/*/quic_strats.ini)
		cp "$root/tests/fixtures/strategy-source-z2k/quic_strats.ini" "$out"
		;;
	*)
		exit 1
		;;
esac
