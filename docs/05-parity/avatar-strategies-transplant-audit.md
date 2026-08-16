# P03 — Avatar Strategies transplant audit

## Initial state

- Donor remote: `avatarDD/zapret-gui`
- Donor branch: `main`
- Frozen donor HEAD: `38ed85ce487c6b3dbdf703a5be197795f7c0cad1`
- Donor worktree: `G:\avatarDD\zapret-gui-p03`
- Donor clean: `YES`
- Active Z2M worktree: `G:\zapret2-manager\.codex-avatar-parity`
- Initial P03 HEAD: `ad2e7f797dd6cfc906d7182b497356d2ffe0b267`

P03 is limited to `Обход DPI → Стратегии`. P01 Dashboard and P02 Control remain
closed. The existing Z2M Strategy backend, state, revisions, validation,
preview, Apply, and persistence remain authoritative.

## Donor manifest

The frozen donor source audit covers `web/js/pages/strategies.js`,
`web/js/components/list_ui.js`, `web/js/components/confirm.js`,
`web/js/components/toast.js`, `web/js/utils/nfqws2_lint.js`,
`web/js/utils/syntax.js`, `web/js/utils/autocomplete.js`, and the Strategies
CSS ranges in `web/css/style.css`.

Donor symbols/blocks to transplant or adapt include `render`, `_bindEvents`,
`fetchStrategies`, `renderActiveCard`, `renderList`, `renderStrategyCard`,
`applyStrategy`, `toggleFavorite`, `deleteStrategy`, `duplicateStrategy`,
`showPreview`, `validatePreview`, `openEditor`, `renderEditorForm`,
`renderProfileEditor`, `saveEditor`, `attachAutocompleteToProfiles`,
`copyStrategyToClipboard`, `pasteStrategyFromClipboard`, `mergeSelected`,
`attachGlobalKeys`, modal resize helpers, and `destroy`.

Donor DOM hierarchy includes the page header, active-strategy card, search /
filter / grouping toolbar, compact strategy cards with profile badges and raw
argument preview, bulk-selection bar, editor modal, preview modal, loading /
empty / error states, and donor-derived active/selected visual classes.

Donor-only healthcheck, autocircular-state, debug-toggle, and `/api/*` backend
flows are not supported by the canonical Z2M Strategy boundary. They must be
classified `BACKEND_NOT_READY` or `INTENTIONAL_Z2M_DIFFERENCE`, never faked.

## Final evidence

- GREEN focused contract suite: `32/32` P03/P02/P01 UI tests passed after the
  final route change; all three P03 modules pass `node --check`; `git diff
  --check` passed.
- Final implementation candidate: `7724c6784916c3da5578ccad9801966e8aa22319`.
- Target deploy: `STRATEGIES_ONLY` via clean detached worktree; target SHA,
  `root:root`, and `0644` were verified for all four deployed files. `rpcd
  reload` ran; no APK build, reboot, or Apply was performed.
- Target read-only characterization: `engine_status` returned installed and
  stopped; `strategies_list` timed out. The page therefore bounds read RPCs and
  renders safe unavailable/empty states instead of waiting forever.
- Browser acceptance: `PARTIAL / BLOCKED`. The existing tab was claimed and
  the session-expiry login control was exercised as requested. After a full
  navigation the LuCI form reported `Invalid username and/or password` with
  the prefilled `root` username and empty password; no credentials were
  available, so post-final-deploy DOM/editor/preview interaction could not be
  completed. No strategy mutation or Apply was attempted.
- Navigation/lifecycle source evidence: one replaceable timeout poller,
  listener removal, autocomplete detach, modal cleanup, and forced Avatar
  Strategies route are covered by the P03 lifecycle contracts.
- Donor-only healthcheck/autocircular/debug flows: `BACKEND_NOT_READY` /
  `INTENTIONAL_Z2M_DIFFERENCE`; no donor `/api/*` call is used.
- Target Apply canary: `NOT RUN` because the service was stopped and no
  rollback-safe baseline was established.
