---
id: sdd-2026-08-29-remote-metadata-parity-browser-acceptance
title: "Remote metadata parity browser acceptance"
type: evidence
status: complete
updated: 2026-08-29
publish: false
tags: [z2m, browser, router, evidence]
---

# Browser acceptance

## Environment

- Target: OpenWrt `192.168.1.1`, app route under LuCI.
- Deployment: source-only, staged in
  `/tmp/z2m-remote-metadata-20260829-223003`; no package install and no APK
  build or install.
- Installed runtime files were copied with `root:root`, mode `0644`; their
  post-deploy SHA-256 values matched the local source files.
- `rpcd reload` was performed so the live UCode RPC surface reloaded the
  changed modules. The Telegram proxy service itself was not restarted.

## Confirmed flows

1. `#/components` rendered the system and both mandatory component cards. The
   live Engine card showed `Официальные release не найдены` and
   `Upstream ответил пустым каталогом. Установленное состояние движка не
   изменено.` instead of inventing a latest release. On a later reload the
   same card showed the stale-LKG warning, confirming that both empty and stale
   remote projections preserve the installed `v1.0.4` state.
2. `#/telegram-tunnel` rendered without the previous
   `latest.displayVersion` exception. Its overview retained the installed Rust
   `2.3.0` local state.
3. Telegram `Компонент` rendered Go and Rust remote catalogs with historical
   version selectors. Go showed `0.9.3-rev2` as latest and Rust showed `2.3.0`.
4. Selecting Go `0.9.3` changed the shared release panel to `Что нового в Go
   0.9.3`, showed `31 июля 2026`, the release name, its changelog bullets, and
   the matching official GitHub release URL. This confirms per-row release
   identity rather than a global latest changelog.
5. Browser DOM and screenshot checks showed no page-level error alert on the
   accepted Components or Telegram states after reload and `rpcd reload`.

## Boundaries

The browser evidence covers the live healthy/stale/empty projections available
from the current router data. A live network outage and a malformed upstream
payload were not injected into production; those failure branches are covered
by the WSL UCode fixtures and focused model tests. No mutation action was
started during browser acceptance.
