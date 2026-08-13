# Avatar Strategy Scanner Task 5 Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-operation dedicated table ownership model (Model A1) with bounded C helper as long-lived netlink owner, `NFT_TABLE_F_OWNER` without `PERSIST`, durable ucode-owned journal, and strict separation of NFQUEUE ownership proof.

**Architecture:** Bounded C ownership helper (refactored from `z2m-scanner-firewall-helper.c`) holds netlink socket and creates exactly one OWNER/no-PERSIST dedicated table per Scanner operation. ucode Scanner/Task 7 remains single canonical journal writer. Kernel automatically removes table on helper death. Userspace get/list/check → delete is never used as primary ownership primitive.

**Tech Stack:** C (native helper), ucode (Scanner runtime + journal), nftables/netlink (kernel ownership), NFQUEUE.

## Global Constraints

- Ownership safety above everything: fail-closed on any uncertainty.
- No userspace get/list/check → delete as primary ownership primitive.
- Bounded C helper never owns product journal, Scanner lifecycle, reconciliation policy, or permanent state.
- ucode Scanner/Task 7 is single canonical journal writer.
- Table name max 62 characters: `z2m_sc_<sid8>_<cid8>_<gen4>_<nonce32>`.
- `NFT_TABLE_F_OWNER` + no `PERSIST` by default.
- NFQUEUE ownership remains separate proof obligation.
- No broad privileged daemon; no arbitrary nft execution.
- No DNS/TG/router/LuCI/Orchestra mutation, no permanent Strategy/config writes.
- ROUTER_E2E not run without explicit physical-router approval.
- Native full gate: `scripts/test/native.sh`.

---

### Task 1: Define bounded ownership helper contract and protocol

