# Baseline — Multi-Source Strategy Catalog + Discord

Date: 2026-09-01  
Repository: `G:/zapret2-manager`  
Branch: `main`  
Reviewed anchor: `6f1a3f9f72e105c888d93f8699b43b95ea383acf`  
Execution base: `da919b89fd81b285eeff66e331d477f1037133f6`

## Git evidence

- `git rev-parse HEAD`: `da919b89fd81b285eeff66e331d477f1037133f6`
- `git rev-parse origin/main`: `da919b89fd81b285eeff66e331d477f1037133f6`
- `git merge-base HEAD 6f1a3f9f72e105c888d93f8699b43b95ea383acf`: `6f1a3f9f72e105c888d93f8699b43b95ea383acf`
- `git diff --check`: passed.
- The preceding `3467d156` commit was present on `main` before this task and was preserved.
- `da919b89` contains only the persisted implementation plan; it was pushed before production work.

## Current architecture facts

1. `strategy-catalog.uc` is an Avatar-specific manifest/raw-file reader. Its pinned source is `avatarDD/zapret-gui` (`strategy-catalog.uc:2`, `:18-20`), with Avatar package/managed roots and `z2m.strategy-read-index.v2` persistence (`:10-16`, `:400-432`). It owns manifest parsing, Avatar levels/protocol inference, duplicate winners, and catalog construction (`:206-800`).
2. `strategy-catalog-refresh.uc` currently verifies the existing selected catalog with `strategy_catalog_resolve({forceVerify: true})`, writes its read index, and completes (`strategy-catalog-refresh.uc:99-132`); it does not refresh independent upstream sources.
3. `strategy-catalog-update.uc` already enforces complete verified snapshot input and keeps the previous snapshot on failure (`strategy-catalog-update.uc:3-8`, `:48-86`). This remains the update/lifecycle authority to reuse rather than duplicate.
4. `discord-profile.uc` currently reads a packaged StressOzz corpus (`discord-profile.uc:10`, `:38-46`), imports `profiles_apply_candidate` (`:6`), hardcodes `strategy_catalog_get_detail('z2k_all_in_one')` (`:79-91`), reports false `avatar-catalog` provenance (`:105`), and has a direct `discord_apply` path (`:136-147`).
5. Existing Strategy Apply imports and calls `profiles_apply_candidate` from `strategy-cli.uc:18` and `:816`; the normal Strategy lifecycle is the canonical writer that must remain authoritative.
6. `resources/manifest.json` currently declares `avatar-strategy-catalog` as `strategy-catalog` (`:8-15`) and `z2k-resources` as `asset-bundle` (`:17-24`). A separate `z2k-strategy-source` entry does not yet exist.
7. The existing RPC/UI surface already exposes Strategy catalog refresh/status and Discord donor methods (`z2m-api.js:48`, `:66-68`, `:137-138`); source lifecycle and source filters are not yet present.
8. No `strategy-source-avatar.uc`, `strategy-source-z2k.uc`, `strategy-sources.uc`, or `strategy-catalog-generation.uc` exists at baseline.

## Focused test baseline

Command executed in WSL with the repository-native UCode runtime:

```text
export LD_LIBRARY_PATH=/opt/ucode/lib
node --test --test-concurrency=1 \
  tests/product/avatar-strategy-catalog.test.mjs
```

Result: `15 tests / 15 pass / 0 fail`, exit code `0`.

Command executed in WSL with the same runtime:

```text
export LD_LIBRARY_PATH=/opt/ucode/lib
node --test --test-concurrency=1 \
  tests/product/strategy-catalog-read-invariant.test.mjs \
  tests/product/avatar-strategy-integration.test.mjs \
  tests/product/resource-center-transaction.test.mjs \
  tests/product/strategy-catalog-authority.test.mjs
```

Result: `25 tests / 25 pass / 0 fail`, exit code `0`.

Combined native baseline: `40 tests / 40 pass / 0 fail`.

Windows-only invocation was also attempted and produced `12 pass / 28 fail`; the failures are harness/environment boundaries (`/opt/ucode/bin/ucode` unavailable and Windows symlink creation denied with `EPERM`). That result is not product evidence and is not used as the implementation gate.

## Initial implementation boundary

Production edits begin after this baseline/spec persistence commit. The current active runtime, Asset Registry/Z2K resource lifecycle, and unrelated concurrent changes remain preserved.
