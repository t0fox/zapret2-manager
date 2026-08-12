# Task 3 Report: Strategy Catalog Candidate Planner

## Scope

Implemented only the Strategy Catalog candidate planner and its product tests:

- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc`
- `tests/product/avatar-strategy-scanner-planner.test.mjs`
- `tests/product/avatar-strategy-catalog.test.mjs`
- `tests/product/avatar-strategy-scanner-integration.test.mjs`

No Scanner runtime, firewall, Apply, DNS, Telegram, router, LuCI, or Orchestra
behavior was added.

## Implementation

`scanner_plan_build()` now:

- accepts the bounded public Scanner request and rejects unknown/raw request fields;
- consumes a verified catalog snapshot and server-owned user Strategy records;
- preserves protocol-specific quick/standard/full selection;
- prepends the first 10 quick or first 20 standard full presets;
- applies full-preset, recommended, complexity, source, and section ordering;
- filters catalog entries by protocol and performs normalized compiled-token plus
  dependency-closure deduplication;
- appends server-policy generated candidates only for standard/full modes;
- applies known DPI skip/filter rules after generation and leaves unknown bounded
  `dpi_type` values unchanged;
- binds the immutable plan to the catalog aggregate digest and compiler digest;
- returns compiled tokens, compiled digest, complete dependency closure, dependency
  digest, provenance, ordinal, complexity, recommendation, preset, and save fields.

`scanner_candidate_canonicalize()` maps a generated candidate only when the
normalized compiled token stream and complete dependency closure are identical.
Display names, IDs, approximate token matches, and client raw command fields do
not establish identity. Unmatched generated candidates remain ephemeral with
`strategyId: null` and `saveRequired: true`.

## TDD Evidence

The planner test was added before `scanner-planner.uc` existed. The mandated RED
command failed because the planner module was absent; Windows also lacked the
configured `/opt/ucode/bin/ucode` executable. After implementation, the focused
planner suite passed all 8 tests under WSL with the available ucode runtime.

## Verification

Focused planner:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs
```

Result: 8 passed, 0 failed.

Task 3 focused command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
```

Result: 22 passed, 3 failed. The 3 failures are existing Task 2 target-profile
tests: this WSL ucode build reports `left-hand side expression is null` at
`scanner-targets.uc:136` while iterating `HINTS`. The planner tests and all 14
catalog tests pass.

Full product suite:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 240 passed, 12 failed. Failures were the same 3 target-profile tests,
8 existing scanner-model tests affected by the WSL ucode/request harness, and
1 pre-existing catalog integration fixture mismatch (`511 !== 420` in
`avatar-strategy-integration.test.mjs`).

Additional checks:

- Modified JavaScript `node --check`: passed.
- `git diff --check`: passed.
- Real installed catalog smoke: planner returned `ok: true`, 29 normalized quick
  candidates, and aggregate digest `5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1`.

## Concerns

- The available WSL ucode runtime cannot execute the pre-existing Task 2 target
  and scanner-model tests cleanly. No Task 2 source was changed to work around it.
- The full product suite retains the pre-existing catalog integration fixture
  mismatch. The catalog production module and its tests were not altered beyond
  the planner provenance assertion.

## Review Round 1 Fixes

The review-round hardening remained within the Task 3 planner/test/report scope:

- bound catalog, compiler, user-record, generator, and target-profile authority
  to server-owned envelopes and the pinned source/compiler markers;
- rejected incomplete dependency items and closure mismatches instead of
  treating missing fields as equivalent values;
- removed planner filesystem/process access and replaced the dependency fallback
  with a pure SHA-256 implementation;
- preserved authoritative catalog order through deduplication and renumbered
  final candidates to contiguous ordinals after filtering;
- rejected public generated raw-argument input and failed closed on invalid
  target-profile resolution.

## Review Round 1 Verification

Focused command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
```

Result: 28 passed, 3 failed. The three failures remain the inherited WSL
ucode `scanner-targets.uc:136` null-indexing failures. All 13 planner tests,
all 14 catalog tests, the digest fallback regression, and the purity assertion
passed.

Full product command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 246 passed, 12 failed. In addition to the same three target-profile
failures, the run retains eight inherited scanner-model harness failures and
the existing catalog integration fixture mismatch (`511 !== 420`).

