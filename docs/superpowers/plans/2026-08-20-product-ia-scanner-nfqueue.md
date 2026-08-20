---
id: product-ia-scanner-nfqueue-plan
title: "Product IA consolidation, Scanner wiring, and NFQUEUE dependencies"
type: plan
status: planned
authority: proposed
updated: 2026-08-20
publish: true
tags: [plan, product, scanner, nfqueue]
---

# Product IA consolidation, Scanner wiring, and NFQUEUE dependencies

> **Execution note:** Use the `executing-plans` skill to implement this plan task by task.

**Goal:** Consolidate the product IA around the existing production contracts, wire one Scanner page with Search/Diagnostics/History, add bounded Scanner history reads, and make NFQUEUE dependencies persistent with fail-before-mutation preflight.

**Architecture:** Keep `scanner_start -> scanner-cli -> scanner-worker -> scanner-planner` authoritative. Treat `scanner-orchestrator.uc` as present but unwired/non-production. Use the existing Scanner state files/native runtime as the only history source. Make the existing navigation model and a single Scanner product shell the frontend authorities. Add package dependencies and a read-only dependency adapter called before Scanner state claim/session mutation.

**Validation:** Node contract tests, targeted ucode tests where the pinned runtime is available, package metadata/build/install checks, then explicit router acceptance and completeness evidence.

## Phase 1: Contract tests first (RED)

1. Add navigation contract tests for the exact six target groups, canonical `services`/`resources` routes, compatibility aliases, parameter preservation, and unchanged frozen-page module ownership.
2. Add Scanner product UI tests asserting three tabs (`search`, `diagnostics`, `history`), no primary engine chooser, preserved diagnostic engine controls, and one production route/module.
3. Add history API/RPC tests asserting bounded list/detail reads, existing Scanner state source, read-only ACL, and no import/reference from production RPC to `scanner-orchestrator.uc`.
4. Add NFQUEUE tests asserting exact Makefile dependencies, structured `EDEPENDENCY`, and that dependency failure happens before state claim/session start or mutation.
5. Run only the new tests and record their expected failures before production edits.

## Phase 2: Navigation and compatibility wiring

1. Extend the canonical navigation model with the approved group/item labels and alias/parameter parsing without changing frozen page render modules.
2. Map the canonical `services`, `resources`, `warp`, `zapret`, and `scan` routes to the existing modules. Preserve old `lists`, `assets`, resource subtype, WARP child, `autostart`, DNS, Telegram, and diagnostic bookmarks through parameterized aliases.
3. Keep internal unified-routing compatibility reachable without promoting it to a new primary product group.
4. Update only route context/lifecycle plumbing required for parameters; do not alter Home, Strategies, DNS, or Telegram visual markup.

## Phase 3: Single Scanner product page

1. Make the existing `scan` route render one product shell with Search, Diagnostics, and History tabs. The shell delegates Search to the existing `z2m-scanner.js` Scanner API lifecycle and Diagnostics to the existing BlockCheck page contract, mounting only the active child and unmounting it on tab/route changes.
2. Remove the engine chooser from the primary Search flow. Keep BlockCheck2/blockcheckw mode, protocol, DNS, worker, and diagnostic controls in Diagnostics.
3. Keep Strategy handoff on the existing canonical Strategy preview/validate/apply/create APIs.
4. Keep polling bounded and lifecycle-safe; no new Scanner worker, orchestrator, queue owner, or persistence writer is introduced.

## Phase 4: Bounded Scanner history read API

1. Add read-only bounded enumeration/projection over existing Scanner records, using the existing test root/native runtime storage and existing record validation/projection boundaries.
2. Expose list/detail through the existing Scanner CLI/RPC surface and LuCI API with explicit read ACL. Do not mutate records and do not add a second storage root.
3. Load history lazily in the History tab, with bounded rows, safe empty/error states, and detail navigation that cannot start/stop a scan.

## Phase 5: Persistent NFQUEUE dependencies and preflight

1. Add `+kmod-nfnetlink-queue +kmod-nft-queue` to the backend package dependencies and update package tests.
2. Add a read-only production dependency adapter that checks the queue capabilities required by the transient Scanner path. Allow test seams for missing-module coverage.
3. Invoke the preflight before Scanner state claim, session begin, queue/rule mutation, or candidate activation. Return `EDEPENDENCY` with missing capability details and no `insmod` fallback.
4. Add host/runtime tests proving successful preflight does not change ownership and failed preflight leaves no active marker, record mutation, temporary queue, or runtime mutation.

## Phase 6: Verification and target acceptance

1. Run focused host tests, relevant existing scanner/package/UI tests, and available ucode/runtime smoke. Separate pre-existing baseline failures from regressions.
2. Build/install the package for the exact target and verify installed dependency metadata and files.
3. Reboot the target; do not run manual `insmod`. Verify Scanner run, temporary NFQUEUE lifecycle, cleanup, production queue 300 preservation, DNS, HTTPS, and completeness audit.
4. Run final diff/status checks, preserve unrelated worktrees, commit the branch, and report exact evidence plus remaining WARP backend gap and the actual Scanner authority map.
