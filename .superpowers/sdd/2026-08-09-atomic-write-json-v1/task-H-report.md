# Task H Report

## Scope

This repair reviewed the Task H report and diff at input commit
`e2a7b3b12b3480dfe6bd3ad67e80325c4107fff2` and changed only verification tests,
TAP/evidence artifacts, and this report. Production sources, the protocol
manifest, adapter, and M5 surfaces were not changed.

## TDD

### RED

Command:

```sh
/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test --test-concurrency=1 tests/native/core/atomic-write-json-property.test.mjs
```

The first repaired run produced 7 passing and 2 failing tests. The failures
were intentional: the old evidence artifact lacked the required host command
and result fields, and the strengthened allocation assertion rejected the
observed exit 74 response-less early-allocation path instead of accepting a
generic nonzero result. The three new production-helper boundary cases passed
against the existing implementation.

### GREEN

The minimum changes made the evidence/TAP pair internally consistent, kept
early helper allocator faults fail-closed without publication artifacts, and
made the canonical encoder allocation process assert normal status plus the
exact `EINTERNAL canonical_encode` output. The final focused run passed 40/40
tests with 0 failures and 0 skips.

## Host Verification

Focused command:

```sh
/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test --test-concurrency=1 tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs tests/native/core/atomic-write-json.test.mjs tests/native/core/atomic-write-json-property.test.mjs
```

Result: 40 passed, 0 failed, 0 skipped.

Full native gate:

```sh
env PATH=/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin:/usr/bin:/bin TMPDIR=/tmp bash scripts/test/native.sh
```

Result: 284 passed, 0 failed, 0 skipped across all broker, adapter, package,
host, and root phases.

Strict helper build:

```sh
env TMPDIR=/home/kirill/z2m-work/native-tmp sh tests/native/core/build-fs-helper.sh /home/kirill/z2m-work/native-tmp/z2m-core-helper-strict-task-h
```

Result: PASS. Artifact SHA-256:
`3a97440fe501bf41811d2bb96171788a3a19a627268e2c08de0af5ffed93e654`.

Sanitizer build:

```sh
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -fsanitize=address,undefined -fno-omit-frame-pointer -I zapret2-manager/src/z2m-core-helper tests/native/core/canonical-validator-fixture.c zapret2-manager/src/z2m-core-helper/canonical.c -ljson-c -Wl,--wrap=free -o /home/kirill/z2m-work/native-tmp/z2m-canonical-validator-asan-task-h
```

Result: PASS. Artifact SHA-256:
`e0e355fe4379e4a60a7d10884f921c2389006b936d1b53ac882db2cab66469a6`.

Sanitizer tests passed for canonical `{"a":1}` encoding and duplicate-key
rejection (`ESCHEMA canonical_validate`), with no sanitizer diagnostics.

The production-helper property matrix now covers the 4 MiB request boundary,
521028/521029 canonical output, exact/one-over global member count, exact/one-
over decoded UTF-8 key bytes, allocator fail-closed behavior, candidate
cleanup, target state, and all uncertainty phases.

## Exact Target

Command:

```sh
bash scripts/test/native-m3-exact-target.sh
```

Result: `NOT RUN`. The script failed closed immediately because `OPENWRT_SDK`
was unavailable; the required exact-target variables were not supplied:
`OPENWRT_SDK SHARED_SDK TARGET_ROOT NODE_BIN TARGET_CC PROOT_BIN QEMU_AARCH64`.
No AArch64 binary, package, APK, or production package E2E result is claimed.

The tracked TAP is valid and honest: `1..1`, one explicit skipped test, 0
passes, 0 failures, 1 skip. SHA-256:
`a7afa7d5ec8537627d7cd3c105c7f665e306458716322871889bdd4cb929b6c1`.

## Evidence

- Exact-target result: `NOT RUN`.
- Host property matrix: 9 passed, 0 failed, 0 skipped.
- Canonical corpus SHA-256: `f2b9008d5b1668367f932d2cc14828a31e36b5e2a1ae7e488ef4cec8424bbd35`.
- Mutation corpus SHA-256: `461292fb2fbf4944734ddf2c5e500f04d50cd4fbb40c986b0ff132a2afb292f7`.
- `canonical.c` SHA-256: `b522345184683e86a3a0a48f904ed277c65208f51ff4448a0410405da5374ea6`.
- Property test SHA-256: `93325497173299918fe406db5d193e84358dccd2d8e4244affd359c565edf359`.

## Final Status

Host verification: PASS. Exact AArch64 target/package verification: NOT RUN.
The remaining concern is the unavailable exact-target environment; this Task H
run does not fabricate an AArch64 result.
