---
id: contract-verification
title: "Verification Contract"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [ai, contract, verification]
---

# Verification Contract

Before claiming any task complete:

1. Run validator and confirm zero errors on all new/modified files.
2. Confirm no legacy paths remain in any .md, .js, .mjs, .sh, .ps1, or workflow file.
3. Confirm all cross-references resolve (no broken wikilinks or relative links).
4. Confirm no orphan normative documents.
5. Run full project test suite (existing Scanner parity tests must still pass).
6. Capture git diff --check and git diff --find-renames output.
7. Write task report to .superpowers/sdd/ with exact commit hash and file list.
