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
UNSAFE_PATH="$TMP_ROOT/unsupported-path"

cleanup() {
	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

UCODE_PATH=$(command -v "$UCODE" 2>/dev/null || true)
if [ -z "$UCODE_PATH" ] || [ ! -x "$UCODE_PATH" ]; then
	printf '[gate-ucode-compile] FAIL  compiler is not available or executable: %s\n' "$UCODE" >&2
	exit 1
fi

# The sorted manifest is line-based, so reject newline paths while find still
# supplies each complete pathname as one argument.
for root in "$SRC_ROOT" "$RPCD_ROOT"; do
	[ -d "$root" ] || continue
	find "$root" -type f -name '*.uc' -exec sh -c '
		marker=$1
		shift
		newline="
"
		for file do
			case "$file" in
				*"$newline"*) : >"$marker"; exit 0 ;;
			esac
		done
	' sh "$UNSAFE_PATH" {} \;
done
if [ -e "$UNSAFE_PATH" ]; then
	printf '[gate-ucode-compile] FAIL  unsupported newline in shipped ucode path\n' >&2
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
	if [ -n "$direct_output" ]; then
		printf '[gate-ucode-compile] direct compile diagnostics:\n%s\n' "$direct_output"
	fi
	if [ -n "$wrapper_output" ]; then
		printf '[gate-ucode-compile] import wrapper diagnostics:\n%s\n' "$wrapper_output"
	fi
	rc=1
done <"$FILES"

exit "$rc"
