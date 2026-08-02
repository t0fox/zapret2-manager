# Orchestra UI V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped Orchestra presentation with a compact, readable Overview and Auto Strategy workflow while preserving existing backend RPC contracts.

**Architecture:** Add a new isolated LuCI view (`orchestra-v2.js`) and a dedicated scoped stylesheet (`orchestra-v2.css`). Keep the old `orchestra.js` untouched as a fallback, and switch only the LuCI menu route after focused tests describe the new behavior.

**Tech Stack:** OpenWrt LuCI JavaScript, LuCI `rpc.declare`, DOM `E()`, scoped CSS, Node test runner.

## Global Constraints

- Do not change Auto Strategy state machine, probes, ranking, corpus, apply/rollback, service IDs, candidate IDs, or ACL.
- Do not restart nfqws2, firewall, NFQUEUE, or uhttpd.
- Do not reboot the router.
- Keep backend ranking and verdicts authoritative; the browser only presents them.
- Keep technical identifiers collapsed by default.

---

### Task 1: Add failing UI contract tests

**Files:**
- Create: `tests/orchestra-v2-ui.test.mjs`

- [ ] Assert the new view exists and preserves existing RPC method names.
- [ ] Assert Overview and Auto Strategy routes are present.
- [ ] Assert the service selector is collapsed by default.
- [ ] Assert failed and timed-out candidates are rendered rather than filtered.
- [ ] Assert raw object strings and technical fields are excluded from the main presentation.
- [ ] Run the focused test and verify RED before implementation.

### Task 2: Implement the isolated Orchestra V2 view

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-v2.js`

- [ ] Load `status`, `orchestra_auto_status`, run history/details and capability RPCs independently.
- [ ] Implement a compact Overview with health, automatic selection, services and current configuration.
- [ ] Implement Auto Strategy with one primary action, collapsed service selector, current operation, tested-strategy journal, final result and collapsed technical details.
- [ ] Keep backend verdict, ranking and candidate status authoritative.
- [ ] Run the focused test until GREEN.

### Task 3: Add dedicated scoped CSS

**Files:**
- Create: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-v2.css`

- [ ] Scope every rule under `.z2m-orchestra-v2`.
- [ ] Use a readable desktop layout and a single-column mobile layout.
- [ ] Render candidate rows as cards on narrow screens.
- [ ] Prevent horizontal overflow and cramped micro-columns.

### Task 4: Switch the LuCI route

**Files:**
- Modify: `luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json`

- [ ] Point the root and Orchestra menu entries to `zapret2-manager/orchestra-v2`.
- [ ] Keep the old view file as a fallback.
- [ ] Verify menu JSON parses.

### Task 5: Verification and review

- [ ] Run `node --check` on the new view.
- [ ] Run `node --test tests/orchestra-v2-ui.test.mjs`.
- [ ] Run the repository full test command when the complete checkout is available; otherwise report the exact limitation.
- [ ] Compare the feature branch to `main`.
- [ ] Open a draft pull request; do not merge automatically.
