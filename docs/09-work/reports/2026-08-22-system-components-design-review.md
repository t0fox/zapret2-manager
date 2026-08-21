# System Components visual follow-up

Date: 2026-08-22  
Surface: Codex in-app Browser  
Target: `http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager?z2m=system-components-v2#/components`  
Viewport request: `1920 x 1080` (desktop-only acceptance)

## Findings and fixes

- The Engine management wall dominated the first impression because it was expanded by default. It now stays collapsed on `#/components` and opens only through `#/components?component=engine`.
- The desktop management view read as one long technical column. The Engine state and official source/action panels now use a two-column layout at desktop widths.
- Component cards stretched into an unnecessarily tall row. The grid and cards now align content to the top.
- The System heading lacked the visual anchor used by the main product shell. Components, Backups, and Settings now use the matching page icon treatment.
- The status-panel subtitle was shortened to `Что нужно для работы` so the first screen scans faster.

## Browser evidence

- `#/components`: one management disclosure, `open === false`, no `open` attribute, page height `1080`.
- `#/components?component=engine`: one management disclosure, `open === true`, desktop grid computed as two tracks, page height `1635`.
- No install, update, reinstall, uninstall, delete, restore, or backup action was triggered.
- The router's existing unset-root-password warning was left unchanged.

## Verification

- Focused UI/product suite: `25/25` passed.
- Runtime files were transferred with `scp -O`; local and router SHA256 values matched for `app.js`, maintenance modules, and `z2m-ui.css`.
- This is scoped browser acceptance; it is not evidence that the unrelated full repository suite is green.
