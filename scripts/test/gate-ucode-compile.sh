#!/bin/sh
# scripts/test/gate-ucode-compile.sh — compile gate for shipped ucode files.

set -u
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$HERE/zapret2-manager/files/usr/libexec/zapret2-manager"
RPCD="$HERE/zapret2-manager/files/usr/share/rpcd/ucode"

rc=0
for f in "$SRC"/*.uc "$SRC"/*/*.uc "$RPCD"/*.uc; do
	[ -f "$f" ] || continue
	case "$(basename "$f")" in
		ucode-broken-sample.uc) continue ;;
	esac
	if ! ucode -c -o /dev/null "$f" >/dev/null 2>&1; then
		printf '[gate-ucode-compile] FAIL  %s (ucode -c non-zero)\n' "$f"
		rc=1
	else
		printf '[gate-ucode-compile] ok    %s\n' "$f"
	fi
done

exit "$rc"
