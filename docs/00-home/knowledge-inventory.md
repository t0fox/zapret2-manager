---
id: knowledge-inventory
title: "Knowledge Inventory and Migration Status"
type: doc
status: current
authority: evidence
updated: 2026-08-22
publish: false
tags: [knowledge, inventory, migration, vault]
---

# Knowledge Inventory and Migration Status

`docs/` is the canonical knowledge source. This inventory records the
authority class and action for every current documentation area, while the
archive manifest records path-level moves and deletes. It is intentionally
kept semantic rather than embedding a volatile Git commit.

| Category | Current scope | Action | Publication |
| --- | --- | --- | --- |
| `CURRENT_NORMATIVE` | `docs/02-architecture/`, `docs/04-contracts/`, `docs/07-decisions/`, and `docs/12-ai/` contracts | Keep and link from an index | Per-document `publish` flag; AI contracts remain private |
| `CURRENT_REFERENCE` | `docs/03-products/`, `docs/05-parity/`, `docs/06-upstreams/`, `docs/08-development/`, and `docs/11-operations/` | Keep, update from implementation evidence | Publish only user/reference material |
| `CURRENT_USER_DOC` | `README.md`, `docs/index.md`, product indexes, and public reference pages | Keep concise and route to canonical owners | `publish: true` only for safe public pages |
| `CURRENT_INTERNAL` | `docs/00-home/`, `docs/09-work/`, and private AI/operations notes | Keep as working evidence; do not publish by default | `publish: false` for internal state, plans, reports, and contracts |
| `SUPERSEDED` | Tracked legacy `docs/superpowers/` plans/specs moved to `docs/99-archive/superpowers/` | Archive with migration manifest rows | Never publish archive material |
| `STALE` | Reports or plans whose status no longer describes the current implementation | Update status and evidence, or archive after replacement is linked | Do not expose stale claims as current |
| `BROKEN_REFERENCE` | Two deleted bootstrap targets from the pre-vault contract | Remove from bootstrap and point to existing home/decisions indexes; do not create stubs | N/A |

## Area inventory

- **Home:** `docs/index.md`, `docs/00-home/current-state.md`, and this
  inventory are the deterministic entry surface.
- **Project and architecture:** `docs/01-project/` and `docs/02-architecture/`
  describe scope and runtime ownership.
- **Products:** `docs/03-products/` routes Strategy, Scanner, BlockCheck, and
  Deep Search. Optional Telegram Proxy and WARP/MASQUE remain explicitly
  optional runtime products; they do not become manager package components.
- **Contracts and parity:** `docs/04-contracts/`, `docs/05-parity/`, and
  `docs/07-decisions/` contain the compatibility and authority boundaries.
- **Upstreams and development:** `docs/06-upstreams/` and
  `docs/08-development/` record source provenance and the validation workflow.
- **Work and operations:** `docs/09-work/` is evidence/plans/specs and
  `docs/11-operations/` is operational guidance; neither is a public product
  catalog.
- **AI and templates:** `docs/12-ai/` is the operating contract and routing
  map; `docs/90-templates/` contains authoring templates.
- **Archive:** `docs/99-archive/` is immutable migration history with a
  machine-validated manifest.

## Verification contract

Every edited canonical Markdown file has the required frontmatter. Run:

```text
node scripts/validate-knowledge.mjs
node scripts/docs.mjs verify
node scripts/docs.mjs build internal
node scripts/docs.mjs build public --production
node tests/knowledge/public-leak.test.mjs
```

The public build may upload only `.artifacts/docs-public`. Internal notes,
generated outputs, secrets, and archive material must never be uploaded to
GitHub Pages.
