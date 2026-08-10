# Task 7 Report: Expose Strategy Dependency Availability

## Status

COMPLETE

## Scope

Implemented only the Task 7 dependency and effective-command composition
contract. No plan, ledger, package asset, state, RPC, UI, Apply transaction, or
second compiler/preflight path was added.

## Compiler Contract

- Dependency records now expose both the stable `id` required by the Strategy
  contract and the existing `reference` compatibility field.
- Lua desync function names are checked against bounded `functions` or
  `luaFunctions` descriptors when supplied. Missing functions remain visible as
  `kind: function` records rather than making structural compilation fail.
- Dependency projections retain missing Blob, Lua, hostlist, and ipset records
  with bounded kind/id/reason data. Missing or unsafe references remain in the
  inspectable compiled arguments and set `available: false` and
  `applicable: false`.
- Successful results expose `structurallyCompilable`, `nativeValidation`,
  `executable`, and `args` aliases. The existing `strategyArgs`, digest, and
  Profile count remain unchanged.
- Pure compilation returns a `not_checked` native-validation shell and never
  calls native preflight. `validate: true` or trusted execution admission calls
  the existing `native_preflight(candidate)` gate; executable admission then
  requires dependency availability and `status: verified`.
- Effective command composition still requires `source: live`, the pinned
  engine, typed captured base/Lua-init/hostlist inputs, and no client `command`
  or `argv`. It now returns `effectiveArgv`, `effectiveCommand`, `fullArgv`,
  and `fullCommand` aliases alongside the original `argv` and `command`.

## Native Preflight Boundary

`native-preflight.uc` was not changed. Its existing read-only pinned manifest,
engine/Lua digest, dry-run, and `--intercept=0` checks are the native execution
validity gate. Task 7 invokes that gate only for explicit validation or
execution admission; pure dependency/compile paths do not run it.

## Tests

RED evidence:

- The Task 7 additions failed before implementation for the missing structural
  and native projections, function dependency record, and effective-command
  aliases. Existing compiler coverage remained green.

Focused verification:

```text
wsl -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/avatar-strategy-compiler.test.mjs tests/native/status-compat.test.mjs tests/product/profiles-model.test.mjs tests/product/profiles-contract.test.mjs
```

Result: 68 tests passed, 0 failed.

Broader product verification:

```text
wsl -d Ubuntu --cd /home/kirill/z2m-work/m5-native-state-store -- /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 101 tests passed, 0 failed.

Additional verification:

- `git diff --check`: clean.
- Pure compiler source has no write, install, network, UCI, or package-manager
  operation.
- Pure compilation returns `nativeValidation.status == not_checked`, proving
  it does not invoke the native dry-run path.
- Effective command tests reject client-composed `argv` and `command` and
  verify shell quoting of hostile captured values.

## Changed Files

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc`
- `tests/product/avatar-strategy-compiler.test.mjs`
- `.superpowers/sdd/avatar-strategy-catalog-parity/task-7-report.md`

## Concerns

- Function availability is intentionally descriptor-driven. Later Preview must
  supply authoritative bounded function descriptors; an absent function
  registry remains an unknown compatibility mode rather than inventing a
  filesystem search.
- The compiler does not own runtime-input capture. Later Preview integration
  must pass authoritative live inputs to `strategy_effective_argv`; UI/RPC
  callers must not construct them.
- Full Strategy Preview and Validate request handling remain Task 9 scope.
