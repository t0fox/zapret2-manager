# Telegram Proxy UI deployment evidence

Date: 2026-08-21
Target: `root@192.168.1.1` (OpenWrt 6.12.94, aarch64)

## Scope

Deployed only the four LuCI runtime assets changed for the Telegram Proxy IA and main Dashboard status card:

- `z2m-proxy-page-core.js`
- `z2m-overview.js`
- `z2m-avatar-dashboard.js`
- `z2m-components.css`

No backend, RPC, lifecycle, APK, or router service files were changed.

## Transfer and verification

Files were staged with OpenSSH `scp -O` into `/tmp/z2m-ui-20260821-telegram-ia`, SHA-256 verified, backed up, and atomically moved into `/www/luci-static/resources/view/zapret2-manager/`.

Installed SHA-256 after the FullHD design-review pass:

- `z2m-proxy-page-core.js`: `95b640d1587111a613033e8f8e5b0c5862c45056b4697542b0e4f02fb6b8c871`
- `z2m-overview.js`: `6c973f412b11c49ca5308e1451facb155508e4f6ec5fc0565514c4fca97dcafd`
- `z2m-avatar-dashboard.js`: `b1e2c0a585df1eae1117fff16789a1c578df7b7969201eefd88a9ee5d0948dd0`
- `z2m-components.css`: `1038e8725c829bd49e1cd8c1a867dee1402d038df228c0dfdea80b7f103420bb`

Backups: `/tmp/z2m-ui-20260821-telegram-ia/backup`, `/tmp/z2m-ui-20260821-design-review-2/previous.css`, and `/tmp/z2m-ui-20260821-design-review-3/previous.css`.

The Codex in-app browser reached the real LuCI endpoint at `http://192.168.1.1/cgi-bin/luci/` without changing router credentials. At viewport `1920x1080`, the live browser verified:

- Telegram Proxy uses `Обзор / Компонент / Настройки / Журнал` and the same underline tab primitive as `Стратегии`.
- Telegram overview renders `Работает с ограничениями`, Rust `2.2.4`, listener `192.168.1.1:1443`, and the health chain.
- The main dashboard card renders `Telegram Proxy / Работает / Provider Rust / Версия 2.2.4` after the normal async load.
- The Component screen uses the shared panel rhythm with readable provider benefits (`13px / 20.8px`) and expanded row spacing.

The router's existing `No password set!` warning remains visible; no security settings were changed. One initial dashboard load showed transient RPC timeouts while switching views; a single bounded reload returned the live status card and events normally.
