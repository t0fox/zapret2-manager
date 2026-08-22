---
id: public-resources
title: "Ресурсы"
type: product-guide
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [ui, resources, assets]
---

# Ресурсы

Resource Center хранит **данные и runtime-assets**, а не системные компоненты.
В интерфейсе используются четыре смысловых вкладки:

- **Обновления** — доступные обновления данных;
- **Установленные** — активы, которыми владеет Asset Registry;
- **Пользовательские** — добавленные пользователем assets;
- **Источники** — provenance и источники каталога.

Avatar Catalog — источник данных каталога. Z2K Core — системный компонент на
странице Компоненты. Lua, blob и list-файлы могут отображаться в
«Установленных», потому что их отслеживает Asset Registry; это не превращает
«Z2K Resources» во второй устанавливаемый продукт.

Не импортируйте ресурс как Strategy вслепую: сначала проверьте provenance,
протокол и ссылки на файлы, затем используйте Preview/Validate в Strategy IDE.
