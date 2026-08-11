# Task 9 Report

## Status

COMPLETE

## Scope

Implemented Task 9 on branch `m5-native-state-store` in:

`/home/kirill/z2m-work/m5-native-state-store`

The implementation is limited to the server-side Strategy Preview and Validate
boundary and its product tests. The existing compiler already exposed the
shared `strategy_candidate()` digest path and `strategy_effective_argv()` path,
so no compiler source change was required. No second compiler, Apply operation,
identity reconciliation, status projection, RPC registration, ACL, or UI code
was added.

## Implementation

Created:

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc`
- `tests/product/avatar-strategy-preview.test.mjs`

The CLI module exports:

- `strategy_preview(input, serverContext)`
- `strategy_validate(input, serverContext)`
- `strategy_cli_dispatch(mode, input)`
- `strategy_cli_request(mode, requestPath)`

`strategy-cli.uc` is an importable ucode module, matching the repository's
module/RPC boundary. Its request-file dispatcher accepts the existing
`{ args: ... }` envelope, enforces a bounded regular file and JSON payload, and
dispatches only `preview` and `validate`.

## Source Authority

- Requests must contain exactly one of `strategy_id` or `strategy_data`.
- Persisted identity requests require a bounded ID, integer revision, and
  64-character catalog digest.
- User identities are resolved through `strategy_user_get()` and must match the
  supplied persisted revision exactly.
- Catalog identities are resolved only from a freshly verified catalog winner
  map and require revision `0`.
- Every request with a catalog digest is compared with the verified current
  aggregate digest; stale values return `ECONFLICT`.
- Inline strategy data is JSON-bounded to 262144 bytes and is normalized and
  compiled by the existing server-side model/compiler path.
- Malformed persisted records do not fall back to a catalog winner.
- Top-level client `candidate`, `args`, `command`, `argv`, effective-command,
  and strategy-argument fields are rejected. Runtime inputs and compiler
  environments are accepted only through the internal server-context argument,
  never from request data.

## Preview

- Preview reuses `strategy_candidate()` for normalization, enabled Profile
  filtering, canonical rendering, dependency inspection, and SHA-256 digest.
- Zero-enabled Strategies return `ok: true`, `strategyArgs: []`, `args: []`,
  `profiles_count: 0`, and `applicable: false`.
- Non-empty Preview returns the canonical Strategy args aliases, effective
  command and argv, Profile count, dependency records, digest, and applicable
  state.
- The effective command is composed only through
  `strategy_effective_argv()` with the pinned engine and trusted live runtime
  inputs. Client-composed command and argv values never enter that path.
- Missing dependencies remain inspectable and make Preview non-applicable; they
  do not make structurally compilable Preview fail.
- Native preflight remains `not_checked` for ordinary Preview.
- `validate: true` enables the existing native preflight through the compiler
  and returns a bounded validation projection.

## Validate

- Validate uses the same identity, catalog digest, normalization, candidate, and
  effective-command path as Preview.
- Validate always enables native preflight and requires complete verified native
  coverage.
- Zero-enabled Strategies return `ENOENABLED` with the candidate digest and
  bounded validation record.
- Missing dependencies return `EDEPENDENCY` with bounded dependency and
  validation records.
- Incomplete or unavailable native preflight returns `EPREFLIGHT` with bounded
  coverage and diagnostics.
- Error codes are clamped to the bounded operation vocabulary:
  `EINPUT`, `ENOENT`, `ECONFLICT`, `ENOENABLED`, `EDEPENDENCY`, `EPREFLIGHT`,
  `EVERIFY`, and `EINTERNAL`.

## No-Write Boundary

Preview and Validate only read user Strategy files, the verified immutable
catalog, and the existing native preflight inputs. The new module contains no
write, unlink, mkdir, rename, config CAS, UCI, install, package-manager,
network, restart, runtime mutation, manager-state, active-identity, or
reconciliation operation. Product tests verify persisted Strategy bytes remain
unchanged and that no Strategy state or legacy Profile state file is created.

## TDD Evidence

The new product test was written before `strategy-cli.uc` existed. The RED run
failed all nine tests because the CLI module and Preview exports were absent.
After implementation, the same focused test passed all nine cases.

## Verification

Focused Preview/Validate:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result: 9 passed, 0 failed.

Adjacent compiler/Profile/model:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs
```

