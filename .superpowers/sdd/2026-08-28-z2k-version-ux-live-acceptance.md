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
- Final SHA: `d80eb27f7fe3187cf4dc49671f4fc38b9946ea14`
- Branch: `codex/z2k-version-lifecycle`
- GitHub proof: `HEAD == origin/codex/z2k-version-lifecycle == d80eb27f7fe3187cf4dc49671f4fc38b9946ea14`
- Router deployment: final SHA, reviewed closure, backup at
  `/tmp/z2m-deploy-z2k-version-lifecycle-23/backup`

## Root cause

The previous screen conflated installed truth, latest catalog state, selected
target, and mutation action. It also rendered advisory review metadata as a
warning and left the first expanded release panel permanently loading because
the detail RPC was only wired to selector changes. The fix separates these
states, maps the operation from the confirmed installed release, and loads
the selected release when the panel is first opened.

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
- Unknown healthy identity renders `Работает` and `Версия не определена`; it offers `Установить`.
- Incompatible selected release preserves the current component health and disables mutation.
- Changelog and installed-to-selected install diff are separate sections.
- Advisory review metadata is not promoted to a warning or hero count.
- The Z2K details panel has one primary operation action and no duplicate user-facing `Обновления` block or universal `Применить` action.
- Selector changes refresh only the release panel; no root remount is performed.
- Opening Details now automatically loads the selected release detail RPC.

## Focused verification

Passed:

- `node --test tests/ui/z2k-version-ux-behavior.test.mjs tests/ui/system-components-details-presentation.test.mjs tests/ui/system-components-z2k-truth-lifecycle.test.mjs tests/ui/system-components-z2k-version-catalog.test.mjs tests/product/z2m-components-model.test.mjs tests/product/z2m-maintenance.test.mjs tests/product/z2m-maintenance-ctx.test.mjs tests/product/z2k-version-details-contract.test.mjs`: **62 passed, 0 failed**.
- JavaScript syntax checks for the changed model and maintenance view: passed.
- `git diff --check`: passed.
- `node scripts/validate-knowledge.mjs`: passed.
- `node scripts/docs.mjs verify`: passed; Quartz SHA `ab346fa66a895e12d63a308e70ce330ba795822a`.

The broader `tests/product,z2k-*` plus `tests/ui,z2k-*` run was **65 passed,
9 failed**. The failures are outside this UX gate: one stale candidate
compatibility assertion, five native-ucode materialization checks, one native
ucode signed-fixture check, one stale upstream-classification assertion, and
one Vitest test file that cannot start because this checkout has no `vitest`
dependency. No focused UX test failed.

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
confirmed installed manifest. Browser selection did not invoke any mutation;
the installed router state remained `r-79.7`.

Browser DOM acceptance:

- Current `r-79.7`: `✓ Эта версия уже установлена.`, install diff says no
  changes, sole action `Переустановить r-79.7`.
- Newer `r-80.3`: `Доступно обновление`, transition
  `r-79.7 → r-80.3`, diff `2 / 2 / 6`, sole action `Обновить до r-80.3`.
- Older `r-79.1`: `Будет установлена более ранняя версия.`, transition
  `r-79.7 → r-79.1`, sole action `Откатить до r-79.1`.
- Final DOM returned to current `r-79.7`; no error class was present and the
  Browser error/warn log was empty.

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
| `z2m-components-model.js` | `cb10fb0720064004149f8210ce772a0dd83aed766bcb14d28f4714224ff2f404` | same | same |
| `z2m-components.css` | `a3d20aefe20b6ac02875b983fb4b15cc2f8ad73f37808e62c3cc0f3db4c601ba` | same | same |
| `z2m-maintenance.js` | `674daa522d28e4c095e6f2302e4b49bdde524d7ed577dd0948cfa869b8777c69` | same | same |
| `z2k-versions.uc` | `36e1fc930fb41e193be9f3a5e65efddecfca1afb18ff447d3094792b1e705841` | same | n/a |

## Final verdict

**Z2K VERSION UX — NOT READY for strict all-path Browser acceptance.**

The supported known-version lifecycle is live and verified on the router for
current, upgrade, and downgrade. Exact remaining blockers are:

1. The current router catalog has no incompatible target and has a confirmed
   installed release, so incompatible-selection and unknown-installed-identity
   cannot be honestly proven live without changing registry/receipt state.
   They are covered by focused behavioral tests, not claimed as Browser proof.
2. The broader repository Z2K test group remains 65/74 because of the listed
   stale/environmental failures; the Vitest contract is unavailable until its
   dependency is provisioned.

No mutation was executed during Browser acceptance. The final router state is
healthy with installed release `r-79.7`.
