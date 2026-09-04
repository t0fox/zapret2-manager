# Single APK Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split/meta release with one source-built `zapret2-manager-full` APK containing all Z2M-owned backend and LuCI files.

**Architecture:** The full package Makefile compiles helpers and installs staged backend/LuCI source inputs directly. Split package definitions remain development compatibility inputs only; release CI selects only full. Versioned APK provides cover split-package world constraints and file ownership migration without adding split dependencies.

**Tech Stack:** OpenWrt 25.12.5 mediatek/filogic SDK, GNU Make package rules, APKv3 metadata, POSIX shell, Node.js `node:test`, repository knowledge validator.

**Spec:** `docs/superpowers/specs/2026-09-04-single-apk-release-design.md`

## Global Constraints

- Build exactly one user-facing APK named `zapret2-manager-full-<version>.apk`.
- Do not unpack or merge already-built APKs.
- Full payload must include backend, four compiled helpers, UCode RPC/backend, init/hotplug/runtime files, `/usr/share/zapret2-manager/**`, LuCI JS/CSS/vendor/icons, ACL and menu.
- Full dependencies must be external OpenWrt packages only; no nested `apk add`, kmods or third-party product binaries.
- Preserve persistent state, catalog migration/LKG behavior, helper socket checks, `status_fast`, and no reboot.
- Keep Engine/Z2K downloaded lifecycle and optional Telegram Proxy outside the manager APK unless source evidence proves they are Z2M-owned.
- Run release/backend/UI/knowledge/syntax/diff checks and a real pinned SDK build before completion; push only verified changes to `main`.

### Task 1: Add failing single-artifact release contract tests

**Files:**
- Create: `tests/release/single-apk-contract.test.mjs`
- Modify: `tests/release/build-manifest.test.mjs`
- Modify: `tests/release/version-contract.test.mjs`
- Modify: `tests/release/workflow-contract.test.mjs`
- Modify: `tests/release/build-script-contract.test.mjs`

- [ ] **Step 1: Write assertions for one artifact, direct full build, payload ownership, external dependencies, versioned compatibility provides, one lifecycle, manifest and direct release publication.**
- [ ] **Step 2: Run `node --test tests/release/*.test.mjs` and confirm the new contract fails against the current meta-package/three-artifact implementation.**
- [ ] **Step 3: Keep the failing output as RED evidence before editing production packaging.**

### Task 2: Implement the canonical full package

**Files:**
- Modify: `zapret2-manager-full/Makefile`
- Modify: `scripts/release/build-apk.sh`

- [ ] **Step 1: Stage `zapret2-manager/files`, `zapret2-manager/src` and `luci-app-zapret2-manager/files` into the full package SDK source context.**
- [ ] **Step 2: Make full `Build/Prepare` copy staged source inputs into `PKG_BUILD_DIR` and compile the four existing C helpers with the target compiler and `libjson-c`.**
- [ ] **Step 3: Install backend and LuCI payloads with the existing exact file/mode rules, including RPC UCode, ACL/menu, LuCI views, vendor and icons.**
- [ ] **Step 4: Add only external OpenWrt dependencies plus mediatek/filogic target constraint and versioned split compatibility provides.**
- [ ] **Step 5: Merge the existing backend postinst and LuCI cache invalidation into one full-package postinst with one rpcd reload and one manager restart followed by bounded readiness proof.**
- [ ] **Step 6: Run `node --test tests/release/single-apk-contract.test.mjs tests/product/clean-install-contract.test.mjs tests/native/package-helper.test.mjs` and confirm GREEN.**

### Task 3: Make release build and verifier single-artifact authoritative

**Files:**
- Modify: `scripts/release/config.mjs`
- Modify: `scripts/release/build-apk.sh`
- Modify: `scripts/release/verify-artifacts.mjs`
- Modify: `tests/release/build-manifest.test.mjs`

- [ ] **Step 1: Set release package list to `['zapret2-manager-full']` and record bundled/external component metadata.**
- [ ] **Step 2: Make the script select only full, verify SDK-native metadata and payload paths/modes, and reject split APKs or split dependencies.**
- [ ] **Step 3: Generate a manifest with one artifact, exact SDK digest, package digest/size, dependencies and bundled fields, then checksum only the APK plus manifest.**
- [ ] **Step 4: Run the focused release tests and verifier fixture; confirm RED cases for extra APK, split dependency and missing payload are rejected.**

### Task 4: Update workflow, documentation and upgrade acceptance

**Files:**
- Modify: `.github/workflows/apk-build.yml`
- Modify: `README.md`
- Modify: `docs/00-home/current-state.md`
- Modify: `docs/01-project/about.md`
- Modify: `docs/01-project/requirements.md`
- Modify: `docs/01-project/installation.md`
- Modify: `docs/01-project/update.md`
- Modify: `docs/08-development/apk-build.md`
- Modify: `docs/09-work/release-apk-acceptance.md`
- Modify: `scripts/public-projection.mjs` only if code evidence text changes require it

- [ ] **Step 1: Make CI run release contract tests, build one full APK, verify it, upload the APK/manifest/checksums, and publish the APK directly without a tarball.**
- [ ] **Step 2: Document one download, one checksum command and one `apk add --allow-untrusted ./zapret2-manager-full-<version>.apk` command.**
- [ ] **Step 3: Document split-r154 upgrade acceptance with `apk add --simulate` first, no manual split install and no reboot.**
- [ ] **Step 4: Run knowledge validator and public projection checks for all modified Markdown.**

### Task 5: Run complete verification and real SDK build

**Files:**
- Modify: `.superpowers/sdd/2026-09-04-single-apk-release.md`

- [ ] **Step 1: Run focused release tests, related backend/UI/Z2K suites, shell syntax, Node syntax, knowledge validator, docs verification and `git diff --check`.**
- [ ] **Step 2: Run `scripts/release/build-apk.sh` against the pinned OpenWrt 25.12.5 SDK and record SDK/artifact digests and exact file list.**
- [ ] **Step 3: Run `node scripts/release/verify-artifacts.mjs dist` and independently inspect APK metadata/payload with SDK-native `apk`.**
- [ ] **Step 4: If router access is available, run clean/upgrade install acceptance using only the full APK, preserving current runtime on any failure; otherwise mark hardware gates `NOT_PROVEN`.**
- [ ] **Step 5: Write the evidence report with exact commands/results, inspect the final diff, commit task-owned files and push `main`.**