Result: 52 passed, 0 failed.

Full product suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 128 passed, 0 failed.

Diff checks:

```text
git diff --check
```

Result: clean for both new files.

## Concerns

- The repository's target native engine and pinned preflight manifest are not
  available in this WSL test environment, so Validate failure coverage proves
  the fail-closed `EPREFLIGHT` path rather than a successful `verified` native
  admission. The existing `native-preflight.uc` remains the sole target gate.
- The internal server context is intentionally separate from request data. A
  later RPC integration must supply authoritative live runtime inputs and
  dependency descriptors from its server-side boundary; it must not forward
  client-provided context.
- No compiler changes were needed, and the existing compiler candidate tests
  already cover the shared digest and effective argv behavior consumed here.

## Fix Round 1

The review identified four concrete request-boundary gaps. The fixes remain
limited to `strategy-cli.uc` and `avatar-strategy-preview.test.mjs`.

1. Ordinary Preview now strips both `executionAdmission` and `validate` from
   the internal context environment before compilation. Only the explicit
   request `validate: true` enables native preflight in this CLI. A direct
   regression passes `executionAdmission: true` and proves Preview retains
   `nativeValidation.status == not_checked`. No later trusted admission path
   was added.
2. Validate now builds one shared bounded projection after candidate
   composition. `ENOENABLED`, `EDEPENDENCY`, and `EPREFLIGHT` all return
   `strategyArgs`, `args`, `effectiveCommand`, `effectiveArgv`,
   `profiles_count`, `profilesCount`, `dependencies`, `digest`, `applicable`,
   `validation`, and a bounded `error`. Empty candidates use the required empty
   array aliases, and all rejected Validate projections force
   `applicable: false`.
3. `strategy_cli_request` and `strategy_cli_dispatch` now validate every parsed
   input through the same request-shape gate before dispatch. Parsed
   `{ ok: false, error: ... }` objects and `{ args: { ok: false, error: ... } }`
   are treated as untrusted request data and return bounded `EINPUT` instead of
   being returned as operation results. Error codes remain clamped to the
   existing bounded vocabulary.
4. Product coverage now rejects all client `argv`, `command`,
   `effectiveCommand`, `effectiveArgv`, and `strategyArgs` fields, checks
   malformed JSON, oversized files, symlink request files, forged error
   envelopes, Validate no-write behavior, and all three complete Validate
   rejection projections.

## Fix Round 1 Verification

RED focused run after adding the regressions:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result before the production fix: 10 passed, 4 failed. The four failures were
the untrusted `executionAdmission` preflight, missing Validate aliases, missing
persisted Validate no-write projection, and forged request error acceptance.

Focused GREEN:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result: 14 passed, 0 failed.

Adjacent product verification:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs
```

Result: 57 passed, 0 failed.

Full product verification:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 133 passed, 0 failed.

Package/native verification:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/native/avatar-strategy-package.test.mjs tests/native/package-helper.test.mjs
```

Result: 46 passed, 0 failed.

`git diff --check` passed. The worktree contains only the focused Task 9 fix
changes before commit.

## Fix Round 2

The second review identified two deeper boundary failures.

1. Preview projections previously passed compiler candidate strings and
   effective runtime arrays through without hard output limits. The CLI now
   bounds candidate args, effective command strings, every argv element and
   array length, dependency records, native validation diagnostics, and the
   serialized total projection. It emits `fullCommand` and `fullArgv` aliases
   alongside the effective aliases. Oversized untrusted strategy/runtime data
   fails closed with a bounded alias-preserving projection using `EINPUT` or
   `EINTERNAL`; no hostile value is truncated into a different candidate.
