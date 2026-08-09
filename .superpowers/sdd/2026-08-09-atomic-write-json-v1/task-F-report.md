# Task F Report

## RED Evidence

Focused command, before stale-test fixes:

```text
env TMPDIR=/tmp /home/kirill/.local/bin/node --test --test-concurrency=1 tests/native/core/atomic-write-json.test.mjs
20 tests, 17 passed, 3 failed
```

The three failures were the depth-64, UTF-8/scalar-distinct, and exact-1024-member direct-helper cases. Each still expected `EUNSUPPORTED/operation_dispatch`; Task F reached the real pre-dispatch result for the fixture instead. The fixture was made deterministic with an unknown root, so the asserted result is `EROOT/root_select`.

The first root run also exposed stale `atomic_write_json` entries in three old unsupported-operation tables and incorrect assumptions in the new integration assertions. Those were corrected without changing production behavior: the 4096-byte path is `EPATH`, canonical output overflow is exit category 4, canonical validation has no request ID before document construction, and candidate-directory checks compare per-case snapshots.

## Integration

- Dispatches `atomic_write_json` through the known-operation, schema, root-policy, and shared publication paths.
- Encodes the already validated canonical value before filesystem publication.
- Compiles and packages `canonical.c` in the production helper.
- Covers exact canonical bytes, metadata, permutation convergence, preflight ordering, validation failures, size bounds, schema/policy, and shared-engine fault phases.
- Leaves the protocol manifest unchanged for Task G.

## GREEN Evidence

All commands ran in the WSL repository as UID 0 with writable `TMPDIR`:

```text
env TMPDIR=/tmp /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test --test-concurrency=1 tests/native/core/atomic-write-json.test.mjs
20 tests, 20 passed, 0 failed

scripts/test/native-root.sh /home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node
105 tests, 105 passed, 0 failed

env PATH=/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin TMPDIR=/tmp scripts/test/native.sh
274 tests, 274 passed, 0 failed

git diff --check
clean
```

## Files

- `tests/native/core/atomic-write-json.test.mjs`
- `tests/native/core/fs-helper.test.mjs`
- `tests/native/package-helper.test.mjs`
- `zapret2-manager/Makefile`
- `zapret2-manager/src/z2m-core-helper/atomic.c`
- `zapret2-manager/src/z2m-core-helper/helper.h`
- `zapret2-manager/src/z2m-core-helper/main.c`

## Commit

Pending final commit.

## Self-Review

- No manifest, transport, adapter, or M5 changes.
- JSON publication reuses `z2m_atomic_write_bytes()` and does not duplicate publication logic.
- Invalid canonical inputs are checked before root open, lock, traversal, candidate creation, or publication.
- Unsupported-operation tests retain `rename_owned`, `unlink_owned`, and lock-operation coverage.

## Concerns

None.
