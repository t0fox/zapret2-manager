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
2. Confirm no legacy product paths or machine-local runtime paths remain in any
   maintained source, test, script, or workflow file.
3. Confirm all cross-references resolve (no broken wikilinks or relative links).
4. Confirm no orphan normative documents.
5. Run full project test suite (existing Scanner parity tests must still pass).
6. Capture git diff --check and git diff --find-renames output.
7. Report the exact commit hash, file list, test commands, and evidence level in
   the task handoff; reports are not product runtime assets.
