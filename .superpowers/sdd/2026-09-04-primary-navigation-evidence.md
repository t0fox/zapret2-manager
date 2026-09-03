---
title: Primary horizontal navigation acceptance evidence
status: READY_FOR_UI_REVIEW
date: 2026-09-04
---

# Outcome

The primary horizontal navigation is implemented as a scoped UI change. The
six existing top-level routes and labels are unchanged; only the primary row's
presentation, shared SVG anchors, and keyboard/overflow behavior were touched.
Secondary navigation, page content, backend ownership, and the app header were
not changed by this task.

## Implementation

- Branch: `codex/header-branding`
- Implementation HEAD: `79f894d522ce193be557a221df66c30540c25cca`
- Runtime deployment source: `b9ecf34f2b5ba8d984c71dabc7dba163b23999b4`
- Commits:
  - `4d59f8b8 feat: center primary navigation cluster`
  - `64af3b72 docs: record primary navigation deploy closure`
  - `b9ecf34f fix: preserve primary navigation focus`
  - `79f894d5 test: align dashboard navigation contract`
- Worktree: `G:\zapret2-manager\.worktrees\canonical-header-branding`
- Final worktree status: clean after this evidence artifact is committed.

## Four design skills

All four required design/UI evaluations were completed and recorded before
implementation in `2026-09-03-primary-navigation-design.md`:

1. Emil design engineering — compact focal cluster, stable 40px click height,
   quiet 16px anchors, underline-only active emphasis, bounded active reveal.
2. Design consultation — reuse existing Z2M tokens and shared SVG registry,
   preserve visible labels and semantic tabs, start-aligned small-screen scroll.
3. Design review — correct the primary track alignment only, keep the secondary
   row text-only, use one monochrome outline contract, preserve focus-visible.
4. Web Interface Guidelines — semantic tab buttons, decorative SVG semantics,
   explicit transitions, reduced motion, no wrapping, and touch/keyboard scroll.

Consolidated result: `DESIGN_APPROVED_FOR_IMPLEMENTATION`; no IA, route, or
secondary navigation changes were introduced.

## UI contract

- Order and labels: `Главная`, `Обход DPI`, `Прокси и маршрутизация`,
  `Списки и данные`, `Диагностика`, `Система`.
- Route targets remain the existing `#`, `#/warp`, `#/proxy`, `#/data`,
  `#/diagnostics`, and `#/system` concepts.
- Icon set is the one shared `z2m-icons.js` outline registry: `dashboard`,
  `shield-check`, `route`, `database`, `activity`, `settings`.
- Every icon is a decorative 16px SVG with `aria-hidden="true"`,
  `focusable="false"`, viewBox `0 0 24 24`, stroke width `2`, round caps and
  joins. Labels remain visible accessible text.
- Desktop uses a centered compact cluster with 12px inline breathing room;
  buttons keep 40px minimum height and a 7px icon/label gap.
- Active state remains blue icon/text plus the existing thin blue underline;
  inactive state is muted gray, and hover/focus do not introduce pills.
- Below 900px the row is a single-line, start-aligned horizontal scroll track;
  labels and icons stay present, the active tab is revealed after rerender,
  and no hamburger or wrapping was added.
- Keyboard behavior remains semantic: `role="tab"`, `aria-selected`, roving
  tabindex, ArrowLeft/ArrowRight/Home/End, and focus-visible styling.

## Verification

- Focused UI/runtime/package matrix: **43 passed, 0 failed**.
- `node --check` passed for `z2m-shell.js`, `z2m-navigation.js`, and
  `z2m-icons.js`.
- `git diff --check` passed.
- `node scripts/validate-knowledge.mjs` passed.
- Browser console errors: `[]` on the final live matrix.
- Desktop keyboard acceptance: selecting `Обход DPI` then ArrowRight produced
  active and focused `Прокси и маршрутизация`, with one selected tab and the
  expected roving tabindex.
- Exact 390px acceptance: six icons remained present, no wrap, and selecting
  `Система` auto-revealed it (`scrollLeft=510`, active tab visible).
- Exact 430px acceptance: `Обход DPI` active and visible, six icons present,
  secondary navigation still rendered.

## Router and HTTP closure

- Target: `root@192.168.1.1`, OpenWrt; deployed through the reviewed four-file
  manifest `.superpowers/sdd/2026-09-03-primary-navigation.deploy.manifest`.
- Backup from the final runtime deployment:
  `/tmp/z2m-primary-navigation-20260903-ps4/backup`.
- `rpcd reload` was used; no service restart or backend mutation was run.
- Router runtime remained healthy: `nfqws2` PID `2118`.
- Local repository source, router filesystem, and HTTP-served bytes matched for
  every checked asset; HTTP returned `200 OK`:

| Asset | SHA-256 |
| --- | --- |
| `app.js` | `1f93138340438d642f5933304c3d479d538b0416dfa354db7090cea96d9fbc7c` |
| `z2m-shell.js` | `5f87a90170bb017980a4b3adebf567b588d63288adad5de47e351971e9dd7ae0` |
| `z2m-navigation.js` | `03bc758277a89dc90326161ec6cb3c53af331bf7e1d42ab4ed8541fc382e453b` |
| `z2m-icons.js` | `9acd5c94d97d8495c5ae477458cd6636dbe1b1b1f55bd9ff2f5bf6514f418e55` |
| `z2m-ui.css` | `3cdee3207fff00687ae674711d8b538d34889f25d424b89100be8719efebe2a1` |

## Browser screenshot matrix

Captured from the final live router page and visually inspected:

- 1440px: centered cluster, active `Главная` and active `Обход DPI` captures.
- 1280px: centered cluster, active `Обход DPI`.
- 1024px: centered cluster, active `Главная`.
- 768px: single-line overflow track, active `Главная` visible.
- Exact 390px: start-aligned overflow track, active `Главная` visible.
- Exact 430px: start-aligned overflow track, active `Обход DPI` visible.

Screenshots:

- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-1440-dashboard.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-1440-dpi.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-1280-dpi.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-1024-dashboard.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-768-dashboard.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-390-dashboard.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-nav-430-dpi.png`

## Review boundary

Technical correctness, responsive behavior, accessibility, router deployment,
and HTTP byte identity are verified. Final visual acceptance remains with the
user; no `UI DONE` claim is made before that approval.

Status: `READY_FOR_UI_REVIEW`
