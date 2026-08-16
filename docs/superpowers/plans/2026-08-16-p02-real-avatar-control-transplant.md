# P02 — Real Avatar Control page transplant implementation plan

> **Execution:** inline in the active `G:\zapret2-manager\.codex-avatar-parity` worktree. Preserve all pre-existing dirty paths; stage only P02 files.

## Goal

Replace the current `#/control` → Dashboard alias with a real donor-derived
Avatar Control page for `Обход DPI → Управление`, while retaining the Z2M
Graphite shell, horizontal navigation, Russian copy, and canonical Z2M service
RPCs. Do not touch P03, backend service semantics, APK packaging, or unrelated
dirty work.

## Frozen inputs

- Donor: `avatarDD/zapret-gui`, `main`,
  `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`
- Donor authority: `web/js/pages/control.js` and the matching control selectors
  in `web/css/style.css`
- Initial Z2M HEAD: `6c3b66dbc23c20c1a6b8ef19d994d8f6e70cf74a`

## Implementation slices (TDD order)

### 1. Source contract and donor inventory

- Keep `tests/ui/p02-control-transplant-contract.test.mjs` as the source and
  deployment-closure contract.
- Run it RED before implementation (done), then make it pass only after the
  dedicated module, route wiring, donor markers, canonical RPCs, cleanup, and
  frozen donor deployment manifest exist.
- Add/update this audit with the final donor files, symbols, CSS selectors,
  classification matrix, and dirty-file preservation evidence.

### 2. Control view model (RED first)

- Add `tests/ui/p02-control-model.test.mjs` using Node `vm` loading for a pure
  `z2m-control-model.js` module.
- Cover STOPPED, RUNNING, UNKNOWN/unavailable, pending, process PID, strategy
  name, firewall rules and NFQUEUE evidence, conservative button permissions,
  and Russian labels with no visible reason codes.
- Add `z2m-control-model.js` with pure normalization helpers; do not add RPCs,
  writers, or backend changes.

### 3. Donor-derived page composition

- Add `z2m-avatar-control.js`, preserving the donor composition and order:
  page header → `control-status-hero` → process-control card → `status-grid`
  (strategy/process/firewall) → conditional `fw-rules-card` → nfqws2 log card
  and `Все логи` link.
- Reuse `z2m-avatar-log.js` for all log DOM. Reuse existing shell/Avatar UI
  primitives for toasts, buttons, status-safe text, and CSS injection.
- Keep the page under `id=z2m-view-control`; do not render Dashboard DOM on
  Control or duplicate the shared log renderer.

### 4. Route/module lifecycle wiring

- Import the new module in `app.js` and change only `control: Control`; retain
  `dashboard: Overview` and all other module mappings.
- Ensure Control renders a shell before its first status response, loads only
  the required status/strategy/log data, and uses the existing app activation
  and unmount path for hash navigation and Back/Forward.
- Add page-scoped polling with one interval, refresh status/logs on a bounded
  cadence, and clear it in `unmount`; guard stale async completions by a page
  token.

### 5. Canonical lifecycle actions and pending lock

- Add tests for start/stop/restart calls, immediate pending UI, spinner,
  disabled all lifecycle controls, duplicate-click prevention, success/error
  result refresh, and final state refresh.
- Wire only `ctx.api.service.start`, `.stop`, `.restart`, then reread
  `ctx.api.service.status`; do not call donor `/api/*` or `fetch`.
- STOPPED enables Start only; RUNNING enables Stop/Restart only; UNKNOWN keeps
  controls conservative. Pending disables all three and prevents duplicate
  mutations until the final refresh settles.

### 6. Status cards and firewall details

- Render strategy, process, and firewall cards from structured evidence.
- Show PID and NFQUEUE 300 only when confirmed. Show firewall details only when
  structured rules/table evidence exists; never infer healthy firewall state
  from a missing field.
- Map all normal visible values to Russian labels; raw internal enums and
  reason codes stay technical/non-visible. Test `MIXED_RU_EN_PRODUCT_COPY=0`,
  `RAW_INTERNAL_ENUM_VISIBLE=0`, and `RAW_REASON_CODE_VISIBLE=0` on the normal
  Control surface.

### 7. Graphite CSS adaptation

- Add only the donor Control selectors needed by the transplanted hierarchy to
  `z2m-ui.css`, using existing Graphite variables and responsive conventions.
- Preserve horizontal LuCI/Z2M navigation and avoid donor sidebar/API CSS.
- Add CSS contract assertions for hero, indicator, buttons, status cards,
  firewall card, logs, spinner, and no donor shell/sidebar takeover.

### 8. Direct target deployment closure

- Add `scripts/deploy-control-parity-target.sh` with an explicit P02-only
  manifest, donor SHA, expected commit guard, backup directory, per-file
  SHA256 verification, root ownership/mode checks, and rpcd reload.
- Use a clean temporary detached worktree inside `.codex-avatar-parity` for
  deployment; do not deploy from the dirty active checkout and do not build an
  APK.
- Include only the Control frontend closure plus its existing shared assets and
  ACL if needed; do not include backend/engine/config writers.

### 9. Verification and browser acceptance

- Run focused P02 tests, then P01 dashboard regression tests if shared files
  changed, plus target/static checks appropriate to the frontend closure.
- Deploy by direct SCP to `root@192.168.1.1`; record deployment SHA and owner
  mode. Confirm target final `NFQWS2_ENABLE=0` and STOPPED.
- In the one existing authenticated Browser session, use normal desktop only:
  Control DOM/header/hero/buttons/cards/firewall/logs, Russian/raw-copy gates,
  console/module/RPC errors, duplicate polling/listener/stale-DOM checks,
  then real lifecycle canary STOPPED → Start pending → RUNNING (PID, NFQUEUE
  300, valid nft) → Restart pending → RUNNING → Stop pending → STOPPED.
- Exercise `Главная → Управление → Главная`, `Управление → Система →
  Управление`, Back/Forward, and hash/render agreement. Restore disabled
  `NFQWS2_ENABLE` and stopped state before handoff.

### 10. Final evidence and selective commit

- Capture `CONTROL_DONOR_FILES`, `CONTROL_DONOR_SYMBOLS`, `CONTROL_DONOR_CSS`,
  all classification counts, tests, deployment, browser, lifecycle, dirty
  preservation, `P03=NO`, and `STATUS` in the audit/final report.
- Review `git diff --name-only` against the P02 allowlist. Stage/commit only
  P02 files and force-add ignored plan/audit docs; leave all pre-existing dirty
  paths byte-for-byte untouched.
- Verify final HEAD, focused tests, and target/browser evidence before claiming
  completion.
