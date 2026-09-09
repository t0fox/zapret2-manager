# Task 14 report — current knowledge and projection alignment

Date: 2026-09-09
Execution branch: `codex/z2k-recovery-v2`

## Changes

Current product, architecture, and developer docs now describe the recovered
boundaries:

- Scanner exposes exactly the five typed Detect operations
  `probe`, `classify`, `quic`, `voice`, and `tcp16`.
- Detect returns bounded typed evidence and does not create candidates, own a
  native Scanner authority, own NFQUEUE, or create a second Strategy lifecycle.
- Strategy permanent Preview → Validate → Save → Apply remains the sole
  permanent strategy path.
- Components is the only Z2K Core mutation surface.
- Resources presents Z2K as Core-managed/read-only and does not create an
  independent mutation owner.
- NFQUEUE documentation now points to the Engine status read-back instead of
  the retired candidate-activation projection.

The public projection code evidence for NFQUEUE was updated to the retained
`health_block` in `core/status-collector.uc`. The reviewed runtime manifest was
audited but not changed: `scanner-cli.uc` and
`scanner-runtime-adapter.sh` are explicitly KEEP_SHARED in
`scanner-callgraph.md`, and no deleted `scanner.c`/legacy worker/planner
reference remains in the manifest.

## Gates

- `node --test tests/knowledge/public-projection.test.mjs tests/knowledge/validator.test.mjs tests/knowledge/docs-cli.test.mjs` — `24 passed, 0 failed`.
- `node scripts/validate-knowledge.mjs` — `Knowledge validation passed.`
- `node scripts/docs.mjs verify` — Quartz SHA verified, exit 0.
- `git diff --check` — exit 0.
- Current normative scan found no stale `scanner_probe`, `scanner.c`,
  `scanner-worker`, `scanner-planner`, old Scanner mode, or
  `УПРАВЛЕНИЕ РЕСУРСАМИ` claim outside historical/parity/archive material.

## Boundary

This task changed documentation and projection metadata only. No router state,
APK, branch push, merge, branch deletion, or worktree deletion was performed.

**Ruling:** Task 14 is `VERIFIED`; historical parity/archive documents remain
historical and were intentionally not rewritten as current product claims.
