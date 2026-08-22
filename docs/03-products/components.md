---
id: public-components
title: "Система — Компоненты"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, components, engine, z2k]
---

# Система — Компоненты

Здесь находятся обязательные foundation-компоненты Z2M:

- **Zapret2 Engine** — traffic processing engine;
- **Z2K Core** — совместимая интеграция engine delta, runtime Lua/detectors и
  связанных данных, когда они подтверждены текущим package contract.

Ожидаемая верхняя сводка: **2 из 2 готовы — система готова к работе**.
Avatar не является системным компонентом. Telegram Proxy и WARP также имеют
свои owner pages.

Для Engine показываются installed version, base upstream, capabilities,
совместимость, service/autostart и доступные install/reinstall/update/remove.
Если написано «Требуется совместимая сборка», безопасного Update нет: текущий
контракт отверг произвольную upstream-версию.
