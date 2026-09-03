---
title: Canonical zapret2.manager app shell branding
status: READY_FOR_UI_REVIEW
date: 2026-09-03
---

# Outcome

The bounded LuCI app-shell branding task is implemented and deployed source-only
to the live router. The shell now renders the canonical `zapret2.manager`
wordmark and README Passage mark, keeps host/runtime status dynamic, and leaves
the existing navigation owner and backend untouched.

## Implementation

- Branch: `codex/header-branding`
- Implementation HEAD: `130ffcc4d9bb6856e2b562ae8adeb7070550f888`
- Commit: `130ffcc4 style: refresh zapret2 manager app branding`
- Worktree: `G:\zapret2-manager\.worktrees\canonical-header-branding`
- Final worktree status: clean
- Files changed:
  - `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js`
  - `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js`
  - `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css`
  - `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/icons/zapret2-manager-mark.svg`
  - `tests/ui/app-shell-branding.test.mjs`
  - `.superpowers/sdd/2026-09-03-canonical-header-branding.deploy.manifest`

## Brand and behavior

- Product identity is exactly `zapret2.manager`; the old `zapret2·manager`
  presentation and textual `z2` placeholder are absent from the app header.
- The packaged SVG is byte-identical to
  `assets/brand/zapret2-manager-mark.svg`.
- The logo is decorative (`alt=""`, `aria-hidden="true"`); the visible
  wordmark remains accessible text.
- Host remains `window.location.hostname || 'OpenWrt'`; no router address is
  hardcoded.
- Runtime labels remain state-derived: `Работает`, `Остановлено`, `Недоступно`,
  `Требует внимания`, and the existing mismatch state.
- The existing `Shell.primaryNavigation(...)` owner and six navigation groups
  are unchanged.
- CSS cache-bust is `header-branding-20260903-r1` to force the live LuCI page to
  request the reviewed stylesheet.

## Local verification

- TDD RED was observed before production edit: 4 expected branding failures,
  with the navigation-owner assertion itself corrected before implementation.
- Final focused UI/runtime/package matrix: `27 passed, 0 failed`.
- `node --check` passed for `app.js` and `z2m-shell.js`.
- `git diff --check` passed.
- `node scripts/validate-knowledge.mjs` passed after every repository file
  modification.
- Aggregate UI test run covered 710 tests and returned 656 passed / 54 failed.
  It is not a green gate: failures are existing unrelated contracts and host
  environment limits, including missing `vitest`, missing historical
  `docs/01-project/avatar-parity.md`, and unrelated source-contract failures.
  The final post-correction gate is the focused 27/27 matrix above.
- Package wildcard inclusion is covered by the focused package contract test;
  no APK build or install was needed for this source-only UI closure.

## Router and HTTP identity

- Target: `root@192.168.1.1`, OpenWrt 25.12.5, Cudy WBR3000UAX v1,
  mediatek/filogic.
- Deployment: reviewed `scripts/deploy-target.sh`, source-only manifest,
  OpenSSH `scp -O`, `rpcd reload` only.
- Backup: `/tmp/z2m-header-branding-20260903/backup` for the first deploy and
  `/tmp/z2m-header-branding-20260903-r2/backup` for the final correction.
- Router post-deploy runtime: `status_fast.serviceState=running`, NFQUEUE `300`,
  `nfqws2` PID `2118`; no lifecycle mutation was run.
- Final repository, router filesystem, and HTTP-served SHA-256 values:

| Asset | SHA-256 | Repo/router/HTTP |
| --- | --- | --- |
| `app.js` | `1f93138340438d642f5933304c3d479d538b0416dfa354db7090cea96d9fbc7c` | match |
| `z2m-shell.js` | `e6a96530291dd47d9d90bb4fd2a8a36deea1348b3416fde2bad94318af73e30b` | match |
| `z2m-ui.css` | `bfc7dd2939a9a5d9a75dd57f887af0fb509091f78761ac0e06224a0abbda1491` | match |
| `zapret2-manager-mark.svg` | `aa579c3a94b20b6d4a35fa08d82764958fa6c70df7c60e3a1f315fda51e357a2` | match |

All four HTTP requests returned `200 OK` with the expected byte length. The
final router files are `root:root`, mode `0644`; all four pre-deploy files are
recoverable in the final backup.

## Browser acceptance evidence

Live authenticated LuCI page: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager`.
The first render exposed stale browser cache and still showed the old shell;
browser cache was cleared once through the supported devtools surface, then the
page reloaded with the final assets. The final live DOM showed
`zapret2.manager`, host `192.168.1.1`, status `Работает`, loaded canonical mark,
the unchanged six navigation tabs, and zero console errors.

Responsive matrix (CSS viewport):

| Viewport | App/header inner width | Horizontal overflow | Host | Mark |
| --- | ---: | --- | --- | --- |
| 1440 | 1180 | none | visible | 32px |
| 1280 | 1180 | none | visible | 32px |
| 768 | 738 | none | visible | 32px |
| 430 | 400 | none | hidden | 30px |
| 390 | 360 | none | hidden | 30px |

Screenshots captured from the live router browser:

- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-zapret2-manager-overview-full-1440.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-zapret2-manager-1280.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-zapret2-manager-768.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-zapret2-manager-430.png`
- `C:/Users/Kirill/.codex/visualizations/2026/09/03/01a068cb-8c79-78e0-84a2-e0e6ecdf03af/router-zapret2-manager-390.png`

The live non-running status was not forced because stopping/restarting the
working router service would change runtime state outside this branding scope.
The non-running label mappings are covered by the local regression contract.

## Four design skill conclusions

1. Emil design engineering: the canonical mark is the single visual anchor;
   the header has no decorative motion, no `transition: all`, and preserves the
   existing reduced-motion behavior. The wordmark is one strong readable unit.
2. Design consultation: the README mark and exact project tokens are reused;
   the header stays a calm deep-navy shell and the canonical gradient is kept
   inside the logo rather than becoming a broad page treatment.
3. Design review: the hierarchy is mark → wordmark → runtime status → host;
   host/version yield on narrow screens, the nav remains the existing shell
   primitive, and rendered checks cover 1440/1280/768/430/390.
4. Web Interface Guidelines: decorative image semantics, visible status text,
   explicit image dimensions, `min-width:0`, ellipsis/truncation, focus ownership,
   and cache-busted asset loading were checked without widening the task into a
   global theme redesign.

## Review decision

The technical closure is ready for human visual review. Final product decision:
use the exact canonical Passage mark, exact `zapret2.manager` wordmark, navy
shell, dynamic green/attention/error status chip, desktop host, and mobile host
elision while preserving all existing navigation/page/backend ownership.

Status: `READY_FOR_UI_REVIEW`
