---
id: z2k-version-catalog-lifecycle-evidence
title: "Z2K version catalog and rollback lifecycle evidence"
type: doc
status: current
authority: evidence
updated: 2026-08-28
publish: false
tags: [z2k, catalog, rollback, ui, resources]
---

# Z2K version catalog and rollback lifecycle evidence

> Superseded by [2026-08-28-z2k-version-ux-live-acceptance.md](2026-08-28-z2k-version-ux-live-acceptance.md), which records final SHA, router deployment, Browser acceptance, and current blockers.

## Scope

The approved Z2K catalog/changelog/rollback plan was implemented on an
isolated branch based on the locally completed Components UI baseline. The
baseline was fast-forward pushed to `origin/main` before this feature branch
was created; the unrelated untracked `\uF03C` directory in the original
checkout was not touched or staged.

## Implementation

- The release catalog is bounded to the newest ten semantic `r-*` tags plus a
  separately retained installed release. Tag identity is resolved to an
  immutable commit SHA; lightweight and annotated tags are handled explicitly.
- `UPDATES.json` and exact-managed assets are read only from that immutable
  commit. Supported releases currently share the audited 39-file exact-managed
  membership; releases with relevant unclassified drift are presented as
  incompatible and cannot be prepared.
- Release details are lazy. The UI displays the upstream human release body,
  deterministic exact-managed change counts, and a compare link. No AI-written
  changelog or raw token/hash/manifest identity is rendered as user-facing UI.
- CHECK_STATE v2 separates `latestCheck` from `preparedTarget`. Prepare stores
  one immutable target identity, operation, local fingerprint, and opaque
  target token. Apply requires the matching target and token, downloads every
  target asset by commit SHA, verifies the candidate gate, applies one Asset
  Registry transaction, postflights every asset, and rolls back on postflight or
  state-clear failure.
- The legacy `z2k_component_apply` is a read-only compatibility boundary that
  returns `ELEGACY_LIFECYCLE`; `resources_update` cannot enter that path.
- CLI, rpcd, ACL, API, Components model, and Components UI expose catalog,
  lazy details, prepare, explicit confirmation, and operation-specific
  install/upgrade/reinstall/downgrade labels.

## UI design review

The release selector and detail panel were reviewed using Emil design
engineering, design consultation, design review, and Web Interface Guidelines.

| Before | After | Why |
| --- | --- | --- |
| One implicit available-release action | Bounded selector with disabled incompatible releases | Makes target choice explicit and prevents accidental incompatible actions |
| Raw release metadata mixed into details | Human changelog and exact-managed change summary | Keeps hierarchy useful while hiding implementation internals |
| Small, generic selector/panel affordances | 44px selector/link targets, visible focus, visited-link color, reduced motion | Improves keyboard, touch, and motion accessibility |
| Advisory upstream drift surfaced as warning | Advisory drift stays outside primary warning/callout | Preserves canonical distinction between update availability and attention |

## Verification

- Z2K-focused product contracts: **47 passed, 0 failed**.
- Components/UI contracts: **35 passed, 0 failed**.
- JavaScript syntax checks for API, Components model, and maintenance view:
  passed.
- `git diff --check`: passed.
- `node scripts/docs.mjs verify`: passed.
- The broader Resource Center transaction group remains **41 passed, 1
  failed** because an existing Strategy Catalog assertion still expects the
  old phrase `partial remote files are rejected`; current production source
  uses the equivalent `rejected-incomplete-source` state. This unrelated test
  was not changed.
- `node scripts/validate-knowledge.mjs` remains blocked by the pre-existing
  `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md: missing frontmatter`.
- `tests/ui/component-status-semantics.test.mjs` cannot start because this
  checkout has no `vitest` dependency.
- Native ucode execution is **unrun**: Windows host has no `ucode` binary or
  `/opt/ucode` runtime. Router deployment, authenticated rpcd calls, and
  browser/cache-disabled acceptance are also **not run** in this task.

## Delivery boundary

The published main baseline is proven at `c6c9b4c57a039f8440d959f72b1159f3bbe94a8c`
with `HEAD == origin/main` in the original checkout. The catalog lifecycle
implementation is committed separately on branch `codex/z2k-version-lifecycle`
and has not been pushed or merged by this task.

## Verdict

Implementation and source-level contracts are ready for router/ucode and
browser acceptance. Overall live-delivery verdict: **NOT READY**, because
those runtime gates remain unverified and the repository validator has the
unrelated pre-existing frontmatter failure above.
