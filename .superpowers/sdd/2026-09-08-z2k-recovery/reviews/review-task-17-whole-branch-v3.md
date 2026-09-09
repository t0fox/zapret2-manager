# Task 17 whole-branch review — initial independent Luna review

Reviewer: independent gpt-5.6-luna agent `Parfit`
Verdict: NOT READY; Task 17 remains WORKING.

## Critical

- Final acceptance gates are incomplete: final-artifact Detect RPC execution,
  discovery lifecycle, upgrade/reinstall/repair/downgrade, injected
  pre-commit and post-activation rollback with physical identity comparison,
  final browser matrix, complete Core identity, and final installed/resource
  metrics are not all proven.

## Important

- Scanner classify UI renders hello values `both`, `client`, `server`, while
  the Manager/native contract accepts `modern`, `legacy`, `both`.
- Scanner `isValidHostname()` rejects valid IPv4/IPv6 and single-label hosts
  accepted by the backend Detect contract.
- Existing acceptance provenance names deleted execution branch
  `codex/z2k-recovery-v2`; the CI candidate is recoverably related but the
  evidence must be rewritten for the current execution branch.

## Minor

- `task-7-report.md` has trailing whitespace under diff-check.
- The canonical repository-wide run is not green; Windows/WSL environment and
  product baseline failures remain to be classified rather than relabeled.

Architecture review found no duplicate lifecycle/scanner authority, the
single Components surface and Core-managed Resources boundaries are present,
and the CI-only artifact/size gate is valid. Browser/router evidence is still
too narrow for Task 17.
