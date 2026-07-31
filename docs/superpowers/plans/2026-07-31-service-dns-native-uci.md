# Service DNS Native UCI Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Service DNS split routing from a manager confdir fragment to native dnsmasq UCI server entries without changing the LuCI or RPC contract.

**Architecture:** A pure ownership module calculates a lossless external list and exact manager ownership. Both async and sync RPCs create the same immutable job; the worker alone writes production UCI, cuts over legacy registration in the same transaction, dynamically discovers the effective dnsmasq config and rolls everything back on failure.

**Tech Stack:** ucode/rpcd, OpenWrt UCI, dnsmasq 2.93, Node built-in test runner.

## Global Constraints

- Preserve all public `service_dns_*` RPC methods, UI layout, structured errors and ACL access.
- Generate only normalized `/domain/ipv4`; retain all external list values byte-for-byte.
- Do not modify production UCI, confdir, fragment or dnsmasq before the worker runs.
- Discover the active dnsmasq section and `-C` config every operation through ubus and `/proc/<pid>/cmdline`.
- Do not verify native routing while the legacy manager confdir is connected.
- Roll back UCI lists, state, pending/lastOperation and legacy files on every post-write failure.

---

### Task 1: Specify native server-list ownership

**Files:**
- Modify: `tests/lib/service-dns-logic.mjs`
- Modify: `tests/service-dns-logic.test.mjs`

**Interfaces:**
- Produces: `normalizeServerEntry(entry)`, `calculateServerOwnership(currentEntries, previousManagedEntries, desiredEntries)`.

- [ ] **Step 1: Write failing tests** for user entry retention, external satisfaction, provider switch, All Off, duplicates, conflict and advanced external entries such as `/x/1.1.1.1#53`, `/x/1.1.1.1@wan`, `/x/1.1.1.1@wan@192.0.2.1`, `//` and `/domain/#`.
- [ ] **Step 2: Run the focused tests** with `node --test tests/service-dns-logic.test.mjs` and confirm each new assertion fails because the ownership API is absent.
- [ ] **Step 3: Implement the pure ownership helpers** using set membership only for normalized manager values and indexed original strings for all external values.
- [ ] **Step 4: Re-run the focused tests** and confirm they pass.

### Task 2: Lock public contracts to the new backend

**Files:**
- Modify: `tests/service-dns-contract.test.mjs`
- Modify: `tests/service-dns-routing.test.mjs`

**Interfaces:**
- Consumes: ownership helper API from Task 1.
- Produces: contract assertions for async no-write, preview preconditions, shared worker, dynamic config discovery and transactional legacy cutover.

- [ ] **Step 1: Write failing source-contract and pure behavior tests** that reject async writes before worker, hardcoded generated config paths, `uci show` parsing, dual legacy registration and a standalone synchronous mutator.
- [ ] **Step 2: Run** `node --test tests/service-dns-contract.test.mjs tests/service-dns-routing.test.mjs` and confirm failures identify missing native behavior.
- [ ] **Step 3: Implement only the contract-supporting helpers and job schema changes.**
- [ ] **Step 4: Re-run both files** and confirm zero failures.

### Task 3: Implement the single job/worker backend

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc`

**Interfaces:**
- Consumes: immutable job precondition and ownership calculation.
- Produces: async enqueue, sync bounded wait wrapper, transactional UCI mutation and full rollback.

- [ ] **Step 1: Replace Service DNS addnhosts apply/rollback paths** with UCI list discovery and an immutable precondition containing active section, server/confdir hashes, prior ownership, legacy fragment hash, draft revision and selection hash.
- [ ] **Step 2: Ensure async Apply only saves a job and pending state; worker owns every production write.**
- [ ] **Step 3: In the worker, revalidate preconditions, set the complete server list and remove only the manager confdir value as one logical UCI transaction, then read back exactly.**
- [ ] **Step 4: Dynamically find active dnsmasq PID via ubus, derive `-C` from `/proc/<pid>/cmdline`, run config test against that effective config, restart, validate listener, exact entries and bounded local DNS queries.**
- [ ] **Step 5: Implement rollback that restores exact lists, legacy files, state and metadata, restarts dnsmasq and surfaces rollback failure separately.**
- [ ] **Step 6: Re-run all Service DNS tests.**

### Task 4: Align status, preview and packaging

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc`
- Modify if required: `zapret2-manager/Makefile`

- [ ] **Step 1: Return native UCI routing diffs, ownership, drift and dynamic runtime facts while preserving fields used by `dns.js`.**
- [ ] **Step 2: Remove obsolete Service DNS fragment packaging only when no migration/rollback path needs it; retain safe migration assets.**
- [ ] **Step 3: Run `node --test tests/service-dns-contract.test.mjs tests/service-dns-logic.test.mjs tests/service-dns-routing.test.mjs`.**

### Task 5: Build, deploy and prove routing

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the project build and inspect the APK contents, permissions, ACL and conffiles.**
- [ ] **Step 2: Install the APK, clear LuCI cache using the packaged mechanism and verify the build marker.**
- [ ] **Step 3: Verify localhost, router LAN, Windows and WSL queries.**
- [ ] **Step 4: Confirm global upstream differs from Comss, disable legacy confdir, clear cache and capture WAN DNS for Gemini and ChatGPT separately plus `example.com` and `openwrt.org` controls.**
- [ ] **Step 5: Run the full test runner once, inspect totals, run `git diff --check`, commit only related files with `refactor(service-dns): use native dnsmasq UCI routing`, and push without force.**
