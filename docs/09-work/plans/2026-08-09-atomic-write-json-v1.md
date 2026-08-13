---
id: plan-atomic-write-json-v1
title: "atomic_write_json v1 Implementation Plan"
type: plan
status: planned
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [plan, native, json, atomic-write]
---
# atomic_write_json v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `atomic_write_json` exactly to the frozen `z2m-canonical-json-v1` contract while reusing the existing atomic byte publication engine.

**Architecture:** Validate the raw JSON token stream iteratively before json-c semantic construction, including decoded-key duplicate detection and integer/Unicode policy. Encode the validated value into a bounded canonical UTF-8 buffer before root open/lock, then pass that buffer through one shared `atomic_write_bytes()` publication path used by both `atomic_write` and `atomic_write_json`.

**Tech Stack:** C11, json-c 0.18-compatible API, OpenWrt musl target compiler, Node.js `node:test`, deterministic JSON corpus, host ASan/UBSan where available.

## Global Constraints

- Canonicalization identifier is `z2m-canonical-json-v1`.
- Canonical UTF-8 output maximum is exactly 521028 bytes, including punctuation and escapes.
- Value depth is exactly 64; root depth is 1.
- Containers are exactly 1024, object members exactly 1024, value nodes exactly 65536, and one decoded object key exactly 4096 UTF-8 bytes.
- Request wire maximum is exactly 4194304 bytes.
- Supported values are object, array, string, signed 64-bit integer, boolean, and null.
- Accepted number grammar is exactly `-?(0|[1-9][0-9]*)`; `-0` serializes as `0`.
- Duplicate object keys compare decoded Unicode scalar sequences and reject before semantic construction.
- Objects sort by unsigned lexicographic decoded UTF-8 bytes; arrays preserve order.
- No Unicode normalization is performed.
- Output has no BOM, whitespace, or trailing newline; output is raw UTF-8 except required JSON escapes.
- Canonical validation completes before root locking, filesystem traversal, candidate creation, or publication.
- `atomic_write_json` reuses `atomic_write_bytes()` and does not create a second publication engine.
- No Task 7 transport or adapter semantics change.
- No `state-store.uc`, `manager-state.json`, generation, DNS, Telegram, WARP, routing, or LuCI work.
- Manifest status remains `reserved_unsupported` until the final parity task.

## File Map

Preparation files already supplied by this branch:

- `tests/native/core/canonical-json-v1-vectors.json`: accepted/rejected data-driven vectors and generated boundary descriptors.
- `tests/native/core/canonical-json-v1-mutations.json`: deterministic malformed/mutation seed corpus.
- `tests/native/core/canonical-json-v1-oracle.mjs`: independent test-side parser, UTF-8 ordering oracle, generator, and property helpers.
- `tests/native/core/canonical-json-v1-corpus.test.mjs`: corpus/oracle integrity and deterministic property tests.
- `tests/native/core/json-c-information-loss.c`: standalone json-c behavior fixture.
- `tests/native/core/json-c-information-loss.test.mjs`: reproducible host experiment assertions.
- `docs/architecture/atomic-write-json-v1-design.md`: frozen design, information-loss evidence, boundaries, complexity, and risks.
- `docs/architecture/atomic-write-json-v1-traceability.md`: requirement-to-vector-to-stage matrix.

Future production files:

- Create: `zapret2-manager/src/z2m-core-helper/canonical.c` for strict scanner, semantic validation handoff, and canonical encoder.
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h` for bounded payload and preflight interfaces.
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c` for canonical value span/schema integration.
- Modify: `zapret2-manager/src/z2m-core-helper/atomic.c` to extract `z2m_atomic_write_bytes()` only.
- Modify: `zapret2-manager/src/z2m-core-helper/main.c` to preflight before root open/lock and dispatch the shared byte engine.
- Modify: `zapret2-manager/Makefile` to compile `canonical.c`.
- Modify: `zapret2-manager/src/z2m-core-helper/protocol-v1.json` only in the final status transition.
- Create/modify: `tests/native/core/atomic-write-json.test.mjs` for helper integration, side-effect, and publication parity tests.
- Create/modify: `tests/native/core/atomic-write-json-property.test.mjs` for production-vs-corpus properties.

---

### Task A: Corpus Harness And Manifest Guard

**Files:**
- Test: `tests/native/core/canonical-json-v1-corpus.test.mjs`
- Test: `tests/native/core/json-c-information-loss.test.mjs`
- Test: `tests/native/core/atomic-write-json.test.mjs`
- Read-only reference: `zapret2-manager/src/z2m-core-helper/protocol-v1.json`

**Interfaces:**
- Consumes the frozen JSON corpus and oracle already committed by preparation.
- Produces test helpers that compare production output to exact expected canonical bytes without changing manifest status.

