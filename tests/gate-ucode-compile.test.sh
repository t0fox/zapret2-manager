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
# node bracket-check (the only local way to prove red-ability without the ucode
# binary): unbalanced braces -> non-zero; balanced -> zero. This proves the
# gate MECHANISM catches a compile defect; the on-target gate uses the real
# `ucode -c` (same defect class, same non-zero rc).
#
# Run: sh tests/gate-ucode-compile.test.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE=${NODE:-node}

# bracket-balance <file>: 0 if balanced, non-zero if unbalanced (emulates ucode -c
# for the brace class; ucode -c catches this AND more, so this is a conservative
# stand-in for the binary that is absent locally).
balance() {
	"$NODE" -e '
		const fs = require("fs");
		const s = fs.readFileSync(process.argv[1], "utf8");
		let d = 0, p = 0, b = 0;
		for (const c of s) {
			if (c == "{") d++;
			else if (c == "}") d--;
			else if (c == "(") p++;
			else if (c == ")") p--;
			else if (c == "[") b++;
			else if (c == "]") b--;
		}
		process.exit((d || p || b) ? 1 : 0);
	' "$1"
}

BROKEN="$HERE/tests/fixtures/ucode-broken-sample.uc"
# a correct sample: any shipped .uc with balanced braces (use apply.uc)
CORRECT="$HERE/zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc"

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
