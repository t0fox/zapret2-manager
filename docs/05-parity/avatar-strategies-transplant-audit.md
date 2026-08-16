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

This section is completed only after the RED/GREEN tests, target deployment,
one real Browser acceptance, navigation/lifecycle checks, and final source
classification are verified.