- [ ] **Step 1: Write the failing integration assertions**

Add cases for a valid `atomic_write_json` request being rejected with the current
`EUNSUPPORTED/operation_dispatch` status, then mark those assertions as the M4
RED baseline rather than changing production code in this task. Add corpus cases
that assert there is no `productionImplementation` or `atomicWriteJsonPass`
marker in the preparation corpus.

- [ ] **Step 2: Run the focused tests**

Run:

```sh
/home/kirill/.local/bin/node --test tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs
```

Expected: corpus and json-c preparation tests pass; no production operation is
claimed or invoked.

- [ ] **Step 3: Implement only the harness additions**

Keep the harness data-driven. It must accept canonical output as bytes, capture
error code/stage/committed/durability, and snapshot the target file plus parent
directory before invocation so validation failures can assert no filesystem
change.

- [ ] **Step 4: Run the focused tests again**

Run the same command and require zero failures, zero skips, and no production
status change.

- [ ] **Step 5: Commit**

```sh
git add tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs
git commit -m "test: add canonical json conformance harness"
```

### Task B: Strict Lexical Validator

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/canonical.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Test: `tests/native/core/atomic-write-json.test.mjs`

**Interfaces:**
- Consumes: raw request bytes and the value token span before json-c value construction.
- Produces: `z2m_canonical_preflight()` returning an owned validated semantic input or a classified pre-publication error.

- [ ] **Step 1: Write RED lexical tests**

Add production-helper cases for duplicate literal/escaped/nested keys,
leading-zero/plus/decimal/exponent/overflow numbers, lone/reversed surrogates,
invalid UTF-8, exact depth/count/key boundaries, and one-over boundaries.
Assert `EMALFORMED` for malformed wire JSON and `ESCHEMA/canonical_validate`
for contract-domain rejection. Assert the target and candidate directory are
unchanged for every pre-publication rejection.

- [ ] **Step 2: Run RED**

Run:

```sh
/home/kirill/.local/bin/node --test tests/native/core/atomic-write-json.test.mjs
```

Expected: the new production cases fail because the operation remains reserved
or the lexical interfaces do not yet exist.

- [ ] **Step 3: Implement the iterative scanner**

Use explicit object/array frames capped by the frozen depth. Recognize only
space, tab, CR, and LF as insignificant whitespace. Decode key escapes to UTF-8
scalar bytes, collect keys per object frame, sort at object close, and reject
adjacent equal identities. Validate integer grammar and signed-64 range while
the number token is still raw. Reject malformed UTF-8, invalid escapes, lone
surrogates, and raw NUL bytes without calling filesystem code.

Use checked `size_t` arithmetic for all spans and vector growth. Do not add an
independent probe, node, string, or byte limit. Use existing frozen counts only.

- [ ] **Step 4: Run GREEN lexical tests**

Run the focused test. Expected: all lexical rejection cases return the exact
code/stage and no filesystem side effects.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/canonical.c zapret2-manager/src/z2m-core-helper/helper.h tests/native/core/atomic-write-json.test.mjs
git commit -m "feat: add strict canonical json lexical validation"
```

### Task C: Semantic Validation And json-c Boundary

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/canonical.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Test: `tests/native/core/atomic-write-json.test.mjs`

**Interfaces:**
- Consumes: the strict lexical pass and the retained raw value span.
- Produces: a supported json-c semantic tree or a bounded internal representation with exact depth/member/node/container/key accounting.

- [ ] **Step 1: Write RED semantic cases**

Add accepted scalars, arrays, recursive objects, raw UTF-8 output, control
escapes, U+007F/U+2028/U+2029, composed/decomposed values, and the valid
surrogate pair. Add rejection cases for unsupported json-c types, malformed
semantic construction, and the escaped-U+0000 key policy decision documented in
the design.

- [ ] **Step 2: Run RED**

Run the focused production test and confirm accepted values are not silently
treated as unsupported operation dispatch.

- [ ] **Step 3: Implement the semantic handoff**

Only construct the semantic tree after lexical validation. Ensure raw value
buffer ownership lasts through semantic construction. Reject any json-c type
outside object, array, string, int64 integer, boolean, and null. Verify json-c
key lengths before use; never pass an embedded-NUL key to a C-string API unless
the frozen protocol decision explicitly rejects it at lexical validation.

- [ ] **Step 4: Run GREEN semantic tests**

Run the focused production test and the preparation corpus. Confirm duplicate
and number spelling evidence is not recovered from the semantic tree.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/canonical.c zapret2-manager/src/z2m-core-helper/protocol.c zapret2-manager/src/z2m-core-helper/helper.h tests/native/core/atomic-write-json.test.mjs
git commit -m "feat: bind canonical json semantic domain"
```