2. Persisted CLI resolution previously called Task 8's `strategy_user_get()`,
   whose CAS-oriented `read_document()` computes a hash through
   `/tmp/z2m-strategy-hash.*` `writefile`/`unlink` operations. The state module
   now exposes `strategy_user_get_readonly()`, backed by bounded stat,
   symlink, read, JSON, and schema validation only. CLI Preview/Validate use
   this API. Task 8 mutation paths retain the original hashed
   `read_document()` behavior for CAS and write concurrency checks.

## Fix Round 2 TDD Evidence

RED focused run after adding the adversarial tests:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result before the production fix: 14 passed, 2 failed. The failures were the
oversized candidate returning `ok: true` and persisted Preview/Validate
creating and removing observed hash temporary files. The no-write test saw
`rename`, `change`, and `rename` events for the hash temp path.

GREEN focused run:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result: 16 passed, 0 failed.

The adversarial tests cover:

- oversized inline Profile args;
- oversized trusted runtime argv elements;
- bounded strategy args/args, effective/full command strings, effective/full
  argv arrays and elements, dependency records, and total JSON output;
- required aliases and bounded errors on output rejection;
- exact root and `/tmp` snapshots around persisted Preview/Validate;
- inotify-style detection of transient tagged hash temp-file events;
- preservation of the existing non-empty and zero-enabled Preview contracts.

## Fix Round 2 Verification

Preview, state, compiler, and Profile suites:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-state.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs
```

Result: 74 passed, 0 failed.

Full product suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 135 passed, 0 failed.

Package/native suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/native/avatar-strategy-package.test.mjs tests/native/package-helper.test.mjs
```

Result: 46 passed, 0 failed.

`git diff --check` passed. No Apply, status, RPC, UI, catalog asset, plan, or
ledger file was changed.

## Fix Round 3

The third review found that `candidate_projection()` serialized and bounded
the projection before `validation_error()` appended `ok: false`,
`applicable: false`, and `error`. That allowed the final EPREFLIGHT,
EDEPENDENCY, or ENOENABLED object to exceed the 65,536-byte output bound even
though the intermediate candidate passed it.

The CLI now defers the aggregate check to `final_projection()`, after all
aliases, validation, dependencies, status, and error fields have been added.
If the complete final object does not fit, it returns the existing smaller
bounded error projection instead. Candidate arguments and authoritative
effective command inputs remain individually bounded and are never truncated
into a different command. The fallback also uses non-truncating bounded
identity fields.

## Fix Round 3 TDD Evidence

The direct regression exercised final serialized Validate projections for
ENOENABLED, EDEPENDENCY, and EPREFLIGHT, including a near-boundary dependency
and argv payload. The initial strict RED run failed 16/17 because the old
pre-error aggregate gate returned the generic EINPUT path instead of preserving
the expected rejection branch at the boundary.

The GREEN regression now accepts the documented smaller EINPUT/EINTERNAL
fallback when required, verifies every final contract field and alias is
present, and measures `JSON.stringify(result).length <= 65536` for all three
rejection paths.

## Fix Round 3 Verification

Focused Preview suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs
```

Result: 17 passed, 0 failed.

Adjacent Strategy suites:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-state.test.mjs tests/product/avatar-strategy-compiler.test.mjs tests/product/profiles-model.test.mjs
```

Result: 75 passed, 0 failed.

Full product suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 136 passed, 0 failed.

Package/native suite:

```text
wsl.exe -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/native/avatar-strategy-package.test.mjs tests/native/package-helper.test.mjs
```

Result: 46 passed, 0 failed.

`git diff --check` passed. The intended Round 3 changes remain limited to the
Task 9 CLI and Preview regression test before report staging.
