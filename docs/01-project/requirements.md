---
id: public-requirements
title: "Требования и совместимость"
type: guide
status: current
authority: release-config
updated: 2026-08-22
publish: true
tags: [start, compatibility, openwrt]
---

# Требования и совместимость

Официальная сборка Z2M закреплена на OpenWrt 25.12.5 для target
`mediatek/filogic`. Meta-package `zapret2-manager-full` устанавливается только
на этот target. Backend и LuCI должны быть из одного релиза.

## Что требуется

- OpenWrt с LuCI и поддержкой APK;
- `zapret2-manager`, `luci-app-zapret2-manager` и `zapret2-manager-full` одной версии;
- доступ к `rpcd`, `ucode`, `kmod-nfnetlink-queue` и `kmod-nft-queue` через зависимости backend;
- совместимая сборка Zapret2 Engine, если нужен обход DPI.

Telegram Proxy и WARP / MASQUE не являются обязательными зависимостями manager.
Их наличие проверяется на собственных страницах.

## Что проверить до установки

Сверьте target/subtarget роутера с release manifest. Не смешивайте APK из разных
релизов и не устанавливайте произвольный vanilla engine, если Компоненты
показывают, что он несовместим с текущим контрактом Z2M.