### Task D: Canonical Encoder

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/canonical.c`
- Test: `tests/native/core/atomic-write-json.test.mjs`
- Test: `tests/native/core/atomic-write-json-property.test.mjs`

**Interfaces:**
- Consumes: validated semantic representation.
- Produces: owned `struct z2m_prepared_json` containing canonical UTF-8 bytes and length, or `ETOOBIG/canonical_size` or `EINTERNAL/canonical_encode`.

- [ ] **Step 1: Write RED encoder assertions**

Assert exact bytes for recursive ordering, prefix keys, UTF-8 comparator traps,
all required escapes, integer boundaries, arrays, exact 521028 output, and one
byte over. Add deterministic allocation-failure tests that prove no root lock
or target traversal occurs.

- [ ] **Step 2: Run RED**

Run the encoder-focused production tests and confirm no current operation can
produce the expected canonical bytes yet.

- [ ] **Step 3: Implement the iterative encoder**

Use a bounded output buffer and explicit traversal frames. Sort temporary key
views by decoded UTF-8 bytes. Append with subtraction-before-addition overflow
checks. Render `int64_t` directly in base 10. Encode strings by Unicode scalar,
using only the frozen named and lowercase hex escapes. Clamp capacity to 521028
and free every temporary allocation on all returns.

- [ ] **Step 4: Run GREEN encoder and property tests**

Run:

```sh
/home/kirill/.local/bin/node --test tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/atomic-write-json.test.mjs tests/native/core/atomic-write-json-property.test.mjs
```

Require exact vector output, fixed points, insertion permutation equality, and
array ordering.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/canonical.c tests/native/core/atomic-write-json.test.mjs tests/native/core/atomic-write-json-property.test.mjs
git commit -m "feat: encode canonical json v1 bytes"
```

### Task E: Shared Atomic Byte Publication

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/atomic.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Test: existing atomic publication tests plus `tests/native/core/atomic-write-json.test.mjs`

**Interfaces:**
- Consumes: borrowed payload bytes, path, allow-create flag, root fd, root mount, and existing request identity.
- Produces: the unchanged success/failure response and publication semantics from one `z2m_atomic_write_bytes()` implementation.

- [ ] **Step 1: Write RED parity tests**

Run the existing atomic write fault matrix with base64 payloads and add the same
fault phases through the JSON operation. Assert candidate creation, write,
fsync, CAS, rename, parent fsync, final verify, cleanup, `ECONFLICT`,
`ECLEANUPUNKNOWN`, and `ECOMMITUNKNOWN` match exactly.

- [ ] **Step 2: Run RED**

Confirm the JSON path is still unsupported and the common function is absent.

- [ ] **Step 3: Extract only the common body**

Move the existing publication body into `z2m_atomic_write_bytes()` without
changing fault phase names, descriptor order, candidate naming, response wire
preparation, cleanup proof, or post-rename uncertainty. Keep
`z2m_atomic_write()` as base64 decode/path wrapper.

- [ ] **Step 4: Run GREEN parity tests**

Run the full existing native atomic tests and the focused JSON parity tests.
Require identical filesystem and error outcomes for equal payload bytes.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/atomic.c zapret2-manager/src/z2m-core-helper/helper.h tests/native/core/atomic-write-json.test.mjs
git commit -m "refactor: share atomic byte publication engine"
```

### Task F: Dispatch And Preflight Integration

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/main.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Modify: `zapret2-manager/Makefile`
- Test: `tests/native/core/atomic-write-json.test.mjs`

**Interfaces:**
- Consumes: canonical preflight bytes and shared byte writer.
- Produces: implemented helper behavior while manifest remains reserved until Task G.

- [ ] **Step 1: Write RED ordering and schema tests**

Add trace assertions proving canonical validation occurs before root open,
mount lookup, lock attempt, path traversal, candidate creation, and response
publication. Add exact request schema tests for all seven fields and fixed mode,
uid, gid, and allow-create behavior.

- [ ] **Step 2: Run RED**

The current main branch must fail because it rejects the operation before the
preflight trace.

- [ ] **Step 3: Integrate the smallest dispatch change**

After request framing and reserved schema validation, run JSON preflight before
`z2m_root_open()`. Retain the prepared bytes until the shared byte writer
returns. Reuse existing root authorization, mount verification, lock, and
response functions. Do not alter transport or adapter code.

- [ ] **Step 4: Run GREEN integration tests**

Run the focused production helper suite plus all existing native tests. Verify
valid JSON writes only use the common publication phases and every validation
failure leaves the filesystem untouched.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/main.c zapret2-manager/src/z2m-core-helper/protocol.c zapret2-manager/Makefile tests/native/core/atomic-write-json.test.mjs
git commit -m "feat: integrate atomic write json dispatch"
```

