# Telegram Proxy Status / Activity verification

Date: 2026-08-21
Scope: current `main`; Status and Activity only, plus the one RPC argument adaptation required for the Activity full-journal link.

## Changed files

- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js`
- `luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-diagnostics-page.js`
- `tests/ui/telegram-proxy-status-activity-main.test.mjs`
- `tests/ui/dns-tg-donor-adaptation.test.mjs`

Scanner changes and all unrelated dirty files were preserved.

## Focused verification

- `node --check` passed for the changed JavaScript modules.
- Telegram-focused UI contract set: 41/41 passed.
- `git diff --check` passed.
- Activity reads canonical `events_tail`, filters structured `component/subsystem/owner/source` identities, and renders through `z2m-avatar-log` with an 8-row preview.
- Status has one coherent hero/connection/chain/additional-state section and one Status technical disclosure.

## Router acceptance

- Router: `root@192.168.1.1`.
- Deployment used `scp -O`; no APK or backend/lifecycle file was deployed.
- Deployed `z2m-proxy-page-core.js` SHA-256: `69acc814a727bbd743a4961854c6c2478009ee38dc58a58bd706fdb4880d7619`.
- Deployed `z2m-diagnostics-page.js` SHA-256: `1a9e7b41d439edfd9f022ed859774735ce47b2d52c304f9acda5134ec940d30f`.
- Live Status showed Rust `2.2.4`, running process, listener `192.168.1.1:1443`, and confirmed Telegram DC connection.
- Live Activity showed `Событий Telegram Proxy пока нет.` and zero `.log-row` entries. Router `events_tail` returned 116 events, 0 TG `source` identities, and only `healthcheck, watchdog` non-TG sources.
- `Открыть все журналы →` navigated to `#/logs`; full journal loaded after passing the canonical JSON-string `edit` argument.
- Home screenshot confirmed the shared canonical journal presentation.

No synthetic TG event was created because the router currently has no real `source=proxy` event and the requested scope excludes lifecycle/backend mutations.

## Broader suite boundary

The complete `tests/ui` run reported 293 tests: 275 passed and 18 failed in pre-existing unrelated provenance, Strategy, P01/P02/P03, Healthcheck, monitoring, module-closure, and ACL contracts. None were in the Telegram-focused 41-test set above.
