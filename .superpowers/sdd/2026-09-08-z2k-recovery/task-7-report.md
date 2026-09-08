# Task 7 — Canonical Z2K Core Components projection

Date: 2026-09-08  
Worktree: `G:\zapret2-manager\.worktrees\z2k-recovery-v2`  
Branch: `codex/z2k-recovery-v2`

## Implementation and review

- Initial implementation: `c5418ce2`.
- Fix round 1: `65ee5960` accepted canonical `activation-receipt-v3`,
  `activation-receipt-v2`, and legacy receipt authorities with confirmed
  evidence, preserved nested `coherence.compatibilityStatus`, and added a
  backend-shaped fixture.
- Fix round 2: `e014132d` accepted literal `activation-receipt-v1` with the
  same confirmed value/confidence guards and added its regression assertion.
- Final independent four-skill UI/design re-review:
  `reviews/review-task-7.md` — PASS, no P0/P1/P2 findings.

The projection has the seven required states (`missing`, `ready`,
`update-available`, `degraded`, `broken`, `working`, `rollback-result`), keeps
user-facing `facts` separate from `technical` evidence, and never reports a
healthy/working Core without canonical receipt, runtime, and Detect coherence.

## Automated evidence

- RED round 1: canonical receipt-v3 plus nested compatibility fixture projected
  `degraded` before the fix.
- GREEN after round 1: `24 passed, 0 failed`.
- RED round 2: literal receipt-v1 projected `degraded` before the fix (`23
  passed, 1 failed`).
- GREEN after round 2: `24 passed, 0 failed`.
- All four scoped files passed `node --check`; `git diff --check` passed.

## Source deploy and browser evidence

- Source-only deploy used candidate `e014132d4f6068619792433b03b0e2781230755a`.
- Remote `z2m-components-model.js` SHA-256:
  `465ff65b3c535db288d9c28e2cfed826c18e27e21857e0db03a1f89b35c6902e`.
- Real LuCI was hard-loaded with cache disabled at `#/components` after the
  deploy. The page rendered one normal-flow `Z2K Core` card, not a second
  lifecycle dashboard. The observed canonical router state was honestly
  projected as `Требует внимания`, with `Detect status: unknown`, rather than
  falsely showing `Работает`; technical evidence remained available via the
  subordinate details path.
- This is a projection acceptance result, not a claim that the current router
  is healthy: the backend snapshot observed in the browser was not Detect-ready.

APK was not built locally or otherwise; APK remains CI-only. No merge, push,
branch deletion, or worktree deletion was performed.
