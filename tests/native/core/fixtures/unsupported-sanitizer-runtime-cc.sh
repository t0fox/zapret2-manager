#!/bin/sh
set -eu

OUT=
while test "$#" -gt 0; do
	if test "$1" = -o; then
		shift
		OUT=${1:?output required}
	fi
	shift
done
test -n "$OUT"
printf '%s\n' '#!/bin/sh' 'echo "probe: error while loading shared libraries: libasan.so: cannot open shared object file" >&2' 'exit 127' > "$OUT"
chmod 0700 "$OUT"
