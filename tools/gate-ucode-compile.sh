#!/bin/sh
# Compile every shipped ucode script and module without executing it.

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ROOT=${SRC_ROOT:-"$HERE/zapret2-manager/files/usr/libexec/zapret2-manager"}
RPCD_ROOT=${RPCD_ROOT:-"$HERE/zapret2-manager/files/usr/share/rpcd/ucode"}
UCODE=${UCODE:-ucode}
TMP_ROOT=${TMPDIR:-/tmp}/gate-ucode-compile.$$
FILES="$TMP_ROOT/files"
WRAPPER="$TMP_ROOT/import-wrapper.uc"

cleanup() {
	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$TMP_ROOT"
: >"$FILES"
for root in "$SRC_ROOT" "$RPCD_ROOT"; do
	[ -d "$root" ] && find "$root" -type f -name '*.uc' >>"$FILES"
done

rc=0
while IFS= read -r file; do
	compile_file=$file
	if grep -q '^[[:space:]]*export[[:space:]]' "$file"; then
		printf "import * as gate_module from '%s';\n" "$file" >"$WRAPPER"
		compile_file=$WRAPPER
	fi

	if output=$("$UCODE" -c -o /dev/null "$compile_file" 2>&1); then
		printf '[gate-ucode-compile] ok    %s\n' "$file"
	else
		printf '[gate-ucode-compile] FAIL  %s (ucode -c non-zero)\n' "$file"
		[ -n "$output" ] && printf '%s\n' "$output"
		rc=1
	fi
done <"$FILES"

exit "$rc"
