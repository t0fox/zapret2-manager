---
id: knowledge-workflow
title: "Knowledge Workflow"
type: doc
status: current
authority: canonical
updated: 2026-08-13
publish: true
tags: [development, knowledge, workflow]
---

# Knowledge Workflow

The `docs/` tree is the canonical project knowledge surface. Changes to
architecture, products, contracts, decisions, research, operations, and AI
operating rules belong in the corresponding numbered section. Work-in-progress
plans and specifications stay under `docs/09-work/`; historical material stays
under `docs/99-archive/`.

## Authoring Rules

- Give every canonical Markdown document unique valid frontmatter fields: `id`,
  `title`, `type`, `status`, `authority`, `updated`, `publish`, and nonempty
  `tags`.
- Keep links relative to the document and point them at canonical paths. Do not
  reintroduce the pre-vault directory layout or its old path aliases.
- Treat contracts, approved specifications, canonical decisions, and indexes as
  authoritative only when they are reachable from the knowledge home or an
  indexed canonical document.
- Record migrations in `docs/99-archive/migration-manifest.json` from Git rename
  evidence, including the old path, actual target, action, and old blob SHA.

## Verification

Run the knowledge validator after documentation edits:

```text
node scripts/validate-knowledge.mjs
node --test tests/knowledge/*.test.mjs
```

The validator is the source of truth for frontmatter, duplicate IDs, links,
manifest rows, and context-map globs. Fix knowledge defects in the docs or
context map; do not change application behavior to make the knowledge checks
pass.
