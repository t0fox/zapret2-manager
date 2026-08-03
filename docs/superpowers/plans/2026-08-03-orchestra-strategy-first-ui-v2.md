# Orchestra Strategy-First UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Orchestra strategy-first LuCI page with real global apply/rollback, targeted Orchestra runs, ranked results, and persistent domain/service overrides.

**Architecture:** Keep the existing `orchestra.js` and all legacy RPCs as the advanced implementation. Add a new `orchestra-strategy.js` simple page and a small `orchestra-strategy-cli.uc` facade that reads the existing combo provider, persists active metadata and override rules, and delegates mutations to the existing verified apply pipeline. The simple page uses the facade plus existing `orchestra_run_*` RPCs and switches to the existing advanced route when requested.

**Tech Stack:** OpenWrt ucode, rpcd/ubus, LuCI JavaScript, JSON state, Node contract tests.

## Global Constraints

- Built-in strategies never create user Profiles.
- Strategy selection is non-mutating; apply is explicit.
- All global mutations delegate to the existing combo provider apply/rollback path.
- Every write RPC accepts an idempotency token.
- Overrides are persisted atomically and compiled before global fallback.
- Existing Orchestra history, ratings, diagnostics and automatic mode remain unchanged.
- Do not claim router acceptance without an actual target run.

---

### Task 1: RED contract tests

**Files:**
- Create: `tests/orchestra-strategy-ui.test.mjs`

**Interfaces:**
- Consumes the new UI, RPC plugin, ACL, menu and backend CLI source files.
- Produces static contract assertions for navigation, RPC wiring, non-auto-apply, targeted runs and override operations.

- [ ] Assert the new page declares `orchestra_strategy_state/apply/rollback` and override RPCs.
- [ ] Assert targeted test uses `orchestra_run_start` with a domain or service payload.
- [ ] Assert the strategy row click only updates pending selection.
- [ ] Assert separate buttons exist for global apply and override creation.
- [ ] Assert the page links to the existing advanced Orchestra route.
- [ ] Assert `Combo presets` is absent from the menu.
- [ ] Assert RPC and ACL contain all facade methods.

### Task 2: Backend facade and persistence

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-strategy-cli.uc`
- Create: `zapret2-manager/files/etc/zapret2-manager/orchestra-strategy.json`
- Modify: `zapret2-manager/Makefile`

**Interfaces:**
- Consumes `discord-profile-cli.uc preview/apply/rollback`.
- Produces CLI modes `state`, `apply`, `rollback`, `override_list`, `override_set`, `override_delete`, `override_reorder`.

- [ ] Load and validate the existing combo catalog through the provider preview.
- [ ] Persist schema, active strategy metadata, idempotency result and ordered overrides.
- [ ] Normalize domain/URL targets without shell interpolation.
- [ ] Enforce one enabled override per normalized target.
- [ ] Apply global strategies by delegating to the provider and publish active metadata only after success.
- [ ] Roll back through the provider and restore previous metadata only after success.
- [ ] Store overrides atomically using temp-file plus rename.

### Task 3: RPC, ACL and menu integration

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`

**Interfaces:**
- Adds read RPCs `orchestra_strategy_state`, `orchestra_override_list`.
- Adds write RPCs `orchestra_strategy_apply`, `orchestra_strategy_rollback`, `orchestra_override_set`, `orchestra_override_delete`, `orchestra_override_reorder`.

- [ ] Use the repository's JSON request-file adapter pattern.
- [ ] Preserve every existing method and ACL permission.
- [ ] Route the root and Orchestra menu item to `orchestra-strategy`.
- [ ] Remove only the separate Combo presets menu item.
- [ ] Keep existing `orchestra` route as `Advanced`.

### Task 4: Strategy-first LuCI page

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.css`
- Modify: `luci-app-zapret2-manager/Makefile` if explicit file installation is required.

**Interfaces:**
- Consumes facade RPCs, `status`, `orchestra_run_start`, `orchestra_run_status`, `orchestra_run_history`, `orchestra_restore_previous`.
- Produces a responsive simple-mode dashboard and explicit advanced-route switch.

- [ ] Render service state, start/stop, active strategy and quick actions.
- [ ] Render built-in strategies and keep pending selection local.
- [ ] Apply globally only from the explicit button.
- [ ] Normalize URL input to hostname client-side before starting a targeted domain run.
- [ ] Display backend ranking, winner, run phase and raw counts.
- [ ] Create an override from the selected/winning strategy.
- [ ] List, enable/replace and delete override rules.
- [ ] Keep technical details collapsed.
- [ ] Avoid hard-coded claims such as `60 domains`; use backend counts.

### Task 5: Verification

**Files:**
- Existing and new tests only.

- [ ] Run the new Node contract test.
- [ ] Run existing Flowseal generator and combo tests.
- [ ] Parse modified JSON files.
- [ ] Run JavaScript syntax checks where supported.
- [ ] Inspect the final branch diff.
- [ ] Report router-only checks as pending unless executed on OpenWrt.
