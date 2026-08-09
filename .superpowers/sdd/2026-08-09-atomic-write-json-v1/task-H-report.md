# Task H Report

## Scope

Task H verification was run against input commit `7abbc2eee16d9b054c982244bf66c49c0191f67a`.
Production code, protocol transport, adapter, and M5 surfaces were not changed.

## TDD

- RED: the new evidence assertion failed because `atomic-write-json-exact-target-evidence.txt` did not exist.
- GREEN: the completed property/evidence suite passed 6/6 with zero failures and zero skips.

## Host Verification

- Focused root suite: 172 passed, 0 failed, 0 skipped.
- Root native gate: 201 passed across broker, adapter, package/property, and root phases; 0 failed, 0 skipped.
- Host compiler: `/usr/bin/cc`, GCC 15.2.0 (`Ubuntu 15.2.0-16ubuntu1`).
- Host json-c: 0.18.
- Strict helper build: PASS; included `canonical.c` and `-std=c11 -Wall -Wextra -Werror`.
- ASan/UBSan helper build: PASS; included `canonical.c`, `-fsanitize=address,undefined`, and `-fno-omit-frame-pointer`.
- Sanitized canonical fixture: PASS for canonical encoding and duplicate-key rejection; no sanitizer diagnostics.
- Package static checks and production package E2E source checks: PASS in the focused suite.

## Exact Target

Exact-target result: NOT RUN.

The required environment variables were absent: `OPENWRT_SDK`, `SHARED_SDK`, `TARGET_ROOT`, `NODE_BIN`, `TARGET_CC`, `PROOT_BIN`, and `QEMU_AARCH64`. The existing exact-target script was run as root and failed closed at the first missing variable, `OPENWRT_SDK`; no PASS was fabricated.

AArch64 musl artifact identity, packaged `z2m-core-helper`, APK SHA-256, and production package E2E execution are therefore NOT RUN. The tracked TAP artifact records this as an explicit one-test skip, and the evidence file records the exact missing variables, host corpus hashes, raw TAP hash, and host pass/fail/skip counts.

## Evidence

- Canonical corpus SHA-256: `f2b9008d5b1668367f932d2cc14828a31e36b5e2a1ae7e488ef4cec8424bbd35`.
- Mutation corpus SHA-256: `461292fb2fbf4944734ddf2c5e500f04d50cd4fbb40c986b0ff132a2afb292f7`.
- `canonical.c` SHA-256: `b522345184683e86a3a0a48f904ed277c65208f51ff4448a0410405da5374ea6`.
- Property test SHA-256: `3ebb0148adf730d7ad3a0c9025520703f9ab41c2c3a8685e0c2daf09c36041d6`.
- Raw NOT RUN TAP SHA-256: `7789ae634468e612216d2de0c248bb00a6627e70605f999dff3785078f460648`.

## Concerns

The only unresolved gate is unavailable AArch64 exact-target/package execution. Escaped U+0000 object-key policy remains the documented rejection policy and is covered by host tests.
