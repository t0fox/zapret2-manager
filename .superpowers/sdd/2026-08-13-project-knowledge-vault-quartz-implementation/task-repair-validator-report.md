# Validator Repair Report

## Scope

Replaced the fixture-specific `scripts/validate-knowledge.mjs` stub with a
repository-root-aware validator. The validator now checks canonical Markdown
frontmatter, global IDs, Markdown links and anchors, Obsidian wikilinks,
legacy paths, authority reachability, migration manifests, context maps, and
typed `publish` values. It accepts both the checked-in context-map schema shape
and the compact legacy-compatible fixture shape while validating their declared
paths and globs.

## TDD Evidence

- Initial RED: `node --test tests/knowledge/validator.test.mjs` reported 10
  failures against the fixture-specific stub.
- GREEN: the focused suite reports `13` passing tests and `0` failures.
- Real-tree fixture validation passes with zero errors.

## Repository Findings

`node scripts/validate-knowledge.mjs docs` remains fail-closed on pre-existing
repository content outside this repair scope. The findings include UTF-8 BOM
handling now covered by the validator, missing frontmatter in historical work
documents, references to absent `docs/07-decisions` and other migration-era
paths, and context-map entries whose code/test globs or targets are not present
in the current main tree. Application, Scanner, and `.ua` files were not
modified to mask those findings.

## Files

- `scripts/validate-knowledge.mjs`
- `tests/knowledge/validator.test.mjs`
- `tests/knowledge/fixtures/`

## Commits

- Validator, tests, and fixtures: `e79ad6a`
- Report history: initial report `7e181e6`; commit-record correction `6c429f2`
