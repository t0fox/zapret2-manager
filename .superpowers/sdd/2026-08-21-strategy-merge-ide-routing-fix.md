---
id: strategy-merge-ide-routing-fix
title: "Bulk Strategy merge uses the new IDE"
type: evidence
status: verified
authority: z2m-strategies
updated: 2026-08-21
publish: false
tags: [strategy, ide, regression]
---

# Root cause

`z2m-strategies.js` contained two declarations of `mergeSelected()`. The
later declaration shadowed the newer handler because JavaScript function
declarations are hoisted. It combined compact list rows directly and opened
the legacy editor path, so selecting and combining strategies did not use the
lossless IDE flow.

# Fix

Removed the later legacy declaration. The single remaining handler now owns
bulk selection/merge, fetches full records through canonical
`strategies.get` when catalog profile arguments are truncated, combines only
complete strategies, and opens the current IDE through `renderEditorForm()`.

# Verification

- Regression test was observed failing before the fix: `2 !== 1` duplicate
  `mergeSelected()` declarations.
- `node --test tests/ui/strategy-ide-workflow.test.mjs`: 7/7 pass.
- `node --check` passes for `z2m-strategies.js` and `z2m-nfqws2-ide.js`.
- `git diff --check` passes.
- Implementation commit: `cae3ef88`.

# Scope

No Strategy API, Apply lifecycle, catalog authority, Scanner authority, or
Strategy UX surface was replaced. Only the shadowing legacy merge handler and
its regression coverage changed.
