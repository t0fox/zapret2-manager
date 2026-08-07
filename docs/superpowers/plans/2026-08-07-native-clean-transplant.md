# Native Clean Transplant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean Native Foundation branch from current `origin/main` using only proven selective imports from `feat/native-fs-helper`.

**Architecture:** Main supplies the product, UI, DNS, Telegram, packaging baseline, and history. Donor paths are restored selectively into new logical commits, with explicit provenance and dependency checks; no donor merge or bulk cherry-pick occurs.

**Tech Stack:** Git worktrees, C11, json-c, OpenWrt package Makefiles, ucode, Node.js `node:test`, WSL/Linux sanitizers, POSIX shell gates.

## Global Constraints

- Main base is `304728c4fb5e49252247d9f80c27becec89cfe41`; donor is `76df521e61acc188be8d9f59fcb67be9da90af02`.
- Work only in `G:/zapret2-native-clean` on `feat/native-clean`.
- Never modify/delete donor or original dirty checkout; never merge/cherry-pick a donor range, rewrite history, or force push.
- Main is authoritative unless an absent reviewed native capability is proven.
- Preserve main DNS/TG semantics and UI; donor UI/artifacts/history are excluded.
- Every imported file records donor provenance and a concrete consumer.

---

### Task 1: Selective Import Manifest And Contracts

**Files:**
- Create: `docs/superpowers/reviews/native-clean-import-manifest.md`
- Create: `docs/contracts/native-backend-v1.md`
- Create: `docs/contracts/z2m-canonical-json-v1.md`
- Create: `docs/superpowers/specs/2026-08-07-native-foundation-fs-helper-design.md`
- Create: `docs/superpowers/plans/2026-08-07-native-foundation-fs-helper.md`

**Interfaces:**
- Consumes: exact main/donor tree diff.
- Produces: approved import allowlist and authoritative contracts for helper/tests.

- [ ] Record every donor-different path as IMPORT, MAIN_WINS, or EXCLUDE with consumer/reason/provenance; confirm no DNS/TG production delta.
- [ ] Restore only the four current contract/design/plan files listed above and verify content hashes against donor.
- [ ] Add contract-link and exclusion assertions, run JSON/contract checks and `git diff --check`.
- [ ] Review and commit `docs(native): import foundation contracts`.

### Task 2: Native Helper Production And Package Closure

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/**`
- Modify: `zapret2-manager/Makefile`
- Test: existing/new package-content test focused on helper build/install.

**Interfaces:**
- Consumes: donor helper source tree and protocol manifest.
- Produces: target-built `/usr/libexec/zapret2-manager/z2m-core-helper` with no test instrumentation.

- [ ] Restore exact helper production sources from donor, excluding no production source needed by its build.
- [ ] Write RED package tests for target compilation source closure, json-c dependency, compile flags, fixed install path, and absence of `Z2M_TESTING`/audit wrappers.
- [ ] Implement minimal OpenWrt Build/Compile and install rules using `$(TARGET_CC)` and target flags/libraries.
- [ ] Run direct WSL helper compile/smoke, package tests and diff check; review and commit `feat(native): import filesystem helper foundation`.

### Task 3: Native Helper And Sanitizer Tests

**Files:**
- Create: `tests/native/**`
- Create/Modify: required gate samples and `tests/gate-ucode-compile.test.sh`, `tests/ucode-no-sugar.test.sh`, `tools/gate-ucode-compile.sh` only where imported tests prove necessity.

**Interfaces:**
- Consumes: Task 2 production helper.
- Produces: protocol/filesystem/lock/SHA/atomic/sanitizer/process-ownership proof.

- [ ] Restore only donor native tests, fixtures, helper build script, and sanitizer ownership modules that exercise imported production sources.
- [ ] Exclude `ratings-helper.compile.test.mjs` and stale prototype changes unless a current main runtime consumer is independently proven.
- [ ] Import minimal gate fixture/script changes required for current shipped ucode compatibility; do not replace unrelated main test runners.
- [ ] Run focused helper, sanitizer, process/artifact, and native recursive suites; review and commit `test(native): import helper verification harness`.

### Task 4: Native Result Modules

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/errors.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/result.uc`
- Test: imported `tests/native/core/result.test.mjs`

**Interfaces:**
- Consumes: native backend v1 contract.
- Produces: canonical result/error building blocks without replacing main RPC handlers.

- [ ] Restore exact modules, trace all imports and package installation, and add RED package/import assertions.
- [ ] Run result, no-sugar, compile, package, and main regression tests; review and commit `feat(native): import result contract modules`.

### Task 5: DNS, TG, And Dependency Preservation

**Files:**
- Modify only tests/docs needed to record preservation; production DNS/TG defaults to main unchanged.

**Interfaces:**
- Consumes: main DNS/TG implementation and imported helper package changes.
- Produces: proof that migration sources and runtime/install closure remain intact.

- [ ] Compare all DNS/TG production paths against main and require zero unexplained changes.
- [ ] Run dns.uc/service-dns/dnsprov/dns-global tests and proxycfg/procd/secrets/health/recovery/TG package tests.
- [ ] Audit rpcd/ACL/procd/UCI/package/catalog/provider references for retained and imported paths; repair only dangling native package references.
- [ ] Review and commit only if preservation assertions/docs are added.

### Task 6: Hygiene, Full Verification, And Delivery

**Files:**
- Create: `tests/native/repository-hygiene.test.mjs`
- Modify: `.gitignore` only for exact native build artifacts.
- Modify: import manifest with final hashes/verification.

**Interfaces:**
- Consumes: final selective import tree.
- Produces: donor-artifact exclusion, fresh-tree proof, reviewed `feat/native-clean`.

- [ ] Add RED hygiene checks rejecting `artifacts/`, `build-apk/`, binaries/objects/core/sanitizer output and donor historical/UI import paths among main-relative additions.
- [ ] Run native recursive suite twice, helper/sanitizer, shell, ucode (`UNAVAILABLE` if absent), package/install/reference, JSON, process/marker/artifact and diff/status gates.
- [ ] Create a fresh worktree at HEAD and repeat full local verification without donor/untracked files.
- [ ] Dispatch whole-tree, Native Foundation, DNS, and TG reviewers; fix all load-bearing findings.
- [ ] Push `feat/native-clean` and open a Draft PR against `main`; do not mark Ready or delete donor.
