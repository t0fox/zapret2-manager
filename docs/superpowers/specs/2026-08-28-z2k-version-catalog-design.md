---
id: z2k-version-catalog-design
title: "Z2K version catalog and target lifecycle"
type: spec
status: approved
authority: approved-plan
updated: 2026-08-28
publish: false
tags: [z2k, versions, updates, rollback]
---

# Z2K version catalog and target lifecycle

## Baseline

The implementation is based on the fetched `origin/main` at
`c6c9b4c57a039f8440d959f72b1159f3bbe94a8c`. The existing ownership boundary
is preserved: Z2M owns the runtime integration, Resource Center owns source
and bundle policy, and Asset Registry is the only writer of managed asset
bytes and metadata.

The current implementation has a single latest-upstream check snapshot and a
legacy `z2k-runtime` update entrypoint. This design replaces those semantics
with one selected-target lifecycle while retaining schema-1 readability and
the existing transactional writer.

## Approved invariants

- The catalog contains only semantic `r-*` releases, ordered by release
  numbers, bounded to the latest ten, plus an installed release outside that
  window when necessary.
- A selected tag is always resolved to an immutable commit SHA before any
  manifest or asset is used. The selected commit, not a mutable tag or branch,
  is the source identity for the prepared target and all downloads.
- A target is installable only when its commit-bound `UPDATES.json` is valid,
  its `current` field equals the requested release, and its exact-managed
  membership is compatible with the current Z2M contract.
- Advisory and watched upstream files remain technical metadata. They do not
  create a primary warning, block an install, or enter a target download
  plan. `files/z2k-config-validator.sh` is never downloaded or installed.
- `CHECK_STATE` schema 2 separates `latestCheck` from `preparedTarget`.
  Checking upstream is read-only; selecting a release prepares a target and
  does not rewrite the meaning of latest-upstream status.
- The target token binds version, immutable commit, manifest digest, local
  managed-asset fingerprint, operation, and preparation time. Any stale
  token or changed local managed state fails closed before mutation.
- Upgrade, reinstall, downgrade, and install/reconcile use the same lifecycle:
  prepare target, confirm, download by commit, verify SHA-256, run candidate
  gates, stage, apply one Asset Registry transaction, postflight, and write an
  activation receipt. Reinstall is a real write even when all current SHAs
  match.
- A successful activation receipt reports the selected release, source
  `necronicle/z2k`, and its immutable source commit. A failed apply or
  postflight restores the complete previous runtime state.
- The frontend displays installed release, latest release, selected version,
  selected details, operation, and prepared-token state as separate fields.
  It never displays raw SHA, plan token, manifest sequence, semantic/advisory
  review labels, or internal classification paths in the primary UI.
- Intentional older Z2K releases are not runtime failures. Only an actually
  broken component contributes to the system failure hero state.

## Non-goals

- A full Z2K installer.
- Installing upstream shell scripts or init scripts.
- Download-now/install-later workflows.
- Arbitrary Git commit selection.
- Supporting incompatible ancient releases at any cost.
- A second Z2K updater or a parallel Asset Registry writer.
- AI-generated changelog text; release descriptions come from upstream commit
  or release text, with deterministic count-only fallback when absent.

## Compatibility and removal gate

Before generic downgrade is enabled, the latest ten supported tags are
audited for exact-managed membership. If membership is stable, no removal
extension is added. If a target excludes an active manager-owned catalog asset,
the removal is part of the same backup/apply/rollback transaction and is
allowed only for assets owned by the current catalog bundle. A target may not
leave a hybrid release active.

## UI interaction contract

The Components card follows the existing Telegram Proxy release interaction:
the selector updates only the selected-release and action regions, changelog
details are lazy, and busy state is indeterminate unless the backend exposes
real stages. Upgrade, reinstall, and downgrade confirmations use the selected
operation and always clear busy state on success or error.

