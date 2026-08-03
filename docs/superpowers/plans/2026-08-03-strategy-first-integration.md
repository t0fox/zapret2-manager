# Strategy-First Backend and UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Flowseal/Asterlike combo implementation into a strategy-first OpenWrt product with one control-plane API and a usable LuCI workflow, without changing strategy definitions or conversion logic.

**Architecture:** Keep `discord-profile-cli.uc` and its generated combo catalog as the existing strategy provider and apply/rollback implementation. Add a thin persistent `strategy-product` controller that validates provider output, stores selection and operation metadata, exposes additive RPC methods, and presents one coherent status model. Replace the current service-checkbox UI with a strategy-first LuCI view that consumes only these additive RPC methods plus the existing engine status.

**Tech Stack:** OpenWrt ucode, rpcd/ubus, LuCI JavaScript, JSON state files, existing `discord-profile-cli.uc`, Node static/contract tests.

## Global Constraints

- Do not modify Flowseal/Asterlike strategy parameters, profile ordering, capture ranges, fake blobs, Lua verbs, source provenance, or conversion tools.
- Do not create a second strategy catalog.
- Reuse `discord-profile-cli.uc preview/apply/rollback` as the provider and existing mutation path in this branch.
- Preserve existing `orchestra_auto_*` methods as legacy compatibility; the new UI must not expose service checkboxes.
- Add RPC schemas only; do not rename or remove existing methods.
- No router reboot.
- No firewall, uhttpd, or nfqws2 restart outside the existing apply implementation.
- Never show raw candidate IDs in the primary UI when `name` is available.
- Do not claim automatic combo scanning until a real backend operation exists.

---

### Task 1: Contract tests for the strategy-first product

**Files:**
- Create: `tests/strategy-product-contract.test.mjs`

**Interfaces:**
- Consumes source files for the controller, rpcd registration, ACL, menu, and LuCI view.
- Produces failing assertions defining the new additive RPC and UI contract.

- [ ] Assert a new `/usr/libexec/zapret2-manager/strategy-product-cli.uc` exists.
- [ ] Assert methods `strategy_product_status`, `strategy_product_select`, `strategy_product_apply`, and `strategy_product_rollback` are registered.
- [ ] Assert read/write ACL lists contain the matching methods.
- [ ] Assert the root menu opens `zapret2-manager/strategy-product`.
- [ ] Assert the new UI contains tabs for Overview, Strategies, Selection, Lists, Diagnostics, Journal, and Settings.
- [ ] Assert the new UI does not contain a service checkbox selector or `serviceIds` mutation.
- [ ] Assert the UI renders `displayName/name` before internal IDs.
- [ ] Assert apply and rollback use the new product RPCs.
- [ ] Commit RED tests before production code.

### Task 2: Persistent strategy product controller

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-product.uc`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/strategy-product-cli.uc`

**Interfaces:**
- Consumes provider command `/usr/bin/ucode /usr/libexec/zapret2-manager/discord-profile-cli.uc preview|apply|rollback`.
- Produces:
  - `strategy_product_status()`
  - `strategy_product_select(input)`
  - `strategy_product_apply(input)`
  - `strategy_product_rollback(input)`

- [ ] Store bounded state at `/etc/zapret2-manager/strategy-product.json` with schema, revision, selected strategy, applied strategy metadata, last operation, and legacy migration note.
- [ ] Parse `comboCatalog.candidates` from the existing provider preview; fail closed on malformed output.
- [ ] Select only a provider candidate whose `managerId`, `digest`, and `name` are present.
- [ ] Selection must not mutate runtime configuration.
- [ ] Apply must call the existing provider apply with candidate ID, digest, acknowledgement, and request token.
- [ ] Publish applied state only when provider returns `ok:true`.
- [ ] Rollback must call the existing provider rollback and clear applied metadata only after success.
- [ ] Return a bounded presentation model: catalog entries, dependency readiness, selected/applied strategy, operation state, capabilities, and actionable reasons.
- [ ] Keep legacy Auto Strategy state read-only and report it as migration metadata, not as the new source of truth.

### Task 3: rpcd and ACL integration

**Files:**
- Modify: `zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc`
- Modify: `luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json`

**Interfaces:**
- Consumes the CLI methods from Task 2.
- Produces additive ubus methods:
  - read: `strategy_product_status`
  - write: `strategy_product_select`, `strategy_product_apply`, `strategy_product_rollback`

- [ ] Add one CLI constant and bounded request-file adapter using the repository's existing JSON-string pattern.
- [ ] Register methods with `{ call, args }` rpcd shape.
- [ ] Preserve all current methods and ACL permissions.
- [ ] Keep read-only status available to read-only LuCI users.

### Task 4: Strategy-first LuCI view

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategy-product.js`
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/strategy-product.css`
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`

**Interfaces:**
- Consumes `status`, `strategy_product_status`, `strategy_product_select`, `strategy_product_apply`, `strategy_product_rollback` and existing route links.
- Produces hash tabs `overview`, `strategies`, `selection`, `lists`, `diagnostics`, `journal`, `settings`.

- [ ] Overview shows engine truth, selected/applied strategy, provider readiness, and one primary action.
- [ ] Strategies shows complete combo presets as cards/rows; no service checkbox list.
- [ ] Selecting a strategy is non-mutating and visually distinct from applying.
- [ ] Apply requires an explicit wide-capture acknowledgement only when provider metadata says `captureMode:wide`.
- [ ] Selection page honestly states that automatic combo scan is unavailable until its backend exists; it must not call legacy service-first `orchestra_auto_run`.
- [ ] Lists and Diagnostics link to the existing pages rather than duplicating their state.
- [ ] Journal shows the controller's last bounded operation and provider result.
- [ ] Settings shows capture and migration information without exposing raw IDs as primary labels.
- [ ] Technical details are collapsed.
- [ ] CSS is fully scoped under `.z2m-strategy-product` and responsive.

### Task 5: Verification and handoff

**Files:**
- Modify tests if implementation reveals a contract mismatch.

- [ ] Run the focused contract test.
- [ ] Run JavaScript syntax and JSON parsing gates.
- [ ] Run existing combo provider/apply tests.
- [ ] Run full repository gate.
- [ ] Open a draft PR targeting `feat/openwrt-combo-presets-v2`, not `main`, so strategy-port work can be reviewed first.
- [ ] Do not install on the router until the full gate and package-content checks are green.
