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

## Final Review Fix Evidence

### Findings Fixed

- Legacy `atomic_write` ordering is restored. `main.c` obtains the root mount ID
  and exclusive lock before `z2m_atomic_write()` performs path validation or
  base64 decoding. The shared byte publication body accepts that verified state
  without reacquiring the lock. `atomic_write_json` keeps canonical encoding
  before root open and uses the normal locking mode through the same body.
- Canonical allocation and construction failures now report exactly
  `EINTERNAL/canonical_encode`, including scanner key allocation,
  `json_c_input`, tokener allocation, and semantic construction. Malformed and
  domain failures retain their existing classifications.
- Production-helper coverage now runs every prepared accepted and rejected
  corpus vector, including ordinary U+0000 values, all required escapes,
  UTF-8 comparator ordering, int64 limits, and invalid classes.

### TDD RED

- Direct canonical allocation regression initially reported
  `EINTERNAL internal` instead of `EINTERNAL canonical_encode` for scanner-key
  allocation, json-c input allocation, and tokener allocation.
- Legacy lock-order regression initially returned `EPATH/path_validate` while
  an exclusive writer held the root lock; the required legacy result was
  `ELOCKED/lock_acquire`. Invalid base64 remained `ESCHEMA/schema` before lock
  attempt.

### TDD GREEN

- Focused command:
  `node --test --test-concurrency=1 tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs tests/native/core/atomic-write-json.test.mjs tests/native/core/atomic-write-json-property.test.mjs`
  Result: `42 passed, 0 failed, 0 skipped`.
- Root helper command:
  `node --test --test-concurrency=1 tests/native/core/fs-helper.test.mjs`
  Result: `96 passed, 0 failed, 0 skipped`.
- Full native command:
  `env PATH=/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin TMPDIR=/tmp bash scripts/test/native.sh`
  Result: `288 passed, 0 failed, 0 skipped` across broker, adapter, package,
  host, root, and production-helper phases.

### Build Evidence

- Strict helper build: PASS. Artifact SHA-256:
  `d8707304d839e4b70b22eae18739f6fbab9e4c090c36f0ffda87f005b8fd25ab`.
- Full helper ASan/UBSan build: PASS. Artifact SHA-256:
  `d732afe9815ba4874346902b43a2ba4afc735a41575c23a5d2c39e1ee721d940`.
- Canonical ASan/UBSan fixture build: PASS. Artifact SHA-256:
  `a6eec3c3410aa5dced6f9e1158905e3f13793ed26b961fc57508279e3521516d`.
  Smoke tests produced `{"a":1}` and `ESCHEMA canonical_validate` for a
  duplicate-key input with no sanitizer diagnostics.

### Current Evidence Hashes

- `canonical.c`: `2e99f961ed00148997585edcf0b61f46f4547425944711455dcff1afda643468`.
- Property test: `b3a83957334eb57ca6258fcde875556eeba5b858e39df660670dce75824e6893`.
- Exact-target artifact remains honest and unchanged: `NOT RUN` because the
  required `OPENWRT_SDK`, `SHARED_SDK`, `TARGET_ROOT`, `NODE_BIN`, `TARGET_CC`,
  `PROOT_BIN`, and `QEMU_AARCH64` variables are unavailable.
