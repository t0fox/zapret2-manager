---
id: public-uninstall
title: "Удаление"
type: guide
status: current
authority: user-guide
updated: 2026-08-22
publish: true
tags: [start, uninstall]
---

# Удаление

Остановите и отключите Engine на странице **Управление**, затем удалите APK
обычным менеджером пакетов OpenWrt. Перед удалением сделайте backup, если нужно
сохранить Strategy, DNS-профили, service-DNS или learned state.

Telegram Proxy, WARP и Engine имеют собственный lifecycle. Удаление manager APK
не следует описывать как автоматическое удаление этих optional-компонентов:
проверьте их состояние и используйте их owner page.
