---
id: public-installation
title: "Установка APK"
type: guide
status: current
authority: release-engineering
updated: 2026-08-22
publish: true
tags: [start, installation, apk]
---

# Установка APK

Скачайте из одного GitHub Release полный manager APK:

- `zapret2-manager-full` — backend, native helpers, ucode/runtime assets и LuCI
  для target `mediatek/filogic`.

На роутере установите их одной командой:

```sh
apk add --allow-untrusted ./zapret2-manager-full-<version>.apk
```

`--allow-untrusted` здесь означает установку APK без настроенной цепочки
подписи. Это не шифрование и не отключение проверок Z2M. После установки
пакет выполняет root-bootstrap, мигрирует каталог стратегий, инвалидирует LuCI
кэш, перезагружает RPC-индекс и запускает bounded readiness-проверку.

## После установки

Откройте LuCI → **zapret2-manager** → **Система → Компоненты**. Если bootstrap
или identity verification не прошли, не обходите ошибку: сначала восстановите
валидный snapshot и проверьте журналы.
