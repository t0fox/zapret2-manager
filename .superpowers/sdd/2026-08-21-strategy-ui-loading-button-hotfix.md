---
id: strategy-ui-loading-button-hotfix
title: "Strategy UI loading feedback and button state hotfix"
type: task-report
status: verification-partial
updated: 2026-08-21
publish: false
---

# Result

The Strategy page remains the canonical Avatar-derived surface and continues
to use the existing Strategy RPCs. The hotfix only changes browser scheduling,
local feedback, and scoped button styling.

## Root cause

`openEdit()` inserted the loading modal and immediately invoked `strategies.get`
in the same click task. The browser could not paint the modal before the RPC
work began. The active-card action was also a disabled `btn-primary`, while a
later generic `.btn-primary { color: ... !important }` rule overrode the scoped
Strategy color.

## Fix

- Detail loading starts after two `requestAnimationFrame` callbacks, with a
  bounded 650 ms slow note and timer cleanup on success, error, close, and
  unmount guards.
- Apply and Duplicate use `state.operationPending` with card-scoped pending
  labels; the existing global `state.pending` remains for global mutations.
- Current state uses `.btn-status-current`, not a disabled primary action.
- Validate, Preview, Create, Save, Apply, Duplicate, and editor loading use the
  local spinner pattern; reduced-motion disables animation.
- Primary enabled and disabled text remains readable while preserving the blue
  primary identity.

## Evidence

- RED then GREEN focused regression contract:
  `tests/ui/strategy-ide-ux-perf-hotfix.test.mjs` — 10/10.
- Avatar/Strategy focused suite — 35/35.
- `node --check` and `git diff --check` — PASS.
- Router deployment was SCP-only, no APK. JS and CSS SHA-256 matched local
  files after upload.
- In-app browser at normal zoom showed enabled Apply as white text on blue;
  filtered active strategy showed current status as green with `opacity: 1`
  and `cursor: default`.
- In-app browser unsaved raw-only draft showed `Visual` disabled and preserved
  `--unknown-option=1` in Raw-only mode.

Apply-pending and targeted edit-loader screenshots were not forced through a
mutating router action: no user strategy was created or applied during QA.