An installed-catalog smoke with an explicit validated target profile also
passed through the planner and pure dependency fallback, returning an
authoritative plan with catalog digest
`5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1` and
compiler digest
`ae6761cb991048e870d2d7adf7b8c93b21a88b43cf4963a599fd4158ad47d404`.

The pure SHA-256 fallback was independently checked against the exact ucode
`sprintf('%J', closure)` byte sequence and now produces the matching digest
`fd6bc5930bb0a77ae383fbc33948ee0a4dc0700b69e43e506c97ea2ae18139c5`.

JavaScript syntax checking, `git diff --check`, and the planner purity scan
also passed.

## Review Round 2 Fixes

The second review round resolved the remaining Task 3 findings:

- replaced the fixed compiler marker with a digest over an explicit compiler
  contract plus real compiled probe outputs;
- bound supplied catalog snapshots to the pinned manifest file digest and a
  server-owned catalog envelope covering source, winner order, sets, and winners;
- bound user and generator records to the same catalog/compiler authority;
- completed full-preset, recommended, complexity, source, source ordinal,
  section ordinal, effective ordinal, Strategy ID, and catalog-order sorting;
- validated dependency item completeness, missing-item consistency,
  availability state, structural compilability, and supplied closure digests;
- rejected target profiles that do not match the normalized request target or
  requested protocol semantics;
- retained planner purity when snapshots are supplied and contiguous final
  ordinals after deduplication and DPI filtering.

## Review Round 2 TDD And Verification

RED command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-scanner-integration.test.mjs
```

Initial result: 29 passed, 11 failed. Eight new planner failures exercised the
authority fixture/implementation gap; three inherited target-profile tests hit
the existing WSL ucode `scanner-targets.uc:136` null-indexing problem.

GREEN planner command:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs
```

Result: 23 passed, 0 failed.

Focused three-file command after implementation: 37 passed, 3 failed. All 23
planner and all 14 catalog tests passed; only the same inherited WSL
`scanner-targets.uc:136` failures remained.

Additional verification:

- `node --check tests/product/avatar-strategy-scanner-planner.test.mjs`: passed.
- `git diff --check`: passed.
- planner I/O import/process scan: no matches.

Files changed in review round 2:

- `tests/product/avatar-strategy-scanner-planner.test.mjs`
- `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc`
- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`

Self-review checked the final comparator fallback, catalog/user/generator
authority cross-binding, complete dependency closure invariants, target/profile
binding, generated append semantics, section coverage, and contiguous ordinals.

Concern: the required three-file command remains non-zero solely because this
available WSL ucode runtime cannot index `HINTS[i]` in the unchanged Task 2
`scanner-targets.uc`; changing that out-of-scope file was explicitly forbidden.

## Fix Round 2 Evidence

The final fix pass added exact regressions and closed the remaining gaps:

- compiler authority is a real digest of the compiler contract and compiled probe outputs;
- catalog, user, and generator values are checked against independent server-owned copies,
  so recomputing attacker-controlled hashes does not confer authority;
- catalog ordering now applies full preset, recommendation, complexity, source path,
  source ordinal, section ordinal, effective ordinal, Strategy ID, and catalog order;
- dependency closures reject duplicate, extra, inconsistent, or reordered missing items,
  and dependency digests are recomputed from the complete validated ordered closure;
- supplied target profiles are bound to the normalized request target, first test host,
  canonical probe URL, and requested protocol semantics;
- final ordinals remain contiguous after sorting, deduplication, generation, and DPI filtering.

Focused planner:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-scanner-planner.test.mjs
```

Result: 29 passed, 0 failed.

Focused catalog:

```text
wsl.exe -d Ubuntu --cd /mnt/c/Users/Kirill/zapret2-manager -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-catalog.test.mjs
```

Result: 13 passed, 0 failed.

The mandated three-file run reached 45 passed and 1 failed before the final
planner-only rerun. The remaining failure is the unchanged Task 2 WSL ucode
compatibility issue at `scanner-targets.uc:136`; its isolated integration run is
1 passed and 3 failed for the same null-indexing error. No target module change
is included in this fix.

Static evidence:

- both modified JavaScript files pass `node --check`;
- `git diff --check` passes;
- the planner purity scan finds no filesystem, process, runtime, Apply, Orchestra,
  firewall, network, RPC, or frontend access;
- changed scope is limited to planner/compiler code, product regressions, and this report.
