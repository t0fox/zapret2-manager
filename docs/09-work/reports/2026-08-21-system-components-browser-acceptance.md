# System Components browser acceptance

Date: 2026-08-21  
Surface: Codex in-app Browser  
Target: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager?z2m=system-components-v2#/components`  
Viewport: `1920 x 1080`

## Acceptance evidence

- System exposes exactly three visible pages: `Компоненты`, `Резервные копии`, `Настройки`.
- `Компоненты` renders `2 / 2 готовы`; Engine is `Готов`, version `v1.0.4`; Z2K remains explicitly `Совместимость не подтверждена` / `Версия не установлена`.
- Engine management stays behind the Components page and shows the official `bol-van/zapret2` authority.
- `Резервные копии` shows the default action `Создать полный backup · Всё`; advanced scopes remain behind `Дополнительно`.
- `Настройки` contains only the supported `Расширенный режим` control.
- No `Avatar`, Telegram Proxy, WARP, or Resource Center ownership appears in the Components DOM.
- No install, update, reinstall, uninstall, delete, restore, or backup-create action was triggered.

## Design-review result

The first Full HD inspection exposed a real visual defect: `z2m-engine-hero` and `z2m-engine-source` had no layout rules, so their inline title/subtitle content appeared joined. The acceptance fix added a shared grid treatment, explicit line-height/wrapping, readable label/value rows, and a stacked narrow fallback while preserving the existing Main/Strategies shell typography.

After deployment, the Full HD screenshot and DOM check showed separate title/subtitle lines, separated source metadata, aligned status values, and consistent card/panel spacing across all three System pages.

## Deployment boundary

- Frontend/backend targets were deployed to the router with legacy OpenSSH SCP (`scp -O`).
- The final CSS SHA256 matched locally and remotely: `d23eed171b88350e3fbabd3520013640a879038a3016236b4af62ba269ef031f`.
- The pre-deployment router copies remain recoverable at `/tmp/z2m-backup-20260821-system-components`.
- This is live browser/UI acceptance evidence. A standalone `ucode -c` probe is not treated as backend syntax proof because the module requires its LuCI imports; the live Resource Center check and browser-rendered state are the runtime evidence boundary.
- The router currently reports an unset root password warning; that is pre-existing device security state and was not modified.
