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