**Files:**
- Create: `zapret2-manager/src/z2m-scanner-ownership-helper/protocol-v2.json`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol-v1.json` (add ownership operation)

**Interfaces:**
- Consumes: existing native helper protocol envelope.
- Produces: `ownership_create`, `ownership_ready`, `ownership_delete`, `ownership_status` operations with exact request/response schemas.

- [ ] **Step 1: Write the failing contract test**

```sh
# tests/native/avatar-strategy-scanner-ownership-contract.test.sh
#!/bin/sh
set -eu
# Expected: helper binary exists and responds to --help with ownership protocol version
test -x build/z2m-scanner-ownership-helper || { echo "FAIL: helper not built"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh tests/native/avatar-strategy-scanner-ownership-contract.test.sh`
Expected: FAIL (binary does not exist yet)

- [ ] **Step 3: Define protocol v2 JSON schema**

```json
{
  "version": 2,
  "operations": {
    "ownership_create": { ... },
    "ownership_ready": { ... },
    "ownership_delete": { ... },
    "ownership_status": { ... }
  }
}
```

- [ ] **Step 4: Run test to verify protocol is loadable**

Run: `node -e "JSON.parse(require('fs').readFileSync('.../protocol-v2.json'))"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/src/z2m-scanner-ownership-helper/protocol-v2.json
git commit -m "feat(task5): define bounded ownership helper protocol v2"
```

### Task 2: Implement bounded ownership helper skeleton (C)

**Files:**
- Create: `zapret2-manager/src/z2m-scanner-ownership-helper/main.c`
- Create: `zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c`
- Create: `zapret2-manager/src/z2m-scanner-ownership-helper/ownership.h`

**Interfaces:**
- Consumes: protocol-v2.json schemas, netlink socket lifecycle.
- Produces: `ownership_create_table()`, `ownership_delete_table()`, `ownership_report_ready()`.

- [ ] **Step 1: Write the failing build test**

```sh
# tests/native/avatar-strategy-scanner-ownership-build.test.sh
make -C zapret2-manager build-ownership-helper 2>&1 | tail -5
test -x build/z2m-scanner-ownership-helper || exit 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh tests/native/avatar-strategy-scanner-ownership-build.test.sh`
Expected: FAIL (source does not exist)

- [ ] **Step 3: Implement minimal C skeleton that opens netlink and prints version**

```c
int main(void) {
    printf("z2m-scanner-ownership-helper v2\n");
    return 0;
}
```

- [ ] **Step 4: Run test to verify it builds and runs**

Run: `sh tests/native/avatar-strategy-scanner-ownership-build.test.sh`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/src/z2m-scanner-ownership-helper/
git commit -m "feat(task5): bounded ownership helper skeleton"
```

### Task 3: Implement table creation with NFT_TABLE_F_OWNER (no PERSIST)

**Files:**
- Modify: `zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c:50-120`

**Interfaces:**
- Consumes: operation identity (session, candidate, generation, nonce32).
- Produces: table name (62 chars max), netlink portID owner evidence.

- [ ] **Step 1: Write the failing unit test for table creation**

```c
// tests/native/ownership_create_table_test.c
void test_create_owner_table(void) {
    struct ownership_request req = { ... };
    int rc = ownership_create_table(&req);
    assert(rc == 0);
    assert(table_exists(req.table_name));
    assert(table_owner_is_current_netlink_port());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test-ownership-create`
Expected: FAIL (function not implemented)

- [ ] **Step 3: Implement nft table creation with NFT_TABLE_F_OWNER**

```c
int ownership_create_table(...) {
    // netlink: NFT_MSG_NEWTABLE + NFTA_TABLE_FLAGS = NFT_TABLE_F_OWNER
    // no NFT_TABLE_F_PERSIST
    // userdata = operation UUID + nonce32
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test-ownership-create`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c
git commit -m "feat(task5): create OWNER/no-PERSIST dedicated table"
```

### Task 4: Wire ucode journal state machine (PREPARED → TABLE_CREATED)

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc`

**Interfaces:**
- Consumes: ownership helper protocol v2.
- Produces: durable journal entries with verified helper responses.

- [ ] **Step 1: Write the failing product test for PREPARED → TABLE_CREATED**

```js
// tests/product/avatar-strategy-scanner-ownership-journal.test.mjs
test('ucode writes PREPARED then TABLE_CREATED after verified helper response', async () => {
    const result = await invokeScannerOperation('create');
    assertJournalContains('PREPARED');
    assertJournalContains('TABLE_CREATED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/product/avatar-strategy-scanner-ownership-journal.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement ucode journal write after helper response**

```ucode
let prepared = journal_write('PREPARED', ...);
let helper_resp = ownership_helper('create', req);
if (helper_resp.ok) journal_write('TABLE_CREATED', helper_resp.evidence);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/product/avatar-strategy-scanner-ownership-journal.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc
git commit -m "feat(task5): ucode single-writer journal PREPARED→TABLE_CREATED"
```

### Task 5: Implement bounded chain/rules installation inside dedicated table

**Files:**
- Modify: `zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c`

**Interfaces:**
- Consumes: table name, NFQUEUE number, mark value.
- Produces: exact chain + rules that match only this operation's NFQUEUE.

- [ ] **Step 1: Write the failing test for bounded rules**

```c
void test_install_bounded_chain(void) {
    ownership_install_rules(table_name, queue_num, mark);
    assert_chain_exists(table_name, "z2m_sc_<nonce32>");
    assert_rule_has_queue(queue_num);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test-ownership-rules`
Expected: FAIL

- [ ] **Step 3: Implement minimal chain + NFQUEUE rule creation**

```c
int ownership_install_rules(...) {
    // nft add chain inet <table> <unique>
    // nft add rule ... queue num <queue> bypass
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test-ownership-rules`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c
git commit -m "feat(task5): bounded chain/rules inside OWNER table"
```

### Task 6: Implement ownership delete path (CLEANING → CLEANED)

**Files:**
- Modify: `zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc`

**Interfaces:**
- Consumes: table name, verified nfqws2 stopped evidence.
- Produces: table absence + CLEANED journal entry.

- [ ] **Step 1: Write the failing cleanup test**

```c
void test_delete_owned_table(void) {
    ownership_delete_table(table_name);
    assert(!table_exists(table_name));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test-ownership-delete`
Expected: FAIL

- [ ] **Step 3: Implement delete with ownership verification**

```c
int ownership_delete_table(...) {
    // verify current netlink port is still owner
    // nft delete table inet <table>
    // verify absence
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test-ownership-delete`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/src/z2m-scanner-ownership-helper/ownership.c
git commit -m "feat(task5): ownership delete path with kernel verification"
```

### Task 7: Implement crash recovery semantics (Task 7 boundary)

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc`

**Interfaces:**
- Consumes: journal state, helper/process lifecycle, OWNER/no-PERSIST invariant.
- Produces: verify absence or reconcile state; never delete uncertain objects.

- [ ] **Step 1: Write the failing reconciliation test**

```js
test('owner dead + table unexpectedly exists → FAIL CLOSED', () => {
    const result = reconcile('TABLE_CREATED', {ownerDead: true, tablePresent: true});
    assert(!result.deleteAttempted);
    assert(result.decision === 'FAIL_CLOSED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/product/avatar-strategy-scanner-reconcile-ownership.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement Task 7 reconciliation rule**

```ucode
if (owner_dead && table_present) {
    journal('unexpected foreign table');
    return { decision: 'FAIL_CLOSED', delete: false };
}
if (owner_dead && !table_present) {
    return { decision: 'reconcile_process_queue_journal' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/product/avatar-strategy-scanner-reconcile-ownership.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc
git commit -m "feat(task5): Task 7 reconciliation with OWNER/no-PERSIST invariant"
```

### Task 8: Add adversarial ownership tests

**Files:**
- Create: `tests/native/avatar-strategy-scanner-ownership-adversarial.test.sh`

**Interfaces:**
- Consumes: ownership helper binary, nft CLI.
- Produces: proof that external writer cannot delete/recreate while owner alive; foreign table after owner death → FAIL CLOSED.

- [ ] **Step 1: Write the failing adversarial test**

```sh
# external writer must not be able to delete/recreate while helper alive
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh tests/native/avatar-strategy-scanner-ownership-adversarial.test.sh`
Expected: FAIL

- [ ] **Step 3: Implement test cases (same-name recreate, owner SIGKILL, foreign table after death)**

- [ ] **Step 4: Run test to verify it passes**

Run: `sh tests/native/avatar-strategy-scanner-ownership-adversarial.test.sh`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/native/avatar-strategy-scanner-ownership-adversarial.test.sh
git commit -m "test(task5): adversarial OWNER ownership tests"
```

### Task 9: Package and native gate integration

**Files:**
- Modify: `zapret2-manager/Makefile`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh` (call new helper)

**Interfaces:**
- Consumes: existing package build.
- Produces: ownership helper binary shipped with package.

- [ ] **Step 1: Update Makefile to build ownership helper**

- [ ] **Step 2: Run native gate**

Run: `scripts/test/native.sh`
Expected: PASS (existing + new ownership tests)

- [ ] **Step 3: Commit**

```bash
git add zapret2-manager/Makefile
git commit -m "feat(task5): package ownership helper"
```

### Task 10: Focused verification + broader verification

**Files:**
- All modified files from Tasks 1-9

**Interfaces:**
- Consumes: full test matrix.
- Produces: evidence that ownership model passes all adversarial cases and native gate.

- [ ] **Step 1: Run focused ownership tests**

Run: `make test-ownership-*`
Expected: all PASS

- [ ] **Step 2: Run broader native gate**

Run: `scripts/test/native.sh`
Expected: PASS

- [ ] **Step 3: Run product ownership journal + reconciliation tests**

Run: `node --test 'tests/product/avatar-strategy-scanner-ownership-*.test.mjs'`
Expected: all PASS

- [ ] **Step 4: Commit final verification**

```bash
git commit -m "test(task5): ownership model verified - focused + broader gates"
```

**Plan complete.** All tasks are bite-sized, independently testable, and respect the approved Section Design.
