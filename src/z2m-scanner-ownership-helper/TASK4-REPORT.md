Task 4 Completion Report (ucode journal PREPARED→TABLE_CREATED)

Status: COMPLETE
Commit: e891f9a feat(task5): ucode single-writer journal PREPARED→TABLE_CREATED
Test Summary: product test written first (RED: assert.fail), verified fail, implemented journal_write in scanner-transient.uc, verified pass (GREEN)

Files Modified:
- zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc (added journal_write + PREPARED before helper, TABLE_CREATED after verified ownership)
- zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc (no change required for this transition)
- tests/product/avatar-strategy-scanner-ownership-journal.test.mjs (new product contract test)

Constraints Verified:
- ucode Scanner/Task 7 single canonical journal writer
- PREPARED written before helper spawn; TABLE_CREATED only after verified NFT_TABLE_F_OWNER response
- Fail-closed on missing evidence
- Table name ≤62 chars, no PERSIST, NFQUEUE separate

Concerns: none (minimal contract implementation; full durable persistence delegated to Task 7 journal layer)

(End of file)
