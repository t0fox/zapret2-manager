# Task 8 Report

## Scope

Implemented Task 8 in the real WSL worktree:

`/home/kirill/z2m-work/m5-native-state-store`

The worktree was on `m5-native-state-store` at the requested base commit
`2ab3ed21da03975090418dd0c24003a61acc3c42` before implementation. The existing
Task 3 package postinst already bootstraps absent Strategy storage with root
ownership and modes 0700/0600, so neither `Makefile` nor `constants.uc` needed
modification.

## Implementation

Created:

- `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc`
- `tests/product/avatar-strategy-state.test.mjs`

The module provides the required interfaces:

- `strategy_user_list/get/create/update/delete`
- `strategy_duplicate`
- `strategy_favorite`
- `strategy_selection_get/set`
- `strategy_reconcile_record/get/clear`

User Strategies are stored at
`/etc/zapret2-manager/strategies/<id>.json` with schema 1, stable identity,
revision, name, user origin, metadata, ordered Profiles, and `updatedAt`.
Disabled Profiles and duplicate child IDs remain stored in their original
order.

Durable state is stored separately at
`/etc/zapret2-manager/strategy-state.json` and is closed to schema, revision,
ordered favorites, and selected identity/hash only. Runtime, drift, queue,
and dependency fields are not accepted or persisted.

## Safety

- Same-directory `mktemp`, private temporary mode, and atomic `mv` publication.
- Atomic private mkdir lock with the package-standard `flock -x` boundary
  documented for production callers.
- Revision checks, reread/hash checks, and no automatic last-writer-wins retry.
- Bounded JSON reads/writes at 521028 bytes.
- Private directory/file modes 0700/0600 and symlink rejection.
- Safe Strategy IDs reject traversal, separators, dot identities, and unsafe
  filename collisions.
- Builtin and extension identities are immutable and cannot enter user storage.
- Duplicate creates `id + '_copy'` and `name + ' (копия)'`, deep-copying only
  metadata and Profiles into a user Strategy.
- Favorites preserve order, allow protected builtin identities, and remove
  deleted user IDs.
- Selection uses durable state revision CAS and delete cleanup.
- Reconciliation is volatile under `/tmp`; persisted state remains clean.
- The legacy Profile document is never read, migrated, or overwritten.

## TDD Evidence

The new test file was written first and failed because
`strategy-state.uc` was absent. After implementation, the same test file
passed with real ucode and temporary private storage roots.

## Verification

Commands run from the WSL worktree:

```text
UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/avatar-strategy-state.test.mjs
```

Result: 8 passed.

```text
UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/avatar-strategy-state.test.mjs tests/product/profiles-contract.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-compiler.test.mjs
```

Result: 74 passed.

```text
node --test tests/native/avatar-strategy-package.test.mjs
```

Result: 11 passed.

```text
git diff --check
```

Result: passed.

## Scope Audit

- No legacy Profile state migration was added.
- No RPC, UI, Apply, status, compiler, raw catalog, or plan files were changed.
- No branch or PR was created.

## Round 1 Fixes

The review findings were reproduced against the committed Task 8 implementation
before changing production code:

1. `read_document()` rejected the zero-byte `0600` file produced by the package
   postinst before `read_state()` could provide its default. `read_state()` now
   treats a private empty state file as an absent schema-1 state without writing
   during a read. The postinst now initializes new files with
   `{"schema":1,"revision":0,"favorites":[],"selected":null}` through the
   existing package bootstrap boundary. Existing files remain guarded and are
   never replaced.
2. Prefix-only builtin detection allowed the pinned catalog ID `fake_simple` to
   be created as a user Strategy. The state module now validates the pinned
   manifest provenance and indexes all physical and source-order catalog IDs;
   catalog identities, heuristic builtin identities, and extension identities
   are immutable and cannot enter user storage.
3. Favorite mutation previously appended any safe ID. It now rejects unknown
   IDs with `ENOENT`, accepts catalog/extension protected identities, retains
   order, and filters deleted or stale user identities during each mutation.
4. Metadata validation is shared by create, update, duplicate, and persisted
   record validation. Metadata is bounded to scalar strings/booleans or bounded
   string arrays, so records accepted by a write cannot later fail list/get
   validation.
5. `atomic_write()` now checks the destination with `readlink()` and `stat()`
   before creating a temporary file. Existing symlinks and non-file targets
   fail closed for state and reconciliation writes, leaving the target bytes
   unchanged.
6. The private mkdir lock now performs bounded stale-lock recovery for an old,
   empty lock directory. Fresh locks still fail closed, while a killed process
   cannot permanently block mutations.

## Round 1 Behavioral Evidence

Added temporary-root regressions in
`tests/product/avatar-strategy-state.test.mjs` for:

- empty package-initial state read and first mutation;
- pinned-manifest `fake_simple` collision;
- ghost favorite rejection and revision preservation;
- malformed metadata on create, update, and duplicate;
- symlinked state and reconciliation destinations;
- stale lock recovery and private file mode preservation;
- legacy Profile state non-creation.

Added package regression in
`tests/native/avatar-strategy-package.test.mjs` that runs the real postinst body
in a temporary package root and asserts the emitted schema-1 initial JSON,
ownership, and `0600` mode. The previous state source-regex safety assertions
were replaced with temporary-root behavior in the product test.

## Round 1 Verification

Commands run from the real WSL worktree:

```text
UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/avatar-strategy-state.test.mjs
```

Result: 12 passed.

```text
UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib node --test tests/product/avatar-strategy-state.test.mjs tests/product/profiles-contract.test.mjs tests/product/avatar-strategy-model.test.mjs tests/product/avatar-strategy-catalog.test.mjs tests/product/avatar-strategy-compiler.test.mjs
```

Result: 78 passed.

```text
node --test tests/native/avatar-strategy-package.test.mjs
node --test tests/native/package-helper.test.mjs
```

Results: 11 passed and 35 passed.

```text
/home/kirill/.local/opt/node-v22.22.1-linux-x64/bin/node --test tests/native/bootstrap.test.mjs
```

Result: 12 passed under WSL root, which is required by the existing bootstrap
test gate.

```text
git diff --check
```

Result: passed.
