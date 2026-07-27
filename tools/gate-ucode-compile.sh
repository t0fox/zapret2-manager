#!/bin/sh
# tools/gate-ucode-compile.sh — compile gate for the shipped ucode files.
#
# Compiles every SHIPPED .uc file with `ucode -c` (compile to bytecode, no
# execution) and fails the gate if any file does not compile. This catches the
# unclosed-brace class of defect the existing gates did not catch (a syntax
# error that surfaces at plugin load as a blank LuCI page with no error).
#
# ucode does not run in this build environment (no binary), so this gate is
# intended for tools/smoke.sh on the TARGET (where ucode is present). Locally
# the gate's red-ability is proven by tests/gate-ucode-compile.test.sh, which
# emulates `ucode -c` via a node bracket-check against a deliberately broken
# sample and a correct one.
#
# Usage (on target):  tools/gate-ucode-compile.sh
# Exit 0 = all shipped .uc compile; non-zero = at least one failed (gate reds).

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/zapret2-manager/files/usr/libexec/zapret2-manager"
RPCD="$HERE/zapret2-manager/files/usr/share/rpcd/ucode"

# ucode -c: compile to bytecode, no execution. -o /dev/null discards output.
# A syntax error (unclosed brace, etc.) makes ucode -c exit non-zero.
rc=0
for f in "$SRC"/*.uc "$RPCD"/*.uc; do
	[ -f "$f" ] || continue
	# skip the broken self-test sample (it is not shipped)
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
