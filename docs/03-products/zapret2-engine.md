---
id: zapret2-engine
title: "Движок Zapret2 (Engine)"
type: product
status: current
authority: current-ui
updated: 2026-08-22
publish: true
tags: [technology, engine]
code: [zapret2-manager/files/usr/libexec/zapret2-manager/engine-gate.uc#engine_gate_status]
---

# Zapret2 Engine

Zapret2 Engine — системный runtime для `nfqws2`. В Z2M он проверяется через
**Система → Компоненты**; единственный источник Engine —
`necronicle/zapret2-z2k`, а UI не выбирает поставщика.

## Что проверяется

Страница компонентов показывает наличие binary, Z2K release, capability и
совместимость с текущими Strategy/assets. Установка дополнительно проверяет
`nfqws2 --version` и SHA-256 `nfqws2` по `sha256sum.txt`; без этого runtime не
считается подтверждённым.

## Обновление

Обновление Engine проходит через owner компонента и сохраняет транзакцию
`fetch → verify → stage → install → runtime verify → rollback`. После него
проверяются runtime process, NFQUEUE owner, активная Strategy, SHA-256 и
сохранность manager state. Одного факта скачивания файла недостаточно.
