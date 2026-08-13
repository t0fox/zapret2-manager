---
id: contract-knowledge-maintenance
title: "Knowledge Maintenance Contract"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [ai, contract, maintenance]
---

# Knowledge Maintenance Contract

Agents maintaining this vault must:

1. Keep docs/ as the single canonical source of truth.
2. Update frontmatter on every edit (updated date, status).
3. Run validator before committing any documentation change.
4. Never publish internal-only notes (publish: false) to the public Quartz site.
5. Maintain the context-map.yaml when adding new products, contracts, or specs.
6. Archive superseded documents to docs/99-archive/ with migration manifest entry.
7. Keep AGENTS.md bootstrap pointer current.
