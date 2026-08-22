---
id: api-rpc
title: "API и RPC"
type: architecture
status: current
authority: evidence
updated: 2026-08-22
publish: true
tags: [development, api, rpc]
code: [zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc#strategies_apply]
---

# API и RPC

UBUS methods разделены на bounded read, edit и async operations. Ошибка
возвращается структурой `{ ok: false, error: { code, message } }`, а не
теряется в `UBUS Unknown error`.

Для Strategy важны `list`, `get`, `preview`, `validate`, `create/update`,
`duplicate`, `favorite` и `apply`; для Scanner — start/status/results/stop и
handoff. Request temp files имеют bounded size и private permissions.
