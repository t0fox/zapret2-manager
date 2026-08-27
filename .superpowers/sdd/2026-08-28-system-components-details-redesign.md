---
title: System Components details redesign
date: 2026-08-28
status: verified-live
---

# System Components details redesign

## Scope

The System > Components presentation was rebuilt around the existing Components
owner. EnginePanel remains available for its standalone consumers, but it is no
longer rendered inside the Components page. The mandatory cards stay compact;
one active full-width details panel appears below them and switching Engine/Z2K
is exclusive.

The redesign keeps the existing RPC/update architecture and mutation contracts.
It adds no second writer, catalog, provider, or backend state model.

## UI changes

- Engine details now have one header, four primary facts, explicit Updates,
  separate Service Management, collapsed Technical Details, and a collapsed
  red Danger Zone.
- Z2K details use the same language: four facts, installed/available/revision
  update rows, a standalone semantic-review callout, and collapsed provenance
  and hash details.
- Available updates expose primary `Обновить` and secondary `Проверить снова`;
  current state exposes `Проверить обновления`; review-required state never
  invents an update action.
- Unknown installed release with healthy materialized assets renders
  `Не определён`; genuinely missing assets render `Не установлен`.
- Fact grids respond as 4 columns on wide screens, 2 on medium screens, and 1
  on narrow screens. Ordinary values use natural wrapping and the page has no
  horizontal overflow in live checks.

## Baseline and final evidence

- Baseline source commit: `0aaa0c8beb0239bf768a7044d4c90bbce5d9af56`.
- Deployed/runtime source commit: `feaf96abc9dcc0dcd5034db1f457161c017fdf05`.
- Cache-busting revision: `components-details-redesign-20260828`.
- Baseline screenshots:
  `C:\Users\Kirill\.codex\visualizations\2026\08\28\components-baseline\before-components-collapsed-1920.png`,
  `before-engine-expanded-1920.png`, `before-z2k-collapsed-1920.png`,
  `before-z2k-expanded-1920.png`, `before-both-expanded-1920.png`,
  `before-both-expanded-1024.png`.
- Final screenshots:
  `C:\Users\Kirill\.codex\visualizations\2026\08\28\components-after\engine-expanded-1920.png`,
  `z2k-expanded-1920.png`, `engine-expanded-1024.png`,
  `z2k-expanded-1024.png`, `components-collapsed-1920.png`.
- Reference screenshot:
  `C:\Users\Kirill\.codex\visualizations\2026\08\28\components-after\dpi-management-reference-1920.png`.

The browser was left on Components after the final check. The router warning
`No password set!` is pre-existing router state and is unrelated to this UI
slice.

## Verification

- Focused Components suite: `48/48` passed.
- JavaScript syntax check for `z2m-maintenance.js`: passed.
- `git diff --check`: passed before task-report creation.
- Knowledge validator: the existing unrelated failure remains:
  `docs/07-decisions/2026-08-24-tg-proxy-feed-lifecycle.md: missing frontmatter`.
- Broader UI suite: `548` tests, `499` passed, `49` failed. The failures are
  outside the changed Components tests and include three files that cannot
  start because `vitest` is not installed, plus existing donor/navigation,
  Scanner, dashboard, and contract assertions.
- Full repository test matrix was attempted; it was not green and surfaced
  `tests/native/bootstrap.test.mjs`. It is not part of this UI closure.
- Browser console errors after the final states: `0`.
- Live layout checks: no horizontal overflow; Engine and Z2K each render one
  details panel; no embedded `.z2m-component-engine-panel`; no clipped action
  buttons. At approximately 1440 CSS px the mandatory grid is 2 columns and
  facts are 4 columns; at approximately 1024 they are 1 and 2; at
  approximately 768 they are 1 and 1.

## Runtime identity

For each changed runtime asset, local SHA-256, the installed router file, and
the browser's CDP `Network.responseReceived` body matched byte-for-byte:

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `z2m-maintenance.js` | 67533 | `46cd78d0a846690dca0fa099f3982397d4ee759ef51a10d592d51d6f5559a164` |
| `z2m-components.css` | 42053 | `9dd760459c92c13272b1462851d08f0bdbd7779291ac5d702ade7958fdfabc7f` |
| `z2m-shell.js` | 13747 | `aa137e07e5ab8b90e17b7e704d02126f6b150f29d5acf0845bc7baad016f9c0c` |

The browser hard reload ran with CDP `Network.setCacheDisabled(true)` and
received HTTP 200 for all three changed assets.

## Delivery boundary

This is a presentation-layer closure only. Backend integration and any live
state-contract changes should be handled in a follow-up task against commit
`feaf96abc9dcc0dcd5034db1f457161c017fdf05`. No package install, reboot, or
unrelated runtime mutation was performed.

## Verdict

DESIGN READY for the System > Components presentation slice. Backend wiring is
intentionally deferred to the follow-up agent task.
