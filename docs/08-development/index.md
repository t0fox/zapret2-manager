---
id: development-index
title: "Разработка"
type: index
status: current
authority: index
updated: 2026-08-13
publish: true
tags: [development, index]
---

# Для разработчиков

Публичное руководство описывает пользовательский workflow. Технические
документы ниже нужны для сопровождения и не являются инструкциями по обходу
owner boundaries:

- [Архитектура](../02-architecture/index.md)
- [Контракты](../04-contracts/index.md)
- [Паритет Avatar и Z2K](../05-parity/index.md)
- [Архитектурные решения](../07-decisions/index.md)
- [Процесс работы со знаниями](./knowledge-workflow.md)

Runtime ownership: Strategy владеет permanent Apply, Scanner создаёт только
transient candidate, DNS сохраняет existing writer, а Telegram Proxy и WARP
имеют отдельные lifecycle owners.

## Канонические технические страницы

- [Архитектура Z2M](./architecture.md)
- [Владение runtime](./runtime-ownership.md)
- [Жизненный цикл Strategy](./strategy-lifecycle.md)
- [Архитектура Scanner](./scanner-architecture.md)
- [Интеграция Z2K и Avatar](./z2k-avatar-integration.md)
- [Модель ресурсов и assets](./resource-asset-model.md)
- [API и RPC](./api-rpc.md)
- [Сборка APK](./apk-build.md)
