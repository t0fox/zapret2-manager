---
id: z2k-version-ux-live-acceptance
title: "Z2K version UX live acceptance evidence"
type: doc
status: current
authority: evidence
updated: 2026-08-28
publish: false
tags: [z2k, catalog, changelog, rollback, ui, resources, browser]
---

# Z2K version UX live acceptance evidence

## Scope and delivery

The approved Z2K version UX was implemented on an isolated branch based on
the locally completed Components baseline.

- Base SHA: `d44341d0f7acff7a6e181a9776bc50ab6b2e4dc8`
- Final implementation SHA: `b16a0023e541bed32bd53d32e945b1e8df1a6ad4`
- Branch: `codex/z2k-version-lifecycle`
- GitHub proof: implementation SHA `b16a0023e541bed32bd53d32e945b1e8df1a6ad4` is present on `origin/codex/z2k-version-lifecycle`; the branch tip is equal to this SHA before the report-only commit.
- Router deployment: final SHA, reviewed closure, backup at
  `/tmp/z2m-deploy-z2k-version-lifecycle-24/backup`

## Root cause

The previous screen conflated installed truth, latest catalog state, selected
target, and mutation action. It also rendered advisory review metadata as a
warning and left the first expanded release panel permanently loading because
the detail RPC was only wired to selector changes. The review also found that
an incompatible catalog option was disabled too early, the release changelog
and install diff shared one ambiguous field, unknown installed identity
inherited ready/no-update hero copy, and stale selector responses could race
the latest selection. The fix separates these states, maps the operation from
the confirmed installed release, keeps incompatible targets inspectable but
non-actionable, and rejects stale detail responses.

## Changed files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js`
- `zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc`
- `tests/ui/z2k-version-ux-behavior.test.mjs`
- Updated Components presentation, lifecycle, and version-detail contract tests.

## Behavioral result

- Installed truth and latest release are shown as separate facts.
- Known installed == selected renders `Переустановить <version>`.
- Newer selected release renders `Обновить до <version>` and an installed-to-selected transition.
- Older selected release renders `Откатить до <version>` without a critical warning.
- Unknown healthy identity renders `Система работает` / `Версия Z2K требует уточнения` at page level and does not claim
  `Система готова` or `Обновления не требуются`; it retains the ready mandatory count and offers `Установить`.
- Incompatible selected release preserves the current component health and disables mutation.
- Changelog (`releaseChanges`, `previous -> selected`) and installed-to-selected install diff (`installChanges`) are
  separate contract fields; legacy `changes` is only an install-diff compatibility alias.
- An incompatible release remains selectable so its details can be inspected; only its mutation action is disabled.
- Rapid A/B selection cannot let a stale A detail response overwrite the latest B response.
- Expanded release details render the release body exactly once.
- Advisory review metadata is not promoted to a warning or hero count.
- The Z2K details panel has one primary operation action and no duplicate user-facing `Обновления` block or universal `Применить` action.
- Selector changes refresh only the release panel; no root remount is performed.
- Opening Details now automatically loads the selected release detail RPC.

## Focused verification

Passed:

- Focused review and related gate: `node --test tests/product/z2k-version-details-contract.test.mjs tests/ui/z2k-version-ux-behavior.test.mjs tests/ui/system-components-model.test.mjs tests/ui/system-components-z2k-truth-lifecycle.test.mjs tests/ui/system-components-details-presentation.test.mjs tests/ui/components-truth-normalization.test.mjs`: **59 passed, 0 failed**.
- JavaScript syntax checks for the changed model and maintenance view: passed.
- `git diff --check`: passed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed; Quartz SHA `ab346fa66a895e12d63a308e70ce330ba795822a`.

The exact broad command was:

`$files = @(Get-ChildItem tests/product,tests/ui -Filter 'z2k-*.test.mjs' -File | ForEach-Object FullName); node --test $files`

Current branch result: **69 passed, 9 failed / 78 total**. The isolated
baseline at `d44341d0f7acff7a6e181a9776bc50ab6b2e4dc8` produced **55 passed,
9 failed / 64 total** with the same nine failure classes: one stale candidate
compatibility assertion, five native-ucode materialization checks, one native
ucode signed-fixture check, one stale upstream-classification assertion, and
one Vitest test file that cannot start because this checkout has no `vitest`
dependency. The review changes add no broad failure class; no focused UX test
failed.

## Live router and Browser evidence

Target: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager#/components`
in the Codex in-app Browser, with cache disabled. Authentication was already
available; no router password or SSH credential was entered.

Direct router detail RPC/CLI after final deployment:

| Selected | Installed | Operation | Installable | Diff |
| --- | --- | --- | --- | --- |
| `r-79.7` | `r-79.7` | `reinstall` | yes | 0 / 0 / 0 |
| `r-79.1` | `r-79.7` | `downgrade` | yes | 0 / 0 / 0 |
| `r-80.3` | `r-79.7` | `upgrade` | yes | 2 / 2 / 6 |

Diff columns are modified / added / removed and are derived from the
confirmed installed manifest.