### Task G: Manifest Implemented Parity

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- Modify: `tests/native/core/fs-helper-protocol.test.mjs`
- Test: `tests/native/core/atomic-write-json.test.mjs`

**Interfaces:**
- Consumes: the production operation from Tasks A-F.
- Produces: exact manifest transition from `reserved_unsupported` to `implemented` and no broader protocol change.

- [ ] **Step 1: Write RED manifest parity assertions**

Change the protocol test expectation in the M4 worktree to require
`implemented`, remove only the expectation of `unsupportedBehavior` for this
operation, and assert the canonical ID, limits, roots, schemas, ownership,
crash semantics, and idempotency remain exact.

- [ ] **Step 2: Run RED**

The test must fail against the still-reserved manifest.

- [ ] **Step 3: Apply the minimal manifest transition**

Change only the operation status and remove its stale unsupported behavior. Do
not change request/success schemas, limits, root lists, or error vocabulary.

- [ ] **Step 4: Run GREEN manifest and helper parity tests**

Run the protocol manifest test, focused JSON helper test, and package static
tests. Confirm no other reserved operation changes.

- [ ] **Step 5: Commit**

```sh
git add zapret2-manager/src/z2m-core-helper/protocol-v1.json tests/native/core/fs-helper-protocol.test.mjs
git commit -m "feat: mark atomic write json implemented"
```

### Task H: Exact Target, Sanitizer, And Final Property Verification

**Files:**
- Modify: `tests/native/core/atomic-write-json-property.test.mjs`
- Create: `tests/native/core/atomic-write-json-exact-target-evidence.txt` for the reproducible target run

**Interfaces:**
- Consumes: completed production implementation and manifest parity.
- Produces: reproducible host, sanitizer, root, and exact OpenWrt target evidence.

- [ ] **Step 1: Write RED verification matrix entries**

Add production property cases for canonical fixed points, insertion permutations
with SHA-256 equality, arrays, exact and one-over every frozen bound, no-side
effect errors, allocation faults, and all atomic publication uncertainty phases.

- [ ] **Step 2: Run RED on host**

Run the focused suite and record failures only from missing implementation or
missing parity, not from environmental tool absence.

- [ ] **Step 3: Run host GREEN and strict builds**

Run:

```sh
/home/kirill/.local/bin/node --test --test-concurrency=1 tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs tests/native/core/atomic-write-json.test.mjs tests/native/core/atomic-write-json-property.test.mjs
cc -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -fsanitize=address,undefined -fno-omit-frame-pointer \
      zapret2-manager/src/z2m-core-helper/atomic.c \
      zapret2-manager/src/z2m-core-helper/base64.c \
      zapret2-manager/src/z2m-core-helper/canonical.c \
      zapret2-manager/src/z2m-core-helper/errors.c \
      zapret2-manager/src/z2m-core-helper/files.c \
      zapret2-manager/src/z2m-core-helper/main.c \
      zapret2-manager/src/z2m-core-helper/mkdir.c \
      zapret2-manager/src/z2m-core-helper/paths.c \
      zapret2-manager/src/z2m-core-helper/protocol.c \
      zapret2-manager/src/z2m-core-helper/roots.c \
      zapret2-manager/src/z2m-core-helper/sha256.c \
      -ljson-c -o /tmp/z2m-core-helper-asan
```

The sanitizer command must compile the helper sources with `canonical.c`; if
the host compiler lacks sanitizer support, report that capability result and
still run the non-sanitized strict build.

- [ ] **Step 4: Run exact target and root verification**

Run the repository's existing `scripts/test/native.sh` and exact AArch64
environment used by the M3 gate, sequentially. Confirm target compiler flags
remain `-std=c11 -Wall -Wextra -Werror`, all corpus boundaries pass, and no
Task 7 tests regress.

- [ ] **Step 5: Commit evidence**

```sh
git add tests/native/core/atomic-write-json-property.test.mjs tests/native/core/atomic-write-json-exact-target-evidence.txt
git commit -m "test: verify atomic write json on exact target"
```

## Final M4 Gate

Before claiming M4 complete, rerun all of the following from a clean M4
worktree:

```sh
git diff --check
/home/kirill/.local/bin/node --test tests/native/core/canonical-json-v1-corpus.test.mjs tests/native/core/json-c-information-loss.test.mjs
scripts/test/native.sh
git status --short
```

The final report must include exact test counts, target/compiler identity,
manifest transition, production publication parity, and any unresolved
escaped-U+0000-key decision. No report may say `atomic_write_json` passes before
Task G and Task H are complete.
