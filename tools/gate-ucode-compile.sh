#!/bin/sh
# Compile every shipped ucode script and module without executing it.

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ROOT=${SRC_ROOT:-"$HERE/zapret2-manager/files/usr/libexec/zapret2-manager"}
RPCD_ROOT=${RPCD_ROOT:-"$HERE/zapret2-manager/files/usr/share/rpcd/ucode"}
UCODE=${UCODE:-ucode}
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gate-ucode-compile.XXXXXX") || {
	printf '[gate-ucode-compile] FAIL  unable to create private temporary directory\n' >&2
	exit 1
}
FILES="$TMP_ROOT/files"
WRAPPER="$TMP_ROOT/import-wrapper.uc"

cleanup() {
	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

UCODE_PATH=$(command -v "$UCODE" 2>/dev/null || true)
if [ -z "$UCODE_PATH" ] || [ ! -x "$UCODE_PATH" ]; then
	printf '[gate-ucode-compile] FAIL  compiler is not available or executable: %s\n' "$UCODE" >&2
	exit 1
fi

: >"$FILES"
for root in "$SRC_ROOT" "$RPCD_ROOT"; do
	[ -d "$root" ] && find "$root" -type f -name '*.uc' >>"$FILES"
done
LC_ALL=C sort -o "$FILES" "$FILES"

rc=0
while IFS= read -r file; do
	if direct_output=$("$UCODE_PATH" -c -o /dev/null "$file" 2>&1); then
		printf '[gate-ucode-compile] ok    %s\n' "$file"
		continue
	fi

	encoded_file=$(printf '%s' "$file" | sed 's/\\/\\\\/g; s/"/\\"/g')
	printf 'import * as gate_module from "%s";\n' "$encoded_file" >"$WRAPPER"
	if wrapper_output=$("$UCODE_PATH" -c -o /dev/null "$WRAPPER" 2>&1); then
		printf '[gate-ucode-compile] ok    %s\n' "$file"
		continue
	fi

	printf '[gate-ucode-compile] FAIL  %s (ucode -c non-zero)\n' "$file"
	[ -n "$direct_output" ] && printf '%s\n' "$direct_output"
	[ -n "$wrapper_output" ] && printf '%s\n' "$wrapper_output"
	rc=1
done <"$FILES"

exit "$rc"
