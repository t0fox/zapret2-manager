# Task 13 Report: Import Profile Drafts into User Strategies

## Status

Implemented in the requested WSL worktree:

`/home/kirill/z2m-work/m5-native-state-store`

Branch: `m5-native-state-store`
Base verified before coding: `3db7209ae588d09994bef0541b4edf7eb630f4ec`

## Implementation

- `strategy-cli.uc` now imports legacy drafts through the existing
  `profiles-draft.uc` `load_state()` export.
- `strategy_import_profiles_from_state()` builds a single user Strategy
  proposal from the current ordered `state.profiles` array.
- Profile args are validated through the existing Profile parser/validator and
  quote-aware Avatar tokenizer, then normalized by the existing Strategy model.
  Token values, quote characters, order, Profile IDs, and disabled `--skip`
  semantics are retained.
- Invalid records, duplicate IDs, multiline/separator-containing fragments,
  parser errors, and normalization failures block the complete import. Import
  diagnostics are capped at 16 records with bounded fields.
- `strategy_import_profiles()` reads a fresh legacy state, returns a read-only
  preview by default, and only calls the existing `strategy_user_create()` when
  `input.mode == 'create'`.
- Preview and create results carry `runtimeMutation: false`. Creation publishes
  exactly one user Strategy through the existing Strategy-owned atomic writer.
- The existing `import_profiles` RPC dispatch now calls the import operation
  instead of returning the bounded `EINPUT` placeholder.
- Updated the existing RPC contract test to assert the replacement behavior and
  added `tests/product/avatar-strategy-import.test.mjs` for RED/GREEN coverage.

## Mutation Boundary

- Import reads legacy drafts via `load_state()` only.
- Import does not call `save_state()`, `set_var()`, `profiles_apply_candidate()`,
  or any runtime/config writer.
- Import does not delete legacy drafts, alter `NFQWS2_OPT`, change config hashes,
  restart services, update active identity, or write manager state.
- Preview does not publish a Strategy. Explicit create writes only the new user
  Strategy file through `strategy_user_create()`.
- No automatic migration, legacy deletion, or Apply path was added.
- No RPC registration, ACL, UI, compiler, Apply, status, plan, ledger, or asset
  files were changed.

## TDD Evidence

- RED run: the new import test failed because
  `strategy_import_profiles_from_state` was absent and the dispatcher still
  exposed the placeholder.
- GREEN run: the import test passed all 4 tests after implementation.

## Verification

Focused WSL compatibility command:

```text
wsl.exe --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/avatar-strategy-import.test.mjs tests/product/profiles-contract.test.mjs tests/product/profiles-ui.test.mjs tests/product/avatar-strategy-state.test.mjs tests/product/avatar-strategy-preview.test.mjs tests/product/avatar-strategy-rpc.test.mjs
```

Result: 85 passed, 0 failed.

Broader WSL product command:

```text
wsl.exe --cd /home/kirill/z2m-work/m5-native-state-store -- env UCODE_BIN=/opt/ucode/bin/ucode UCODE_LIBRARY_PATH=/opt/ucode/lib /home/kirill/.local/bin/node --test tests/product/*.test.mjs
```

Result: 183 passed, 0 failed.

`git diff --check`: passed.

## Concerns

- The WSL user is non-root and cannot safely install a temporary
  `/etc/zapret2-manager/state.json` fixture. Behavioral import tests therefore
  exercise the pure state-to-Strategy proposal helper with a fixture, while the
  production entry point is statically and boundary-tested to call
  `load_state()`.
- The existing repository is 33 commits ahead of its remote tracking branch;
  no branch or unrelated changes were created by this task.
