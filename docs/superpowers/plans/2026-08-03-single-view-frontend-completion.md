# Single-view Frontend Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the approved LuCI single-view frontend, make its frontend-focused and repository gates honest and green, and publish a frozen frontend-to-backend contract for the next backend-rewrite agent.

**Architecture:** Keep `app.js` as the only root `L.view.extend()` and compose focused internal modules behind the shared `z2m-api.js`, `z2m-store.js`, and `z2m-shell.js` boundaries. Preserve the existing RPC names and payload transport during frontend completion; backend implementation changes are explicitly out of scope. Legacy route files remain redirects only, while legacy tests are migrated to validate the new single-view modules rather than resurrecting removed views.

**Tech Stack:** OpenWrt LuCI JavaScript, rpcd/ubus, Node.js 22 test runner, POSIX shell/Bash gates, GitHub Actions.

## Global Constraints

- Branch: `feat/strategy-first-integration`.
- Only one shipped root `L.view.extend()` in `app.js`.
- Eight internal tabs: `overview`, `strategy`, `services`, `lists`, `dns`, `proxy`, `monitor`, `maintenance`.
- `PKG_RELEASE:=137` for `luci-app-zapret2-manager`; unchanged backend packages keep their own release.
- No runtime `*-legacy.js`, obsolete CSS fragments, CDN, or external UI assets.
- Existing ubus method names and JSON edit transport remain unchanged during frontend completion.
- Backend source under `zapret2-manager/files/usr/libexec/` is not modified by this plan.
- Unknown or missing backend values render as unavailable/unknown, never fabricated zeroes or success.
- Mutations remain explicit, capability-gated, idempotency-aware, and use shared confirmation UX where backend returns rollback TTL.

---

### Task 1: Stabilize Strategy Composition and Auto Strategy

