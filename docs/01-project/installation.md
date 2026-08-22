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

Скачайте из одного GitHub Release три manager-пакета:

- `zapret2-manager` — backend, ucode/shell runtime и native helper;
- `luci-app-zapret2-manager` — LuCI-интерфейс;
- `zapret2-manager-full` — target-specific meta-package backend + LuCI.

На роутере установите их одной командой:

```sh
apk add --allow-untrusted \
  ./zapret2-manager-<version>.apk \
  ./luci-app-zapret2-manager-<version>.apk \
  ./zapret2-manager-full-<version>.apk
```

`--allow-untrusted` здесь означает установку APK без настроенной цепочки
подписи. Это не шифрование и не отключение проверок Z2M. После установки
backend выполняет root-bootstrap, создаёт базовые каталоги и перезагружает
RPC-индекс.

## После установки

Откройте LuCI → **zapret2-manager** → **Система → Компоненты**. Если bootstrap
или identity verification не прошли, не обходите ошибку: сначала восстановите
валидный snapshot и проверьте журналы.
