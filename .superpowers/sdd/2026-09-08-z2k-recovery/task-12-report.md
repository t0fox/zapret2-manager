# Task 12 — explicit rollback outcomes and same-release repair

Status: VERIFIED_FOCUSED_PENDING_RUNTIME

## Implementation

- Kept `resource-update.uc` as the lifecycle coordinator and added the canonical top-level rollback projection `{ attempted, ok, restored }`; nested rollback details are no longer mixed into the initiating `error` object.
- Postflight verification failure now returns `EPOSTFLIGHT`; successful compensation projects the captured LKG identity: release, runtime bundle digest, Detect SHA, catalog digest, and selected strategy identity.
- Pre-commit rejection returns `rollback.attempted: false` and the existing mutation counters/active identity prove that Registry and runtime were not changed.
- Added `z2k_registry_repair_release` as the sole receipt-v3 authority and pure `resolveRepairTarget` bridge. Repair uses the existing prepare/apply transaction and resolves the installed coherent release rather than latest.
- The worker preserves the explicit `same-release-repair` mode as progress metadata; it remains a coordinator and does not gain lifecycle authority.

## TDD and verification

- RED command:
  `node --test tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs`
  produced six expected contract failures before implementation.
- GREEN command (WSL, UCode, serial to avoid the existing shared `/tmp` fixture race):
  `node --test --test-concurrency=1 tests/product/z2k-coherent-transaction.test.mjs tests/product/z2k-update-transaction.test.mjs tests/product/z2k-detect-artifact.test.mjs tests/product/z2k-receipt-v3.test.mjs tests/product/z2k-target-lifecycle-contract.test.mjs`
  with `UCODE_BIN=/opt/ucode/bin/ucode`, `UCODE_LIBRARY_PATH=/opt/ucode/lib`, and `LD_LIBRARY_PATH=/opt/ucode/lib`: **81 passed, 0 failed, 0 skipped**.
- The repair fixture directly verified the installed coherent release through both Registry authority and runtime bridge (`p-81.1 -> p-81.1`).
- Independent review also verified the repair marker is preserved in the queued worker request and that a successful rollback requires complete restored identity evidence.
- `git diff --check`: passed.

## Boundary

No router evidence is claimed here. Source deployment, CI-built APK packaging, router runtime proof, browser acceptance, and final branch delivery remain separate gates. No local APK build was performed.
