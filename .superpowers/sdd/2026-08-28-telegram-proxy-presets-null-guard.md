# Telegram Proxy settings preset null guard

Date: 2026-08-28

## Root cause

`z2m-proxy-page-core.js` renders every pane even when the bounded
`proxy.configGet()` request is rejected or times out. In that case
`data.config` contains only an error and `profilePresets()` receives no
`presets.recommended.settings` or `presets.direct.settings`. Reading
`.settings` therefore produced `undefined`, and `Object.keys(undefined)`
raised `TypeError: Cannot convert undefined or null to object`.

## Change

- Normalize both nested preset settings through the existing `object()` helper
  before calling `Object.keys()`.
- Add a regression test that executes the production `profilePresets()` helper
  with a config RPC error and verifies both local fallback profiles.

## Evidence

- Baseline commit before this change: `c6c9b4c57a039f8440d959f72b1159f3bbe94a8c`.
- TDD RED: the new regression test failed with the same
  `TypeError: Cannot convert undefined or null to object` at `profilePresets`.
- TDD GREEN: `node --test tests/ui/tg-settings-presets-contract.test.mjs` —
  11 passed, 0 failed.
- Focused Telegram suite: 46 passed, 0 failed across the seven related UI
  test files.
- `node --check` for the changed frontend file — exit 0.
- `git diff --check` — exit 0.
- `node scripts/docs.mjs verify` — exit 0; Quartz SHA verified.

## Verification boundaries

- `node scripts/validate-knowledge.mjs` still reports the pre-existing
  missing-frontmatter document
  `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md`; that document was
  not changed here.
- The full 255-file `node --test` run was not completed on this Windows host:
  it exposed unrelated baseline/native failures including
  `process.getuid is not a function`, then made no progress for over a minute
  and was stopped under the bounded retry policy.
- No router deployment or browser acceptance was performed in this source-only
  fix.

## Files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js`
- `tests/ui/tg-settings-presets-contract.test.mjs`
- `.superpowers/sdd/2026-08-28-telegram-proxy-presets-null-guard.md`
