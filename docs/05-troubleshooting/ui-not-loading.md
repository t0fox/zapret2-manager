---
id: public-trouble-ui
title: "UI не загружается"
type: troubleshooting
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [troubleshooting, ui]
---

# UI не загружается

Проверьте, что backend и LuCI APK одной версии, `rpcd` отвечает, а в Журналах
нет bootstrap или ACL ошибок. Обновите LuCI без очистки persistent state.

Если проблема появилась после обновления, вернитесь к Компонентам и backup;
не удаляйте state-файлы вручную.
