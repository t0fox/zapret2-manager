---
id: knowledge-workflow
title: "Knowledge Workflow"
type: doc
status: current
authority: canonical
updated: 2026-08-14
publish: true
tags: [development, knowledge, workflow]
---

# Knowledge Workflow

The `docs/` tree is the canonical project knowledge surface. Public documentation should explain the project, current product behavior, architecture, installation, troubleshooting, and development workflow without exposing internal engineering handoffs or agent operating material.

## Authoring rules

- Give every canonical Markdown document valid frontmatter fields: `id`, `title`, `type`, `status`, `authority`, `updated`, `publish`, and nonempty `tags`.
- Keep links relative to the document and point public pages only to other public pages.
- Use current code, package metadata, tests, and canonical contracts as evidence for product claims. A design or plan by itself is not evidence that a feature is shipped.
- Keep maturity explicit. Mark incomplete functionality as prototype, in development, or planned rather than presenting it as stable.
- Keep generated Quartz output out of source control; public and internal builds belong under `.artifacts/`.

## Public and internal views

The repository uses the same knowledge source for two Quartz views. Public mode publishes only material explicitly marked for publication. Internal mode can include the wider engineering knowledge graph.

That boundary is intentional: a public page may summarize architecture or a contract, but it should not link visitors into private work notes, agent instructions, recovery records, or other internal-only material.

## Verification

Run the knowledge validator after documentation edits:

```text
node scripts/validate-knowledge.mjs
```

For the documentation site, verify the pinned Quartz checkout and build both views:

```text
node scripts/docs.mjs verify
node scripts/docs.mjs build internal
node scripts/docs.mjs build public
```

The public build also runs generated-site checks for required pages, meaningful content, publication-boundary leaks, broken relative links, and GitHub Pages subpath behavior. Fix a documentation or metadata defect at its source rather than weakening those checks.

## Development principle

Documentation is part of the implementation contract. When code changes a product boundary, state model, package flow, or verified maturity level, update the corresponding public explanation when that change affects users. Keep implementation-level evidence in the internal knowledge system and keep the public site concise enough for a new visitor to navigate without reading repository internals.

Return to [Development](./index.md), [Project overview](../01-project/index.md), or [Architecture](../02-architecture/index.md).
