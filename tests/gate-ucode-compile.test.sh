#!/bin/sh
# tests/gate-ucode-compile.test.sh — self-test for the compile gate.
#
# Rule: a gate whose red-ability is unproven is considered ABSENT. This proves
# the compile gate (tools/gate-ucode-compile.sh) can go red: it must return
# non-zero on a deliberately BROKEN ucode file (unbalanced braces — the same
# defect class the real watchdog.uc carries) and zero on a CORRECT one.
#
# ucode does not run in this build environment (no binary), so the gate itself
# runs `ucode -c` on the TARGET. This self-test emulates `ucode -c` LOCALLY via a
# node bracket-check that STRIPS comments (// to EOL) and string literals ("..."
# and '...') BEFORE counting, so brackets inside comments/strings do not
# cause false imbalances (mirrors ucode -c parsing the code, not raw text).
#
# Run: sh tests/gate-ucode-compile.test.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE=${NODE:-node}

# balance <file>: exit 0 if balanced, non-zero if unbalanced. Emulates ucode -c
# for the brace class; comments and string literals are stripped first so
# brackets inside them do not cause false imbalances.
balance() {
	"$NODE" -e '
		const fs = require("fs");
		let s = fs.readFileSync(process.argv[1], "utf8");
		s = s.replace(/\/\/.*$/gm, "");
		s = s.replace(/"[^"]*"/g, "");
		s = s.replace(/\x27[^\x27]*\x27/g, "");
		let d = 0, p = 0, b = 0;
		for (const c of s) {
			if (c === "{") d++;
			else if (c === "}") d--;
			else if (c === "(") p++;
			else if (c === ")") p--;
			else if (c === "[") b++;
			else if (c === "]") b--;
		}
		process.exit((d || p || b) ? 1 : 0);
	' "$1"
}

BROKEN="$HERE/tests/fixtures/ucode-broken-sample.uc"
# a correct sample: a known-balanced .uc (apply.uc on main carries a pre-existing
# brace/paren imbalance from another agent's consolidation — not a clean sample;
# use the gate-samples/good.uc instead).
CORRECT="$HERE/tests/fixtures/gate-samples/good.uc"

fail=0

# 1) the gate MUST red on a broken file (unbalanced braces -> non-zero)
if balance "$BROKEN"; then
	printf '[gate-ucode-compile selftest] FAIL: broken sample did not red the gate\n'
	fail=1
else
	printf '[gate-ucode-compile selftest] ok: broken sample reds the gate (non-zero)\n'
fi

# 2) the gate MUST NOT red on a correct file (balanced -> zero)
if balance "$CORRECT"; then
	printf '[gate-ucode-compile selftest] ok: correct sample is green (zero)\n'
else
	printf '[gate-ucode-compile selftest] FAIL: correct sample red the gate (should be zero)\n'
	fail=1
fi

exit "$fail"