Real mutation cycle, executed through the canonical prepare -> explicit
confirmation -> update CLI path, with a pre-mutation snapshot at installed
`r-79.7`, confirmed receipt authority, Lua `7/7`, registry revision `4`,
running `zapret2`/`zapret2-manager`, autocircular state hash
`15714f313702a025d91b8ddc92f9e08bb299cc36d0295359de7195c2ad9d9ff1` (423
lines), and config hash
`26c96c5a9655a3fe1949b157f5d6b8a976d0621d5e04db45f066543c04ed5cfa`:

| Cycle | Result | Postflight | Receipt / runtime |
| --- | --- | --- | --- |
| Upgrade `r-79.7 -> r-80.3` | `ok=true`, `updated=39`, registry revision `5` | `verified=39`, `postflightMatched=39` | receipt `r-80.3`, 39 assets; Lua `7/7`; services running; nfqws2 PID `7943`, qnum `300`; nft queues `300` |
| Downgrade `r-80.3 -> r-79.7` | `ok=true`, `updated=43`, registry revision `6` | `verified=43`, `postflightMatched=43` | receipt `r-79.7`, 43 assets; Lua `7/7`; services running; runtime/autocircular/config unchanged |
| Reinstall `r-79.7 -> r-79.7` | `ok=true`, `updated=43`, registry revision `7` | `verified=43`, `postflightMatched=43` | receipt `r-79.7`, 43 assets; Lua `7/7`; services running; runtime/autocircular/config unchanged |

Final direct status: installed release `r-79.7`, confidence `confirmed`,
authority `activation-receipt`, status `update-available`, attention
`review-advisory`, `canApply=true`, Lua `7/7`, registry revision `7`; the
advisory validator file remains non-blocking and is not promoted into the
primary UI. The active nft table is `inet zapret2`; TCP/UDP queue rules target
`300` in both directions.

Browser DOM acceptance:

- Current `r-79.7`: `✓ Эта версия уже установлена.`, install diff says no
  changes, sole action `Переустановить r-79.7`.
- Newer `r-80.3`: `Доступно обновление`, transition
  `r-79.7 → r-80.3`, diff `2 / 2 / 6`, sole action `Обновить до r-80.3`.
- Older `r-79.1`: `Будет установлена более ранняя версия.`, transition
  `r-79.7 → r-79.1`, sole action `Откатить до r-79.1`.
- Final DOM returned to current `r-79.7`; no error class was present and the
  Browser error/warn log was empty. After the live upgrade, downgrade, and
  reinstall, the page was reloaded and the current catalog was reopened.
- Unknown-installed-identity and incompatible-target behavior are covered by
  the focused interaction tests: the former removes ready/no-update hero copy
  while retaining the `2 / 2` ready count; the latter selects a non-installable
  option, preserves current health, and disables only the action. The live
  catalog had no natural target for either synthetic state.

Responsive Browser evidence had no document horizontal overflow at effective
CSS widths 1441, 1023, and 764 px. The fact grid used 4, 2, and 1 columns
respectively; the mobile operation button stayed within its action container.

Screenshots:

- `C:\Users\Kirill\.codex\visualizations\2026\08\28\01a04771-7236-78c2-94ab-bb31c8714c08\z2k-components-css-1440x900.png`
- `C:\Users\Kirill\.codex\visualizations\2026\08\28\01a04771-7236-78c2-94ab-bb31c8714c08\z2k-components-css-1024x768.png`
- `C:\Users\Kirill\.codex\visualizations\2026\08\28\01a04771-7236-78c2-94ab-bb31c8714c08\z2k-components-css-768x900.png`

## SHA proof

All hashes below are SHA-256. HTTP responses were fetched from the live
router with `cache: no-store`.

| File | Local | Router | HTTP |
| --- | --- | --- | --- |
| `z2m-components-model.js` | `96f6196903b778198713086c1c715f389114f0a9bc242f7aad33fed068f5277d` | same | same |
| `z2m-components.css` | `a3d20aefe20b6ac02875b983fb4b15cc2f8ad73f37808e62c3cc0f3db4c601ba` | same | same |
| `z2m-maintenance.js` | `2aea343c9af48787e07dbf249cd18f478d5edcc4ebdab96fcdb5017ba8ff2f44` | same | same |
| `z2k-versions.uc` | `a8b2a8dfa7cb8cde1c8cc71ac3b0ce1eba6b4276a318e4d9f4036873b0e150eb` | same | n/a |

## Final verdict

**Z2K VERSION UX — READY for the approved known-version lifecycle and
synthetic review-state acceptance; broad baseline remains separately
classified.**

The supported known-version lifecycle is live and verified on the router for
current, upgrade, downgrade, and reinstall. Exact boundaries are:

1. The current router catalog has no incompatible target and has a confirmed
   installed release, so incompatible-selection and unknown-installed-identity
   cannot be honestly proven live without changing registry/receipt state.
   They are covered by focused interaction tests; the natural known-version
   browser paths are live-verified.
2. The broader repository Z2K test group remains 69/78 on this branch and
   55/64 on the isolated baseline with identical nine failures. These are
   stale/environmental gates, not a regression from this review fix; the
   Vitest contract remains unavailable until its dependency is provisioned.

The final router state is healthy with installed release `r-79.7`; both
services run, Lua is `7/7`, and the runtime strategy/autocircular/nft contract
remained intact across all three mutations.