**Files:**
- Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
- Create/Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-auto.js`
- Create/Modify: `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js`
- Modify: `tests/auto-strategy-ui.test.mjs`
- Modify: `tests/ui/single-view-overview-strategy.test.mjs`
- Modify: `.github/workflows/single-view-ui-gate.yml`

**Interfaces:**
- Consumes: `ctx.api.orchestra.autoStatus/autoEnable/autoDisable/autoRun/autoStop/autoRestore`, `ctx.shell`, `ctx.refresh()`.
- Produces: internal module `{ load(ctx), render(ctx, envelope), unmount() }` and composed Strategy tab module `{ id, load, render, mount, unmount }`.

- [ ] Write/update tests that require the composed Strategy page and read-only Auto Strategy load.
- [ ] Run focused tests and verify the old direct-import assertion fails for the expected reason.
- [ ] Update assertions to require `z2m-strategy-page` and include `tests/auto-strategy-ui.test.mjs` in the focused workflow.
- [ ] Verify Auto Strategy uses exact existing RPC names, revision/request ID/service IDs, capability gating, bounded errors, non-overlapping polling, and shared restore modal.
- [ ] Run the focused gate and require zero failures.
- [ ] Commit the isolated Strategy/Auto Strategy completion.

### Task 2: Replace Legacy View Harnesses with a Single-view Render Harness

**Files:**
- Modify: `tests/ui/render-harness.test.mjs`
- Modify: `tests/ui/rpc-semantics.test.mjs`
- Modify: `tests/ui/negative-controls.test.mjs`
- Modify: `tests/ui/ui-gates.test.mjs`
- Modify: `tests/ui-views.test.mjs`
- Modify: `tools/luci-module-smoke.mjs` only if the existing loader cannot evaluate internal modules.

**Interfaces:**
- Consumes: internal tab lifecycle modules and `z2m-api.js` facade.
- Produces: deterministic fixtures for healthy, missing, error, and unsupported backend responses without referencing deleted legacy files.

- [ ] Add a failing harness test that loads `app.js` plus all internal modules without any `*-legacy.js` dependency.
- [ ] Verify the failure comes from old path/module assumptions, not production syntax.
- [ ] Replace old zone-view lists with the eight internal tab modules and compatibility redirect checks.
- [ ] Preserve semantic assertions for RPC method, transport, mutation guard, unknown-value rendering, and secret redaction.
- [ ] Delete assertions tied only to removed DOM class names or obsolete CBI page ownership.
- [ ] Run the migrated harness group until green.
- [ ] Commit the harness migration.

### Task 3: Migrate Feature Contracts without Weakening Behavior

**Files:**
- Modify legacy contract suites including:
  - `tests/dns-provider-contract.test.mjs`
  - `tests/dns-regressions.test.mjs`
  - `tests/service-dns-contract.test.mjs`
  - `tests/orchestra-ui-active-runs.test.mjs`
  - `tests/remastered-overview.test.mjs`
  - `tests/remastered-ui-foundation.test.mjs`
  - `tests/t4-2-production-auto-ui.test.mjs`
  - `tests/t4-3-ui-regression.test.mjs`
  - `tests/t4-auto-strategy-ui.test.mjs`

**Interfaces:**
- Consumes: `z2m-overview.js`, `z2m-strategy.js`, `z2m-auto.js`, `z2m-dns.js`, `z2m-services.js`, `z2m-monitor.js`, `z2m-maintenance.js`, `z2m-ui.css`, `z2m-components.css`.
- Produces: behavior-oriented tests tied to current module boundaries.

- [ ] For each failing suite, identify the production behavior the assertion was protecting.
- [ ] Write the replacement assertion against the current module that owns that behavior.
- [ ] Keep checks for bounded polling, terminal phases, explicit mutations, provider payloads, rollback, unavailable rendering, accessibility roles, and local-only assets.
- [ ] Remove only assertions whose sole purpose was enforcing deleted file names, old menu counts, or legacy DOM wrappers.
- [ ] Run each suite individually after migration.
- [ ] Commit in small feature-group commits.

### Task 4: Resolve Remaining Non-UI Test Failures without Backend Rewrites

**Files:**
- Diagnose and modify tests/fixtures/tools only where failures are caused by stale repository assumptions:
  - `tests/a3-3-probe-journal.test.mjs`
  - `tests/discord-continuation-contract.test.mjs`
  - `tests/discord-service-contract.test.mjs`
  - `tests/flowseal-combo-integration.test.mjs`
  - `tests/proxy-qr-encode.test.mjs`
  - `tests/remastered-t1-contract.test.mjs`
  - `tests/stressozz-corpus.test.mjs`
  - `tests/t3-6-proxy-runtime.test.mjs`
- Do not change backend runtime source to satisfy old frontend expectations.

**Interfaces:**
- Consumes: immutable backend source and current repository fixtures.
- Produces: honest tests that distinguish frontend completion from future backend rewrite work.

- [ ] Re-run each remaining failing test with bounded logs.
- [ ] Classify failure as stale test, missing fixture, environment-only target gate, or genuine existing backend failure.
- [ ] Fix stale paths/fixtures and environment gating only.
- [ ] For genuine backend failures, document them in the handoff contract and exclude them from the frontend-completion gate only with an explicit named allowlist and rationale; never silently skip.
- [ ] Require frontend-focused tests and syntax/package guards to remain green.
- [ ] Commit infrastructure fixes separately from test migrations.

### Task 5: Freeze the Frontend-to-Backend Contract

**Files:**
- Create: `docs/frontend-backend-contract.md`
- Update: `tests/fixtures/ui-rpc-contract.json` only if facade names already present in source are missing from the fixture.
- Update: PR description/comment with final status.

**Interfaces:**
- Consumes: `z2m-api.js`, ACL JSON, UI payload construction, rollback/confirmation behavior.
- Produces: method-by-method contract covering request transport, required response fields, optional capabilities, error shapes, polling/terminal semantics, and frontend fallback behavior.

- [ ] Extract all facade methods and group them by tab.
- [ ] Document exact JSON edit payloads generated by the frontend.
- [ ] Document required, optional, and unsupported response behavior.
- [ ] Mark known backend gaps: `events_tail`, DNS manager override registration, Orchestra zero-target runtime, profile import behavior, nft/nfqws2 watchdog state.
- [ ] Add a contract test ensuring every facade method is documented.
- [ ] Commit the handoff document.

### Task 6: Final Verification and Frontend Release Evidence

**Files:**
- Modify CI workflow only if required to produce reproducible evidence.
- No production changes during the final verification step.

**Interfaces:**
- Produces: exact commit SHA, test counts, syntax result, menu/ACL result, package metadata result, and remaining backend-only blockers.

- [ ] Run focused single-view contract tests.
- [ ] Run `tools/run-all-tests.sh` and inspect every remaining red result.
- [ ] Run `node --check` over every shipped LuCI JavaScript file.
- [ ] Validate menu JSON, ACL JSON, CSS balance, no external assets, no runtime legacy wrappers.
- [ ] Verify `luci-app-zapret2-manager/Makefile` remains `PKG_RELEASE:=137` and backend Makefiles were not modified.
- [ ] Update draft PR with final evidence and explicit backend handoff blockers.
- [ ] Do not mark the frontend complete unless the frontend gate is zero-failure and all remaining repository failures are explicitly classified as backend-only with evidence.
