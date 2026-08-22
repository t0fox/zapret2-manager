---
id: runtime-ownership
title: "Владение runtime"
type: architecture
status: current
authority: canonical
updated: 2026-08-22
publish: true
tags: [development, ownership, runtime]
code: [zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc#strategies_apply_method]
---

# Владение runtime

Каноническая цепочка всегда важнее удобного shortcut: UI вызывает RPC facade,
facade передаёт операцию владельцу, owner меняет state/runtime и возвращает
structured evidence.

Scanner-orchestrator может существовать как исходный модуль, но не становится
production authority. Аналогично IDE не пишет firewall, DNS не создаёт второй
dnsmasq, а Monitoring не становится новым poller каждого subsystem.
